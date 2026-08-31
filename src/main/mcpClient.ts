/**
 * MCP Client real (SDK oficial) cableado al proxy MITM.
 *
 * El Client del SDK hace el handshake completo (initialize → initialized)
 * sobre un Transport custom que reutiliza los wires del StdioProxy:
 *   - send() → wires.write → pipeline de interceptación → stdin del server
 *   - deliveredS2c (stdout post-pipeline) → onmessage del SDK
 *
 * LOGGING CENTRALIZADO (Phase 6): el proxy loguea TODO el tráfico (c2s al
 * resolver el pipeline, s2c al entregarse). El transport NO loguea — así
 * cada mensaje aparece exactamente una vez en la timeline, mostrando la
 * versión final (modificada) cuando el usuario editó un breakpoint.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { EventEmitter } from 'events';
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
  /**
   * Escribe una línea NDJSON al stdin del server (vía pipeline de
   * interceptación — el proxy loguea al resolverse). Puede ser async:
   * si un breakpoint retiene el mensaje, la promesa espera la decisión.
   */
  write: (line: string) => boolean | Promise<boolean>;
  /** Suscripción a chunks NDJSON entregados por el pipeline (s2c final). Devuelve unsub. */
  onData: (cb: (chunk: string) => void) => () => void;
  /** Suscripción al exit del subprocess server. Devuelve unsub. */
  onExit: (cb: () => void) => () => void;
  /** ¿Server vivo? */
  running: () => boolean;
}

export interface McpClientEvents {
  connected: (info: { serverName: string; serverVersion: string }) => void;
  closed: () => void;
  error: (err: Error) => void;
}

// __MCP_CLIENT_CONTROLLER__

/**
 * Timeout de requests del cliente SDK: 10 min.
 *
 * Los requests pasan por el pipeline MITM antes de llegar al server — si el
 * usuario pausa el tráfico o hay breakpoints activos, el request puede
 * quedar en cola/hold mucho tiempo. Con el timeout corto (15s) el SDK
 * expiraba el request en plena pausa y, al reanudar, la respuesta llegaba
 * a un request ya muerto → "Received a response for an unknown message ID".
 */
const REQUEST_TIMEOUT_MS = 600_000;

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

    const transport = new ProxyTransport(wires);
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
    const opts: RequestOptions = { timeout: REQUEST_TIMEOUT_MS };
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
}

// __PROXY_TRANSPORT__

/**
 * Transport del SDK sobre los wires del StdioProxy.
 *
 * - start(): se suscribe al stream entregado por el pipeline (deliveredS2c)
 *   → onmessage del SDK (s2c final — consistente con lo que muestra el log)
 * - send(): escribe al stdin del server via wires.write (que pasa por el
 *   pipeline — puede quedar en hold si hay breakpoints c2s activos)
 * - close(): desuscribe (el server lo controla el proxy, no el cliente)
 *
 * El transport NO loguea: el proxy emite los entries (c2s al resolver el
 * pipeline, s2c al entregar) para no duplicar en la timeline.
 */
export class ProxyTransport implements Transport {
  private offData: (() => void) | null = null;
  private offExit: (() => void) | null = null;
  private closed = false;
  private started = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(private wires: ProxyWires) {}

  async start(): Promise<void> {
    if (this.started) throw new Error('transport already started');
    if (!this.wires.running()) throw new Error('proxy not running');
    this.started = true;

    // s2c entregado por el pipeline → SDK client (sin loguear: el proxy ya lo hizo)
    this.offData = this.wires.onData((chunk) => {
      for (const line of chunk.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        let msg: JSONRPCMessage;
        try {
          msg = JSON.parse(t) as JSONRPCMessage;
        } catch {
          continue; // línea no-JSON — ignorar
        }
        try {
          this.onmessage?.(msg);
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
    // Vía pipeline: puede quedar en hold hasta que el usuario resuelva.
    const ok = await this.wires.write(JSON.stringify(message) + '\n');
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