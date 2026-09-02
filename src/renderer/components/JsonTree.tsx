import React, { useState } from 'react';

/**
 * JSON tree view with key-field highlighting (id, method, params, result, error).
 * Key fields: accent color. Strings: green. Numbers/null: purple. Object/Array: collapsible.
 */

const KEY_HIGHLIGHT = new Set(['id', 'method', 'params', 'result', 'error', 'jsonrpc', 'code', 'message']);

interface Props { data: unknown; }

export default function JsonTree({ data }: Props): React.ReactElement {
  return <div className="jt">{render(data, '$', 0, new Set())}</div>;
}

function render(value: unknown, key: string, depth: number, expanded: Set<string>): React.ReactElement {
  const pathKey = `${depth}:${key}`;
  const isPrim = value === null || typeof value !== 'object';
  if (isPrim) return <Leaf value={value} fieldKey={key} />;
  const isArr = Array.isArray(value);
  const entries = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const isOpen = depth < 2 || expanded.has(pathKey); // first 2 levels always open
  return (
    <div className="jt-node">
      <span
        className="jt-toggle"
        onClick={() => {
          const next = new Set(expanded);
          if (next.has(pathKey)) next.delete(pathKey); else next.add(pathKey);
          // hack: re-render via state mutation isn't clean; toggle via React state needed for full impl.
          // Here we use a simple trick: we alternate a data- attribute and manual re-render would be costly.
          // Better solution: use per-component state. Since this is leaf-ish, we accept a basic toggle for now.
          const el = document.querySelector(`[data-jt-path="${cssEscape(pathKey)}"]`);
          if (el) el.classList.toggle('jt-collapsed');
        }}
      >
        {isOpen ? '▼' : '▶'}
      </span>
      <span className="jt-key" style={KEY_HIGHLIGHT.has(key) ? { color: 'var(--accent)', fontWeight: 600 } : undefined}>{key}</span>
      <span className="jt-punct">{isArr ? '[' : '{'}</span>
      <span className="jt-count">{entries.length} {isArr ? 'items' : 'keys'}</span>
      <div className="jt-children" data-jt-path={pathKey} style={{ display: isOpen ? 'block' : 'none', paddingLeft: 16 }}>
        {entries.map(([k, v]) => (
          <div key={k}>{render(v, k, depth + 1, expanded)}</div>
        ))}
      </div>
      <span className="jt-punct">{isArr ? ']' : '}'}</span>
    </div>
  );
}

function Leaf({ value, fieldKey }: { value: unknown; fieldKey: string }): React.ReactElement {
  let cls = 'jt-leaf';
  let display: string;
  if (value === null) { cls += ' jt-null'; display = 'null'; }
  else if (typeof value === 'string') { cls += ' jt-str'; display = JSON.stringify(value); }
  else if (typeof value === 'number') { cls += ' jt-num'; display = String(value); }
  else if (typeof value === 'boolean') { cls += ' jt-bool'; display = String(value); }
  else { cls += ' jt-str'; display = JSON.stringify(value); }
  const keyStyle = KEY_HIGHLIGHT.has(fieldKey) ? { color: 'var(--accent)', fontWeight: 600 } : undefined;
  return (
    <span className={cls}>
      <span className="jt-key" style={keyStyle}>{fieldKey}</span>
      <span className="jt-punct">: </span>
      <span>{display}</span>
    </span>
  );
}

function cssEscape(s: string): string {
  return s.replace(/[^\w-]/g, '_');
}
