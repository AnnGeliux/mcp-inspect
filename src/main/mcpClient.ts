/**
 * MCP Client real (SDK oficial) cableado al proxy MITM.
 *
 * El Client del SDK hace el handshake completo (initialize → initialized)
 * sobre un Transport custom que reutiliza los wires del StdioProxy:
 *   - send() → stdin del server (el proxy no loguea raw writes)
 *   - stdout del server → onmessage del SDK (el proxy ya loguea s2c)
 * Así cada mensaje aparece exactamente una vez en la timeline del inspector.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { EventEmitter } from 'events';
import { LogEntry, Direction, JsonRpcMessage } from '../shared/types';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  CallToolRequest,
  GetPromptRequest,
  ListPromptsRequest,
  ListResourcesRequest,
  ListToolsRequest,
  ReadResourceRequest,
} from '@modelcontextprotocol/sdk/types.js';

/** Wires expuestos por el StdioProxy para cablear el cliente. */
export interface ProxyWires {
  /** Escribe una línea NDJSON cruda al stdin del server (sin loguear). */
  write: (line: string) => boolean;
  /** Suscripción a chunks NDJSON crudos del stdout del server. Devuelve unsub. */
  onData: (cb: (chunk: string) => void) => () => void;
  /** Suscripción al exit del subprocess server. Devuelve unsub. */
  onExit: (cb: () => void) => () => void;
  /** ¿Server vivo? */
  running: () => boolean;
}

export interface McpClientEvents {
  entry: (entry: LogEntry) => void;
  connected: (info: { serverName: string; serverVersion: string }) => void;
  closed: () => void;
  error: (err: Error) => void;
}

// __MCP_CLIENT_CONTROLLER__

export declare interface McpClientController {
  on<E extends keyof McpClientEvents>(event: E, listener: McpClientEvents[E]): this;
  emit<E extends keyof McpClientEvents>(event: E, ...args: Parameters<McpClientEvents[E]>): boolean;
}

/**
 * Controla un Client MCP real del SDK, cableado al proxy en vez de spawner
 * su propio subprocess. Ciclo:
 *   connectToProxy(wires) → client.connect(transport) → initialize handshake
 *   request/notify       → métodos MCP arbitrarios
 *   stop()               → close
 */
export class McpClientController extends EventEmitter {
  private client: Client | null = null;
  private transport: ProxyTransport | null = null;
  private seq = 0;
  private _connected = false;

  /**
   * Cablea el cliente SDK a los wires del proxy y ejecuta el handshake MCP
   * (initialize → initialized). El server ya debe estar corriendo via
   * proxy.start().
   */
  async connectToProxy(wires: ProxyWires, clientInfo: { name: string; version: string }): Promise<void> {
    if (this.client) {
      throw new Error('client already connected — call stop() first');
    }
    if (!wires.running()) {
      throw new Error('proxy not running — start the server first');
    }

    const transport = new ProxyTransport(wires, (dir, msg) => this.report(dir, msg));
    this.transport = transport;
    this.client = new Client(clientInfo, { capabilities: {} });

    this.client.onerror = (err) => this.emit('error', err);
    this.client.onclose = () => {
      this._connected = false;
      this.client = null;
      this.transport = null;
      this.emit('closed');
    };

    await this.client.connect(transport); // initialize + notifications/initialized
    this._connected = true;
    const sv = this.client.getServerVersion();
    this.emit('connected', {
      serverName: sv?.name ?? 'unknown',
      serverVersion: sv?.version ?? '?',
    });
  }

  /**
   * Request MCP. Despacha a los métodos tipados del SDK Client — cada uno
   * pasa su resultSchema correcto (mandar undefined al request() interno
   * rompe safeParse). Para métodos arbitrarios: envío raw del proxy.
   */
  async request(method: string, params?: unknown): Promise<unknown> {
    this.assertConnected();
    const c = this.client!;
    const opts: RequestOptions = { timeout: 15000 };
    switch (method) {
      case 'ping':
        return c.ping(opts);
      case 'tools/list':
        return c.listTools(params as ListToolsRequest['params'] | undefined, opts);
      case 'tools/call':
        return c.callTool(params as CallToolRequest['params'], undefined, opts);
      case 'resources/list':
        return c.listResources(params as ListResourcesRequest['params'] | undefined, opts);
      case 'prompts/list':
        return c.listPrompts(params as ListPromptsRequest['params'] | undefined, opts);
      case 'prompts/get':
        return c.getPrompt(params as GetPromptRequest['params'], opts);
      case 'resources/read':
        return c.readResource(params as ReadResourceRequest['params'], opts);
      default:
        throw new Error(`unsupported method for SDK client: ${method} — use raw send instead`);
    }
  }

