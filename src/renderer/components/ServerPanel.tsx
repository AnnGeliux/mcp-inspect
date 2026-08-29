import React, { useState } from 'react';
import { ServerConfig, SavedServer } from '../../shared/types';

interface Props {
  /** Lista de servers guardados (presets + user). */
  servers: SavedServer[];
  /** ID del server seleccionado. */
  selectedId: string | null;
  /** Config del server seleccionado (editable). */
  config: ServerConfig;
  /** Callback al seleccionar un server del dropdown. */
  onSelect: (id: string) => void;
  /** Callback al editar la config del server seleccionado. */
  onChange: (c: ServerConfig) => void;
  /** Callback al agregar un server nuevo. */
  onAdd: (name: string, config: ServerConfig) => void;
  /** Callback al editar el nombre/config de un server guardado. */
  onUpdate: (id: string, name: string, config: ServerConfig) => void;
  /** Callback al eliminar un server. */
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

  const selected = servers.find((s) => s.id === selectedId) ?? null;
  const cmdStr = [config.command, ...(config.args ?? [])].join(' ');

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (id) onSelect(id);
  };

  const startAdd = () => {
    setEditName('');
    setEditCommand('');
    setEditArgs('');
    setEditMode('add');
  };

  const startEdit = () => {
    if (!selected) return;
    setEditName(selected.name);
    setEditCommand(selected.config.command);
    setEditArgs((selected.config.args ?? []).join('\n'));
    setEditMode('edit');
  };

  const cancelEdit = () => {
    setEditMode('none');
  };

  const saveEdit = () => {
    const args = editArgs.split('\n').filter((s) => s.length > 0);
    const newConfig: ServerConfig = { ...config, command: editCommand, args };
    if (editMode === 'add') {
      onAdd(editName, newConfig);
    } else if (editMode === 'edit' && selected) {
      onUpdate(selected.id, editName, newConfig);
    }
    setEditMode('none');
  };

  const handleDelete = () => {
    if (!selected) return;
    if (selected.preset) return;
    if (confirm(`¿Eliminar el server "${selected.name}"?`)) {
      onDelete(selected.id);
    }
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
        {/* Dropdown selector */}
        <div className="endpoint-card">
          <div className="label">Server seleccionado</div>
          <select
            className="dropdown"
            value={selectedId ?? ''}
            onChange={handleSelectChange}
            disabled={running || editMode !== 'none'}
          >
            <option value="" disabled>— Selecciona un server —</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.preset ? ' (preset)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* CRUD buttons */}
        {editMode === 'none' && (
          <div className="crud-row">
            <button className="btn small" onClick={startAdd} disabled={running}>＋ Agregar</button>
            <button className="btn small" onClick={startEdit} disabled={running || !selected}>✎ Editar</button>
            <button
              className="btn small danger-text"
              onClick={handleDelete}
              disabled={running || !selected || !!selected?.preset}
              title={selected?.preset ? 'Los presets no se pueden eliminar' : ''}
            >
              🗑 Eliminar
            </button>
          </div>
        )}

        {/* Add / Edit form */}
        {editMode !== 'none' && (
          <div className="endpoint-card edit-form">
            <div className="label">{editMode === 'add' ? 'Nuevo server' : 'Editar server'}</div>
            <input
              className="cmd-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Nombre descriptivo"
              disabled={running}
            />
            <input
              className="cmd-input"
              style={{ marginTop: 6 }}
              value={editCommand}
              onChange={(e) => setEditCommand(e.target.value)}
              placeholder="Comando (ej. npx)"
              disabled={running}
            />
            <textarea
              className="cmd-input args"
              style={{ marginTop: 6 }}
              value={editArgs}
              onChange={(e) => setEditArgs(e.target.value)}
              placeholder={'Args (uno por línea)'}
              disabled={running}
              rows={4}
            />
            <div className="crud-row" style={{ marginTop: 8 }}>
              <button className="btn primary small" onClick={saveEdit} disabled={!editName.trim() || !editCommand.trim()}>
                ✓ Guardar
              </button>
              <button className="btn small" onClick={cancelEdit}>✕ Cancelar</button>
            </div>
          </div>
        )}

        {/* Config display (when not editing) */}
        {editMode === 'none' && selected && (
          <>
            <div className="endpoint-card">
              <div className="label">Comando</div>
              <input
                className="cmd-input"
                value={config.command}
                onChange={(e) => update({ command: e.target.value })}
                placeholder="npx"
                disabled={running}
              />
            </div>
            <div className="endpoint-card">
              <div className="label">Args (uno por línea)</div>
              <textarea
                className="cmd-input args"
                value={(config.args ?? []).join('\n')}
                onChange={(e) => update({ args: e.target.value.split('\n').filter((s) => s.length > 0) })}
                placeholder={'-y\n@modelcontextprotocol/everything-server'}
                disabled={running}
                rows={4}
              />
            </div>
            <div className="endpoint-card">
              <div className="label">Preview</div>
              <div className="value">{cmdStr}</div>
            </div>
          </>
        )}

        {/* Empty state */}
        {editMode === 'none' && !selected && (
          <div className="endpoint-card">
            <div className="value" style={{ color: 'var(--text-dim)' }}>
              Selecciona o agrega un server para configurarlo.
            </div>
          </div>
        )}

        {/* Start/Stop */}
        {editMode === 'none' && (
          <div className="action-row">
            {!running ? (
              <button className="btn primary" onClick={onStart} disabled={!selected}>▶ Start</button>
            ) : (
              <button className="btn danger" onClick={onStop}>■ Stop</button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}