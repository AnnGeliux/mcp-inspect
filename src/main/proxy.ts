/**
 * Proxy STDIO MITM con pipeline de interceptación.
 *
 * Spawn del subprocess MCP server. Captura:
 * - stdout (NDJSON) → pipeline → parseado a LogEntry (dirección s2c)
 * - stderr (texto libre UTF-8) → LogEntry con campo stderr
 * - stdin (cliente → server) → pipeline → reenviado + log con dirección c2s
 *
 * Phase 6 — interceptación: cada mensaje pasa por MITMPipeline antes de
 * entregarse. Sin reglas activas, la entrega es inmediata (read-only de
 * siempre). Con reglas, el mensaje se retiene hasta que el usuario decide
 * (send / send-modified / drop / respond). Ver pipeline.ts.
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
import { MITMPipeline } from './pipeline';
import { LogEntry, ServerConfig, Direction, JsonRpcMessage } from '../shared/types';
import type { ProxyWires } from './mcpClient';

export interface ProxyEvents {
  entry: (entry: LogEntry) => void;
  exit: (code: number | null, signal: NodeJS.Signals | null) => void;
  error: (err: Error) => void;
  /** Chunk crudo de stdout (NDJSON) — para consumers extra (cliente SDK). */
  data: (chunk: string) => void;
  /**
   * Chunk de stdout post-pipeline (solo mensajes ENTREGADOS al cliente).
   * El cliente SDK se suscribe aquí en vez de 'data' para no recibir lo
   * que el pipeline descartó/alteró de forma inconsistente con el log.
   */
  deliveredS2c: (chunk: string) => void;
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
  /** Pipeline MITM compartido con el main (reglas + holds). */
  readonly pipeline = new MITMPipeline();

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
    this.pipeline.clearCorrelation();

    // stdout (s2c) → pipeline → NDJSON parser → LogEntry
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      const msgs = this.stdoutParser.feed(chunk);
      for (const m of msgs) this.handleS2cMessage(m);
    });
    proc.stdout.on('end', () => {
      // EOF en stdout → fin de sesión STDIO
      const tail = this.stdoutParser.flush();
      for (const m of tail) this.handleS2cMessage(m);
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
   * Mensaje s2c (server → cliente): pasa por el pipeline. Si fluye, se loguea
   * Y se emite como deliveredS2c (chunks NDJSON para el cliente SDK). Si se
   * retiene, no se loguea todavía — se loguea al resolverse con los flags
   * held/modified/dropped correspondientes.
   */
  private async handleS2cMessage(msg: JsonRpcMessage): Promise<void> {
    const arrivedAt = Date.now();
    const result = await this.pipeline.process('s2c', msg, arrivedAt);

    if (result.msg === null) {
      // drop / respond: el original nunca se entrega. Se loguea como dropped.
      const corr = this.pipeline.correlateResponse('s2c', msg, arrivedAt);
      this.emitMessage('s2c', msg, undefined, {
        latencyMs: corr?.latencyMs,
        requestMethod: corr?.requestMethod,
        held: result.held,
        heldMs: result.heldMs,
        modified: result.modified,
        dropped: true,
        simulated: result.simulated,
      });
      return;
    }

    // Entregar: log entry + chunk al cliente SDK
    const corr = this.pipeline.correlateResponse('s2c', result.msg, arrivedAt);
    this.emitMessage('s2c', result.msg, undefined, {
      latencyMs: corr?.latencyMs,
      requestMethod: corr?.requestMethod,
      held: result.held,
      heldMs: result.heldMs,
      modified: result.modified,
      simulated: result.simulated,
    });

    const chunk = JSON.stringify(result.msg) + '\n';
    this.emit('deliveredS2c', chunk);
  }

  /**
   * Cliente → server: el mensaje pasa por el pipeline y se escribe al stdin
   * cuando resuelve. Devuelve true si el pipeline lo aceptó (aunque esté en
   * hold — el write real es async), false si el proceso no está corriendo.
   */
  writeClientMessage(msg: JsonRpcMessage): boolean {
    if (!this.child || this._exited) return false;
    const line = JSON.stringify(msg) + '\n';
    void this.writeC2sThroughPipeline(msg, line);
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

  /** Pipeline c2s: entregar al stdin del server cuando resuelva. Devuelve true si se aceptó al pipeline. */
  private async writeC2sThroughPipeline(msg: JsonRpcMessage, originalLine?: string): Promise<boolean> {
    const line0 = originalLine ?? JSON.stringify(msg) + '\n';
    const result = await this.pipeline.process('c2s', msg);

    if (result.msg === null) {
      // dropped por el usuario o por simulación (fault/mock c2s)
      this.emitMessage('c2s', msg, line0, {
        held: result.held,
        heldMs: result.heldMs,
        modified: result.modified,
        dropped: true,
        simulated: result.simulated,
      });
      // Simulación c2s (fault/mock): entregar la respuesta sintética al
      // cliente — el server nunca vio el request.
      if (result.syntheticResponse) {
        this.deliverSyntheticToClient(result.syntheticResponse, result.simulated);
      }
      return false;
    }

    const line = result.modified ? JSON.stringify(result.msg) + '\n' : line0;
    try {
      this.child?.stdin.write(line, 'utf8');
    } catch {
      return false; // proceso murió mientras se decidía — ignorar
    }
    this.emitMessage('c2s', result.msg, line, {
      held: result.held,
      heldMs: result.heldMs,
      modified: result.modified,
      simulated: result.simulated,
    });
    return true;
  }

  /**
   * Entrega una respuesta sintética al cliente (fault/mock c2s): log entry
   * s2c + chunk deliveredS2c. La correlación de latencia se calcula contra
   * el request original observado por el pipeline.
   */
  private deliverSyntheticToClient(response: JsonRpcMessage, simulated?: 'fault' | 'mock' | 'throttle'): void {
    const arrivedAt = Date.now();
    const corr = this.pipeline.correlateResponse('s2c', response, arrivedAt);
    this.emitMessage('s2c', response, undefined, {
      latencyMs: corr?.latencyMs,
      requestMethod: corr?.requestMethod,
      modified: true,
      simulated,
    });
    const chunk = JSON.stringify(response) + '\n';
    this.emit('deliveredS2c', chunk);
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

  /** Mata el proceso inmediatamente (SIGKILL, sin gracia). */
  kill(): void {
    const c = this.child;
    if (!c || this._exited) return;
    try { c.kill('SIGKILL'); } catch { /* ignore */ }
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

  /**
   * Wires post-pipeline: el cliente SDK envía y recibe solo a través del
   * pipeline de interceptación. El write enruta cada mensaje JSON-RPC por
   * pipeline.process('c2s') — retiene si hay breakpoint, loguea al resolverse
   * (una sola vez, con flags held/modified). El onData entrega solo los
   * chunks s2c entregados por el pipeline (consistente con el log).
   */
  deliveredWires(): ProxyWires {
    const self = this;
    return {
      write: (line: string) => {
        // Parsear el mensaje y enrutarlo por el pipeline (interceptable + logging único).
        let msg: JsonRpcMessage | null = null;
        try {
          const parsed = JSON.parse(line.trim());
          if (parsed && typeof parsed === 'object' && 'jsonrpc' in parsed) msg = parsed as JsonRpcMessage;
        } catch { /* línea no-JSON */ }
        if (msg === null) {
          // No JSON (no debería pasar con el SDK) — write crudo sin pipeline.
          return self.writeClientRaw(line);
        }
        return self.writeC2sThroughPipeline(msg);
      },
      onData: (cb: (chunk: string) => void) => {
        self.on('deliveredS2c', cb);
        return () => self.removeListener('deliveredS2c', cb);
      },
      onExit: (cb: () => void) => {
        const handler = () => cb();
        self.on('exit', handler);
        return () => self.removeListener('exit', handler);
      },
      running: () => self.running,
    };
  }

  private emitMessage(
    dir: Direction,
    msg: JsonRpcMessage,
    rawOverride?: string,
    extra?: {
      latencyMs?: number;
      requestMethod?: string;
      held?: boolean;
      heldMs?: number;
      modified?: boolean;
      dropped?: boolean;
      simulated?: 'fault' | 'mock' | 'throttle';
    },
  ): void {
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

    const entry: LogEntry = {
      seq,
      ts,
      dir,
      kind,
      rpcId,
      method,
      result,
      error,
      params,
      raw,
      ...(extra ?? {}),
    };
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