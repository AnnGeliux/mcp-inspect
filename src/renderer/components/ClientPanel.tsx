import React, { useState } from 'react';
import { LogEntry, ClientConfig, SavedClient } from '../../shared/types';

interface Props {
  /** Lista de clientes guardados (presets + user). */
  clients: SavedClient[];
  /** ID del client seleccionado. */
  selectedClientId: string | null;
  /** Callback al seleccionar un client del dropdown. */
  onSelectClient: (id: string) => void;
  /** Callback al agregar un client nuevo. */
  onAddClient: (name: string, config: ClientConfig) => void;
  /** Callback al editar un client guardado. */
  onUpdateClient: (id: string, name: string, config: ClientConfig) => void;
  /** Callback al eliminar un client. */
  onDeleteClient: (id: string) => void;

  /** El cliente MCP real (SDK) está conectado tras el handshake. */
  clientConnected: boolean;
  serverInfo: { name?: string; version?: string; capabilities?: unknown } | null;
  /** Última herramienta llamada y su resultado (para display). */
  lastToolResult: LogEntry | null;
  /** Si hay server + client seleccionados (activa el panel central). */
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
  const [editType, setEditType] = useState<'sdk' | 'inspector'>('sdk');
  const [editCommand, setEditCommand] = useState('');
  const [editArgs, setEditArgs] = useState('');

  const selected = clients.find((c) => c.id === selectedClientId) ?? null;
  const caps = serverInfo?.capabilities as Record<string, unknown> | undefined;

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (id) onSelectClient(id);
  };

  const startAdd = () => {
    setEditName('');
    setEditType('sdk');
    setEditCommand('node');
    setEditArgs('');
    setEditMode('add');
  };

  const startEdit = () => {
    if (!selected) return;
    setEditName(selected.name);
    setEditType(selected.config.type);
    setEditCommand(selected.config.command);
    setEditArgs((selected.config.args ?? []).join('\n'));
    setEditMode('edit');
  };

  const cancelEdit = () => {
    setEditMode('none');
  };

  const saveEdit = () => {
    const args = editArgs.split('\n').filter((s) => s.length > 0);
    const newConfig: ClientConfig = {
      type: editType,
      name: editName,
      command: editCommand,
      args,
    };
    if (editMode === 'add') {
      onAddClient(editName, newConfig);
    } else if (editMode === 'edit' && selected) {
      onUpdateClient(selected.id, editName, newConfig);
    }
    setEditMode('none');
  };

  const handleDelete = () => {
    if (!selected) return;
    if (selected.preset) return;
    if (confirm(`¿Eliminar el client "${selected.name}"?`)) {
      onDeleteClient(selected.id);
    }
  };

  // Disable interaction if no server+client selected
  const interactionDisabled = !hasSelection || !clientConnected;

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
        {/* Dropdown selector */}
        <div className="endpoint-card">
          <div className="label">Client seleccionado</div>
          <select
            className="dropdown"
            value={selectedClientId ?? ''}
            onChange={handleSelectChange}
            disabled={editMode !== 'none'}
          >
            <option value="" disabled>— Selecciona un client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.preset ? ' (preset)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* CRUD buttons */}
        {editMode === 'none' && (
          <div className="crud-row">
            <button className="btn small" onClick={startAdd}>＋ Agregar</button>
            <button className="btn small" onClick={startEdit} disabled={!selected}>✎ Editar</button>
            <button
              className="btn small danger-text"
              onClick={handleDelete}
              disabled={!selected || !!selected?.preset}
              title={selected?.preset ? 'Los presets no se pueden eliminar' : ''}
            >
              🗑 Eliminar
            </button>
          </div>
        )}

        {/* Add / Edit form */}
        {editMode !== 'none' && (
          <div className="endpoint-card edit-form">
            <div className="label">{editMode === 'add' ? 'Nuevo client' : 'Editar client'}</div>
            <input
              className="cmd-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Nombre descriptivo"
            />
            <select
              className="dropdown"
              style={{ marginTop: 6 }}
              value={editType}
              onChange={(e) => setEditType(e.target.value as 'sdk' | 'inspector')}
            >
              <option value="sdk">SDK (@modelcontextprotocol/sdk)</option>
              <option value="inspector">Inspector oficial</option>
            </select>
            <input
              className="cmd-input"
              style={{ marginTop: 6 }}
              value={editCommand}
              onChange={(e) => setEditCommand(e.target.value)}
              placeholder="Comando (ej. npx)"
            />
            <textarea
              className="cmd-input args"
              style={{ marginTop: 6 }}
              value={editArgs}
              onChange={(e) => setEditArgs(e.target.value)}
              placeholder={'Args (uno por línea)'}
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

        {/* Estado + interaction (only when not editing) */}
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
              <button className="btn primary" onClick={onPing} disabled={interactionDisabled}>
                📡 ping
              </button>
              <button className="btn" onClick={onListTools} disabled={interactionDisabled}>
                📋 tools/list
              </button>
              <button className="btn" onClick={onCallEcho} disabled={interactionDisabled}>
                🔧 tools/call — echo
              </button>
              <button className="btn" onClick={onCallLongRunning} disabled={interactionDisabled}>
                ⏳ tools/call — longRunning (con progreso)
              </button>
            </div>

            <div className="endpoint-card" style={{ marginTop: 12 }}>
              <div className="label">Último resultado</div>
              {lastToolResult ? (
                <pre className="result-pre">{JSON.stringify(lastToolResult, null, 2)}</pre>
              ) : (
                <div className="value">—</div>
              )}
            </div>

            <div className="endpoint-card">
              <div className="label">Envío raw (JSON-RPC)</div>
              <textarea
                className="cmd-input args"
                rows={3}
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder={'{"jsonrpc":"2.0","id":1,"method":"tools/list"}'}
                disabled={interactionDisabled}
              />
              <button
                className="btn"
                style={{ marginTop: 6 }}
                onClick={() => { onSendRaw(rawInput); }}
                disabled={interactionDisabled || !rawInput.trim()}
              >
                ⬆ Enviar raw
              </button>
            </div>

            <div className="action-row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={onExport}>⤓ Exportar</button>
              <button className="btn" onClick={onImport}>⤒ Importar</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}