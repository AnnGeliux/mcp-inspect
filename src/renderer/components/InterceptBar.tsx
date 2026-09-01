import React, { useState } from 'react';
import { InterceptRule, HeldMessage, JsonRpcMessage, SimulationConfig } from '../../shared/types';

interface Props {
  rules: InterceptRule[];
  interceptAllC2s: boolean;
  interceptAllS2c: boolean;
  held: HeldMessage[];
  onAddRule: (dir: 'c2s' | 's2c', method: string, simulation?: SimulationConfig) => void;
  onRemoveRule: (id: string) => void;
  onToggleRule: (id: string, enabled: boolean) => void;
  onSetInterceptAll: (dir: 'c2s' | 's2c', on: boolean) => void;
  onClearAll: () => void;
  onResolve: (id: string, resolution: { action: 'send' } | { action: 'send-modified'; msg: JsonRpcMessage } | { action: 'drop' } | { action: 'respond'; msg: JsonRpcMessage }) => void;
}

/** Sugerencias de método para el dropdown de reglas. */
const METHOD_SUGGESTIONS = [
  '',
  'initialize',
  'ping',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/read',
  'prompts/list',
  'prompts/get',
  'logging/setLevel',
  'completion/complete',
  'sampling/createMessage',
  'roots/list',
  'elicitation/create',
];

/** Errores JSON-RPC estándar para fault injection. */
const FAULT_PRESETS = [
  { code: -32601, label: '-32601 Method not found' },
  { code: -32602, label: '-32602 Invalid params' },
  { code: -32603, label: '-32603 Internal error' },
  { code: -32600, label: '-32600 Invalid request' },
  { code: -32700, label: '-32700 Parse error' },
  { code: -32001, label: '-32001 Request timeout' },
];

type SimType = 'hold' | 'fault' | 'mock' | 'throttle';

/** Pill corta para el tipo de simulación de una regla. */
function simBadge(r: InterceptRule): React.ReactElement | null {
  const s = r.simulation;
  if (!s) return null;
  if (s.type === 'fault') return <span className="pill danger" title={`Fault injection: error ${'faultCode' in s ? s.faultCode ?? -32603 : -32603}`}>⚡ fault</span>;
  if (s.type === 'mock') return <span className="pill purple" title="Auto-mock: respuesta predeterminada, no golpea el destino">🧪 mock</span>;
  if (s.type === 'throttle') return <span className="pill warning" title={`Throttling: +${'throttleMs' in s ? s.throttleMs : 0} ms`}>🕒 {('throttleMs' in s ? s.throttleMs : 0)}ms</span>;
  return null;
}

/**
 * InterceptBar — barra de interceptación MITM (Phase 6+7).
 *
 * - Toggles intercept-all por dirección (c2s = pausar peticiones, s2c = pausar respuestas).
 * - Reglas por método con simulación opcional (Phase 7):
 *     hold (breakpoint clásico) · fault (error JSON-RPC) · mock (respuesta
 *     predeterminada) · throttle (retraso artificial).
 * - Holds activos: editor inline JSON + Enviar / Enviar editado / Drop / Responder.
 */
