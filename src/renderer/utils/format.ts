/**
 * Utility functions for path truncation and command preview formatting.
 */

/**
 * Truncate a long path/string in the middle with ellipsis.
 * If the string is <= maxLen chars, return it as-is.
 * Otherwise, keep the first `keepStart` chars + "..." + last `keepEnd` chars.
 *
 * @example truncateMiddle("C:\\Users\\Ann\\node_modules\\@modelcontextprotocol\\server-everything\\dist\\index.js", 60)
 * // → "C:\\Users\\Ann\\node_modules\\@mode...\\server-everything\\dist\\index.js"
 */
export function truncateMiddle(str: string, maxLen = 60, keepStart = 30, keepEnd = 27): string {
  if (str.length <= maxLen) return str;
  // Use ellipsis char for short truncations (matches existing UI style),
  // triple-dot for longer ones
  const ellipsis = maxLen <= 50 ? '…' : '...';
  const sliceEnd = keepStart;
  const sliceStart = str.length - keepEnd;
  if (sliceEnd >= sliceStart) return str; // safety
  return str.slice(0, sliceEnd) + ellipsis + str.slice(sliceStart);
}

/**
 * Detect the transport type of a server config.
 * For now, all servers are stdio (future: http, sse, etc).
 */
export function serverTypeBadge(config: { command: string; args: string[] }): string {
  // Check if it looks like an HTTP server
  const fullCmd = [config.command, ...(config.args ?? [])].join(' ');
  if (fullCmd.includes('--http') || fullCmd.includes('--sse') || fullCmd.includes('--port')) {
    return 'http';
  }
  return 'stdio';
}

/**
 * Detect the client type badge.
 */
export function clientTypeBadge(config: { type: string }): string {
  return config.type === 'inspector' ? 'inspector' : 'sdk';
}

/**
 * Format env vars as KEY=VALUE lines.
 */
export function envToText(env?: Record<string, string>): string {
  if (!env) return '';
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

/**
 * Parse KEY=VALUE lines into a Record.
 */
export function textToEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key) env[key] = val;
    }
  }
  return env;
}

/**
 * Build a full command preview string from command + args + env.
 * Each part is truncated with truncateMiddle if too long.
 */
export function buildCommandPreview(
  command: string,
  args: string[],
  env?: Record<string, string>,
): string {
  const parts: string[] = [];
  if (env && Object.keys(env).length > 0) {
    for (const [k, v] of Object.entries(env)) {
      parts.push(`${k}=${truncateMiddle(v, 60)}`);
    }
  }
  if (command) parts.push(truncateMiddle(command, 60));
  for (const arg of args) {
    parts.push(truncateMiddle(arg, 60));
  }
  return parts.join(' ');
}