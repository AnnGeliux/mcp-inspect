/**
 * MITM Pipeline — the heart of interception (Phase 6).
 *
 * Every message crossing the proxy goes through here BEFORE delivery:
 *   c2s: writeClientMessage() → pipeline.process('c2s', msg) → server stdin
 *   s2c: server stdout → pipeline.process('s2c', msg) → SDK client
 *
 * With no active rules, the message flows through unchanged (the usual
 * read-only behavior — the promise resolves immediately).
 *
 * If a rule matches, the message is HELD: the process() promise doesn't
 * resolve until the user decides from the UI:
 *   send          → deliver the original unchanged
 *   send-modified → deliver the edited version (params/result/error altered)
 *   drop          → discard it (never reaches its destination)
 *   respond       → s2c only: discard the original and deliver a synthetic
 *                   response to the client (test how the LLM reacts without
 *                   touching the server). In c2s it equals drop.
 *
 * SERIALIZATION: the pending promise naturally serializes each direction
 * — messages arriving behind a hold wait in the promise chain (they are
 * never reordered). c2s and s2c flow independently.
 *
 * CORRELATION: JSON-RPC responses do NOT carry `method` (pitfall #1 from
 * the mcp-protocol-tooling skill) — they are correlated with their request
 * ONLY by `id`. The pipeline observes every request and keeps id→{method, ts}
 * maps per direction, which feed (a) method-based rules on s2c and (b) the
 * request→response latency calculation in the proxy.
 */

import { EventEmitter } from 'events';
import { InterceptRule, HeldMessage, JsonRpcMessage, JsonRpcResponse, JsonRpcError, HoldResolution, SimulationConfig } from '../shared/types';

export interface PipelineEvents {
  /** A message was held by a breakpoint. */
  held: (held: HeldMessage) => void;
  /** A hold was resolved (or released). */
  released: (id: string) => void;
  /** Rules changed (add/remove/toggle/intercept-all/clear). */
  rulesChanged: () => void;
  /** The global pause changed (freeze traffic without killing the subprocess). */
  pausedChanged: (paused: boolean) => void;
  /** The pause queue changed (messages enqueued or released). */
  queueChanged: () => void;
}

export declare interface MITMPipeline {
  on<E extends keyof PipelineEvents>(event: E, listener: PipelineEvents[E]): this;
  emit<E extends keyof PipelineEvents>(event: E, ...args: Parameters<PipelineEvents[E]>): boolean;
}

/** Pipeline result after resolving: what to deliver and whether it was altered. */
export interface ProcessResult {
  /** Final message to deliver to the destination (null = discarded). */
  msg: JsonRpcMessage | null;
  /** true if it was held by a breakpoint. */
  held: boolean;
  /** true if the delivered message differs from the original (edited or responded). */
  modified: boolean;
  /** ms it was held. */
  heldMs: number;
  /**
   * Synthetic response for the CLIENT (c2s fault/mock simulations only):
   * the original message is discarded from the flow towards the server and
   * this response is delivered to the client in its place. The proxy emits
   * it as deliveredS2c + entry.
   */
  syntheticResponse?: JsonRpcMessage;
  /** Applied simulation (for the entry badge in the log). */
  simulated?: 'fault' | 'mock' | 'throttle';
}

/** Info about an observed request, to correlate its response. */
interface RequestInfo {
  method: string;
  ts: number;
}

/** Message in the pause queue, waiting for resume (FIFO). */
interface PausedItem {
  msg: JsonRpcMessage;
  arrivedAt: number;
  resolve: (r: ProcessResult) => void;
}

type Dir = 'c2s' | 's2c';

/** Limit of correlated requests per direction (prevents unbounded growth). */
const MAX_TRACKED_REQUESTS = 1000;

