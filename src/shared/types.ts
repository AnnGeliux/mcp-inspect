/**
 * Tipos compartidos entre main, preload y renderer.
 * MCP JSON-RPC 2.0 message types.
 */

/** Cualquier mensaje JSON-RPC 2.0 válido en MCP. */
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

/** Dirección del mensaje en el log. */
export type Direction = 'c2s' | 's2c';

/** Una entrada en el log de tráfico. */
export interface LogEntry {
  /** ID autoincrementable local. */
  seq: number;
  /** Timestamp ISO 8601. */
  ts: string;
  /** Dirección: cliente→server o server→cliente. */
  dir: Direction;
  /** Tipo detectado por inspección del JSON. */
  kind: 'request' | 'notification' | 'response' | 'error';
  /** ID JSON-RPC (null para notifications). */
  rpcId: JsonRpcId;
  /** Método (solo para request/notification). */
  method?: string;
  /** Resultado (response). */
  result?: unknown;
  /** Error (response con error). */
  error?: JsonRpcError;
  /** Params (request/notification). */
  params?: unknown;
  /** Bytes raw que produjo este mensaje (NDJSON line). */
  raw: string;
  /** Bytes capturados en stderr (separado del canal MCP). */
  stderr?: string;
}

/** Config de spawn que el usuario llena en la UI. */
export interface ServerConfig {
  /** Comando a ejecutar (ej. "npx"). */
  command: string;
  /** Args (ej. ["-y", "@modelcontextprotocol/everything-server"]). */
  args: string[];
  /** Env vars extra. */
  env?: Record<string, string>;
}

/** Estado de sesión exportable. */
export interface SessionExport {
  version: 1;
  exportedAt: string;
  config: ServerConfig;
  entries: LogEntry[];
}
