import React, { useState } from 'react';
import { ServerConfig, SavedServer } from '../../shared/types';
import ServerCard from './ServerCard';

interface Props {
  servers: SavedServer[];
  selectedId: string | null;
  config: ServerConfig;
  onSelect: (id: string) => void;
  onChange: (c: ServerConfig) => void;
  onAdd: (name: string, config: ServerConfig) => void;
  onUpdate: (id: string, name: string, config: ServerConfig) => void;
  onDelete: (id: string) => void;
  running: boolean;
  onStart: () => void;
  onStop: () => void;
}

type EditMode = 'none' | 'add' | 'edit';

export default function ServerPanel(props: Props): React.ReactElement {
  const {
    servers,
    selectedId,
    config,
    onSelect,
    onChange,
    onAdd,
    onUpdate,
    onDelete,
    running,
    onStart,
    onStop,
  } = props;

  const [editMode, setEditMode] = useState<EditMode>('none');
  const [editName, setEditName] = useState('');
  const [editCommand, setEditCommand] = useState('');
  const [editArgs, setEditArgs] = useState('');
  const [editId, setEditId] = useState<string | null>(null);

  const selected = servers.find((s) => s.id === selectedId) ?? null;
  const cmdStr = [config.command, ...(config.args ?? [])].join(' ');

  const startAdd = () => {
    setEditName(''); setEditCommand(''); setEditArgs(''); setEditId(null);
    setEditMode('add');
  };

  const startEdit = (id: string) => {
    const s = servers.find((srv) => srv.id === id);
    if (!s) return;
    setEditName(s.name);
    setEditCommand(s.config.command);
    setEditArgs((s.config.args ?? []).join('\n'));
    setEditId(id);
    setEditMode('edit');
  };

  const cancelEdit = () => { setEditMode('none'); setEditId(null); };

  const saveEdit = () => {
    const args = editArgs.split('\n').filter((s) => s.length > 0);
    const newConfig: ServerConfig = { ...config, command: editCommand, args };
    if (editMode === 'add') {
      onAdd(editName, newConfig);
    } else if (editMode === 'edit' && editId) {
      onUpdate(editId, editName, newConfig);
    }
    setEditMode('none'); setEditId(null);
  };

  const handleDelete = (id: string) => {
    const s = servers.find((srv) => srv.id === id);
    if (!s || s.preset) return;
    onDelete(id);
  };

  const update = (patch: Partial<ServerConfig>) => onChange({ ...config, ...patch });

  return (
    <section className="panel">
      <div className="panel-header">
        <span className="icon">📡</span>
        <span>MCP Server</span>
        <span className="role-tag">target</span>
      </div>
      <div className="panel-body">
        {/* Card grid — visual selectors */}
        {editMode === 'none' && (
          <div className="card-grid-section">
            <div className="card-grid-label">Servers disponibles</div>
            <div className="card-grid">
              {servers.map((s) => (
                <ServerCard
                  key={s.id}
                  server={s}
                  selected={s.id === selectedId}
                  running={running && s.id === selectedId}
                  disabled={running}
                  onSelect={() => onSelect(s.id)}
                  onEdit={() => startEdit(s.id)}
                  onDelete={() => handleDelete(s.id)}
                />
              ))}
              <button className="card card-add" onClick={startAdd} disabled={running} title="Agregar server custom">
                <span className="card-icon">＋</span>
                <span className="card-name">Agregar</span>
              </button>
            </div>
          </div>
        )}

        {/* Add / Edit form */}
        {editMode !== 'none' && (
          <div className="endpoint-card edit-form slide-in">
            <div className="label">{editMode === 'add' ? 'Nuevo server' : 'Editar server'}</div>
            <input className="cmd-input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nombre descriptivo" disabled={running} />
            <input className="cmd-input" style={{ marginTop: 8 }} value={editCommand} onChange={(e) => setEditCommand(e.target.value)} placeholder="Comando (ej. npx)" disabled={running} />
            <textarea className="cmd-input args" style={{ marginTop: 8 }} value={editArgs} onChange={(e) => setEditArgs(e.target.value)} placeholder={'Args (uno por línea)'} disabled={running} rows={4} />
            <div className="crud-row" style={{ marginTop: 8 }}>
              <button className="btn primary small" onClick={saveEdit} disabled={!editName.trim() || !editCommand.trim()}>✓ Guardar</button>
              <button className="btn small" onClick={cancelEdit}>✕ Cancelar</button>
            </div>
          </div>
        )}

        {/* Config display (when not editing) */}
        {editMode === 'none' && selected && (
          <>
            <div className="endpoint-card">
              <div className="label">Comando</div>
              <input className="cmd-input" value={config.command} onChange={(e) => update({ command: e.target.value })} placeholder="npx" disabled={running} />
            </div>
            <div className="endpoint-card">
              <div className="label">Args (uno por línea)</div>
              <textarea className="cmd-input args" value={(config.args ?? []).join('\n')} onChange={(e) => update({ args: e.target.value.split('\n').filter((s) => s.length > 0) })} placeholder={'-y\n@modelcontextprotocol/everything-server'} disabled={running} rows={4} />
            </div>
            <div className="endpoint-card">
              <div className="label">Preview</div>
              <div className="value">{cmdStr}</div>
            </div>
          </>
        )}

        {/* Empty state */}
        {editMode === 'none' && !selected && (
          <div className="empty-state">
            <span className="empty-state-icon">📡</span>
            <span className="empty-state-text">Selecciona un server para empezar</span>
          </div>
        )}

        {/* Start/Stop */}
        {editMode === 'none' && (
          <div className="action-row" style={{ marginTop: 12 }}>
            {!running ? (
              <button className="btn primary" onClick={onStart} disabled={!selected} title="Iniciar el server MCP">▶ Start</button>
            ) : (
              <button className="btn danger" onClick={onStop} title="Detener el server">■ Stop</button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}