  /** Notification MCP genérica (sin id → sin respuesta esperada). */
  async notify(method: string, params?: unknown): Promise<void> {
    this.assertConnected();
    const c = this.client as unknown as {
      notification: (args: { method: string; params?: unknown }) => Promise<void>;
    };
    await c.notification({ method, params });
  }

  get connected(): boolean {
    return this._connected;
  }

  /** Info del server tras el handshake (capabilities, nombre, versión). */
  getServerInfo(): {
    name?: string;
    version?: string;
    capabilities?: unknown;
    instructions?: string;
  } {
    this.assertConnected();
    const c = this.client!;
    return {
      name: c.getServerVersion()?.name,
      version: c.getServerVersion()?.version,
      capabilities: c.getServerCapabilities(),
      instructions: c.getInstructions(),
    };
  }

  async stop(): Promise<void> {
    const c = this.client;
    this.client = null;
    this.transport = null;
    this._connected = false;
    if (c) {
      try { await c.close(); } catch { /* ignore */ }
    }
  }

  private assertConnected(): void {
    if (!this.client) throw new Error('client not connected');
  }

  /** Convierte un mensaje JSON-RPC en LogEntry y lo emite al renderer. */
  private report(dir: Direction, msg: JsonRpcMessage): void {
    const seq = ++this.seq;
    const entry = toLogEntry(seq, dir, msg);
    this.emit('entry', entry);
  }
}

// __PROXY_TRANSPORT__

/**
 * Transport del SDK sobre los wires del StdioProxy.
 *
 * - start(): se suscribe al stdout del server → onmessage del SDK (s2c)
 * - send(): escribe al stdin del server via wires.write (c2s)
 * - close(): desuscribe (el server lo controla el proxy, no el cliente)
 *
 * NOTA anti-duplicación: el proxy ya registra TODO el tráfico s2c (stdout)
 * y c2s (via writeClientMessage). Para no duplicar entries en la timeline:
 * el transport reporta solo lo que él mismo inyecta (send → c2s) y NO el
 * stdout (que el proxy ya loguea). El onMessage s2c existe solo para el
 * SDK (protocol-level), sin emitir entries.
 */
export class ProxyTransport implements Transport {
  private offData: (() => void) | null = null;
  private offExit: (() => void) | null = null;
  private closed = false;
  private started = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    private wires: ProxyWires,
    private onMessage: (dir: Direction, msg: JsonRpcMessage) => void
  ) {}

  async start(): Promise<void> {
    if (this.started) throw new Error('transport already started');
    if (!this.wires.running()) throw new Error('proxy not running');
    this.started = true;

    // stdout del server → SDK client. El proxy ya loguea s2c; aquí solo
    // alimentamos al SDK (sin emitir entry para no duplicar).
    this.offData = this.wires.onData((chunk) => {
      for (const line of chunk.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        let msg: JsonRpcMessage;
        try {
          msg = JSON.parse(t) as JsonRpcMessage;
        } catch {
          continue; // línea no-JSON — el proxy la trata como raw
        }
        try {
          this.onmessage?.(msg as unknown as JSONRPCMessage);
        } catch (e) {
          this.onerror?.(e instanceof Error ? e : new Error(String(e)));
        }
      }
    });

    // exit del server → cierre del transport
    this.offExit = this.wires.onExit(() => {
      this.onclose?.();
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.wires.running()) throw new Error('proxy not running — cannot send');
    // report c2s → entry en la timeline del inspector
    this.onMessage('c2s', message as unknown as JsonRpcMessage);
    const ok = this.wires.write(JSON.stringify(message) + '\n');
    if (!ok) throw new Error('proxy write failed');
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.offData?.();
    this.offExit?.();
    this.onclose?.();
  }
}

// __TO_LOG_ENTRY__

/** Convierte un JsonRpcMessage en LogEntry (misma lógica que proxy.ts). */
function toLogEntry(seq: number, dir: Direction, msg: JsonRpcMessage): LogEntry {
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
    kind = 'notification';
    rpcId = null;
  }

  return {
    seq,
    ts: new Date().toISOString(),
    dir,
    kind,
    rpcId,
    method,
    result,
    error,
    params,
    raw: JSON.stringify(msg),
  };
}