export default function InterceptBar(props: Props): React.ReactElement {
  const {
    rules,
    interceptAllC2s,
    interceptAllS2c,
    held,
    onAddRule,
    onRemoveRule,
    onToggleRule,
    onSetInterceptAll,
    onClearAll,
    onResolve,
  } = props;

  const [newRuleDir, setNewRuleDir] = useState<'c2s' | 's2c'>('c2s');
  const [newRuleMethod, setNewRuleMethod] = useState('');
  const [newRuleSim, setNewRuleSim] = useState<SimType>('hold');
  const [faultCode, setFaultCode] = useState(-32601);
  const [faultMessage, setFaultMessage] = useState('');
  const [throttleMs, setThrottleMs] = useState(2000);
  const [mockResult, setMockResult] = useState('{}');
  const [showRules, setShowRules] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const active = interceptAllC2s || interceptAllS2c || rules.some((r) => r.enabled) || held.length > 0;

  const mockResultValid = (() => {
    try {
      JSON.parse(mockResult);
      return true;
    } catch {
      return false;
    }
  })();

  const addRule = (): void => {
    let simulation: SimulationConfig | undefined;
    if (newRuleSim === 'fault') simulation = { type: 'fault', faultCode, ...(faultMessage ? { faultMessage } : {}) };
    else if (newRuleSim === 'mock' && mockResultValid) simulation = { type: 'mock', mockResult: JSON.parse(mockResult) };
    else if (newRuleSim === 'throttle') simulation = { type: 'throttle', throttleMs: Math.max(0, throttleMs) };
    onAddRule(newRuleDir, newRuleMethod, simulation);
  };

  const draftOf = (h: HeldMessage): string => {
    if (drafts[h.id] !== undefined) return drafts[h.id]!;
    return JSON.stringify(h.msg, null, 2);
  };

  const setDraft = (id: string, text: string) => setDrafts((prev) => ({ ...prev, [id]: text }));

  const parseDraft = (id: string): JsonRpcMessage | null => {
    try {
      return JSON.parse(drafts[id] ?? 'null') as JsonRpcMessage;
    } catch {
      return null;
    }
  };

  const sendOriginal = (id: string) => onResolve(id, { action: 'send' });
  const sendModified = (id: string) => {
    const msg = parseDraft(id);
    if (msg) onResolve(id, { action: 'send-modified', msg });
  };
  const dropHold = (id: string) => onResolve(id, { action: 'drop' });
  const respondHold = (id: string) => {
    const msg = parseDraft(id);
    if (msg) onResolve(id, { action: 'respond', msg });
  };

  return (
    <section className={`intercept-bar ${active ? 'active' : ''}`}>
      <div className="intercept-header">
        <span className="icon">⏸</span>
        <span className="intercept-title">Interceptación</span>
        <label className="intercept-toggle" title="Retener TODAS las peticiones cliente→server (breakpoint de petición)">
          <input type="checkbox" checked={interceptAllC2s} onChange={(e) => onSetInterceptAll('c2s', e.target.checked)} />
          <span>Todas las peticiones (→)</span>
        </label>
        <label className="intercept-toggle" title="Retener TODAS las respuestas server→cliente (breakpoint de respuesta)">
          <input type="checkbox" checked={interceptAllS2c} onChange={(e) => onSetInterceptAll('s2c', e.target.checked)} />
          <span>Todas las respuestas (←)</span>
        </label>
        {held.length > 0 && (
          <span className="intercept-held-count pill warning" title="Mensajes retenidos esperando decisión">
            ⏸ {held.length} retenido{held.length > 1 ? 's' : ''}
          </span>
        )}
        <button className="btn-link" onClick={() => setShowRules(!showRules)}>
          {showRules ? `▾ Reglas (${rules.length})` : `▸ Reglas (${rules.length})`}
        </button>
        <button className="btn-link danger-text" onClick={onClearAll} title="Quitar reglas y liberar holds (enviando originales)">
          ✕ Limpiar
        </button>
      </div>

      {showRules && (
        <div className="intercept-rules">
          <div className="intercept-rule-new">
            <select className="cmd-input" value={newRuleDir} onChange={(e) => setNewRuleDir(e.target.value as 'c2s' | 's2c')} title="Dirección de la regla">
              <option value="c2s">→ peticiones (c2s)</option>
              <option value="s2c">← respuestas (s2c)</option>
            </select>
            <select className="cmd-input" value={newRuleMethod} onChange={(e) => setNewRuleMethod(e.target.value)} title="Método al que aplica la regla (vacío = todos)">
              {METHOD_SUGGESTIONS.map((m) => (
                <option key={m || 'all'} value={m}>
                  {m === '' ? 'todos los métodos' : m}
                </option>
              ))}
            </select>
            <select className="cmd-input sim-type" value={newRuleSim} onChange={(e) => setNewRuleSim(e.target.value as SimType)} title="Acción al coincidir la regla">
              <option value="hold">⏸ breakpoint</option>
              <option value="fault">⚡ fault (error)</option>
              <option value="mock">🧪 mock (respuesta fija)</option>
              <option value="throttle">🕒 throttle (retraso)</option>
            </select>
            {newRuleSim === 'fault' && (
              <>
                <select className="cmd-input sim-code" value={faultCode} onChange={(e) => setFaultCode(Number(e.target.value))} title="Código de error JSON-RPC">
                  {FAULT_PRESETS.map((f) => (
                    <option key={f.code} value={f.code}>{f.label}</option>
                  ))}
                </select>
                <input
                  className="cmd-input sim-msg"
                  value={faultMessage}
                  onChange={(e) => setFaultMessage(e.target.value)}
                  placeholder="mensaje (opcional)"
                  title="Mensaje del error inyectado"
                />
              </>
            )}
            {newRuleSim === 'mock' && (
              <input
                className={`cmd-input sim-mock ${mockResultValid ? '' : 'invalid'}`}
                value={mockResult}
                onChange={(e) => setMockResult(e.target.value)}
                placeholder='JSON del "result" a entregar'
                title='Contenido JSON que se entregará como result al cliente'
              />
            )}
            {newRuleSim === 'throttle' && (
              <input
                className="cmd-input sim-ms"
                type="number"
                min={0}
                value={throttleMs}
                onChange={(e) => setThrottleMs(Number(e.target.value))}
                title="Retraso artificial en ms"
              />
            )}
            <button
              className="btn small"
              onClick={addRule}
              disabled={newRuleSim === 'mock' && !mockResultValid}
              title="Añadir la regla"
            >
              + Añadir
            </button>
          </div>
          {rules.length === 0 ? (
            <div className="intercept-rules-empty">Sin reglas — los mensajes fluyen sin pausa.</div>
          ) : (
            <div className="intercept-rules-list">
              {rules.map((r) => (
                <div key={r.id} className="intercept-rule-row">
                  <label className="intercept-toggle">
                    <input type="checkbox" checked={r.enabled} onChange={(e) => onToggleRule(r.id, e.target.checked)} />
                  </label>
                  <span className={`dir ${r.dir === 'c2s' ? 'c2s' : 's2c'}`}>{r.dir === 'c2s' ? '→' : '←'}</span>
                  <span className="method mono">{r.method === '' ? '(todos)' : r.method}</span>
                  {simBadge(r)}
                  <button className="card-action-btn" onClick={() => onRemoveRule(r.id)} title="Eliminar regla">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {held.map((h) => {
        const draft = draftOf(h);
        const valid = parseDraft(h.id) !== null;
        return (
          <div key={h.id} className="intercept-hold">
            <div className="intercept-hold-header">
              <span className={`dir ${h.dir === 'c2s' ? 'c2s' : 's2c'}`}>
                {h.dir === 'c2s' ? '→ petición retenida' : '← respuesta retenida'}
              </span>
              <span className="method mono">{'method' in h.msg && h.msg.method ? h.msg.method : '(respuesta)'}</span>
              {h.ruleId === '__all__' && <span className="pill gray">intercept-all</span>}
            </div>
            <textarea
              className="intercept-hold-editor"
              value={draft}
              onChange={(e) => setDraft(h.id, e.target.value)}
              spellCheck={false}
              rows={Math.min(14, draft.split('\n').length)}
              title="Edita el JSON y usa Enviar editado / Responder"
            />
            {!valid && <div className="intercept-hold-invalid danger-text">JSON inválido — corrige para habilitar las acciones de edición</div>}
            <div className="intercept-hold-actions">
              <button className="btn small" onClick={() => sendOriginal(h.id)} title="Entregar el mensaje original sin cambios">
                ▶ Enviar
              </button>
              <button className="btn small primary" onClick={() => sendModified(h.id)} disabled={!valid} title="Entregar la versión editada">
                ✎ Enviar editado
              </button>
              <button className="btn small danger" onClick={() => dropHold(h.id)} title="Descartar — nunca llega a su destino">
                ✕ Drop
              </button>
              {h.dir === 's2c' && (
                <button className="btn small" onClick={() => respondHold(h.id)} disabled={!valid} title="Descartar el original y entregar esta respuesta sintética al cliente">
                  ⟲ Responder
                </button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

