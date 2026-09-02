/**
 * NDJSON parser for JSON-RPC 2.0 messages.
 * Handles partial lines (accumulating a buffer) and emits one parsed
 * message per complete line terminated in '\n'.
 *
 * MCP STDIO spec: "Messages are delimited by newlines, and MUST NOT contain
 * embedded newlines." (research/transports_summary.md, transports.txt L61-63).
 */

import { JsonRpcMessage } from '../shared/types';

export class NdjsonParser {
  private buffer = '';

  /**
   * Feeds raw bytes (string) into the parser.
   * Returns 0 or more complete messages extracted from the buffer.
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

  /** Final flush: processes any residual line without a trailing newline. */
  flush(): JsonRpcMessage[] {
    if (!this.buffer) return [];
    const line = this.buffer.replace(/\r$/, '');
    this.buffer = '';
    const msg = parseLine(line);
    return msg ? [msg] : [];
  }

  /** Bytes not yet parsed (partial line). Useful for diagnostics. */
  get pending(): string {
    return this.buffer;
  }
}

/** Tries to parse a line as JSON-RPC. Returns null on failure. */
export function parseLine(line: string): JsonRpcMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null; // empty line (ignored per spec)
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null; // invalid JSON, ignore (don't invent an error)
  }
  if (!isObject(parsed)) return null;
  if (parsed.jsonrpc !== '2.0') return null;
  return parsed as unknown as JsonRpcMessage;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
