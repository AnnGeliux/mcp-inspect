import React, { useState, useMemo, useEffect, useRef } from 'react';
import { LogEntry } from '../../shared/types';
import JsonHighlight from './JsonHighlight';

interface Props {
  entries: LogEntry[];
}

type FilterType = 'all' | 'request' | 'response' | 'notification' | 'error';
type ViewMode = 'formatted' | 'raw';

/** Pixels of tolerance to consider the user "at the bottom". */
const STICKY_THRESHOLD = 24;

/** Métodos MCP estándar para el filtro por método (Phase 5). */
const METHOD_FILTERS = [
  { label: 'all', value: '' },
  { label: 'initialize', value: 'initialize' },
  { label: 'ping', value: 'ping' },
  { label: 'tools/*', value: 'tools/' },
  { label: 'resources/*', value: 'resources/' },
  { label: 'prompts/*', value: 'prompts/' },
  { label: 'sampling/*', value: 'sampling/' },
  { label: 'roots/*', value: 'roots/' },
  { label: 'elicitation/*', value: 'elicitation/' },
  { label: 'notifications/*', value: 'notifications/' },
  { label: 'completion/*', value: 'completion/' },
  { label: 'logging/*', value: 'logging/' },
];

export default function LogList({ entries }: Props): React.ReactElement {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<FilterType>('all');
  const [methodFilter, setMethodFilter] = useState('');
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(Date.now());
  const [viewMode, setViewMode] = useState<ViewMode>('formatted');
  const [copied, setCopied] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpBtn, setShowJumpBtn] = useState(false);

  // ——— Auto-scroll: follow new entries while user is at the bottom ———
  // NOTE: 'auto' (instant) instead of 'smooth' — smooth fires intermediate
  // scroll events >threshold from bottom, which would flip stickiness off
  // mid-animation and drop the follow during message bursts.
  const entriesCount = entries.length;
  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
  }, [entriesCount, filter, search, methodFilter]);

  // Track scroll position: if the user scrolls away from the bottom, stop following.
  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < STICKY_THRESHOLD;
    stickToBottomRef.current = atBottom;
    setShowJumpBtn(!atBottom && el.scrollHeight > el.clientHeight);
  };

  const jumpToBottom = () => {
    stickToBottomRef.current = true;
    setShowJumpBtn(false);
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  // Update "now" every second for relative timestamps
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Counters by type
  const counts = useMemo(() => {
    const c = { request: 0, response: 0, notification: 0, error: 0 };
    for (const e of entries) c[e.kind]++;
    return c;
  }, [entries]);

  /** Método efectivo de un entry (responses: el request correlacionado). */
  const entryMethod = (e: LogEntry): string => (e.method && e.method !== '[lifecycle]' && e.method !== '[stderr]' && e.method !== '[proxy]' ? e.method : e.requestMethod ?? '');

  // Filtered entries
  const filtered = useMemo(() => {
    let list = entries;
    if (filter !== 'all') list = list.filter((e) => e.kind === filter);
    if (methodFilter !== '') {
      list = list.filter((e) => entryMethod(e).startsWith(methodFilter));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) => {
        const method = (e.method ?? '').toLowerCase();
        const id = String(e.rpcId ?? '').toLowerCase();
        const raw = (e.raw ?? '').toLowerCase();
        return method.includes(q) || id.includes(q) || raw.includes(q);
      });
    }
    return list;
  }, [entries, filter, methodFilter, search]);

  const toggle = (seq: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq); else next.add(seq);
      return next;
    });
  };

  const copyRaw = (e: LogEntry) => {
    void window.api.clipboardWrite(e.raw);
    setCopied(e.seq);
    window.setTimeout(() => setCopied(null), 1200);
  };

  const filters: { key: FilterType; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: entries.length },
    { key: 'request', label: 'Requests', count: counts.request },
    { key: 'response', label: 'Responses', count: counts.response },
    { key: 'notification', label: 'Notifications', count: counts.notification },
    { key: 'error', label: 'Errors', count: counts.error },
  ];

  return (
    <section className="panel log-panel">
      <div className="panel-header">
        <span className="icon">📜</span>
        <span>Tráfico en vivo</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>
          MITM · {entries.length} mensajes
        </span>
      </div>

      {/* Toolbar: filters + method filter + search */}
      <div className="log-toolbar">
        <div className="log-filters">
          {filters.map((f) => (
            <button
              key={f.key}
              className={`filter-btn ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
              title={`Mostrar ${f.label.toLowerCase()}`}
            >
              {f.label}
              {f.count > 0 && <span className="filter-count">{f.count}</span>}
            </button>
          ))}
        </div>
        <select
          className="log-method-filter"
          value={methodFilter}
          onChange={(e) => setMethodFilter(e.target.value)}
          title="Filtrar por método MCP"
        >
          {METHOD_FILTERS.map((m) => (
            <option key={m.value || 'all'} value={m.value}>
              {m.label === 'all' ? 'método: todos' : m.label}
            </option>
          ))}
        </select>
        <input
          className="log-search"
          placeholder="Buscar método, id, payload…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="log-list" ref={listRef} onScroll={handleScroll}>
        {showJumpBtn && (
          <button className="jump-latest" onClick={jumpToBottom} title="Volver al último mensaje">
            ⤓ Último
          </button>
        )}
        {filtered.length === 0 && entries.length === 0 && (
          <div className="empty-state">
            <span className="empty-state-icon">📜</span>
            <span className="empty-state-text">Esperando tráfico… Inicia el server para ver mensajes</span>
          </div>
        )}
        {filtered.length === 0 && entries.length > 0 && (
          <div className="empty-state">
            <span className="empty-state-icon">🔍</span>
            <span className="empty-state-text">Sin resultados para el filtro/búsqueda actual</span>
          </div>
        )}
        {filtered.map((e) => {
          const isOpen = expanded.has(e.seq);
          return (
            <div key={e.seq} className={`log-entry fade-in ${isOpen ? 'expanded' : ''}`} onClick={() => toggle(e.seq)}>
              <div className="log-entry-header">
                <span className="log-toggle">{isOpen ? '▼' : '▶'}</span>
                <span className="ts" title={e.ts}>{formatTs(e.ts)} <span className="ts-rel">({relativeTs(e.ts, now)})</span></span>
                <span className={`dir ${e.kind === 'error' ? 'err' : e.kind === 'notification' ? 'notif' : e.dir === 'c2s' ? 'c2s' : 's2c'}`}>
                  {dirLabel(e)}
                </span>
                <span className="method">
                  <span className="m">{e.method ?? (e.kind === 'response' || e.kind === 'error' ? `← ${e.rpcId}` : '(?)')}</span>
                  {e.rpcId != null && <span className="id">id={String(e.rpcId)}</span>}
                </span>
                {/* Latencia correlacionada (Phase 5) */}
                {e.latencyMs !== undefined && (
                  <span className={`latency ${e.latencyMs > 2000 ? 'slow' : ''}`} title={`Latencia request→response (${e.requestMethod ?? '?'})`}>
                    {e.latencyMs} ms
                  </span>
                )}
                {/* Badge de spec (Phase 5) */}
                {e.spec && !e.spec.ok && (
                  <span className="spec-badge spec-error" title={`No conforme con la spec MCP: ${e.spec.issues ?? ''}`}>
                    ⚠ spec
                  </span>
                )}
                {/* Badges de interceptación (Phase 6) */}
                {e.held && <span className="pill warning" title={`Retenido ${e.heldMs ?? 0} ms`}>⏸</span>}
                {e.modified && <span className="pill purple" title="Modificado por el usuario">✎</span>}
                {e.dropped && <span className="pill danger" title="Descartado — nunca llegó a destino">✕</span>}
                <span className={`status ${e.error ? 'err' : ''}`}>
                  {e.error ? `code ${e.error.code}` : status(e)}
                </span>
              </div>
              {isOpen && (
                <div className="preview" onClick={(ev) => ev.stopPropagation()}>
                  <div className="preview-toolbar">
                    <div className="view-tabs">
                      <button
                        className={`view-tab ${viewMode === 'formatted' ? 'active' : ''}`}
                        onClick={(ev2) => { ev2.stopPropagation(); setViewMode('formatted'); }}
                        title="Vista formateada con sintaxis coloreada"
                      >
                        Formatted
                      </button>
                      <button
                        className={`view-tab ${viewMode === 'raw' ? 'active' : ''}`}
                        onClick={(ev2) => { ev2.stopPropagation(); setViewMode('raw'); }}
                        title="JSON sin formato, copiable"
                      >
                        Raw
                      </button>
                    </div>
                    <button
                      className="btn-link"
                      onClick={(ev2) => { ev2.stopPropagation(); copyRaw(e); }}
                      title="Copiar payload al portapapeles"
                    >
                      {copied === e.seq ? '✓ Copiado' : '⧉ Copiar'}
                    </button>
                  </div>
                  {viewMode === 'formatted' ? (
                    <JsonHighlight data={buildTreeData(e)} maxHeight={280} />
                  ) : (
                    <pre className="raw-json"><code>{rawOf(e)}</code></pre>
                  )}
                  {e.spec && !e.spec.ok && (
                    <div className="spec-issues danger-text" title="Detalle">
                      ⚠ Spec MCP: {e.spec.issues ?? 'no conforme'}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function dirLabel(e: LogEntry): string {
  if (e.kind === 'error' && e.dir === 's2c') return '← err';
  if (e.kind === 'notification' && e.dir === 's2c') return '↓ notif';
  if (e.kind === 'notification' && e.dir === 'c2s') return '↑ notif';
  if (e.dir === 'c2s') return '→ req';
  return '← resp';
}

function status(e: LogEntry): string {
  if (e.stderr) return 'stderr';
  if (e.dropped) return 'dropped';
  if (e.result !== undefined) return 'ok';
  return '';
}

/** Payload raw sin formato (para el tab Raw). */
function rawOf(e: LogEntry): string {
  return e.raw;
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function relativeTs(iso: string, now: number): string {
  const d = new Date(iso).getTime();
  const diff = Math.max(0, now - d);
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `hace ${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  return `hace ${Math.floor(hours / 24)}d`;
}

function buildTreeData(e: LogEntry): unknown {
  if (e.stderr) return { _kind: 'stderr', text: e.stderr };
  if (e.method === '[proxy]') return { _kind: 'proxy', ...e };
  if (e.method && e.rpcId != null) {
    return { jsonrpc: '2.0', id: e.rpcId, method: e.method, params: e.params ?? null };
  }
  if (e.method) {
    return { jsonrpc: '2.0', method: e.method, params: e.params ?? null };
  }
  if (e.error) {
    return { jsonrpc: '2.0', id: e.rpcId, error: e.error };
  }
  return { jsonrpc: '2.0', id: e.rpcId, result: e.result ?? null };
}