export class MITMPipeline extends EventEmitter {
  private rules = new Map<string, InterceptRule>();
  /** Active holds, per direction. */
  private heldByDir: Record<Dir, HeldMessage[]> = { c2s: [], s2c: [] };
  /** Pending resolvers per hold id — resolving the promise = delivering. */
  private resolvers = new Map<string, (r: ProcessResult) => void>();
  /** Observed requests per direction: id → {method, ts} (correlation). */
  private requests: Record<Dir, Map<string | number, RequestInfo>> = { c2s: new Map(), s2c: new Map() };
  private seq = 0;
  /** Intercept-all per direction: if true, EVERYTHING is held. */
  private interceptAll: Record<Dir, boolean> = { c2s: false, s2c: false };
  /** Global pause: freezes ALL traffic (without killing the subprocess). */
  private _paused = false;
  /** Pause queue per direction — released FIFO on resume. */
  private pausedQueue: Record<Dir, PausedItem[]> = { c2s: [], s2c: [] };

  // ——— Rules —————————————————————————————————————————————————————

  addRule(dir: Dir, method: string, simulation?: SimulationConfig): InterceptRule {
    const id = `rule-${++this.seq}`;
    const rule: InterceptRule = { id, dir, method, enabled: true, ...(simulation ? { simulation } : {}) };
    this.rules.set(id, rule);
    this.emit('rulesChanged');
    return rule;
  }

  /** Assigns/changes the simulation of an existing rule. */
  setRuleSimulation(id: string, simulation: SimulationConfig | null): void {
    const r = this.rules.get(id);
    if (r) {
      if (simulation === null) delete r.simulation;
      else r.simulation = simulation;
      this.emit('rulesChanged');
    }
  }

  removeRule(id: string): void {
    this.rules.delete(id);
    this.emit('rulesChanged');
  }

  toggleRule(id: string, enabled: boolean): void {
    const r = this.rules.get(id);
    if (r) {
      r.enabled = enabled;
      this.emit('rulesChanged');
    }
  }

  setInterceptAll(dir: Dir, on: boolean): void {
    this.interceptAll[dir] = on;
    this.emit('rulesChanged');
  }

  getInterceptAll(dir: Dir): boolean {
    return this.interceptAll[dir];
  }

  listRules(): InterceptRule[] {
    return Array.from(this.rules.values());
  }

  /** Active holds (copy), in arrival order. */
  listHeld(): HeldMessage[] {
    return [...this.heldByDir.c2s, ...this.heldByDir.s2c];
  }

  /** true if there is at least one held message awaiting a decision. */
  get hasHeld(): boolean {
    return this.heldByDir.c2s.length > 0 || this.heldByDir.s2c.length > 0;
  }

  /** Removes all rules, releases holds and the pause queue, and lifts the pause. */
  async flushAll(): Promise<void> {
    for (const h of this.listHeld()) {
      this.resolveHold(h.id, { action: 'send' });
    }
    // The pause queue is released too (deliver originals, without re-processing).
    const queued = [...this.pausedQueue.c2s.splice(0), ...this.pausedQueue.s2c.splice(0)];
    for (const item of queued) {
      item.resolve({ msg: item.msg, held: false, modified: false, heldMs: 0 });
    }
    if (queued.length > 0) this.emit('queueChanged');
    const wasPaused = this._paused;
    this._paused = false;
    if (wasPaused) this.emit('pausedChanged', false);
    this.rules.clear();
    this.interceptAll.c2s = false;
    this.interceptAll.s2c = false;
    this.emit('rulesChanged');
  }

  /** Clears the correlation maps (when starting a new session). */
  clearCorrelation(): void {
    this.requests.c2s.clear();
    this.requests.s2c.clear();
  }

  // ——— Global pause (freeze traffic without killing the subprocess) ———

  /** Is it paused? New messages are enqueued instead of flowing. */
  get paused(): boolean {
    return this._paused;
  }

  /** Messages enqueued by the pause, per direction. */
  queueLengths(): { c2s: number; s2c: number } {
    return { c2s: this.pausedQueue.c2s.length, s2c: this.pausedQueue.s2c.length };
  }

  /** Freezes ALL traffic: every new message is enqueued (FIFO per direction). */
  pause(): void {
    if (this._paused) return;
    this._paused = true;
    this.emit('pausedChanged', true);
  }

