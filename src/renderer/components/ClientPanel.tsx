import React, { useState } from 'react';
import { LogEntry, ClientConfig, SavedClient } from '../../shared/types';
import ClientCard from './ClientCard';
import JsonHighlight from './JsonHighlight';
import { truncateMiddle, envToText, textToEnv, buildCommandPreview, clientTypeBadge } from '../utils/format';

interface Props {
  clients: SavedClient[];
  selectedClientId: string | null;
  onSelectClient: (id: string) => void;
  onAddClient: (name: string, config: ClientConfig, description?: string) => void;
  onUpdateClient: (id: string, name: string, config: ClientConfig, description?: string) => void;
  onDeleteClient: (id: string) => void;
  clientConnected: boolean;
  serverInfo: { name?: string; version?: string; capabilities?: unknown } | null;
  lastToolResult: LogEntry | null;
  hasSelection: boolean;
  onPing: () => void;
  onListTools: () => void;
  onCallEcho: () => void;
  onCallLongRunning: () => void;
  onSendRaw: (msg: string) => void;
  onExport: () => void;
  onImport: () => void;
}

type EditMode = 'none' | 'add' | 'edit';

export default function ClientPanel(props: Props): React.ReactElement {
  const {
    clients,
    selectedClientId,
    onSelectClient,
    onAddClient,
    onUpdateClient,
    onDeleteClient,
    clientConnected,
    serverInfo,
    lastToolResult,
    hasSelection,
    onPing,
    onListTools,
    onCallEcho,
    onCallLongRunning,
    onSendRaw,
    onExport,
    onImport,
  } = props;

  const [rawInput, setRawInput] = useState('');
  const [editMode, setEditMode] = useState<EditMode>('none');
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editType, setEditType] = useState<'sdk' | 'inspector'>('sdk');
  const [editCommand, setEditCommand] = useState('');
  const [editArgs, setEditArgs] = useState('');
  const [editEnv, setEditEnv] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const selected = clients.find((c) => c.id === selectedClientId) ?? null;
  const caps = serverInfo?.capabilities as Record<string, unknown> | undefined;
  const interactionDisabled = !hasSelection || !clientConnected;

  const startAdd = () => {
    setEditName(''); setEditDesc(''); setEditType('sdk'); setEditCommand('node'); setEditArgs(''); setEditEnv('');
    setEditId(null); setShowAdvanced(false);
    setEditMode('add');
  };

  const startEdit = (id: string) => {
    const c = clients.find((cl) => cl.id === id);
    if (!c) return;
    setEditName(c.name);
    setEditDesc(c.description ?? '');
    setEditType(c.config.type);
    setEditCommand(c.config.command);
    setEditArgs((c.config.args ?? []).join('\n'));
    setEditEnv(envToText(c.config.env));
    setEditId(id);
    setShowAdvanced(false);
    setEditMode('edit');
  };

  const cancelEdit = () => { setEditMode('none'); setEditId(null); };

  const saveEdit = () => {
    const args = editArgs.split('\n').filter((s) => s.length > 0);
    const env = textToEnv(editEnv);
    const newConfig: ClientConfig = {
      type: editType,
      name: editName,
      command: editCommand,
      args,
      env: Object.keys(env).length > 0 ? env : undefined,
    };
    const desc = editDesc.trim() || undefined;
    if (editMode === 'add') {
      onAddClient(editName, newConfig, desc);
    } else if (editMode === 'edit' && editId) {
      onUpdateClient(editId, editName, newConfig, desc);
    }
    setEditMode('none'); setEditId(null);
  };

  const handleDelete = (id: string) => {
    const c = clients.find((cl) => cl.id === id);
    if (!c || c.preset) return;
    onDeleteClient(id);
  };

  // Build live preview for edit form
  const editArgsList = editArgs.split('\n').filter((s) => s.length > 0);
  const editEnvRecord = textToEnv(editEnv);
  const basicPreview = [editCommand, ...editArgsList].filter(Boolean).join(' ');
  const fullPreview = buildCommandPreview(editCommand, editArgsList, editEnvRecord);

  return (
    <section className="panel">
      <div className="panel-header">
        <span className="icon">🧑‍💻</span>
        <span>MCP Client</span>
        <span className={`role-tag ${clientConnected ? 'green' : ''}`}>
          {clientConnected ? 'connected' : 'idle'}
        </span>
      </div>
      <div className="panel-body">
        {/* Card grid */}
        {editMode === 'none' && (
          <div className="card-grid-section">
            <div className="card-grid-label">Clients disponibles</div>
            <div className="card-grid">
              {clients.map((c) => (
                <ClientCard
                  key={c.id}
                  client={c}
                  selected={c.id === selectedClientId}
                  connected={clientConnected && c.id === selectedClientId}
                  onSelect={() => onSelectClient(c.id)}
                  onEdit={() => startEdit(c.id)}
                  onDelete={() => handleDelete(c.id)}
                />
              ))}
              <button className="card card-add" onClick={startAdd} title="Agregar client custom">
                <span className="card-icon">＋</span>
                <span className="card-name">Agregar</span>
              </button>
            </div>
          </div>
        )}

        {/* Add / Edit form with collapsible sections */}
        {editMode !== 'none' && (
          <div className="endpoint-card edit-form slide-in">
            <div className="form-label">{editMode === 'add' ? 'Nuevo client' : 'Editar client'}</div>

            {/* ——— Basic section (always visible) ——— */}
            <div className="form-section-basic">
              <input className="cmd-input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nombre descriptivo" />
              <select className="dropdown" style={{ marginTop: 8 }} value={editType} onChange={(e) => setEditType(e.target.value as 'sdk' | 'inspector')}>
                <option value="sdk">SDK (@modelcontextprotocol/sdk)</option>
                <option value="inspector">Inspector oficial</option>
              </select>
              <input className="cmd-input" style={{ marginTop: 8 }} value={editCommand} onChange={(e) => setEditCommand(e.target.value)} placeholder="Comando (ej. npx)" />
              <input className="cmd-input" style={{ marginTop: 8 }} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Descripción corta (opcional)" />

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
                  <textarea className="cmd-input args" value={editArgs} onChange={(e) => setEditArgs(e.target.value)} placeholder={'@modelcontextprotocol/inspector'} rows={4} />
                </div>

                <div className="form-field" style={{ marginTop: 8 }}>
                  <label className="form-field-label">Variables de entorno (KEY=VALUE, una por línea)</label>
                  <textarea className="cmd-input args" value={editEnv} onChange={(e) => setEditEnv(e.target.value)} placeholder={'NODE_ENV=development'} rows={3} />
                </div>

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

        {/* Estado + interaction */}
        {editMode === 'none' && (
          <>
            <div className="endpoint-card">
              <div className="label">Estado</div>
              {clientConnected ? (
                <div className="value">
                  Cliente MCP real (SDK <span className="mono">@modelcontextprotocol/sdk</span>) conectado
                  {serverInfo?.name ? ` a "${serverInfo.name}" v${serverInfo.version}` : ''}.
                  Handshake initialize → initialized completado.
                </div>
              ) : (
                <div className="value">
                  {hasSelection
                    ? 'Inicia el server — el cliente se conecta y ejecuta el handshake automáticamente.'
                    : 'Selecciona un server y un client para comenzar.'}
                </div>
              )}
            </div>

            {caps && (
              <div className="endpoint-card">
                <div className="label">Server capabilities</div>
                <div className="value">{Object.keys(caps).join(' · ')}</div>
              </div>
            )}

            <div className="action-row" style={{ flexDirection: 'column', gap: 6 }}>
              <span className="label" style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-dim)' }}>
                Interacción cliente → server
              </span>
              <button className="btn primary" onClick={onPing} disabled={interactionDisabled} title="Enviar ping al server">📡 ping</button>
              <button className="btn" onClick={onListTools} disabled={interactionDisabled} title="Listar herramientas del server">📋 tools/list</button>
              <button className="btn" onClick={onCallEcho} disabled={interactionDisabled} title="Llamar herramienta echo">🔧 tools/call — echo</button>
              <button className="btn" onClick={onCallLongRunning} disabled={interactionDisabled} title="Operación larga con progreso">⏳ tools/call — longRunning</button>
            </div>

            <div className="endpoint-card" style={{ marginTop: 12 }}>
              <div className="label">Último resultado</div>
              {lastToolResult ? (
                <JsonHighlight data={lastToolResult} maxHeight={220} />
              ) : (
                <div className="value">—</div>
              )}
            </div>

            <div className="endpoint-card">
              <div className="label">Envío raw (JSON-RPC)</div>
              <textarea className="cmd-input args" rows={3} value={rawInput} onChange={(e) => setRawInput(e.target.value)} placeholder={'{"jsonrpc":"2.0","id":1,"method":"tools/list"}'} disabled={interactionDisabled} />
              <button className="btn" style={{ marginTop: 6 }} onClick={() => { onSendRaw(rawInput); }} disabled={interactionDisabled || !rawInput.trim()} title="Enviar mensaje JSON-RPC raw">⬆ Enviar raw</button>
            </div>

            <div className="action-row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={onExport} title="Exportar sesión a archivo">⤓ Exportar</button>
              <button className="btn" onClick={onImport} title="Importar sesión desde archivo">⤒ Importar</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}