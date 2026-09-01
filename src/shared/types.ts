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
  /** Latencia request→response en ms (solo responses correlacionadas por rpcId). */
  latencyMs?: number;
  /** Método del request originante (solo responses correlacionadas — las respuestas JSON-RPC no llevan method). */
  requestMethod?: string;
  /** Resultado de la validación contra los schemas oficiales del protocolo MCP. */
  spec?: SpecCheck;
  /** true si el mensaje fue retenido por un breakpoint antes de entregarse. */
  held?: boolean;
  /** ms que el mensaje estuvo retenido por un breakpoint. */
  heldMs?: number;
  /** true si el mensaje fue modificado por el usuario antes de entregarse. */
  modified?: boolean;
  /** true si el mensaje fue descartado por el usuario (nunca llegó a su destino). */
  dropped?: boolean;
  /** Simulación aplicada por una regla (fault injection / auto-mock / throttle). */
  simulated?: 'fault' | 'mock' | 'throttle';
}

/** Resultado compacto de validación contra la spec MCP (via schemas zod del SDK). */
export interface SpecCheck {
  ok: boolean;
  /** Primeros issues formateados (solo si ok=false). */
  issues?: string;
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

/**
 * Simulación asociada a una regla (Phase 7).
 * - 'hold': breakpoint clásico — retiene y espera decisión del usuario.
 * - 'throttle': entrega el original tras `throttleMs` de retraso artificial.
 * - 'fault': descarta el mensaje y entrega una respuesta de error JSON-RPC
 *   al cliente (generada con el id del request original).
 * - 'mock': descarta el mensaje y entrega `mockResult`/`mockError` al
 *   cliente sin golpear el destino real.
 */
export type SimulationConfig =
  | { type: 'hold' }
  | { type: 'throttle'; throttleMs: number }
  | { type: 'fault'; faultCode?: number; faultMessage?: string }
  | { type: 'mock'; mockResult?: unknown; mockError?: JsonRpcError };

/** Una regla de interceptación activa en el proxy. */
export interface InterceptRule {
  /** ID único. */
  id: string;
  /** Dirección que pausa: c2s (breakpoint de petición) o s2c (breakpoint de respuesta). */
  dir: 'c2s' | 's2c';
  /** Método al que aplica ('' = todos). */
  method: string;
  /** true = regla activa. */
  enabled: boolean;
  /** Simulación a aplicar al coincidir (default 'hold' — comportamiento Phase 6). */
  simulation?: SimulationConfig;
}

/** Un mensaje retenido por un breakpoint, esperando decisión del usuario. */
export interface HeldMessage {
  /** ID del hold (uuid). */
  id: string;
  /** Dirección del mensaje. */
  dir: 'c2s' | 's2c';
  /** Mensaje JSON-RPC original tal como llegó. */
  msg: JsonRpcMessage;
  /** Regla que lo capturó (null = intercept-all). */
  ruleId: string | null;
  /** Timestamp ISO de cuándo fue retenido. */
  heldAt: string;
  /** Resolución ya decidida por el usuario pero pendiente de entrega (en cola tras otro hold). */
  pendingResolution?: HoldResolution;
}

/** Acción de resolución de un hold. */
export type HoldResolution =
  | { action: 'send' }
  | { action: 'send-modified'; msg: JsonRpcMessage }
  | { action: 'drop' }
  | { action: 'respond'; msg: JsonRpcMessage };
