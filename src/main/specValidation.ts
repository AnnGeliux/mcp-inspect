/**
 * Validación de tramas contra la spec oficial MCP (Phase 5).
 *
 * Cada mensaje JSON-RPC que cruza el proxy se valida contra los schemas
 * zod que empaqueta el propio SDK (@modelcontextprotocol/sdk/types.js —
 * 155 schemas derivados de la spec 2025-06-18 + erratas 2026-07-28).
 *
 * La validación es no-bloqueante: solo produce SpecCheck { ok, issues } que
 * se adjunta al LogEntry y se muestra como badge visual en la UI. Nunca
 * altera el mensaje.
 *
 * Mapa método→schema cubre los métodos estándar del protocolo. Mensajes con
 * método desconocido (custom/experimental) se validan contra el schema base
 * JSONRPCMessageSchema (framing correcto, sin shape específico).
 */

import {
  JSONRPCMessageSchema,
  // ——— Lifecycle ———
  InitializeRequestSchema,
  InitializeResultSchema,
  InitializedNotificationSchema,
  PingRequestSchema,
  EmptyResultSchema,
  // ——— Tools ———
  ListToolsRequestSchema,
  ListToolsResultSchema,
  CallToolRequestSchema,
  CallToolResultSchema,
  // ——— Resources ———
  ListResourcesRequestSchema,
  ListResourcesResultSchema,
  ReadResourceRequestSchema,
  ReadResourceResultSchema,
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesResultSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  // ——— Prompts ———
  ListPromptsRequestSchema,
  ListPromptsResultSchema,
  GetPromptRequestSchema,
  GetPromptResultSchema,
  PromptListChangedNotificationSchema,
  // ——— Logging / completions ———
  SetLevelRequestSchema,
  LoggingMessageNotificationSchema,
  CompleteRequestSchema,
  CompleteResultSchema,
  // ——— Sampling / roots / elicitation (server→client) ———
  CreateMessageRequestSchema,
  CreateMessageResultSchema,
  ListRootsRequestSchema,
  ListRootsResultSchema,
  RootsListChangedNotificationSchema,
  ElicitRequestSchema,
  ElicitResultSchema,
  ElicitationCompleteNotificationSchema,
  // ——— Notifications transversales ———
  CancelledNotificationSchema,
  ProgressNotificationSchema,
  ToolListChangedNotificationSchema,
  // ——— Tasks (2026-07-28 era) ———
  GetTaskRequestSchema,
  GetTaskResultSchema,
  ListTasksRequestSchema,
  ListTasksResultSchema,
  CancelTaskRequestSchema,
  CancelTaskResultSchema,
  TaskStatusNotificationSchema,
  CreateTaskResultSchema,
  GetTaskPayloadRequestSchema,
  GetTaskPayloadResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import { JsonRpcMessage, SpecCheck, Direction } from '../shared/types';

type Schema = z.ZodTypeAny;

/** request method → schema del request completo. */
const REQUEST_SCHEMAS: Record<string, Schema> = {
  initialize: InitializeRequestSchema,
  ping: PingRequestSchema,
  'tools/list': ListToolsRequestSchema,
  'tools/call': CallToolRequestSchema,
  'resources/list': ListResourcesRequestSchema,
  'resources/read': ReadResourceRequestSchema,
  'resources/templates/list': ListResourceTemplatesRequestSchema,
  'resources/subscribe': SubscribeRequestSchema,
  'resources/unsubscribe': UnsubscribeRequestSchema,
  'prompts/list': ListPromptsRequestSchema,
  'prompts/get': GetPromptRequestSchema,
  'logging/setLevel': SetLevelRequestSchema,
  'completion/complete': CompleteRequestSchema,
  'sampling/createMessage': CreateMessageRequestSchema,
  'roots/list': ListRootsRequestSchema,
  'elicitation/create': ElicitRequestSchema,
  'tasks/get': GetTaskRequestSchema,
  'tasks/list': ListTasksRequestSchema,
  'tasks/cancel': CancelTaskRequestSchema,
  'tasks/result': GetTaskPayloadRequestSchema,
};

/** notification method → schema de la notificación completa. */
const NOTIFICATION_SCHEMAS: Record<string, Schema> = {
  'notifications/initialized': InitializedNotificationSchema,
  'notifications/cancelled': CancelledNotificationSchema,
  'notifications/progress': ProgressNotificationSchema,
  'notifications/message': LoggingMessageNotificationSchema,
  'notifications/tools/list_changed': ToolListChangedNotificationSchema,
  'notifications/resources/list_changed': ResourceListChangedNotificationSchema,
  'notifications/resources/updated': ResourceUpdatedNotificationSchema,
  'notifications/prompts/list_changed': PromptListChangedNotificationSchema,
  'notifications/roots/list_changed': RootsListChangedNotificationSchema,
  'notifications/elicitation/complete': ElicitationCompleteNotificationSchema,
  'notifications/tasks/status': TaskStatusNotificationSchema,
};

/** rpcId → schema del result (responses se validan contra el result schema del método originante). */
const RESULT_SCHEMAS: Record<string, Schema> = {
  initialize: InitializeResultSchema,
  ping: EmptyResultSchema,
  'tools/list': ListToolsResultSchema,
  'tools/call': CallToolResultSchema,
  'resources/list': ListResourcesResultSchema,
  'resources/read': ReadResourceResultSchema,
  'resources/templates/list': ListResourceTemplatesResultSchema,
  'prompts/list': ListPromptsResultSchema,
  'prompts/get': GetPromptResultSchema,
  'completion/complete': CompleteResultSchema,
  'sampling/createMessage': CreateMessageResultSchema,
  'roots/list': ListRootsResultSchema,
  'elicitation/create': ElicitResultSchema,
  'tasks/get': GetTaskResultSchema,
  'tasks/list': ListTasksResultSchema,
  'tasks/cancel': CancelTaskResultSchema,
  'tasks/result': GetTaskPayloadResultSchema,
};

/** Resultado con task (2026-07-28 era) — CreateTaskResultSchema via tasks/list response. */
const TASK_RESULT_SCHEMAS: Record<string, Schema> = {
  'tasks/create': CreateTaskResultSchema,
};

function isRequest(m: JsonRpcMessage): boolean {
  return 'method' in m && 'id' in m;
}

function isNotification(m: JsonRpcMessage): boolean {
  return 'method' in m && !('id' in m);
}

function isResponse(m: JsonRpcMessage): boolean {
  return !('method' in m);
}

/**
 * Valida un mensaje contra la spec MCP.
 * @param msg Mensaje JSON-RPC tal como cruzó el wire.
 * @param requestMethod Método del request originante (responses no llevan method) —
 *        el correlador de latencia lo resuelve; si es undefined, se intenta solo
 *        con JSONRPCMessageSchema (framing genérico).
 */
export function validateSpec(msg: JsonRpcMessage, requestMethod?: string): SpecCheck | null {
  // 1. Framing JSON-RPC base — SIEMPRE (todo mensaje debe parsearlo)
  const framing = JSONRPCMessageSchema.safeParse(msg);
  if (!framing.success) {
    return { ok: false, issues: formatIssues(framing.error.issues) };
  }

  // 2. Schema específico por tipo de mensaje
  if ('method' in msg && 'id' in msg) {
    // request: el schema describe el mensaje completo (method + params)
    const schema = REQUEST_SCHEMAS[msg.method];
    if (!schema) return { ok: true }; // método custom/experimental — framing OK
    const r = schema.safeParse(msg);
    return r.success ? { ok: true } : { ok: false, issues: formatIssues(r.error.issues) };
  }

  if ('method' in msg) {
    // notification: el schema describe el mensaje completo
    const schema = NOTIFICATION_SCHEMAS[msg.method];
    if (!schema) return { ok: true };
    const r = schema.safeParse(msg);
    return r.success ? { ok: true } : { ok: false, issues: formatIssues(r.error.issues) };
  }

  // response: el RESULT schema describe el PAYLOAD (msg.result), no el wrapper
  if ('error' in msg && msg.error) {
    return { ok: true }; // error response — JSONRPCError ya validado por el framing
  }
  const resultSchema = requestMethod
    ? RESULT_SCHEMAS[requestMethod] ?? TASK_RESULT_SCHEMAS[requestMethod]
    : undefined;
  if (!resultSchema) return { ok: true }; // sin correlación — solo framing
  const payload = 'result' in msg ? msg.result : undefined;
  const r = resultSchema.safeParse(payload);
  return r.success ? { ok: true } : { ok: false, issues: formatIssues(r.error.issues) };
}

/** Primeros 2 issues formateados compactos. */
function formatIssues(issues: z.ZodIssue[]): string {
  return issues
    .slice(0, 2)
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join(' · ');
}

/**
 * Valida una trama ya clasificada como entry (usado en pushEntry del main).
 * Igual que validateSpec pero acepta entries del timeline (para re-validar
 * sesiones importadas).
 */
export function validateEntrySpec(
  entry: { kind: string; method?: string; raw: string; stderr?: string },
  requestMethod?: string,
): SpecCheck | null {
  if (entry.stderr) return null; // stderr no es canal MCP
  if (entry.kind === 'request' || entry.kind === 'notification') {
    // parse raw → validate
    try {
      const msg = JSON.parse(entry.raw) as JsonRpcMessage;
      return validateSpec(msg, requestMethod);
    } catch {
      return { ok: false, issues: 'no es JSON válido' };
    }
  }
  if (entry.kind === 'response' || entry.kind === 'error') {
    try {
      const msg = JSON.parse(entry.raw) as JsonRpcMessage;
      return validateSpec(msg, requestMethod);
    } catch {
      // entries sintéticas ([proxy]/[lifecycle] llevan raw texto, no JSON) → no validar
      return null;
    }
  }
  return null;
}

export type { Direction };