import React, { useState } from 'react';
import { LogEntry } from '../../shared/types';
import JsonTree from './JsonTree';

interface Props {
  entries: LogEntry[];
}

export default function LogList({ entries }: Props): React.ReactElement {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (seq: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq); else next.add(seq);
      return next;
    });
  };

  return (
    <section className="panel log-panel">
      <div className="panel-header">
        <span className="icon">📜</span>
        <span>Tráfico en vivo</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>
          Read-only MITM · {entries.length} mensajes
        </span>
      </div>
      <div className="log-list">
        {entries.length === 0 && (
          <div className="empty">
            Esperando tráfico… Inicia el server con el preset "echo (test)" y presiona "📡 Enviar ping".
          </div>
        )}
        {entries.map((e) => {
          const isOpen = expanded.has(e.seq);
          return (
            <div key={e.seq} className={`log-entry ${isOpen ? 'expanded' : ''}`} onClick={() => toggle(e.seq)}>
              <span className="ts">{formatTs(e.ts)}</span>
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
              {isOpen && (
                <div className="preview" onClick={(ev) => ev.stopPropagation()}>
                  <JsonTree data={buildTreeData(e)} />
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

function buildTreeData(e: LogEntry): unknown {
  if (e.stderr) return { _kind: 'stderr', text: e.stderr };
  if (e.method === '[proxy]') return { _kind: 'proxy', ...e };
  // reconstruir forma JSON-RPC
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