  /**
   * Resumes traffic: drains the FIFO queue per direction. Every enqueued
   * message RE-ENTERS the pipeline (with its original arrivedAt) — if it
   * matches a rule/breakpoint it is held for inspection; otherwise it
   * flows through unchanged. c2s drains first so requests are correlated
   * before their responses.
   */
  resume(): void {
    if (!this._paused) return;
    this._paused = false;
    const qC2s = this.pausedQueue.c2s.splice(0);
    const qS2c = this.pausedQueue.s2c.splice(0);
    for (const item of qC2s) {
      void this.processNow('c2s', item.msg, item.arrivedAt).then(item.resolve);
    }
    for (const item of qS2c) {
      void this.processNow('s2c', item.msg, item.arrivedAt).then(item.resolve);
    }
    this.emit('pausedChanged', false);
    if (qC2s.length + qS2c.length > 0) this.emit('queueChanged');
  }

  /**
   * Resets the pause state for a new session: the old queue is discarded
   * (resolve with drop — the previous server no longer exists) and the
   * flag is left at false.
   */
  resetPause(): void {
    const queued = [...this.pausedQueue.c2s.splice(0), ...this.pausedQueue.s2c.splice(0)];
    const wasPaused = this._paused;
    this._paused = false;
    for (const item of queued) {
      item.resolve({ msg: null, held: false, modified: false, heldMs: 0 });
    }
    if (queued.length > 0) this.emit('queueChanged');
    if (wasPaused) this.emit('pausedChanged', false);
  }

  // ——— Correlation id→{method, ts} ——————————————————————————

