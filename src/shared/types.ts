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
  /**
   * Si true (default), el cliente MCP real (SDK) se conecta al proxy tras
   * el spawn y ejecuta el handshake initialize → initialized.
   * Los presets de test (echo) usan false: no son servers MCP completos.
   */
  connectClient?: boolean;
}

/** Config de un cliente MCP guardado. */
export interface ClientConfig {
  /** Tipo de cliente: 'sdk' = SDK oficial, 'inspector' = inspector official CLI. */
  type: 'sdk' | 'inspector';
  /** Nombre descriptivo. */
  name: string;
  /** Comando a ejecutar (ej. "npx"). */
  command: string;
  /** Args (ej. ["@modelcontextprotocol/inspector"]). */
  args: string[];
  /** Env vars extra. */
  env?: Record<string, string>;
}

/** Un MCP server guardado (persistible). */
export interface SavedServer {
  /** ID único (uuid o timestamp). */
  id: string;
  /** Nombre descriptivo. */
  name: string;
  /** Descripción corta opcional para mostrar en la card. */
  description?: string;
  /** Config de spawn. */
  config: ServerConfig;
  /** Si true, es un preset que no se puede borrar. */
  preset?: boolean;
}

/** Un MCP client guardado (persistible). */
export interface SavedClient {
  /** ID único (uuid o timestamp). */
  id: string;
  /** Nombre descriptivo. */
  name: string;
  /** Descripción corta opcional para mostrar en la card. */
  description?: string;
  /** Config del cliente. */
  config: ClientConfig;
  /** Si true, es un preset que no se puede borrar. */
  preset?: boolean;
}

/** Estado de sesión exportable. */
export interface SessionExport {
  version: 1;
  exportedAt: string;
  config: ServerConfig;
  entries: LogEntry[];
}
