/**
 * Proxy STDIO MITM.
 *
 * Spawn del subprocess MCP server. Captura:
 * - stdout (NDJSON) → parseado a LogEntry (dirección s2c)
 * - stderr (texto libre UTF-8) → LogEntry con campo stderr
 * - stdin (cliente → server) → reenviado byte a byte + log con dirección c2s
 *
 * Spec: research/transports_summary.md
 *   "Server MUST NOT write anything to its stdout that is not a valid MCP message."
 *   "The server MAY write UTF-8 strings to its standard error (stderr) for logging purposes."
 *   "Messages are delimited by newlines, and MUST NOT contain embedded newlines."
 *
 * Nota Windows: abrimos stdin/stdout/stderr en binary mode para preservar
 * el framing NDJSON (sin traducción CRLF automática).
 */

import { spawn, ChildProcessByStdio } from 'child_process';
import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';
import { NdjsonParser } from './parser';
import { LogEntry, ServerConfig, Direction, JsonRpcMessage } from '../shared/types';
import type { ProxyWires } from './mcpClient';

export interface ProxyEvents {
  entry: (entry: LogEntry) => void;
  exit: (code: number | null, signal: NodeJS.Signals | null) => void;
  error: (err: Error) => void;
  /** Chunk crudo de stdout (NDJSON) — para consumers extra (cliente SDK). */
  data: (chunk: string) => void;
}

export declare interface StdioProxy {
  on<E extends keyof ProxyEvents>(event: E, listener: ProxyEvents[E]): this;
  emit<E extends keyof ProxyEvents>(event: E, ...args: Parameters<ProxyEvents[E]>): boolean;
}

export class StdioProxy extends EventEmitter {
  private child: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
  private stdoutParser = new NdjsonParser();
  private stderrBuf = '';
  private seq = 0;
  private _exited = false;

