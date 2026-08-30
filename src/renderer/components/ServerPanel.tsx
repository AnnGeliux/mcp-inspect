import React, { useState } from 'react';
import { ServerConfig, SavedServer } from '../../shared/types';
import ServerCard from './ServerCard';
import { truncateMiddle, envToText, textToEnv, buildCommandPreview, serverTypeBadge } from '../utils/format';

interface Props {
  servers: SavedServer[];
  selectedId: string | null;
  config: ServerConfig;
  onSelect: (id: string) => void;
  onChange: (c: ServerConfig) => void;
  onAdd: (name: string, config: ServerConfig, description?: string) => void;
  onUpdate: (id: string, name: string, config: ServerConfig, description?: string) => void;
  onDelete: (id: string) => void;
  running: boolean;
  onStart: () => void;
  onStop: () => void;
  /** Reiniciar el subprocess con la misma config (Phase 5). */
  onRestart: () => void;
  /** Matar el subprocess inmediatamente, SIGKILL (Phase 5). */
  onKill: () => void;
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
    onRestart,
    onKill,
  } = props;

  const [editMode, setEditMode] = useState<EditMode>('none');
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCommand, setEditCommand] = useState('');
  const [editArgs, setEditArgs] = useState('');
  const [editEnv, setEditEnv] = useState('');
  const [editConnectClient, setEditConnectClient] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const selected = servers.find((s) => s.id === selectedId) ?? null;
  const cmdStr = buildCommandPreview(config.command, config.args ?? [], config.env);

  const startAdd = () => {
    setEditName(''); setEditDesc(''); setEditCommand(''); setEditArgs(''); setEditEnv('');
    setEditConnectClient(true); setEditId(null); setShowAdvanced(false);
    setEditMode('add');
  };

  const startEdit = (id: string) => {
    const s = servers.find((srv) => srv.id === id);
    if (!s) return;
    setEditName(s.name);
    setEditDesc(s.description ?? '');
    setEditCommand(s.config.command);
    setEditArgs((s.config.args ?? []).join('\n'));
    setEditEnv(envToText(s.config.env));
    setEditConnectClient(s.config.connectClient !== false);
    setEditId(id);
    setShowAdvanced(false);
    setEditMode('edit');
  };

  const cancelEdit = () => { setEditMode('none'); setEditId(null); };

  const saveEdit = () => {
    const args = editArgs.split('\n').filter((s) => s.length > 0);
    const env = textToEnv(editEnv);
    const newConfig: ServerConfig = {
      ...config,
      command: editCommand,
      args,
      env: Object.keys(env).length > 0 ? env : undefined,
      connectClient: editConnectClient,
    };
    const desc = editDesc.trim() || undefined;
    if (editMode === 'add') {
      onAdd(editName, newConfig, desc);
    } else if (editMode === 'edit' && editId) {
      onUpdate(editId, editName, newConfig, desc);
    }
    setEditMode('none'); setEditId(null);
  };

  const handleDelete = (id: string) => {
    const s = servers.find((srv) => srv.id === id);
    if (!s || s.preset) return;
    onDelete(id);
  };

  const update = (patch: Partial<ServerConfig>) => onChange({ ...config, ...patch });

  // Build live preview for edit form
  const editArgsList = editArgs.split('\n').filter((s) => s.length > 0);
  const editEnvRecord = textToEnv(editEnv);
  const basicPreview = [editCommand, ...editArgsList].filter(Boolean).join(' ');
  const fullPreview = buildCommandPreview(editCommand, editArgsList, editEnvRecord);

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

        {/* Add / Edit form with collapsible sections */}
        {editMode !== 'none' && (
          <div className="endpoint-card edit-form slide-in">
            <div className="form-label">{editMode === 'add' ? 'Nuevo server' : 'Editar server'}</div>

            {/* ——— Basic section (always visible) ——— */}
            <div className="form-section-basic">
              <input className="cmd-input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nombre descriptivo" disabled={running} />
              <input className="cmd-input" style={{ marginTop: 8 }} value={editCommand} onChange={(e) => setEditCommand(e.target.value)} placeholder="Comando (ej. npx)" disabled={running} />
              <input className="cmd-input" style={{ marginTop: 8 }} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Descripción corta (opcional)" disabled={running} />

              {/* Basic preview */}
              <div className="cmd-preview" style={{ marginTop: 8 }}>
                <span className="cmd-preview-label">Preview</span>
                <code className="cmd-preview-code">{basicPreview || '—'}</code>
              </div>
            </div>

            {/* ——— Advanced toggle ——— */}
            <button
              className={`advanced-toggle ${showAdvanced ? 'expanded' : ''}`}
              onClick={() => setShowAdvanced(!showAdvanced)}
              type="button"
            >
              <span className="advanced-toggle-icon">{showAdvanced ? '▾' : '▸'}</span>
              <span>⚙ Avanzado</span>
            </button>

            {/* ——— Advanced section (collapsible) ——— */}
            <div className={`form-section-advanced ${showAdvanced ? 'expanded' : 'collapsed'}`}>
              <div className="form-section-advanced-inner">
                <div className="form-field">
                  <label className="form-field-label">Args (uno por línea)</label>
                  <textarea className="cmd-input args" value={editArgs} onChange={(e) => setEditArgs(e.target.value)} placeholder={'-y\n@modelcontextprotocol/everything-server'} disabled={running} rows={4} />
                </div>

                <div className="form-field" style={{ marginTop: 8 }}>
                  <label className="form-field-label">Variables de entorno (KEY=VALUE, una por línea)</label>
                  <textarea className="cmd-input args" value={editEnv} onChange={(e) => setEditEnv(e.target.value)} placeholder={'ELECTRON_RUN_AS_NODE=1\nNODE_ENV=development'} disabled={running} rows={3} />
                </div>

                <label className="form-checkbox-row" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={editConnectClient}
                    onChange={(e) => setEditConnectClient(e.target.checked)}
                  />
                  <span>Conectar cliente MCP automáticamente</span>
                </label>

                {/* Full preview (with env + args) */}
                <div className="cmd-preview" style={{ marginTop: 8 }}>
                  <span className="cmd-preview-label">Preview completo</span>
                  <code className="cmd-preview-code">{fullPreview || '—'}</code>
                </div>
              </div>
            </div>

            {/* ——— Action buttons ——— */}
            <div className="crud-row" style={{ marginTop: 8 }}>
              <button className="btn primary small" onClick={saveEdit} disabled={!editName.trim() || !editCommand.trim()}>✓ Guardar</button>
              <button className="btn small" onClick={cancelEdit}>✕ Cancelar</button>
            </div>
          </div>
        )}

        {/* Config display — property table style (DevTools > Properties) */}
        {editMode === 'none' && selected && (
          <div className="prop-table" role="table" aria-label="Configuración del server seleccionado">
            <div className="prop-row" role="row">
              <span className="prop-label" role="cell">Comando</span>
              <span className="prop-value" role="cell">
                <input className="prop-input" value={config.command} onChange={(e) => update({ command: e.target.value })} placeholder="npx" disabled={running} spellCheck={false} />
              </span>
            </div>
            <div className="prop-row" role="row">
              <span className="prop-label" role="cell">Args</span>
              <span className="prop-value" role="cell">
                <textarea className="prop-input prop-input-textarea" value={(config.args ?? []).join('\n')} onChange={(e) => update({ args: e.target.value.split('\n').filter((s) => s.length > 0) })} placeholder={'-y\n@modelcontextprotocol/everything-server'} disabled={running} rows={4} spellCheck={false} />
              </span>
            </div>
            <div className="prop-row" role="row">
              <span className="prop-label" role="cell">Preview</span>
              <span className="prop-value" role="cell">
                <code className="prop-code" title={cmdStr}>{truncateMiddle(cmdStr, 140)}</code>
              </span>
            </div>
            {config.env && Object.keys(config.env).length > 0 && (
              <div className="prop-row" role="row">
                <span className="prop-label" role="cell">Env</span>
                <span className="prop-value" role="cell">
                  <code className="prop-code">
                    {Object.entries(config.env).map(([k, v]) => `${k}=${v}`).join(' ')}
                  </code>
                </span>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {editMode === 'none' && !selected && (
          <div className="empty-state">
            <span className="empty-state-icon">📡</span>
            <span className="empty-state-text">Selecciona un server para empezar</span>
          </div>
        )}

        {/* Start/Stop/Restart/Kill — gestor de procesos (Phase 5, feature 1c) */}
        {editMode === 'none' && (
          <div className="action-row" style={{ marginTop: 12 }}>
            {!running ? (
              <button className="btn primary" onClick={onStart} disabled={!selected} title="Iniciar el server MCP">▶ Start</button>
            ) : (
              <>
                <button className="btn" onClick={onRestart} title="Reiniciar el subprocess (mantiene la sesión loggeada)">↻ Reiniciar</button>
                <button className="btn danger" onClick={onStop} title="Detener el server (SIGTERM → SIGKILL)">■ Stop</button>
                <button className="btn danger" onClick={onKill} title="Matar inmediatamente (SIGKILL, sin gracia)">☠ Matar</button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}