import React from 'react';
import { SavedClient } from '../../shared/types';

interface Props {
  client: SavedClient;
  selected: boolean;
  connected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function clientIcon(client: SavedClient): string {
  const n = client.name.toLowerCase();
  if (n.includes('sdk')) return '📦';
  if (n.includes('inspector')) return '🔍';
  if (n.includes('claude')) return '🤖';
  if (n.includes('cursor')) return '🖱️';
  if (n.includes('vscode') || n.includes('code')) return '💻';
  if (n.includes('custom')) return '⚙️';
  return '🧑‍💻';
}

function clientDesc(client: SavedClient): string {
  const parts: string[] = [client.config.type];
  if (client.config.command) parts.push(client.config.command);
  const desc = parts.join(' · ');
  return desc.length > 50 ? desc.slice(0, 47) + '…' : desc;
}

export default function ClientCard({
  client,
  selected,
  connected,
  disabled,
  onSelect,
  onEdit,
  onDelete,
}: Props): React.ReactElement {
  const isPreset = !!client.preset;
  const statusBadge = connected
    ? { text: 'connected', cls: 'badge-running' }
    : isPreset
      ? { text: 'preset', cls: 'badge-preset' }
      : { text: 'idle', cls: 'badge-idle' };

  return (
    <div
      className={`card ${selected ? 'card-selected' : ''} ${disabled ? 'card-disabled' : ''}`}
      onClick={() => !disabled && onSelect()}
      title={clientDesc(client)}
    >
      <div className="card-top">
        <span className="card-icon">{clientIcon(client)}</span>
        <div className="card-info">
          <span className="card-name">{client.name}</span>
          <span className="card-desc">{clientDesc(client)}</span>
        </div>
        <span className={`card-badge ${statusBadge.cls}`}>{statusBadge.text}</span>
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
                if (confirm(`¿Eliminar el client "${client.name}"?`)) onDelete();
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