  /** Inicia el subprocess con la config dada. Idempotent. */
  start(config: ServerConfig): void {
    if (this.child) {
      throw new Error('proxy already running — call stop() first');
    }
    if (!config.command) {
      throw new Error('config.command is required');
    }

    // Spawn sin shell para que argv se respete literal. cwd: process.cwd().
    const proc = spawn(config.command, config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(config.env ?? {}) },
      windowsHide: true,
      // shell: false (default) — crítico para stdio determinista.
    }) as ChildProcessByStdio<Writable, Readable, Readable>;

    this.child = proc;
    this.stdoutParser = new NdjsonParser();
    this.stderrBuf = '';
    this._exited = false;

    // stdout (s2c) → NDJSON parser → LogEntry
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      this.emit('data', chunk); // consumers extra (cliente SDK) reciben el chunk crudo
      const msgs = this.stdoutParser.feed(chunk);
      for (const m of msgs) this.emitMessage('s2c', m);
    });
    proc.stdout.on('end', () => {
      // EOF en stdout → fin de sesión STDIO
      const tail = this.stdoutParser.flush();
      for (const m of tail) this.emitMessage('s2c', m);
      const pending = this.stdoutParser.pending;
      if (pending) this.emitErr(`[proxy] stdout closed with unparsed data: ${JSON.stringify(pending).slice(0, 200)}`);
    });

    // stderr (separado, no es canal MCP)
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk: string) => {
      this.stderrBuf += chunk;
      let nl = this.stderrBuf.indexOf('\n');
      while (nl !== -1) {
        const line = this.stderrBuf.slice(0, nl);
        this.stderrBuf = this.stderrBuf.slice(nl + 1);
        this.emitStderr(line);
        nl = this.stderrBuf.indexOf('\n');
      }
    });
    proc.stderr.on('end', () => {
      if (this.stderrBuf) this.emitStderr(this.stderrBuf);
      this.stderrBuf = '';
    });

    proc.on('exit', (code, signal) => {
      this._exited = true;
      this.child = null;
      this.emit('exit', code, signal);
    });

    proc.on('error', (err) => this.emit('error', err));
  }

  /**
   * Cliente → server: escribir un mensaje JSON-RPC completo al stdin del server.
   * Devuelve true si se enqueó, false si el proceso no está corriendo.
   */
  writeClientMessage(msg: JsonRpcMessage): boolean {
    if (!this.child || this._exited) return false;
    const line = JSON.stringify(msg) + '\n';
    try {
      this.child.stdin.write(line, 'utf8');
    } catch {
      return false;
    }
    this.emitMessage('c2s', msg, line);
    return true;
  }

  /** Escribe bytes crudos al stdin del server (para tests con strings no-JSON). */
  writeClientRaw(raw: string): boolean {
    if (!this.child || this._exited) return false;
    try {
      this.child.stdin.write(raw, 'utf8');
    } catch {
      return false;
    }
    return true;
  }

  /** Mata el proceso amablemente: cierra stdin, espera exit, luego SIGKILL. */
  async stop(timeoutMs = 2000): Promise<void> {
    const c = this.child;
    if (!c) return;
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        if (!this._exited) {
          try { c.kill('SIGKILL'); } catch { /* ignore */ }
        }
        resolve();
      }, timeoutMs);
      this.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
      try { c.stdin.end(); } catch { /* ignore */ }
      // SIGTERM por si no termina al cerrar stdin
      try { c.kill('SIGTERM'); } catch { /* ignore */ }
    });
  }

  /** ¿Está vivo el subprocess? */
  get running(): boolean {
    return this.child !== null && !this._exited;
  }

  /**
   * Wires para cablear un MCP client SDK al subprocess del proxy.
   * El write NO loguea (el transporte del cliente reporta el c2s), y el
   * onData entrega chunks crudos de stdout (además de los entries que el
   * proxy ya emite por 'entry').
   */
  wires(): ProxyWires {
    const self = this;
    return {
      write: (line: string) => self.writeClientRaw(line),
      onData: (cb: (chunk: string) => void) => {
        self.on('data', cb);
        return () => self.removeListener('data', cb);
      },
      onExit: (cb: () => void) => {
        const handler = () => cb();
        self.on('exit', handler);
        return () => self.removeListener('exit', handler);
      },
      running: () => self.running,
    };
  }

  private emitMessage(dir: Direction, msg: JsonRpcMessage, rawOverride?: string): void {
    const seq = ++this.seq;
    const ts = new Date().toISOString();
    const raw = rawOverride ?? JSON.stringify(msg);
    let kind: LogEntry['kind'];
    let rpcId: LogEntry['rpcId'];
    let method: string | undefined;
    let result: unknown;
    let error: LogEntry['error'] | undefined;
    let params: unknown;

    if ('method' in msg && !('id' in msg)) {
      kind = 'notification';
      rpcId = null;
      method = msg.method;
      params = msg.params;
    } else if ('method' in msg && 'id' in msg) {
      kind = 'request';
      rpcId = msg.id ?? null;
      method = msg.method;
      params = msg.params;
    } else if ('result' in msg || 'error' in msg) {
      kind = 'error' in msg && msg.error ? 'error' : 'response';
      rpcId = msg.id ?? null;
      result = msg.result;
      error = msg.error;
    } else {
      kind = 'notification'; // fallback
      rpcId = null;
    }

    const entry: LogEntry = { seq, ts, dir, kind, rpcId, method, result, error, params, raw };
    this.emit('entry', entry);
  }

  private emitStderr(line: string): void {
    const seq = ++this.seq;
    const entry: LogEntry = {
      seq,
      ts: new Date().toISOString(),
      dir: 's2c',
      kind: 'notification',
      rpcId: null,
      method: '[stderr]',
      raw: line,
      stderr: line,
    };
    this.emit('entry', entry);
  }

  private emitErr(msg: string): void {
    const seq = ++this.seq;
    const entry: LogEntry = {
      seq,
      ts: new Date().toISOString(),
      dir: 's2c',
      kind: 'error',
      rpcId: null,
      method: '[proxy]',
      raw: msg,
      error: { code: -1, message: msg },
    };
    this.emit('entry', entry);
  }
}
