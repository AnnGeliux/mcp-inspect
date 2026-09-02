/**
 * Types shared between main, preload and renderer.
 * MCP JSON-RPC 2.0 message types.
 */

/** Any valid JSON-RPC 2.0 message in MCP. */
export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** Message direction in the log. */
export type Direction = 'c2s' | 's2c';

/** An entry in the traffic log. */
export interface LogEntry {
  /** Local auto-incrementing ID. */
  seq: number;
  /** ISO 8601 timestamp. */
  ts: string;
  /** Direction: client→server or server→client. */
  dir: Direction;
  /** Type detected by inspecting the JSON. */
  kind: 'request' | 'notification' | 'response' | 'error';
  /** JSON-RPC ID (null for notifications). */
  rpcId: JsonRpcId;
  /** Method (requests/notifications only). */
  method?: string;
  /** Result (responses). */
  result?: unknown;
  /** Error (responses with an error). */
  error?: JsonRpcError;
  /** Params (requests/notifications). */
  params?: unknown;
  /** Raw bytes this message produced (NDJSON line). */
  raw: string;
  /** Bytes captured on stderr (separate from the MCP channel). */
  stderr?: string;
  /** request→response latency in ms (only for responses correlated by rpcId). */
  latencyMs?: number;
  /** Method of the originating request (only for correlated responses — JSON-RPC responses carry no method). */
  requestMethod?: string;
  /** Result of validation against the official MCP protocol schemas. */
  spec?: SpecCheck;
  /** true if the message was held by a breakpoint before delivery. */
  held?: boolean;
  /** ms the message was held by a breakpoint. */
  heldMs?: number;
  /** true if the message was modified by the user before delivery. */
  modified?: boolean;
  /** true if the message was discarded by the user (never reached its destination). */
  dropped?: boolean;
  /** Simulation applied by a rule (fault injection / auto-mock / throttle). */
  simulated?: 'fault' | 'mock' | 'throttle';
}

/** Compact validation result against the MCP spec (via the SDK's zod schemas). */
export interface SpecCheck {
  ok: boolean;
  /** First issues, formatted (only when ok=false). */
  issues?: string;
}

/** Spawn config the user fills in the UI. */
export interface ServerConfig {
  /** Command to run (e.g. "npx"). */
  command: string;
  /** Args (e.g. ["-y", "@modelcontextprotocol/everything-server"]). */
  args: string[];
  /** Extra env vars. */
  env?: Record<string, string>;
  /**
   * If true (default), the real MCP client (SDK) connects to the proxy
   * after spawn and runs the initialize → initialized handshake.
   * Test presets (echo) use false: they are not full MCP servers.
   */
  connectClient?: boolean;
}

/** Config of a saved MCP client. */
export interface ClientConfig {
  /** Client type: 'sdk' = official SDK, 'inspector' = inspector official CLI. */
  type: 'sdk' | 'inspector';
  /** Descriptive name. */
  name: string;
  /** Command to run (e.g. "npx"). */
  command: string;
  /** Args (e.g. ["@modelcontextprotocol/inspector"]). */
  args: string[];
  /** Extra env vars. */
  env?: Record<string, string>;
}

/** A saved MCP server (persistable). */
export interface SavedServer {
  /** Unique ID (uuid or timestamp). */
  id: string;
  /** Descriptive name. */
  name: string;
  /** Optional short description shown on the card. */
  description?: string;
  /** Spawn config. */
  config: ServerConfig;
  /** If true, it's a preset that cannot be deleted. */
  preset?: boolean;
}

/** A saved MCP client (persistable). */
export interface SavedClient {
  /** Unique ID (uuid or timestamp). */
  id: string;
  /** Descriptive name. */
  name: string;
  /** Optional short description shown on the card. */
  description?: string;
  /** Client config. */
  config: ClientConfig;
  /** If true, it's a preset that cannot be deleted. */
  preset?: boolean;
}

/** Exportable session state. */
export interface SessionExport {
  version: 1;
  exportedAt: string;
  config: ServerConfig;
  entries: LogEntry[];
}

/**
 * Simulation associated with a rule (Phase 7).
 * - 'hold': classic breakpoint — holds and waits for the user's decision.
 * - 'throttle': delivers the original after `throttleMs` of artificial delay.
 * - 'fault': discards the message and delivers a JSON-RPC error response
 *   to the client (generated with the original request's id).
 * - 'mock': discards the message and delivers `mockResult`/`mockError` to
 *   the client without hitting the real destination.
 */
export type SimulationConfig =
  | { type: 'hold' }
  | { type: 'throttle'; throttleMs: number }
  | { type: 'fault'; faultCode?: number; faultMessage?: string }
  | { type: 'mock'; mockResult?: unknown; mockError?: JsonRpcError };

/** An active interception rule in the proxy. */
export interface InterceptRule {
  /** Unique ID. */
  id: string;
  /** Direction it pauses: c2s (request breakpoint) or s2c (response breakpoint). */
  dir: 'c2s' | 's2c';
  /** Method it applies to ('' = all). */
  method: string;
  /** true = rule active. */
  enabled: boolean;
  /** Simulation to apply on match (default 'hold' — Phase 6 behavior). */
  simulation?: SimulationConfig;
}

/** A message held by a breakpoint, awaiting the user's decision. */
export interface HeldMessage {
  /** Hold ID (uuid). */
  id: string;
  /** Message direction. */
  dir: 'c2s' | 's2c';
  /** Original JSON-RPC message exactly as it arrived. */
  msg: JsonRpcMessage;
  /** Rule that captured it (null = intercept-all). */
  ruleId: string | null;
  /** ISO timestamp of when it was held. */
  heldAt: string;
  /** Resolution already decided by the user but pending delivery (queued behind another hold). */
  pendingResolution?: HoldResolution;
}

/** Resolution action for a hold. */
export type HoldResolution =
  | { action: 'send' }
  | { action: 'send-modified'; msg: JsonRpcMessage }
  | { action: 'drop' }
  | { action: 'respond'; msg: JsonRpcMessage };
