import React, { useState } from 'react';
import { ServerConfig, SavedServer } from '../../shared/types';
import ServerCard from './ServerCard';
import { truncateMiddle, envToText, textToEnv, buildCommandPreview, serverTypeBadge } from '../utils/format';

interface Props {
  servers: SavedServer[];
  selectedId: string | null;
  config: ServerConfig;
  /** Multi-select: ids checked for group start (Ctrl+Click / checkbox). */
  checkedIds?: string[];
  onSelect: (id: string) => void;
  /** Toggle a server in the multi-select set. */
  onToggleChecked?: (id: string) => void;
  onChange: (c: ServerConfig) => void;
  onAdd: (name: string, config: ServerConfig, description?: string) => void;
  onUpdate: (id: string, name: string, config: ServerConfig, description?: string) => void;
  onDelete: (id: string) => void;
  /** true if the ACTIVE session's server is running. */
  running: boolean;
  /** Multi-server (M1): ids of ALL running sessions (for per-card badges). */
  runningIds?: string[];
  onStart: () => void;
  /** Restart the subprocess with the same config (Phase 5). */
  onRestart: () => void;
  /** Kill the subprocess immediately, SIGKILL (Phase 5). */
  onKill: () => void;
  /** MITM pause: freeze traffic without killing the subprocess. */
  paused: boolean;
  /** Freeze ALL traffic (the server stays alive). */
  onPause: () => void;
  /** Resume frozen traffic (releases the FIFO queue). */
  onResume: () => void;
}

type EditMode = 'none' | 'add' | 'edit';

export default function ServerPanel(props: Props): React.ReactElement {
  const {
    servers,
    selectedId,
    config,
    checkedIds,
    onSelect,
    onToggleChecked,
    onChange,
    onAdd,
    onUpdate,
    onDelete,
    running,
    runningIds = [],
    onStart,
    onRestart,
    onKill,
    paused,
    onPause,
    onResume,
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
        {running && (
          <button
            className="header-btn server"
            onClick={onRestart}
            disabled={!selected}
            title="Reset the server: restart the subprocess with the same config (the logged session is preserved)"
          >
            ↻ Reset
          </button>
        )}
      </div>
      <div className="panel-body">
        {/* Card grid — visual selectors.
            Multi-server (M1): cards are always clickable (selecting a running
            server focuses its tab); per-server running shows its badge and
            only locks that card's edit/delete. */}
        {editMode === 'none' && (
          <div className="card-grid-section">
            <div className="card-grid-label">Available servers</div>
            <div className="card-grid">
              {servers.map((s) => {
                const isRunning = runningIds.includes(s.id);
                return (
                  <ServerCard
                    key={s.id}
                    server={s}
                    selected={s.id === selectedId}
                    checked={checkedIds?.includes(s.id) ?? false}
                    running={isRunning}
                    disabled={isRunning}
                    onSelect={() => onSelect(s.id)}
                    onToggleChecked={onToggleChecked ? () => onToggleChecked(s.id) : undefined}
                    onEdit={() => startEdit(s.id)}
                    onDelete={() => handleDelete(s.id)}
                  />
                );
              })}
              <button className="card card-add" onClick={startAdd} title="Add a custom server">
                <span className="card-icon">＋</span>
                <span className="card-name">Add</span>
              </button>
            </div>
          </div>
        )}

        {/* Add / Edit form with collapsible sections */}
        {editMode !== 'none' && (
          <div className="endpoint-card edit-form slide-in">
            <div className="form-label">{editMode === 'add' ? 'New server' : 'Edit server'}</div>

            {/* ——— Basic section (always visible) ——— */}
            <div className="form-section-basic">
              <input className="cmd-input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Descriptive name" disabled={running} />
              <input className="cmd-input" style={{ marginTop: 8 }} value={editCommand} onChange={(e) => setEditCommand(e.target.value)} placeholder="Command (e.g. npx)" disabled={running} />
              <input className="cmd-input" style={{ marginTop: 8 }} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Short description (optional)" disabled={running} />

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
              <span>⚙ Advanced</span>
            </button>

            {/* ——— Advanced section (collapsible) ——— */}
            <div className={`form-section-advanced ${showAdvanced ? 'expanded' : 'collapsed'}`}>
              <div className="form-section-advanced-inner">
                <div className="form-field">
                  <label className="form-field-label">Args (one per line)</label>
                  <textarea className="cmd-input args" value={editArgs} onChange={(e) => setEditArgs(e.target.value)} placeholder={'-y\n@modelcontextprotocol/everything-server'} disabled={running} rows={4} />
                </div>

                <div className="form-field" style={{ marginTop: 8 }}>
                  <label className="form-field-label">Environment variables (KEY=VALUE, one per line)</label>
                  <textarea className="cmd-input args" value={editEnv} onChange={(e) => setEditEnv(e.target.value)} placeholder={'ELECTRON_RUN_AS_NODE=1\nNODE_ENV=development'} disabled={running} rows={3} />
                </div>

                <label className="form-checkbox-row" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={editConnectClient}
                    onChange={(e) => setEditConnectClient(e.target.checked)}
                  />
                  <span>Connect the MCP client automatically</span>
                </label>

                {/* Full preview (with env + args) */}
                <div className="cmd-preview" style={{ marginTop: 8 }}>
                  <span className="cmd-preview-label">Full preview</span>
                  <code className="cmd-preview-code">{fullPreview || '—'}</code>
                </div>
              </div>
            </div>

            {/* ——— Action buttons ——— */}
            <div className="crud-row" style={{ marginTop: 8 }}>
              <button className="btn primary small" onClick={saveEdit} disabled={!editName.trim() || !editCommand.trim()}>✓ Save</button>
              <button className="btn small" onClick={cancelEdit}>✕ Cancel</button>
            </div>
          </div>
        )}

        {/* Config display — property table style (DevTools > Properties) */}
        {editMode === 'none' && selected && (
          <div className="prop-table" role="table" aria-label="Selected server configuration">
            <div className="prop-row" role="row">
              <span className="prop-label" role="cell">Command</span>
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
            <span className="empty-state-text">Select a server to get started</span>
          </div>
        )}

        {/* Process manager — per-session gating (multi-server, M1).
            Start is ALWAYS available: it starts the checked group or the
            selected server (focuses its tab). Pause/Resume/Kill act on the
            ACTIVE session only. ↻ Reset lives in the panel-header. */}
        {editMode === 'none' && (
          <div className="action-row" style={{ marginTop: 12 }}>
            <button
              className="btn primary"
              onClick={onStart}
              disabled={!selected && (checkedIds?.length ?? 0) === 0}
              title="Start the selected server (or every checked card)"
            >
              {running && selected && (checkedIds?.length ?? 0) === 0 ? '↻ Start again' : '▶ Start'}
            </button>
            {running && (
              <>
                {paused ? (
                  <button className="btn primary" onClick={onResume} title="Resume frozen traffic — releases the queue in order (FIFO)">▶ Resume</button>
                ) : (
                  <button className="btn warning" onClick={onPause} title="Pause traffic (MITM) of the active session — the server stays alive, messages are queued">⏸ Pause</button>
                )}
                <button className="btn danger" onClick={onKill} title="Kill the active session's server immediately (SIGKILL, no grace period)">☠ Kill</button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}