import React from 'react';

interface Props {
  onSendPing: () => void;
  onExport: () => void;
  onImport: () => void;
}

export default function ClientPanel({ onSendPing, onExport, onImport }: Props): React.ReactElement {
  return (
    <section className="panel">
      <div className="panel-header">
        <span className="icon">🧑‍💻</span>
        <span>MCP Client</span>
        <span className="role-tag">launcher</span>
      </div>
      <div className="panel-body">
        <div className="endpoint-card">
          <div className="label">Estado</div>
          <div className="value">El inspector actúa como cliente MCP que escribe mensajes al stdin del server.</div>
        </div>
        <div className="action-row" style={{ flexDirection: 'column', gap: 6 }}>
          <button className="btn primary" onClick={onSendPing}>📡 Enviar ping</button>
          <button className="btn" onClick={onExport}>⤓ Exportar sesión (JSON)</button>
          <button className="btn" onClick={onImport}>⤒ Importar sesión</button>
        </div>
        <div className="endpoint-card">
          <div className="label">Tip</div>
          <div className="value">
            Usa el preset "echo (test)" del panel izquierdo para verificar end-to-end que el proxy NDJSON funciona
            sin necesidad de un server MCP real instalado.
          </div>
        </div>
      </div>
    </section>
  );
}
