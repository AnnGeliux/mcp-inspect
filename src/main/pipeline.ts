/**
 * MITM Pipeline — el corazón de la interceptación (Phase 6).
 *
 * Cada mensaje que cruza el proxy pasa por aquí ANTES de entregarse:
 *   c2s: writeClientMessage() → pipeline.process('c2s', msg) → stdin del server
 *   s2c: stdout del server → pipeline.process('s2c', msg) → cliente SDK
 *
 * Sin reglas activas, el mensaje fluye tal cual (comportamiento read-only
 * de siempre — la promesa se resuelve inmediatamente).
 *
 * Si una regla coincide, el mensaje queda RETENIDO: la promesa de process()
 * no se resuelve hasta que el usuario lo decide desde la UI:
 *   send          → entrega el original sin cambios
 *   send-modified → entrega la versión editada (params/result/error alterados)
 *   drop          → lo descarta (nunca llega a su destino)
 *   respond       → s2c only: descarta el original y entrega una respuesta
 *                   sintética al cliente (probar cómo reacciona el LLM sin
 *                   tocar el server). En c2s equivale a drop.
 *
 * SERIALIZACIÓN: la promesa pendiente serializa naturalmente cada dirección
 * — los mensajes que llegan detrás de un hold quedan esperando en la cadena
 * de promesas (nunca se reordenan). c2s y s2c fluyen independientes.
 *
 * CORRELACIÓN: las respuestas JSON-RPC NO llevan `method` (pitfall #1 del
 * skill mcp-protocol-tooling) — se correlacionan con su request SOLO por
 * `id`. El pipeline observa cada request y mantiene mapas id→{method, ts}
 * por dirección, que alimentan (a) reglas por método en s2c y (b) el cálculo
 * de latencia request→response en el proxy.
 */

import { EventEmitter } from 'events';
import { InterceptRule, HeldMessage, JsonRpcMessage, HoldResolution } from '../shared/types';

export interface PipelineEvents {
  /** Un mensaje fue retenido por un breakpoint. */
  held: (held: HeldMessage) => void;
  /** Un hold fue resuelto (o liberado). */
  released: (id: string) => void;
  /** Reglas cambiaron (add/remove/toggle/intercept-all/clear). */
  rulesChanged: () => void;
  /** La pausa global cambió (congelar tráfico sin matar el subprocess). */
  pausedChanged: (paused: boolean) => void;
  /** La cola de pausa cambió (mensajes encolados o liberados). */
  queueChanged: () => void;
}

export declare interface MITMPipeline {
  on<E extends keyof PipelineEvents>(event: E, listener: PipelineEvents[E]): this;
  emit<E extends keyof PipelineEvents>(event: E, ...args: Parameters<PipelineEvents[E]>): boolean;
}

/** Resultado del pipeline tras resolver: qué entregar y si fue alterado. */
export interface ProcessResult {
  /** Mensaje final a entregar al destino (null = descartado). */
  msg: JsonRpcMessage | null;
  /** true si fue retenido por un breakpoint. */
  held: boolean;
  /** true si el mensaje entregado difiere del original (editado o respondido). */
  modified: boolean;
  /** ms que estuvo retenido. */
  heldMs: number;
}

/** Info de un request observado, para correlacionar su respuesta. */
interface RequestInfo {
  method: string;
  ts: number;
}

/** Mensaje en cola de pausa, esperando el resume (FIFO). */
interface PausedItem {
  msg: JsonRpcMessage;
  arrivedAt: number;
  resolve: (r: ProcessResult) => void;
}

type Dir = 'c2s' | 's2c';

/** Límite de requests correlacionados por dirección (evita crecimiento infinito). */
const MAX_TRACKED_REQUESTS = 1000;

