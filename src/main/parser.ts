/**
 * Parser NDJSON para mensajes JSON-RPC 2.0.
 * Maneja líneas parciales (acumulando buffer) y emite un mensaje parseado
 * por cada línea completa terminada en '\n'.
 *
 * Spec MCP STDIO: "Messages are delimited by newlines, and MUST NOT contain
 * embedded newlines." (research/transports_summary.md, transports.txt L61-63).
 */

import { JsonRpcMessage } from '../shared/types';

export class NdjsonParser {
  private buffer = '';

  /**
   * Alimenta bytes crudos (string) al parser.
   * Devuelve 0 o más mensajes completos extraídos del buffer.
   */
  feed(chunk: string): JsonRpcMessage[] {
    this.buffer += chunk;
    const out: JsonRpcMessage[] = [];
    let nl = this.buffer.indexOf('\n');
    while (nl !== -1) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, ''); // tolerate CRLF
      this.buffer = this.buffer.slice(nl + 1);
      const msg = parseLine(line);
      if (msg !== null) out.push(msg);
      nl = this.buffer.indexOf('\n');
    }
    return out;
  }

  /** Flush final: procesa cualquier línea residual sin newline final. */
  flush(): JsonRpcMessage[] {
    if (!this.buffer) return [];
    const line = this.buffer.replace(/\r$/, '');
    this.buffer = '';
    const msg = parseLine(line);
    return msg ? [msg] : [];
  }

  /** Bytes sin parsear aún (línea parcial). Útil para diagnóstico. */
  get pending(): string {
    return this.buffer;
  }
}

/** Intenta parsear una línea como JSON-RPC. Devuelve null si falla. */
export function parseLine(line: string): JsonRpcMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null; // línea vacía (ignorada por spec)
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null; // JSON inválido, ignorar (no inventar error)
  }
  if (!isObject(parsed)) return null;
  if (parsed.jsonrpc !== '2.0') return null;
  return parsed as unknown as JsonRpcMessage;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
