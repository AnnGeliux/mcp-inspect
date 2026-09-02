/**
 * Real MCP client (official SDK) wired to the MITM proxy.
 *
 * The SDK Client performs the full handshake (initialize → initialized)
 * over a custom Transport that reuses the StdioProxy's wires:
 *   - send() → wires.write → interception pipeline → server stdin
 *   - deliveredS2c (post-pipeline stdout) → SDK onmessage
 *
 * CENTRALIZED LOGGING (Phase 6): the proxy logs ALL traffic (c2s when the
 * pipeline resolves, s2c on delivery). The transport does NOT log — this
 * way each message appears exactly once in the timeline, showing the
 * final (modified) version when the user edited a breakpoint.
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

/** Wires exposed by the StdioProxy for hooking up the client. */
export interface ProxyWires {
  /**
   * Writes an NDJSON line to the server's stdin (via the interception
   * pipeline — the proxy logs on resolution). Can be async: if a
   * breakpoint holds the message, the promise waits for the decision.
   */
  write: (line: string) => boolean | Promise<boolean>;
  /** Subscription to NDJSON chunks delivered by the pipeline (final s2c). Returns an unsub. */
  onData: (cb: (chunk: string) => void) => () => void;
  /** Subscription to the server subprocess exit. Returns an unsub. */
  onExit: (cb: () => void) => () => void;
  /** Is the server alive? */
  running: () => boolean;
}

export interface McpClientEvents {
  connected: (info: { serverName: string; serverVersion: string }) => void;
  closed: () => void;
  error: (err: Error) => void;
}

// __MCP_CLIENT_CONTROLLER__

/**
 * Timeout for SDK client requests: 10 min.
 *
 * Requests pass through the MITM pipeline before reaching the server — if
 * the user pauses traffic or there are active breakpoints, the request can
 * stay queued/held for a long time. With the short timeout (15s) the SDK
 * expired the request mid-pause and, on resume, the response arrived to
 * an already-dead request → "Received a response for an unknown message ID".
 */
const REQUEST_TIMEOUT_MS = 600_000;

export declare interface McpClientController {
  on<E extends keyof McpClientEvents>(event: E, listener: McpClientEvents[E]): this;
  emit<E extends keyof McpClientEvents>(event: E, ...args: Parameters<McpClientEvents[E]>): boolean;
}

/**
 * Controls a real MCP Client from the SDK, wired to the proxy instead of
 * spawning its own subprocess. Cycle:
 *   connectToProxy(wires) → client.connect(transport) → initialize handshake
 *   request/notify       → arbitrary MCP methods
 *   stop()               → close
 */
export class McpClientController extends EventEmitter {
  private client: Client | null = null;
  private transport: ProxyTransport | null = null;
  private _connected = false;

  /**
   * Wires the SDK client to the proxy's wires and runs the MCP handshake
   * (initialize → initialized). The server must already be running via
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
   * MCP request. Dispatches to the typed SDK Client methods — each one
   * passes its correct resultSchema (sending undefined to the internal
   * request() breaks safeParse). For arbitrary methods: raw proxy send.
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

  /** Generic MCP notification (no id → no response expected). */
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

  /** Server info after the handshake (capabilities, name, version). */
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
 * SDK Transport over the StdioProxy's wires.
 *
 * - start(): subscribes to the stream delivered by the pipeline (deliveredS2c)
 *   → SDK onmessage (final s2c — consistent with what the log shows)
 * - send(): writes to the server's stdin via wires.write (which goes through
 *   the pipeline — may stay on hold if there are active c2s breakpoints)
 * - close(): unsubscribes (the server is controlled by the proxy, not the client)
 *
 * The transport does NOT log: the proxy emits the entries (c2s when the
 * pipeline resolves, s2c on delivery) to avoid duplicates in the timeline.
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

    // s2c delivered by the pipeline → SDK client (no logging: the proxy already did it)
    this.offData = this.wires.onData((chunk) => {
      for (const line of chunk.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        let msg: JSONRPCMessage;
        try {
          msg = JSON.parse(t) as JSONRPCMessage;
        } catch {
          continue; // non-JSON line — ignore
        }
        try {
          this.onmessage?.(msg);
        } catch (e) {
          this.onerror?.(e instanceof Error ? e : new Error(String(e)));
        }
      }
    });

    // server exit → transport closure
    this.offExit = this.wires.onExit(() => {
      this.onclose?.();
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.wires.running()) throw new Error('proxy not running — cannot send');
    // Via the pipeline: may stay on hold until the user resolves.
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