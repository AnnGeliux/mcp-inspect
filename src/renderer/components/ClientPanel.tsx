import React, { useState } from 'react';
import { LogEntry } from '../../shared/types';

interface Props {
  /** El cliente MCP real (SDK) está conectado tras el handshake. */
  clientConnected: boolean;
  serverInfo: { name?: string; version?: string; capabilities?: unknown } | null;
  /** Última herramienta llamada y su resultado (para display). */
  lastToolResult: LogEntry | null;
  onPing: () => void;
  onListTools: () => void;
  onCallEcho: () => void;
  onCallLongRunning: () => void;
  onSendRaw: (msg: string) => void;
  onExport: () => void;
  onImport: () => void;
}

export default function ClientPanel(props: Props): React.ReactElement {
  const {
    clientConnected,
    serverInfo,
    lastToolResult,
    onPing,
    onListTools,
    onCallEcho,
    onCallLongRunning,
    onSendRaw,
    onExport,
    onImport,
  } = props;
  const [rawInput, setRawInput] = useState('');

  const caps = serverInfo?.capabilities as Record<string, unknown> | undefined;

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
        <div className="endpoint-card">
          <div className="label">Estado</div>
          {clientConnected ? (
            <div className="value">
              Cliente MCP real (SDK <span className="mono">@modelcontextprotocol/sdk</span>) conectado
              {serverInfo?.name ? ` a "${serverInfo.name}" v${serverInfo.version}` : ''}.
              Handshake initialize → initialized completado.
            </div>
          ) : (
            <div className="value">Inicia el server — el cliente se conecta y ejecuta el handshake automáticamente.</div>
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
          <button className="btn primary" onClick={onPing} disabled={!clientConnected}>
            📡 ping
          </button>
          <button className="btn" onClick={onListTools} disabled={!clientConnected}>
            📋 tools/list
          </button>
          <button className="btn" onClick={onCallEcho} disabled={!clientConnected}>
            🔧 tools/call — echo
          </button>
          <button className="btn" onClick={onCallLongRunning} disabled={!clientConnected}>
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
            disabled={!clientConnected}
          />
          <button className="btn" style={{ marginTop: 6 }} onClick={() => { onSendRaw(rawInput); }} disabled={!clientConnected || !rawInput.trim()}>
            ⬆ Enviar raw
          </button>
        </div>

        <div className="action-row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={onExport}>⤓ Exportar</button>
          <button className="btn" onClick={onImport}>⤒ Importar</button>
        </div>
      </div>
    </section>
  );
}