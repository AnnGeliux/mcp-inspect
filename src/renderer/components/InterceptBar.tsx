import React, { useState } from 'react';
import { InterceptRule, HeldMessage, JsonRpcMessage } from '../../shared/types';

interface Props {
  rules: InterceptRule[];
  interceptAllC2s: boolean;
  interceptAllS2c: boolean;
  held: HeldMessage[];
  onAddRule: (dir: 'c2s' | 's2c', method: string) => void;
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

/**
 * InterceptBar — barra de interceptación MITM (Phase 6).
 *
 * - Toggles intercept-all por dirección (c2s = pausar peticiones, s2c = pausar respuestas).
 * - Reglas por método: añadir/quitar/toggle.
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
  const [showRules, setShowRules] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const active = interceptAllC2s || interceptAllS2c || rules.some((r) => r.enabled) || held.length > 0;

  const draftOf = (h: HeldMessage): string => {
    if (drafts[h.id] !== undefined) return drafts[h.id];
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
            <button className="btn small" onClick={() => onAddRule(newRuleDir, newRuleMethod)}>
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