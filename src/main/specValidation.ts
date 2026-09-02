/**
 * Frame validation against the official MCP spec (Phase 5).
 *
 * Every JSON-RPC message crossing the proxy is validated against the zod
 * schemas shipped by the SDK itself (@modelcontextprotocol/sdk/types.js —
 * 155 schemas derived from the 2025-06-18 spec + 2026-07-28 errata).
 *
 * Validation is non-blocking: it only produces a SpecCheck { ok, issues }
 * that gets attached to the LogEntry and shown as a visual badge in the
 * UI. It never alters the message.
 *
 * The method→schema map covers the standard protocol methods. Messages
 * with an unknown (custom/experimental) method are validated against the
 * base JSONRPCMessageSchema (correct framing, no specific shape).
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

/** request method → schema of the full request. */
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

/** notification method → schema of the full notification. */
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

/** rpcId → result schema (responses are validated against the originating method's result schema). */
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

/** Result containing a task (2026-07-28 era) — CreateTaskResultSchema via tasks/list response. */
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
 * Validates a message against the MCP spec.
 * @param msg JSON-RPC message exactly as it crossed the wire.
 * @param requestMethod Method of the originating request (responses carry no method) —
 *        resolved by the latency correlator; if undefined, only
 *        JSONRPCMessageSchema is tried (generic framing).
 */
export function validateSpec(msg: JsonRpcMessage, requestMethod?: string): SpecCheck | null {
  // 1. Base JSON-RPC framing — ALWAYS (every message must parse it)
  const framing = JSONRPCMessageSchema.safeParse(msg);
  if (!framing.success) {
    return { ok: false, issues: formatIssues(framing.error.issues) };
  }

  // 2. Message-type-specific schema
  if ('method' in msg && 'id' in msg) {
    // request: the schema describes the full message (method + params)
    const schema = REQUEST_SCHEMAS[msg.method];
    if (!schema) return { ok: true }; // custom/experimental method — framing OK
    const r = schema.safeParse(msg);
    return r.success ? { ok: true } : { ok: false, issues: formatIssues(r.error.issues) };
  }

  if ('method' in msg) {
    // notification: the schema describes the full message
    const schema = NOTIFICATION_SCHEMAS[msg.method];
    if (!schema) return { ok: true };
    const r = schema.safeParse(msg);
    return r.success ? { ok: true } : { ok: false, issues: formatIssues(r.error.issues) };
  }

  // response: the RESULT schema describes the PAYLOAD (msg.result), not the wrapper
  if ('error' in msg && msg.error) {
    return { ok: true }; // error response — JSONRPCError already validated by the framing
  }
  const resultSchema = requestMethod
    ? RESULT_SCHEMAS[requestMethod] ?? TASK_RESULT_SCHEMAS[requestMethod]
    : undefined;
  if (!resultSchema) return { ok: true }; // no correlation — framing only
  const payload = 'result' in msg ? msg.result : undefined;
  const r = resultSchema.safeParse(payload);
  return r.success ? { ok: true } : { ok: false, issues: formatIssues(r.error.issues) };
}

/** First 2 issues, compactly formatted. */
function formatIssues(issues: z.ZodIssue[]): string {
  return issues
    .slice(0, 2)
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join(' · ');
}

/**
 * Validates a frame already classified as an entry (used in pushEntry in main).
 * Same as validateSpec but accepts timeline entries (to re-validate
 * imported sessions).
 */
export function validateEntrySpec(
  entry: { kind: string; method?: string; raw: string; stderr?: string },
  requestMethod?: string,
): SpecCheck | null {
  if (entry.stderr) return null; // stderr is not an MCP channel
  if (entry.kind === 'request' || entry.kind === 'notification') {
    // parse raw → validate
    try {
      const msg = JSON.parse(entry.raw) as JsonRpcMessage;
      return validateSpec(msg, requestMethod);
    } catch {
      return { ok: false, issues: 'not valid JSON' };
    }
  }
  if (entry.kind === 'response' || entry.kind === 'error') {
    try {
      const msg = JSON.parse(entry.raw) as JsonRpcMessage;
      return validateSpec(msg, requestMethod);
    } catch {
      // synthetic entries ([proxy]/[lifecycle] carry plain-text raw, not JSON) → don't validate
      return null;
    }
  }
  return null;
}

export type { Direction };