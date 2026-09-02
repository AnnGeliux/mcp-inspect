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

/** Entradas técnicas (stderr / lifecycle / proxy) — ocultas por defecto en la vista chat. */
function isTechnical(e: LogEntry): boolean {
  return (
    !!e.stderr ||
    e.method === '[stderr]' ||
    e.method === '[lifecycle]' ||
    e.method === '[proxy]'
  );
}

/**
 * Agrupación estilo mensajería:
 * - 'tx': par request↔response correlacionados por rpcId (o huérfanos de un lado).
 * - 'solo': notifications y entradas técnicas — burbujas sueltas cronológicas.
 */
interface ChatGroup {
  key: string;
  type: 'tx' | 'solo';
  request?: LogEntry;
  response?: LogEntry;
  solo?: LogEntry;
}

export default function LogList({ entries }: Props): React.ReactElement {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<FilterType>('all');
  const [methodFilter, setMethodFilter] = useState('');
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(Date.now());
  const [viewMode, setViewMode] = useState<ViewMode>('formatted');
  const [copied, setCopied] = useState<number | null>(null);
  const [showTech, setShowTech] = useState(false);
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
  }, [entriesCount, filter, search, methodFilter, showTech]);

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
  const entryMethod = (e: LogEntry): string =>
    e.method && e.method !== '[lifecycle]' && e.method !== '[stderr]' && e.method !== '[proxy]'
      ? e.method
      : e.requestMethod ?? '';

  // Filtered entries (mismos filtros que el timeline — misma data)
  const filtered = useMemo(() => {
    let list = entries;
    if (!showTech) list = list.filter((e) => !isTechnical(e));
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
  }, [entries, filter, methodFilter, search, showTech]);

  // Número de técnicos ocultos (para el hint del empty state)
  const hiddenTechCount = useMemo(
    () => (showTech ? 0 : entries.filter((e) => isTechnical(e)).length),
    [entries, showTech],
  );

  // ——— Agrupación chat: transacciones + burbujas sueltas ———
  const groups = useMemo(() => {
    const byId = new Map<string, ChatGroup>();
    const out: ChatGroup[] = [];
    for (const e of filtered) {
      if (isTechnical(e) || e.kind === 'notification') {
        out.push({ key: `solo-${e.seq}`, type: 'solo', solo: e });
        continue;
      }
      if (e.kind === 'request') {
        const g = byId.get(String(e.rpcId));
        if (g) {
          g.request = e;
        } else {
          const ng: ChatGroup = { key: `tx-${e.seq}`, type: 'tx', request: e };
          byId.set(String(e.rpcId), ng);
          out.push(ng);
        }
        continue;
      }
      // response | error — completa la transacción de su id (o queda huérfana)
      const g = byId.get(String(e.rpcId));
      if (g) {
        g.response = e;
      } else {
        const ng: ChatGroup = { key: `tx-${e.seq}`, type: 'tx', response: e };
        byId.set(String(e.rpcId), ng);
        out.push(ng);
      }
    }
    return out;
  }, [filtered]);

  const toggle = (seq: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
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

  // ——— Render de una burbuja (request derecha / response izq. / notif gris) ———
  const renderBubble = (e: LogEntry): React.ReactElement => {
    const isOpen = expanded.has(e.seq);
    const side = e.dir === 'c2s' ? 'right' : 'left';
    const variant =
      e.kind === 'notification' ? 'notif' : isTechnical(e) ? 'tech' : e.error ? 'err' : '';
    return (
      <div
        key={e.seq}
        className={`log-entry bubble ${side} ${variant} ${isOpen ? 'expanded' : ''} fade-in`}
        onClick={() => toggle(e.seq)}
      >
        <div className="bubble-meta">
          <span className="log-toggle">{isOpen ? '▾' : '▸'}</span>
          <span className="method">
            <span className="m">
              {e.method ??
                (e.kind === 'response' || e.kind === 'error' ? `← ${e.rpcId}` : '(?)')}
            </span>
            {e.rpcId != null && <span className="id">id={String(e.rpcId)}</span>}
          </span>
          {/* Badge de spec (Phase 5) */}
          {e.spec && !e.spec.ok && (
            <span
              className="spec-badge spec-error"
              title={`No conforme con la spec MCP: ${e.spec.issues ?? ''}`}
            >
              ⚠ spec
            </span>
          )}
          {/* Badges de interceptación (Phase 6/7) */}
          {e.held && (
            <span className="pill warning" title={`Retenido ${e.heldMs ?? 0} ms`}>
              ⏸
            </span>
          )}
          {e.modified && (
            <span className="pill purple" title="Modificado por el usuario">
              ✎
            </span>
          )}
          {e.dropped && (
            <span className="pill danger" title="Descartado — nunca llegó a destino">
              ✕
            </span>
          )}
          {e.simulated === 'fault' && (
            <span
              className="pill danger"
              title="Fault injection — error JSON-RPC inyectado por regla"
            >
              ⚡ fault
            </span>
          )}
          {e.simulated === 'mock' && (
            <span
              className="pill purple"
              title="Auto-mock — respuesta sintética, el destino real no fue golpeado"
            >
              🧪 mock
            </span>
          )}
          {e.simulated === 'throttle' && (
            <span
              className="pill warning"
              title={`Throttling — retraso artificial de ${e.heldMs ?? 0} ms`}
            >
              🕒 {e.heldMs ?? 0}ms
            </span>
          )}
          <span className={`status ${e.error ? 'err' : ''}`}>
            {e.error ? `code ${e.error.code}` : status(e)}
          </span>
        </div>
        {/* Payload plegado a 2 líneas; click expande inline */}
        {!isOpen && <div className="bubble-snippet">{snippetOf(e)}</div>}
        {isOpen && (
          <div className="preview" onClick={(ev) => ev.stopPropagation()}>
            <div className="preview-toolbar">
              <div className="view-tabs">
                <button
                  className={`view-tab ${viewMode === 'formatted' ? 'active' : ''}`}
                  onClick={(ev2) => {
                    ev2.stopPropagation();
                    setViewMode('formatted');
                  }}
                  title="Vista formateada con sintaxis coloreada"
                >
                  Formatted
                </button>
                <button
                  className={`view-tab ${viewMode === 'raw' ? 'active' : ''}`}
                  onClick={(ev2) => {
                    ev2.stopPropagation();
                    setViewMode('raw');
                  }}
                  title="JSON sin formato, copiable"
                >
                  Raw
                </button>
              </div>
              <button
                className="btn-link"
                onClick={(ev2) => {
                  ev2.stopPropagation();
                  copyRaw(e);
                }}
                title="Copiar payload al portapapeles"
              >
                {copied === e.seq ? '✓ Copiado' : '⧉ Copiar'}
              </button>
            </div>
            {viewMode === 'formatted' ? (
              <JsonHighlight data={buildTreeData(e)} maxHeight={280} />
            ) : (
              <pre className="raw-json">
                <code>{rawOf(e)}</code>
              </pre>
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
  };

  // ——— Render de una transacción (bloque full-width request↔response) ———
  const renderTx = (g: ChatGroup): React.ReactElement => {
    const req = g.request;
    const resp = g.response;
    const method = req?.method ?? resp?.requestMethod ?? `← ${String(resp?.rpcId ?? '?')}`;
    const id = req?.rpcId ?? resp?.rpcId;
    return (
      <div key={g.key} className="tx-block fade-in">
        <div className="tx-header">
          <span className="method">
            <span className="m">{method}</span>
            {id != null && <span className="id">id={String(id)}</span>}
          </span>
          {/* Latencia correlacionada (Phase 5) */}
          {resp?.latencyMs !== undefined && (
            <span
              className={`latency ${resp.latencyMs > 2000 ? 'slow' : ''}`}
              title={`Latencia request→response (${resp.requestMethod ?? '?'})`}
            >
              {resp.latencyMs} ms
            </span>
          )}
          {!resp && <span className="tx-waiting">esperando respuesta…</span>}
        </div>
        <div className="tx-msgs">
          {req && renderBubble(req)}
          {resp && renderBubble(resp)}
        </div>
      </div>
    );
  };

  return (
    <section className="panel log-panel">
      <div className="panel-header">
        <span className="icon">📜</span>
        <span>Tráfico en vivo</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>
          MITM · {entries.length} mensajes
        </span>
      </div>

      {/* Toolbar: filters + method filter + search + toggle técnicos */}
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
          <button
            className={`filter-btn ${showTech ? 'active' : ''}`}
            onClick={() => setShowTech((v) => !v)}
            title="Mostrar/ocultar mensajes técnicos (stderr, lifecycle, proxy)"
          >
            🔧 técnicos
            {hiddenTechCount > 0 && <span className="filter-count">{hiddenTechCount}</span>}
          </button>
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

      <div className="log-list chat" ref={listRef} onScroll={handleScroll}>
        {showJumpBtn && (
          <button className="jump-latest" onClick={jumpToBottom} title="Volver al último mensaje">
            ⤓ Último
          </button>
        )}
        {filtered.length === 0 && entries.length === 0 && (
          <div className="empty-state">
            <span className="empty-state-icon">📜</span>
            <span className="empty-state-text">
              Esperando tráfico… Inicia el server para ver mensajes
            </span>
          </div>
        )}
        {filtered.length === 0 && entries.length > 0 && (
          <div className="empty-state">
            <span className="empty-state-icon">🔍</span>
            <span className="empty-state-text">Sin resultados para el filtro/búsqueda actual</span>
            {hiddenTechCount > 0 && (
              <span className="empty-state-text">
                {hiddenTechCount} mensajes técnicos ocultos — activa 🔧 técnicos
              </span>
            )}
          </div>
        )}
        {groups.map((g) => (g.type === 'solo' ? renderBubble(g.solo!) : renderTx(g)))}
      </div>
    </section>
  );
}

function status(e: LogEntry): string {
  if (e.stderr) return 'stderr';
  if (e.dropped) return 'dropped';
  if (e.result !== undefined) return 'ok';
  return '';
}

/** Payload resumido de una burbuja (2 líneas plegadas). */
function snippetOf(e: LogEntry): string {
  let s: string;
  if (e.stderr) s = e.stderr;
  else if (e.method === '[lifecycle]' || e.method === '[proxy]') s = e.raw;
  else if (e.kind === 'request' || e.kind === 'notification')
    s = e.params !== undefined ? JSON.stringify(e.params) : '(sin params)';
  else if (e.error) s = JSON.stringify(e.error);
  else s = e.result !== undefined ? JSON.stringify(e.result) : '(sin result)';
  if (s.length > 600) s = s.slice(0, 600) + '…';
  return s;
}

/** Payload raw sin formato (para el tab Raw). */
function rawOf(e: LogEntry): string {
  return e.raw;
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