export class MITMPipeline extends EventEmitter {
  private rules = new Map<string, InterceptRule>();
  /** Holds activos, por dirección. */
  private heldByDir: Record<Dir, HeldMessage[]> = { c2s: [], s2c: [] };
  /** Resolvers pendientes por hold id — resolver la promesa = entregar. */
  private resolvers = new Map<string, (r: ProcessResult) => void>();
  /** Requests observados por dirección: id → {method, ts} (correlación). */
  private requests: Record<Dir, Map<string | number, RequestInfo>> = { c2s: new Map(), s2c: new Map() };
  private seq = 0;
  /** Intercept-all por dirección: si true, TODO se retiene. */
  private interceptAll: Record<Dir, boolean> = { c2s: false, s2c: false };
  /** Pausa global: congela TODO el tráfico (sin matar el subprocess). */
  private _paused = false;
  /** Cola de pausa por dirección — se libera en FIFO al resume. */
  private pausedQueue: Record<Dir, PausedItem[]> = { c2s: [], s2c: [] };

  // ——— Reglas ————————————————————————————————————————————————————

  addRule(dir: Dir, method: string): InterceptRule {
    const id = `rule-${++this.seq}`;
    const rule: InterceptRule = { id, dir, method, enabled: true };
    this.rules.set(id, rule);
    this.emit('rulesChanged');
    return rule;
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

  /** Holds activos (copia), en orden de llegada. */
  listHeld(): HeldMessage[] {
    return [...this.heldByDir.c2s, ...this.heldByDir.s2c];
  }

  /** true si hay al menos un mensaje retenido esperando decisión. */
  get hasHeld(): boolean {
    return this.heldByDir.c2s.length > 0 || this.heldByDir.s2c.length > 0;
  }

  /** Elimina todas las reglas, libera holds y cola de pausa, y quita la pausa. */
  async flushAll(): Promise<void> {
    for (const h of this.listHeld()) {
      this.resolveHold(h.id, { action: 'send' });
    }
    // La cola de pausa también se libera (entrega originales, sin re-procesar).
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

  /** Limpia los mapas de correlación (al iniciar una sesión nueva). */
  clearCorrelation(): void {
    this.requests.c2s.clear();
    this.requests.s2c.clear();
  }

  // ——— Pausa global (congelar tráfico sin matar el subprocess) ———

  /** ¿Está pausado? Los mensajes nuevos se encolan en vez de fluir. */
  get paused(): boolean {
    return this._paused;
  }

  /** Mensajes encolados por la pausa, por dirección. */
  queueLengths(): { c2s: number; s2c: number } {
    return { c2s: this.pausedQueue.c2s.length, s2c: this.pausedQueue.s2c.length };
  }

  /** Congela TODO el tráfico: cada mensaje nuevo se encola (FIFO por dirección). */
  pause(): void {
    if (this._paused) return;
    this._paused = true;
    this.emit('pausedChanged', true);
  }

  /**
   * Reanuda el tráfico: libera la cola FIFO por dirección. Cada mensaje
   * encolado RE-ENTRA al pipeline (con su arrivedAt original) — si coincide
   * con una regla/breakpoint se retiene para inspección; si no, fluye tal
   * cual. c2s se drena primero para que los requests queden correlacionados
   * antes que sus responses.
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
   * Reinicia el estado de pausa para una sesión nueva: la cola vieja se
   * descarta (resolve con drop — el server anterior ya no existe) y el flag
   * queda en false.
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

  // ——— Correlación id→{method, ts} ————————————————————————————

  /** Registra un request observado (para reglas por método y latencia). */
  private observeRequest(dir: Dir, msg: JsonRpcMessage, arrivedAt: number): void {
    if ('method' in msg && 'id' in msg && msg.id != null) {
      const map = this.requests[dir];
      if (map.size >= MAX_TRACKED_REQUESTS) {
        // FIFO: evicta el más viejo (primera key insertada)
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      map.set(msg.id, { method: msg.method, ts: arrivedAt });
    }
  }

  /** Método efectivo de un mensaje: propio (requests/notif) o correlacionado (responses). */
  methodOf(dir: Dir, msg: JsonRpcMessage): string {
    if ('method' in msg) return msg.method;
    if ('id' in msg && msg.id != null) {
      const origin: Dir = dir === 'c2s' ? 's2c' : 'c2s';
      return this.requests[origin].get(msg.id)?.method ?? '';
    }
    return '';
  }

  /**
   * Correlaciona una respuesta con su request (si existe).
   * Devuelve {requestMethod, latencyMs} o null. Consume la entrada del mapa.
   */
  correlateResponse(dir: Dir, msg: JsonRpcMessage, now = Date.now()): { requestMethod: string; latencyMs: number } | null {
    if ('method' in msg) return null; // request/notification — no correlaciona
    if (!('id' in msg) || msg.id == null) return null;
    const origin: Dir = dir === 'c2s' ? 's2c' : 'c2s';
    const info = this.requests[origin].get(msg.id);
    if (!info) return null;
    this.requests[origin].delete(msg.id);
    return { requestMethod: info.method, latencyMs: Math.max(0, now - info.ts) };
  }

  // ——— Procesamiento ————————————————————————————————————————————

  /**
   * Procesa un mensaje que cruza el proxy. Devuelve una promesa que se
   * resuelve con la decisión final:
   *  - Sin reglas: inmediata, mensaje tal cual.
   *  - Con regla coincidente: la promesa espera hasta que el usuario resuelve
   *    el hold desde la UI (resolveHold).
   *
   * @param arrivedAt ms epoch de llegada al proxy (para latencia/heldAt precisos).
   * El write al destino lo hace el CALLER (proxy.ts) cuando la promesa resuelve.
   */
  process(dir: Dir, msg: JsonRpcMessage, arrivedAt = Date.now()): Promise<ProcessResult> {
    // Pausa global: encolar en vez de procesar (el subprocess sigue vivo).
    if (this._paused) {
      return new Promise<ProcessResult>((resolve) => {
        this.pausedQueue[dir].push({ msg, arrivedAt, resolve });
        this.emit('queueChanged');
      });
    }
    return this.processNow(dir, msg, arrivedAt);
  }

  /** Procesamiento real (sin pausa): observado + match de reglas + hold. */
  private processNow(dir: Dir, msg: JsonRpcMessage, arrivedAt: number): Promise<ProcessResult> {
    this.observeRequest(dir, msg, arrivedAt);

    const ruleId = this.matchRule(dir, msg);
    if (ruleId === null) {
      return Promise.resolve({ msg, held: false, modified: false, heldMs: 0 });
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

  /** ¿Coincide alguna regla (activa) con este mensaje? ruleId o null. */
  private matchRule(dir: Dir, msg: JsonRpcMessage): string | null {
    const method = this.methodOf(dir, msg);
    // intercept-all: coincide con todo (ruleId implícito)
    if (this.interceptAll[dir]) return '__all__';
    for (const r of this.rules.values()) {
      if (!r.enabled) continue;
      if (r.dir !== dir) continue;
      if (r.method === '' || r.method === method) return r.id;
    }
    return null;
  }

  /**
   * Resuelve un hold con la decisión del usuario.
   *
   * ENTREGA FIFO: solo el PRIMER hold de cada dirección se entrega al
   * resolver. Si el hold resuelto no es el primero, la decisión queda
   * registrada (pendingResolution) y se aplica automáticamente cuando los
   * holds anteriores se resuelvan — así los mensajes nunca se reordenan.
   *
   * Ids desconocidos → false (hold ya resuelto).
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
      // No es el head: registrar decisión, entregar cuando llegue su turno.
      held.pendingResolution = resolution;
      this.emit('rulesChanged');
      return true;
    }

    // Es el head: aplicar y resolver; luego cascada de decisiones pendientes.
    this.applyAndRelease(held, resolution);
    this.cascadePending(dir);
    return true;
  }

  /** Aplica la decisión al hold head: saca de la lista, resuelve la promesa. */
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
        // s2c: entregamos respuesta sintética al cliente en vez del original.
        // c2s: "responder" hacia el server no aplica → drop.
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

  /** Tras liberar el head, aplica en cascada las decisiones ya registradas. */
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