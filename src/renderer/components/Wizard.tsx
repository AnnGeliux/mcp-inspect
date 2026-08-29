import React, { useState } from 'react';
import { SavedServer, SavedClient, ServerConfig, ClientConfig } from '../../shared/types';
import ServerCard from './ServerCard';
import ClientCard from './ClientCard';
import { truncateMiddle, envToText, textToEnv, buildCommandPreview } from '../utils/format';

interface Props {
  step: 1 | 2;
  servers: SavedServer[];
  clients: SavedClient[];
  selectedServerId: string | null;
  selectedClientId: string | null;
  running: boolean;
  clientConnected: boolean;
  onSelectServer: (id: string) => void;
  onSelectClient: (id: string) => void;
  onAddServer: (name: string, config: ServerConfig, description?: string) => void;
  onAddClient: (name: string, config: ClientConfig, description?: string) => void;
  onAdvance: () => void;
  onBack: () => void;
}

export default function Wizard(props: Props): React.ReactElement {
  const {
    step,
    servers,
    clients,
    selectedServerId,
    selectedClientId,
    running,
    clientConnected,
    onSelectServer,
    onSelectClient,
    onAddServer,
    onAddClient,
    onAdvance,
    onBack,
  } = props;

  const [showAddForm, setShowAddForm] = useState(false);

  return (
    <div className="wizard-overlay">
      <div className="wizard-container">
        <div className="wizard-progress">
          <div className="wizard-step-indicator">
            <div className={`wizard-dot ${step >= 1 ? 'active' : ''}`}>1</div>
            <div className={`wizard-line ${step >= 2 ? 'active' : ''}`} />
            <div className={`wizard-dot ${step >= 2 ? 'active' : ''}`}>2</div>
          </div>
          <span className="wizard-progress-text">
            {step === 1 ? 'Paso 1 de 2 — Elige un MCP Server' : 'Paso 2 de 2 — Elige un MCP Client'}
          </span>
        </div>

        <div className="wizard-content">
          {step === 1 && (
            <ServerStep
              servers={servers}
              selectedServerId={selectedServerId}
              running={running}
              onSelect={onSelectServer}
              onAdd={onAddServer}
              showAddForm={showAddForm}
              setShowAddForm={setShowAddForm}
            />
          )}
          {step === 2 && (
            <ClientStep
              clients={clients}
              selectedClientId={selectedClientId}
              clientConnected={clientConnected}
              onSelect={onSelectClient}
              onAdd={onAddClient}
              showAddForm={showAddForm}
              setShowAddForm={setShowAddForm}
            />
          )}
        </div>

        <div className="wizard-nav">
          {step === 2 && (
            <button className="btn" onClick={onBack}>← Atrás</button>
          )}
          {step === 1 && selectedServerId && (
            <button className="btn primary" onClick={onAdvance}>Siguiente →</button>
          )}
          {step === 2 && selectedClientId && (
            <button className="btn primary" onClick={onAdvance}>¡Listo! →</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ——— Server Step ———

interface ServerStepProps {
  servers: SavedServer[];
  selectedServerId: string | null;
  running: boolean;
  onSelect: (id: string) => void;
  onAdd: (name: string, config: ServerConfig, description?: string) => void;
  showAddForm: boolean;
  setShowAddForm: (v: boolean) => void;
}

function ServerStep(props: ServerStepProps): React.ReactElement {
  const { servers, selectedServerId, running, onSelect, onAdd, showAddForm, setShowAddForm } = props;
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const save = () => {
    const argList = args.split('\n').filter((s) => s.length > 0);
    onAdd(name, { command, args: argList }, desc.trim() || undefined);
    setShowAddForm(false);
    setName(''); setDesc(''); setCommand(''); setArgs(''); setShowAdvanced(false);
  };

  const basicPreview = [command, ...args.split('\n').filter((s) => s.length > 0)].filter(Boolean).join(' ');

  return (
    <div className="wizard-step">
      <h2 className="wizard-title">📡 Elige un MCP Server</h2>
      <p className="wizard-subtitle">Selecciona un server predefinido o agrega uno custom</p>
      <div className="card-grid">
        {servers.map((s) => (
          <ServerCard
            key={s.id}
            server={s}
            selected={s.id === selectedServerId}
            running={running && s.id === selectedServerId}
            onSelect={() => onSelect(s.id)}
            onEdit={() => {}}
            onDelete={() => {}}
          />
        ))}
        {!showAddForm && (
          <button className="card card-add" onClick={() => setShowAddForm(true)} title="Agregar server custom">
            <span className="card-icon">＋</span>
            <span className="card-name">Agregar custom</span>
          </button>
        )}
      </div>
      {showAddForm && (
        <div className="wizard-add-form">
          <input className="cmd-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre descriptivo" />
          <input className="cmd-input" style={{ marginTop: 8 }} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Comando (ej. npx)" />
          <input className="cmd-input" style={{ marginTop: 8 }} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descripción corta (opcional)" />
          <div className="cmd-preview" style={{ marginTop: 8 }}>
            <span className="cmd-preview-label">Preview</span>
            <code className="cmd-preview-code">{basicPreview || '—'}</code>
          </div>
          <button
            className={`advanced-toggle ${showAdvanced ? 'expanded' : ''}`}
            onClick={() => setShowAdvanced(!showAdvanced)}
            type="button"
            style={{ marginTop: 8 }}
          >
            <span className="advanced-toggle-icon">{showAdvanced ? '▾' : '▸'}</span>
            <span>⚙ Avanzado</span>
          </button>
          <div className={`form-section-advanced ${showAdvanced ? 'expanded' : 'collapsed'}`}>
            <div className="form-section-advanced-inner">
              <textarea className="cmd-input args" value={args} onChange={(e) => setArgs(e.target.value)} placeholder={'Args (uno por línea)'} rows={4} />
            </div>
          </div>
          <div className="crud-row" style={{ marginTop: 8 }}>
            <button className="btn primary small" onClick={save} disabled={!name.trim() || !command.trim()}>✓ Guardar</button>
            <button className="btn small" onClick={() => setShowAddForm(false)}>✕ Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ——— Client Step ———

interface ClientStepProps {
  clients: SavedClient[];
  selectedClientId: string | null;
  clientConnected: boolean;
  onSelect: (id: string) => void;
  onAdd: (name: string, config: ClientConfig, description?: string) => void;
  showAddForm: boolean;
  setShowAddForm: (v: boolean) => void;
}

function ClientStep(props: ClientStepProps): React.ReactElement {
  const { clients, selectedClientId, clientConnected, onSelect, onAdd, showAddForm, setShowAddForm } = props;
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [type, setType] = useState<'sdk' | 'inspector'>('sdk');
  const [command, setCommand] = useState('node');
  const [args, setArgs] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const save = () => {
    const argList = args.split('\n').filter((s) => s.length > 0);
    onAdd(name, { type, name, command, args: argList }, desc.trim() || undefined);
    setShowAddForm(false);
    setName(''); setDesc(''); setCommand('node'); setArgs(''); setShowAdvanced(false);
  };

  const basicPreview = [command, ...args.split('\n').filter((s) => s.length > 0)].filter(Boolean).join(' ');

  return (
    <div className="wizard-step">
      <h2 className="wizard-title">🧑‍💻 Elige un MCP Client</h2>
      <p className="wizard-subtitle">Selecciona un client predefinido o agrega uno custom</p>
      <div className="card-grid">
        {clients.map((c) => (
          <ClientCard
            key={c.id}
            client={c}
            selected={c.id === selectedClientId}
            connected={clientConnected && c.id === selectedClientId}
            onSelect={() => onSelect(c.id)}
            onEdit={() => {}}
            onDelete={() => {}}
          />
        ))}
        {!showAddForm && (
          <button className="card card-add" onClick={() => setShowAddForm(true)} title="Agregar client custom">
            <span className="card-icon">＋</span>
            <span className="card-name">Agregar custom</span>
          </button>
        )}
      </div>
      {showAddForm && (
        <div className="wizard-add-form">
          <input className="cmd-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre descriptivo" />
          <select className="dropdown" style={{ marginTop: 8 }} value={type} onChange={(e) => setType(e.target.value as 'sdk' | 'inspector')}>
            <option value="sdk">SDK (@modelcontextprotocol/sdk)</option>
            <option value="inspector">Inspector oficial</option>
          </select>
          <input className="cmd-input" style={{ marginTop: 8 }} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Comando (ej. npx)" />
          <input className="cmd-input" style={{ marginTop: 8 }} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descripción corta (opcional)" />
          <div className="cmd-preview" style={{ marginTop: 8 }}>
            <span className="cmd-preview-label">Preview</span>
            <code className="cmd-preview-code">{basicPreview || '—'}</code>
          </div>
          <button
            className={`advanced-toggle ${showAdvanced ? 'expanded' : ''}`}
            onClick={() => setShowAdvanced(!showAdvanced)}
            type="button"
            style={{ marginTop: 8 }}
          >
            <span className="advanced-toggle-icon">{showAdvanced ? '▾' : '▸'}</span>
            <span>⚙ Avanzado</span>
          </button>
          <div className={`form-section-advanced ${showAdvanced ? 'expanded' : 'collapsed'}`}>
            <div className="form-section-advanced-inner">
              <textarea className="cmd-input args" value={args} onChange={(e) => setArgs(e.target.value)} placeholder={'Args (uno por línea)'} rows={4} />
            </div>
          </div>
          <div className="crud-row" style={{ marginTop: 8 }}>
            <button className="btn primary small" onClick={save} disabled={!name.trim() || !command.trim()}>✓ Guardar</button>
            <button className="btn small" onClick={() => setShowAddForm(false)}>✕ Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}