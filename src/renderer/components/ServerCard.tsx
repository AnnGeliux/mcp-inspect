import React from 'react';
import { SavedServer } from '../../shared/types';
import { truncateMiddle, serverTypeBadge } from '../utils/format';

interface Props {
  server: SavedServer;
  selected: boolean;
  running: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** Icono emoji derivado del nombre/ID del server. */
function serverIcon(server: SavedServer): string {
  const n = server.name.toLowerCase();
  if (n.includes('everything')) return '🧩';
  if (n.includes('echo')) return '🔁';
  if (n.includes('filesystem') || n.includes('fs')) return '📁';
  if (n.includes('git')) return '🌿';
  if (n.includes('github')) return '🐙';
  if (n.includes('database') || n.includes('db') || n.includes('sqlite') || n.includes('postgres')) return '🗄️';
  if (n.includes('browser') || n.includes('puppeteer') || n.includes('playwright')) return '🌐';
  if (n.includes('memory')) return '🧠';
  if (n.includes('slack')) return '💬';
  return '📡';
}

/**
 * Description for the card. Priority:
 * 1. Explicit description field
 * 2. Truncated command (not raw path)
 */
function serverDesc(server: SavedServer): string {
  if (server.description && server.description.trim()) {
    return server.description.trim();
  }
  const cmd = server.config.command;
  const args = server.config.args ?? [];
  const full = [cmd, ...args].join(' ');
  return truncateMiddle(full, 50) || '—';
}

export default function ServerCard({
  server,
  selected,
  running,
  disabled,
  onSelect,
  onEdit,
  onDelete,
}: Props): React.ReactElement {
  const isPreset = !!server.preset;
  const statusBadge = running
    ? { text: 'running', cls: 'badge-running' }
    : isPreset
      ? { text: 'preset', cls: 'badge-preset' }
      : { text: 'idle', cls: 'badge-idle' };

  const typeBadge = serverTypeBadge(server.config);

  return (
    <div
      className={`card ${selected ? 'card-selected' : ''} ${disabled ? 'card-disabled' : ''}`}
      onClick={() => !disabled && onSelect()}
      title={serverDesc(server)}
    >
      <div className="card-top">
        <span className="card-icon">{serverIcon(server)}</span>
        <div className="card-info">
          <span className="card-name">{server.name}</span>
          <span className="card-desc">{serverDesc(server)}</span>
        </div>
        <span className={`card-badge ${statusBadge.cls}`}>{statusBadge.text}</span>
      </div>
      <div className="card-badges-row">
        <span className="card-type-badge">{typeBadge}</span>
      </div>
      {!disabled && (
        <div className="card-actions">
          <button
            className="card-action-btn"
            title="Editar"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
          >
            ✎
          </button>
          {!isPreset && (
            <button
              className="card-action-btn danger"
              title="Eliminar"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`¿Eliminar el server "${server.name}"?`)) onDelete();
              }}
            >
              🗑
            </button>
          )}
        </div>
      )}
    </div>
  );
}