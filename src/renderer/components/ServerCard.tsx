import React from 'react';
import { SavedServer } from '../../shared/types';
import { truncateMiddle, serverTypeBadge } from '../utils/format';

interface Props {
  server: SavedServer;
  selected: boolean;
  /** Multi-select: the card is checked (queued for group start). */
  checked?: boolean;
  running: boolean;
  disabled?: boolean;
  onSelect: () => void;
  /** Multi-select toggle (Ctrl+Click or checkbox). */
  onToggleChecked?: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** Emoji icon derived from the server's name/ID. */
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
  checked,
  running,
  disabled,
  onSelect,
  onToggleChecked,
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

  // Click semantics:
  // - Ctrl+Click anywhere on the card → toggle the multi-select check.
  // - Plain click → exclusive select (single target).
  const handleCardClick = (e: React.MouseEvent) => {
    if (disabled) return;
    if (e.ctrlKey && onToggleChecked) {
      e.preventDefault();
      onToggleChecked();
      return;
    }
    onSelect();
  };

  return (
    <div
      className={`card ${selected ? 'card-selected' : ''} ${checked ? 'card-checked' : ''} ${disabled ? 'card-disabled' : ''}`}
      onClick={handleCardClick}
      title={serverDesc(server)}
    >
      {/* Multi-select checkbox (top-right corner of the card) */}
      {onToggleChecked && (
        <input
          type="checkbox"
          className="card-check"
          title="Check to include in the group start (Ctrl+Click toggles too)"
          checked={!!checked}
          disabled={disabled}
          onChange={(e) => {
            e.stopPropagation();
            onToggleChecked();
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
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
            title="Edit"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
          >
            ✎
          </button>
          {!isPreset && (
            <button
              className="card-action-btn danger"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete server "${server.name}"?`)) onDelete();
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