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

/** Method suggestions for the rules dropdown. */
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

/** Standard JSON-RPC errors for fault injection. */
const FAULT_PRESETS = [
  { code: -32601, label: '-32601 Method not found' },
  { code: -32602, label: '-32602 Invalid params' },
  { code: -32603, label: '-32603 Internal error' },
  { code: -32600, label: '-32600 Invalid request' },
  { code: -32700, label: '-32700 Parse error' },
  { code: -32001, label: '-32001 Request timeout' },
];

type SimType = 'hold' | 'fault' | 'mock' | 'throttle';

/** Short pill for a rule's simulation type. */
function simBadge(r: InterceptRule): React.ReactElement | null {
  const s = r.simulation;
  if (!s) return null;
  if (s.type === 'fault') return <span className="pill danger" title={`Fault injection: error ${'faultCode' in s ? s.faultCode ?? -32603 : -32603}`}>⚡ fault</span>;
  if (s.type === 'mock') return <span className="pill purple" title="Auto-mock: canned response, does not hit the destination">🧪 mock</span>;
  if (s.type === 'throttle') return <span className="pill warning" title={`Throttling: +${'throttleMs' in s ? s.throttleMs : 0} ms`}>🕒 {('throttleMs' in s ? s.throttleMs : 0)}ms</span>;
  return null;
}

/**
 * InterceptBar — MITM interception bar (Phase 6+7).
 *
 * - Intercept-all toggles per direction (c2s = hold requests, s2c = hold responses).
 * - Per-method rules with optional simulation (Phase 7):
 *     hold (classic breakpoint) · fault (JSON-RPC error) · mock (canned
 *     response) · throttle (artificial delay).
 * - Active holds: inline JSON editor + Send / Send edited / Drop / Respond.
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
        <span className="intercept-title">Interception</span>
        <label className="intercept-toggle" title="Hold ALL client→server requests (request breakpoint)">
          <input type="checkbox" checked={interceptAllC2s} onChange={(e) => onSetInterceptAll('c2s', e.target.checked)} />
          <span>All requests (→)</span>
        </label>
        <label className="intercept-toggle" title="Hold ALL server→client responses (response breakpoint)">
          <input type="checkbox" checked={interceptAllS2c} onChange={(e) => onSetInterceptAll('s2c', e.target.checked)} />
          <span>All responses (←)</span>
        </label>
        {held.length > 0 && (
          <span className="intercept-held-count pill warning" title="Held messages awaiting a decision">
            ⏸ {held.length} held
          </span>
        )}
        <button className="btn-link" onClick={() => setShowRules(!showRules)}>
          {showRules ? `▾ Rules (${rules.length})` : `▸ Rules (${rules.length})`}
        </button>
        <button className="btn-link danger-text" onClick={onClearAll} title="Remove rules and release holds (sending originals)">
          ✕ Clear
        </button>
      </div>

      {showRules && (
        <div className="intercept-rules">
          <div className="intercept-rule-new">
            <select className="cmd-input" value={newRuleDir} onChange={(e) => setNewRuleDir(e.target.value as 'c2s' | 's2c')} title="Rule direction">
              <option value="c2s">→ requests (c2s)</option>
              <option value="s2c">← responses (s2c)</option>
            </select>
            <select className="cmd-input" value={newRuleMethod} onChange={(e) => setNewRuleMethod(e.target.value)} title="Method the rule applies to (empty = all)">
              {METHOD_SUGGESTIONS.map((m) => (
                <option key={m || 'all'} value={m}>
                  {m === '' ? 'all methods' : m}
                </option>
              ))}
            </select>
            <select className="cmd-input sim-type" value={newRuleSim} onChange={(e) => setNewRuleSim(e.target.value as SimType)} title="Action to take when the rule matches">
              <option value="hold">⏸ breakpoint</option>
              <option value="fault">⚡ fault (error)</option>
              <option value="mock">🧪 mock (fixed response)</option>
              <option value="throttle">🕒 throttle (delay)</option>
            </select>
            {newRuleSim === 'fault' && (
              <>
                <select className="cmd-input sim-code" value={faultCode} onChange={(e) => setFaultCode(Number(e.target.value))} title="JSON-RPC error code">
                  {FAULT_PRESETS.map((f) => (
                    <option key={f.code} value={f.code}>{f.label}</option>
                  ))}
                </select>
                <input
                  className="cmd-input sim-msg"
                  value={faultMessage}
                  onChange={(e) => setFaultMessage(e.target.value)}
                  placeholder="message (optional)"
                  title="Message of the injected error"
                />
              </>
            )}
            {newRuleSim === 'mock' && (
              <input
                className={`cmd-input sim-mock ${mockResultValid ? '' : 'invalid'}`}
                value={mockResult}
                onChange={(e) => setMockResult(e.target.value)}
                placeholder='JSON of the "result" to deliver'
                title='JSON content that will be delivered to the client as the result'
              />
            )}
            {newRuleSim === 'throttle' && (
              <input
                className="cmd-input sim-ms"
                type="number"
                min={0}
                value={throttleMs}
                onChange={(e) => setThrottleMs(Number(e.target.value))}
                title="Artificial delay in ms"
              />
            )}
            <button
              className="btn small"
              onClick={addRule}
              disabled={newRuleSim === 'mock' && !mockResultValid}
              title="Add the rule"
            >
              + Add
            </button>
          </div>
          {rules.length === 0 ? (
            <div className="intercept-rules-empty">No rules — messages flow without pausing.</div>
          ) : (
            <div className="intercept-rules-list">
              {rules.map((r) => (
                <div key={r.id} className="intercept-rule-row">
                  <label className="intercept-toggle">
                    <input type="checkbox" checked={r.enabled} onChange={(e) => onToggleRule(r.id, e.target.checked)} />
                  </label>
                  <span className={`dir ${r.dir === 'c2s' ? 'c2s' : 's2c'}`}>{r.dir === 'c2s' ? '→' : '←'}</span>
                  <span className="method mono">{r.method === '' ? '(all)' : r.method}</span>
                  {simBadge(r)}
                  <button className="card-action-btn" onClick={() => onRemoveRule(r.id)} title="Delete rule">
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
                {h.dir === 'c2s' ? '→ held request' : '← held response'}
              </span>
              <span className="method mono">{'method' in h.msg && h.msg.method ? h.msg.method : '(response)'}</span>
              {h.ruleId === '__all__' && <span className="pill gray">intercept-all</span>}
            </div>
            <textarea
              className="intercept-hold-editor"
              value={draft}
              onChange={(e) => setDraft(h.id, e.target.value)}
              spellCheck={false}
              rows={Math.min(14, draft.split('\n').length)}
              title="Edit the JSON and use Send edited / Respond"
            />
            {!valid && <div className="intercept-hold-invalid danger-text">Invalid JSON — fix it to enable the editing actions</div>}
            <div className="intercept-hold-actions">
              <button className="btn small" onClick={() => sendOriginal(h.id)} title="Deliver the original message unchanged">
                ▶ Send
              </button>
              <button className="btn small primary" onClick={() => sendModified(h.id)} disabled={!valid} title="Deliver the edited version">
                ✎ Send edited
              </button>
              <button className="btn small danger" onClick={() => dropHold(h.id)} title="Drop — never reaches its destination">
                ✕ Drop
              </button>
              {h.dir === 's2c' && (
                <button className="btn small" onClick={() => respondHold(h.id)} disabled={!valid} title="Discard the original and deliver this synthetic response to the client">
                  ⟲ Respond
                </button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

