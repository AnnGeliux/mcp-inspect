/**
 * MITM STDIO proxy with interception pipeline.
 *
 * Spawns the MCP server subprocess. Captures:
 * - stdout (NDJSON) → pipeline → parsed into LogEntry (s2c direction)
 * - stderr (free-form UTF-8 text) → LogEntry with stderr field
 * - stdin (client → server) → pipeline → forwarded + logged with c2s direction
 *
 * Phase 6 — interception: every message goes through MITMPipeline before
 * being delivered. With no active rules, delivery is immediate (the usual
 * read-only behavior). With rules, the message is held until the user
 * decides (send / send-modified / drop / respond). See pipeline.ts.
 *
 * Spec: research/transports_summary.md
 *   "Server MUST NOT write anything to its stdout that is not a valid MCP message."
 *   "The server MAY write UTF-8 strings to its standard error (stderr) for logging purposes."
 *   "Messages are delimited by newlines, and MUST NOT contain embedded newlines."
 *
 * Windows note: we open stdin/stdout/stderr in binary mode to preserve
 * the NDJSON framing (no automatic CRLF translation).
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
  /** Raw stdout chunk (NDJSON) — for extra consumers (SDK client). */
  data: (chunk: string) => void;
  /**
   * Post-pipeline stdout chunk (only messages DELIVERED to the client).
   * The SDK client subscribes here instead of 'data' so it doesn't receive
   * what the pipeline discarded/altered inconsistently with the log.
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
  /** MITM pipeline shared with main (rules + holds). */
  readonly pipeline = new MITMPipeline();

  /** Starts the subprocess with the given config. Idempotent. */
  start(config: ServerConfig): void {
    if (this.child) {
      throw new Error('proxy already running — call stop() first');
    }
    if (!config.command) {
      throw new Error('config.command is required');
    }

    // Spawn without a shell so argv is respected literally. cwd: process.cwd().
    const proc = spawn(config.command, config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(config.env ?? {}) },
      windowsHide: true,
      // shell: false (default) — critical for deterministic stdio.
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
      // EOF on stdout → end of the STDIO session
      const tail = this.stdoutParser.flush();
      for (const m of tail) this.handleS2cMessage(m);
      const pending = this.stdoutParser.pending;
      if (pending) this.emitErr(`[proxy] stdout closed with unparsed data: ${JSON.stringify(pending).slice(0, 200)}`);
    });

    // stderr (separate, not an MCP channel)
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
   * s2c message (server → client): goes through the pipeline. If it flows, it is logged
   * AND emitted as deliveredS2c (NDJSON chunks for the SDK client). If it is
   * held, it is not logged yet — it is logged when resolved with the
   * corresponding held/modified/dropped flags.
   */
  private async handleS2cMessage(msg: JsonRpcMessage): Promise<void> {
    const arrivedAt = Date.now();
    const result = await this.pipeline.process('s2c', msg, arrivedAt);

    if (result.msg === null) {
      // drop / respond: the original is never delivered. Logged as dropped.
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

    // Deliver: log entry + chunk to the SDK client
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
   * Client → server: the message goes through the pipeline and is written to
   * stdin when it resolves. Returns true if the pipeline accepted it (even if
   * it is on hold — the actual write is async), false if the process is not
   * running.
   */
  writeClientMessage(msg: JsonRpcMessage): boolean {
    if (!this.child || this._exited) return false;
    const line = JSON.stringify(msg) + '\n';
    void this.writeC2sThroughPipeline(msg, line);
    return true;
  }

  /** Writes raw bytes to the server's stdin (for tests with non-JSON strings). */
  writeClientRaw(raw: string): boolean {
    if (!this.child || this._exited) return false;
    try {
      this.child.stdin.write(raw, 'utf8');
    } catch {
      return false;
    }
    return true;
  }

  /** c2s pipeline: deliver to the server's stdin when it resolves. Returns true if accepted into the pipeline. */
  private async writeC2sThroughPipeline(msg: JsonRpcMessage, originalLine?: string): Promise<boolean> {
    const line0 = originalLine ?? JSON.stringify(msg) + '\n';
    const result = await this.pipeline.process('c2s', msg);

    if (result.msg === null) {
      // dropped by the user or by a simulation (c2s fault/mock)
      this.emitMessage('c2s', msg, line0, {
        held: result.held,
        heldMs: result.heldMs,
        modified: result.modified,
        dropped: true,
        simulated: result.simulated,
      });
      // c2s simulation (fault/mock): deliver the synthetic response to the
      // client — the server never saw the request.
      if (result.syntheticResponse) {
        this.deliverSyntheticToClient(result.syntheticResponse, result.simulated);
      }
      return false;
    }

    const line = result.modified ? JSON.stringify(result.msg) + '\n' : line0;
    try {
      this.child?.stdin.write(line, 'utf8');
    } catch {
      return false; // process died while the decision was pending — ignore
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
   * Delivers a synthetic response to the client (c2s fault/mock): s2c log
   * entry + deliveredS2c chunk. Latency correlation is calculated against
   * the original request observed by the pipeline.
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

  /** Stops the process gracefully: closes stdin, waits for exit, then SIGKILL. */
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
      // SIGTERM in case it doesn't exit when stdin closes
      try { c.kill('SIGTERM'); } catch { /* ignore */ }
    });
  }

  /** Kills the process immediately (SIGKILL, no grace period). */
  kill(): void {
    const c = this.child;
    if (!c || this._exited) return;
    try { c.kill('SIGKILL'); } catch { /* ignore */ }
  }

  /** Is the subprocess alive? */
  get running(): boolean {
    return this.child !== null && !this._exited;
  }

  /**
   * Wires for hooking up an MCP SDK client to the proxy's subprocess.
   * The write does NOT log (the client's transport reports the c2s), and
   * onData delivers raw stdout chunks (in addition to the entries the
   * proxy already emits via 'entry').
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
   * Post-pipeline wires: the SDK client sends and receives exclusively
   * through the interception pipeline. The write routes each JSON-RPC message
   * through pipeline.process('c2s') — held if there's a breakpoint, logged
   * when resolved (once, with held/modified flags). onData delivers only
   * the s2c chunks delivered by the pipeline (consistent with the log).
   */
  deliveredWires(): ProxyWires {
    const self = this;
    return {
      write: (line: string) => {
        // Parse the message and route it through the pipeline (interceptable + single logging).
        let msg: JsonRpcMessage | null = null;
        try {
          const parsed = JSON.parse(line.trim());
          if (parsed && typeof parsed === 'object' && 'jsonrpc' in parsed) msg = parsed as JsonRpcMessage;
        } catch { /* non-JSON line */ }
        if (msg === null) {
          // Not JSON (shouldn't happen with the SDK) — raw write, bypassing the pipeline.
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