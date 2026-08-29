import React, { useState, useMemo, useEffect } from 'react';
import { LogEntry } from '../../shared/types';
import JsonHighlight from './JsonHighlight';

interface Props {
  entries: LogEntry[];
}

type FilterType = 'all' | 'request' | 'response' | 'notification' | 'error';

export default function LogList({ entries }: Props): React.ReactElement {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(Date.now());

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

  // Filtered entries
  const filtered = useMemo(() => {
    let list = entries;
    if (filter !== 'all') list = list.filter((e) => e.kind === filter);
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
  }, [entries, filter, search]);

  const toggle = (seq: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq); else next.add(seq);
      return next;
    });
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
          Read-only MITM · {entries.length} mensajes
        </span>
      </div>

      {/* Toolbar: filters + search */}
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
        <input
          className="log-search"
          placeholder="Buscar método, id, payload…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="log-list">
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
                  <span className="m">{e.method ?? (e.kind === 'response' ? `← ${e.rpcId}` : '(?)')}</span>
                  {e.rpcId != null && <span className="id">id={String(e.rpcId)}</span>}
                </span>
                <span className={`status ${e.error ? 'err' : ''}`}>
                  {e.error ? `code ${e.error.code}` : status(e)}
                </span>
              </div>
              {isOpen && (
                <div className="preview" onClick={(ev) => ev.stopPropagation()}>
                  <JsonHighlight data={buildTreeData(e)} />
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
  if (e.result !== undefined) return 'ok';
  return '';
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