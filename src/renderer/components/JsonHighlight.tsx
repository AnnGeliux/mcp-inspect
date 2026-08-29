import React from 'react';

/**
 * Lightweight JSON syntax highlighter using regex-based tokenization.
 * Colors: keys (blue), strings (green), numbers (orange), booleans (purple), null (gray).
 */

interface Props {
  data: unknown;
  /** Max height in px; defaults to 280. */
  maxHeight?: number;
}

export default function JsonHighlight({ data, maxHeight = 280 }: Props): React.ReactElement {
  const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return (
    <pre className="json-highlight" style={{ maxHeight }}>
      <code dangerouslySetInnerHTML={{ __html: highlight(json) }} />
    </pre>
  );
}

function highlight(json: string): string {
  // Escape HTML first
  let s = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Tokenize: strings (including keys), numbers, booleans, null
  // Keys are strings followed by optional whitespace and a colon
  s = s.replace(
    /("(?:[^"\\]|\\.)*")(\s*:)/g,
    (_m, str: string, colon: string) =>
      `<span class="jh-key">${str}</span>${colon}`,
  );
  // String values (not followed by colon = not a key)
  s = s.replace(
    /("(?:[^"\\]|\\.)*")(?!\s*:)/g,
    '<span class="jh-str">$1</span>',
  );
  // Numbers
  s = s.replace(
    /\b(-?\d+\.?\d*(?:[eE][+-]?\d+)?)\b/g,
    '<span class="jh-num">$1</span>',
  );
  // Booleans
  s = s.replace(/\b(true|false)\b/g, '<span class="jh-bool">$1</span>');
  // Null
  s = s.replace(/\bnull\b/g, '<span class="jh-null">null</span>');

  return s;
}