import React from 'react';
import { ServerConfig } from '../../shared/types';

interface Props {
  config: ServerConfig;
  onChange: (c: ServerConfig) => void;
  running: boolean;
  onStart: () => void;
  onStop: () => void;
  /** Preset del server MCP real (paths absolutos) — llega del main via App. */
  everythingPreset: ServerConfig | null;
}

export default function ServerPanel({ config, onChange, running, onStart, onStop, everythingPreset }: Props): React.ReactElement {
  const cmdStr = [config.command, ...(config.args ?? [])].join(' ');

  const update = (patch: Partial<ServerConfig>) => onChange({ ...config, ...patch });

  const presets: Array<{ label: string; cfg: ServerConfig }> = [];
  if (everythingPreset) {
    presets.push({
      label: `everything-server (MCP real)`,
      cfg: everythingPreset,
    });
  }
  presets.push(
    {
      label: 'echo (test)',
      cfg: { command: 'node', args: ['-e', "process.stdin.setEncoding('utf8');process.stdin.on('data',d=>{const m=JSON.parse(d.trim());if(m.id)console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ok:true}}));else if(m.method)console.log(JSON.stringify({jsonrpc:'2.0',method:'notifications/message',params:{level:'info',data:m.method}}));});"], connectClient: false },
    },
    {
      label: 'echo CRLF (test)',
      cfg: { command: 'node', args: ['-e', "process.stdin.setEncoding('utf8');let b='';process.stdin.on('data',d=>{b+=d;let n;while((n=b.indexOf('\\\\n'))>=0){const line=b.slice(0,n).replace(/\\\\r$/,'');b=b.slice(n+1);const m=JSON.parse(line);if(m.id)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{echo:m.method}})+'\\\\r\\\\n');}});"], connectClient: false },
    }
  );

  return (
    <section className="panel">
      <div className="panel-header">
        <span className="icon">📡</span>
        <span>MCP Server</span>
        <span className="role-tag">target</span>
      </div>
      <div className="panel-body">
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
        <div className="endpoint-card">
          <div className="label">Presets</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {presets.map((p) => (
              <button key={p.label} className="preset-btn" onClick={() => onChange(p.cfg)} disabled={running}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="action-row">
          {!running ? (
            <button className="btn primary" onClick={onStart}>▶ Start</button>
          ) : (
            <button className="btn danger" onClick={onStop}>■ Stop</button>
          )}
        </div>
      </div>
    </section>
  );
}