  /** Records an observed request (for method-based rules and latency). */
  private observeRequest(dir: Dir, msg: JsonRpcMessage, arrivedAt: number): void {
    if ('method' in msg && 'id' in msg && msg.id != null) {
      const map = this.requests[dir];
      if (map.size >= MAX_TRACKED_REQUESTS) {
        // FIFO: evict the oldest one (first inserted key)
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      map.set(msg.id, { method: msg.method, ts: arrivedAt });
    }
  }

  /** Effective method of a message: its own (requests/notifications) or correlated (responses). */
  methodOf(dir: Dir, msg: JsonRpcMessage): string {
    if ('method' in msg) return msg.method;
    if ('id' in msg && msg.id != null) {
      const origin: Dir = dir === 'c2s' ? 's2c' : 'c2s';
      return this.requests[origin].get(msg.id)?.method ?? '';
    }
    return '';
  }

  /**
   * Correlates a response with its request (if it exists).
   * Returns {requestMethod, latencyMs} or null. Consumes the map entry.
   */
  correlateResponse(dir: Dir, msg: JsonRpcMessage, now = Date.now()): { requestMethod: string; latencyMs: number } | null {
    if ('method' in msg) return null; // request/notification — no correlation
    if (!('id' in msg) || msg.id == null) return null;
    const origin: Dir = dir === 'c2s' ? 's2c' : 'c2s';
    const info = this.requests[origin].get(msg.id);
    if (!info) return null;
    this.requests[origin].delete(msg.id);
    return { requestMethod: info.method, latencyMs: Math.max(0, now - info.ts) };
  }

  // ——— Processing ————————————————————————————————————————————

  /**
   * Processes a message crossing the proxy. Returns a promise that resolves
   * with the final decision:
   *  - No rules: immediate, message unchanged.
   *  - With a matching rule: the promise waits until the user resolves
   *    the hold from the UI (resolveHold).
   *
   * @param arrivedAt epoch ms of arrival at the proxy (for precise latency/heldAt).
   * The write to the destination is done by the CALLER (proxy.ts) when the promise resolves.
   */
  process(dir: Dir, msg: JsonRpcMessage, arrivedAt = Date.now()): Promise<ProcessResult> {
    // Global pause: enqueue instead of processing (the subprocess stays alive).
    if (this._paused) {
      return new Promise<ProcessResult>((resolve) => {
        this.pausedQueue[dir].push({ msg, arrivedAt, resolve });
        this.emit('queueChanged');
      });
    }
    return this.processNow(dir, msg, arrivedAt);
  }

  /** Actual processing (no pause): observe + rule match + hold/simulation. */
  private processNow(dir: Dir, msg: JsonRpcMessage, arrivedAt: number): Promise<ProcessResult> {
    this.observeRequest(dir, msg, arrivedAt);

    const ruleId = this.matchRule(dir, msg);
    if (ruleId === null) {
      return Promise.resolve({ msg, held: false, modified: false, heldMs: 0 });
    }

    const rule = ruleId === '__all__' ? null : this.rules.get(ruleId) ?? null;
    const sim = rule?.simulation;

    // Phase 7 — automatic simulations (fault/mock/throttle), no hold.
    if (sim) {
      if (sim.type === 'throttle') {
        return this.applyThrottle(dir, msg, sim.throttleMs, arrivedAt, ruleId);
      }
      if (sim.type === 'fault') {
        return Promise.resolve(this.applyFault(dir, msg, sim, ruleId));
      }
      if (sim.type === 'mock') {
        return Promise.resolve(this.applyMock(dir, msg, sim, ruleId));
      }
      // sim.type === 'hold' → falls through to the classic hold below.
    }

    const id = `held-${++this.seq}-${arrivedAt}`;
    const held: HeldMessage = {
      id,
      dir,
      msg,
      ruleId,
      heldAt: new Date(arrivedAt).toISOString(),
    };
    this.heldByDir[dir].push(held);

    const p = new Promise<ProcessResult>((resolve) => {
      this.resolvers.set(id, resolve);
    });

    this.emit('held', held);
    return p;
  }

  /** Throttle: delivers the original after `ms` of artificial delay. */
  private applyThrottle(
    dir: Dir,
    msg: JsonRpcMessage,
    ms: number,
    arrivedAt: number,
    ruleId: string,
  ): Promise<ProcessResult> {
    const delay = Math.max(0, ms);
    return new Promise<ProcessResult>((resolve) => {
      setTimeout(() => {
        resolve({
          msg,
          held: false,
          modified: false,
          heldMs: Math.max(0, Date.now() - arrivedAt),
          simulated: 'throttle',
        });
        void ruleId; // matchRule already decided — informational only here.
      }, delay);
    });
  }

  /**
   * Fault injection: the message is discarded and a JSON-RPC error
   * response is generated for the CLIENT with the original request's id.
   * - c2s (client request): the server never sees it; the client gets the error.
   * - s2c (real server response): replaced with the error.
   * - Notifications (no id): nobody to answer → pure drop.
   */
  private applyFault(
    dir: Dir,
    msg: JsonRpcMessage,
    sim: { type: 'fault'; faultCode?: number; faultMessage?: string },
    _ruleId: string,
  ): ProcessResult {
    const response = this.buildSyntheticResponse(dir, msg, {
      error: { code: sim.faultCode ?? -32603, message: sim.faultMessage ?? 'Injected fault (mcp-inspect)' },
    });
    if (response === null) {
      // Notification or message without id: nothing to answer — pure drop.
      return { msg: null, held: false, modified: false, heldMs: 0, simulated: 'fault' };
    }
    if (dir === 'c2s') {
      // The request never reaches the server; the synthetic response goes to the client.
      return { msg: null, held: false, modified: true, heldMs: 0, syntheticResponse: response, simulated: 'fault' };
    }
    // s2c: the real response is replaced with the error towards the client.
    return { msg: response, held: false, modified: true, heldMs: 0, simulated: 'fault' };
  }

  /**
   * Auto-mock: the message is discarded and mockResult/mockError is
   * delivered to the client without hitting the real destination.
   * Same as fault but with a user-defined payload.
   */
  private applyMock(
    dir: Dir,
    msg: JsonRpcMessage,
    sim: { type: 'mock'; mockResult?: unknown; mockError?: JsonRpcError },
    _ruleId: string,
  ): ProcessResult {
    const response = this.buildSyntheticResponse(dir, msg, {
      result: sim.mockError ? undefined : sim.mockResult,
      error: sim.mockError,
    });
    if (response === null) {
      return { msg: null, held: false, modified: false, heldMs: 0, simulated: 'mock' };
    }
    if (dir === 'c2s') {
      return { msg: null, held: false, modified: true, heldMs: 0, syntheticResponse: response, simulated: 'mock' };
    }
    return { msg: response, held: false, modified: true, heldMs: 0, simulated: 'mock' };
  }

  /**
   * Builds a synthetic JSON-RPC response for the given message.
   * Respondable = any message with a non-null `id`:
   * - client requests (c2s) → the client expects a response with that id.
   * - server responses (s2c) → replaced, keeping their id.
   * Requests initiated BY the SERVER (s2c, e.g. sampling/createMessage)
   * are NOT respondable — replacing them with a response would confuse
   * the client → pure drop. Notifications (no id) → pure drop.
   */
  private buildSyntheticResponse(
    dir: Dir,
    msg: JsonRpcMessage,
    payload: { result?: unknown; error?: JsonRpcError },
  ): JsonRpcMessage | null {
    if (!('id' in msg) || msg.id == null) return null; // notification / null id
    if (dir === 's2c' && 'method' in msg) return null; // request initiated by the server
    const response: JsonRpcResponse = { jsonrpc: '2.0', id: msg.id };
    if (payload.error) response.error = payload.error;
    else response.result = payload.result;
    return response;
  }

  /** Does any (active) rule match this message? ruleId or null. */
  private matchRule(dir: Dir, msg: JsonRpcMessage): string | null {
    const method = this.methodOf(dir, msg);
    // intercept-all: matches everything (implicit ruleId).
    if (this.interceptAll[dir]) return '__all__';
    for (const r of this.rules.values()) {
      if (!r.enabled) continue;
      if (r.dir !== dir) continue;
      if (r.method === '' || r.method === method) return r.id;
    }
    return null;
  }

  /**
   * Resolves a hold with the user's decision.
   *
   * FIFO DELIVERY: only the FIRST hold of each direction is delivered when
   * resolved. If the resolved hold is not the first, the decision is
   * recorded (pendingResolution) and applied automatically when the
   * earlier holds resolve — this way messages are never reordered.
   *
   * Unknown ids → false (hold already resolved).
   */
  resolveHold(id: string, resolution: HoldResolution): boolean {
    let dir: Dir;
    let idx = this.heldByDir.c2s.findIndex((h) => h.id === id);
    if (idx !== -1) dir = 'c2s';
    else {
      idx = this.heldByDir.s2c.findIndex((h) => h.id === id);
      dir = 's2c';
    }
    if (idx === -1) return false;

    const held = this.heldByDir[dir][idx]!;

    if (idx !== 0) {
      // Not the head: record the decision, deliver when its turn comes.
      held.pendingResolution = resolution;
      this.emit('rulesChanged');
      return true;
    }

    // It is the head: apply and resolve; then cascade of pending decisions.
    this.applyAndRelease(held, resolution);
    this.cascadePending(dir);
    return true;
  }

  /** Applies the decision to the head hold: removes from the list, resolves the promise. */
  private applyAndRelease(held: HeldMessage, resolution: HoldResolution): void {
    const dir = held.dir;
    const list = this.heldByDir[dir];
    const idx = list.indexOf(held);
    if (idx !== -1) list.splice(idx, 1);

    let finalMsg: JsonRpcMessage | null;
    let modified = false;

    switch (resolution.action) {
      case 'send':
        finalMsg = held.msg;
        break;
      case 'send-modified':
        finalMsg = resolution.msg;
        modified = true;
        break;
      case 'drop':
        finalMsg = null;
        break;
      case 'respond':
        // s2c: we deliver a synthetic response to the client instead of the original.
        // c2s: "respond" towards the server doesn't apply → drop.
        finalMsg = dir === 's2c' ? resolution.msg : null;
        modified = dir === 's2c';
        break;
    }

    const heldMs = Date.now() - new Date(held.heldAt).getTime();
    const resolveFn = this.resolvers.get(held.id);
    if (resolveFn) {
      this.resolvers.delete(held.id);
      resolveFn({ msg: finalMsg, held: true, modified, heldMs });
    }
    this.emit('released', held.id);
  }

  /** After releasing the head, cascades the already-recorded decisions. */
  private cascadePending(dir: Dir): void {
    const list = this.heldByDir[dir];
    while (list.length > 0 && list[0]!.pendingResolution !== undefined) {
      const next = list[0]!;
      const resolution = next.pendingResolution!;
      delete next.pendingResolution;
      this.applyAndRelease(next, resolution);
    }
  }
}