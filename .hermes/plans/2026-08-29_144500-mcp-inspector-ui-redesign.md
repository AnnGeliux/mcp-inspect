# MCP Inspector — Rediseño UI (tabs + timeline + tools dinámicas)

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Rediseñar el renderer del MCP Inspector con layout tipo Inspector oficial (sidebar de conexión + tabs por capability), timeline de tráfico agrupada por transacción (prioridad #1 del usuario), y forms auto-generados desde `inputSchema` de las tools descubiertas vía `tools/list`.

**Architecture:** El main process NO cambia (el `McpClientController` ya soporta todos los métodos necesarios: `tools/list|call`, `resources/list|read`, `prompts/list|get`, `ping`). Todo el rediseño es renderer-only: se reemplaza el layout de 3 columnas por sidebar (conexión server+client) + área principal con tabs (Tráfico / Tools / Recursos / Prompts / Raw). La agrupación de transacciones y la generación de forms desde JSON Schema son funciones puras con tests (misma infra que `tests/parser.test.ts`: `node --test --import tsx`).

**Tech Stack:** React 19 + TypeScript + Vite 6 (existentes) + **Tailwind CSS v4** (nuevo, vía `@tailwindcss/vite`). Tema GitHub-dark actual conservado como tokens `@theme`.

---

## Contexto y decisiones del usuario

- **Alcance:** Completo — rediseño tipo Inspector oficial (tabs por capability + panel de conexión). Las 3 columnas desaparecen.
- **Pain #1:** El log central — difícil de navegar/analizar → timeline agrupada por transacción (req con resp anidada, como conversación) + filtros arriba.
- **Estética:** Mantener GitHub-dark, pulir detalles (espaciado, jerarquía, hover/focus). Sin light mode.
- **Tools dinámicas:** Form auto-generado desde `inputSchema` (como "Try it" del Inspector oficial).
- **Stack de estilos:** Tailwind (nueva dependencia, build step).

### Estado actual (verificado)

- Layout: `App.tsx` → 3 columnas: `ServerPanel` | `LogList` | `ClientPanel`, CSS plano en `styles.css` (GitHub-dark con variables).
- `JsonTree.tsx` tiene un hack de DOM (`document.querySelector` + classList toggle) para colapsar nodos — se reescribe con estado React.
- IPC disponible (NO hay que tocar main/preload): `start/stop/write/status`, `clientRequest(method, params)`, `clientNotify`, `clientStatus`, `exportSession/importSession`, `loadServers/saveServers`, `loadClients/saveClients` + eventos push (`onEntry`, `onExit`, `onError`, `onClientConnected`, `onClientClosed`, `onClientError`).
- `mcpClient.request()` ya despacha: `ping`, `tools/list`, `tools/call`, `resources/list`, `prompts/list`, `prompts/get`, `resources/read` (src/main/mcpClient.ts:104-126).
- Handshake automático: `proxy:start` conecta el cliente SDK si `connectClient !== false`; emite `client:connected` con `{serverName, serverVersion}`; `clientStatus()` devuelve `capabilities`.
- Presets ya persistidos en `~/.mcp-inspector/servers.json|clients.json` (merge presets + user en main).
- Tests: `npm test` → `node --test --import tsx tests/parser.test.ts`. Actualizar el script al agregar tests.
- **Ojo:** hay una instancia vieja de la app corriendo (build anterior al commit 2683bd5). Para verificar, cerrarla y usar `npm start` (rebuild completo).
- **Ojo TS6053:** el linter de `write_file` reporta falso positivo "File not found" al crear `.ts` nuevos. Fuente de verdad: `npx tsc -p tsconfig.renderer.json --noEmit`.

### Estructura final del renderer

```
src/renderer/
  App.tsx                      (rewrite: shell + tabs + estado)
  index.css                    (nuevo: Tailwind @theme GitHub-dark)
  styles.css                   (delete al final)
  components/
    ConnectionPanel.tsx        (nuevo: merge ServerPanel+ClientPanel en sidebar)
    JsonTree.tsx               (rewrite: estado React, Tailwind)
    tabs/
      TrafficTab.tsx           (nuevo: timeline por transacción + filtros)
      ToolsTab.tsx             (nuevo: lista + form dinámico + resultado)
      ResourcesTab.tsx         (nuevo: lista + read)
      PromptsTab.tsx           (nuevo: lista + get con args)
      RawTab.tsx               (nuevo: envío raw + export/import sesión)
    (delete al final: ServerPanel.tsx, ClientPanel.tsx, LogList.tsx)
  lib/
    transactions.ts            (nuevo: agrupación + filtros, puro)
    schemaForm.ts              (nuevo: JSON Schema → campos, puro)
tests/
  transactions.test.ts         (nuevo)
  schemaForm.test.ts           (nuevo)
```

---

## Task 1: Setup Tailwind v4

**Objective:** Instalar Tailwind v4, conectarlo a Vite y crear el tema GitHub-dark como tokens — sin romper la UI actual.

**Files:**
- Modify: `package.json` (devDeps vía npm)
- Modify: `vite.config.ts`
- Create: `src/renderer/index.css`
- Modify: `src/renderer/index.tsx` (agregar import)

**Step 1: Instalar**

```bash
npm i -D tailwindcss @tailwindcss/vite
```

**Step 2: vite.config.ts** — agregar plugin:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(__dirname, 'dist-renderer'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
  },
  server: { port: 5173, strictPort: true },
});
```

**Step 3: Create `src/renderer/index.css`**

```css
@import "tailwindcss";

@theme {
  /* GitHub-dark palette (mismos valores que styles.css) */
  --color-canvas: #0d1117;
  --color-panel: #161b22;
  --color-card: #1c2128;
  --color-line: #30363d;
  --color-line-strong: #444c56;
  --color-fg: #c9d1d9;
  --color-fg-dim: #8b949e;
  --color-accent: #58a6ff;
  --color-ok: #3fb950;
  --color-bad: #f85149;
  --color-warn: #d29922;
  --color-purp: #bc8cff;
  --font-mono: "Cascadia Mono", "JetBrains Mono", Consolas, ui-monospace, monospace;
}

/* Scrollbars — Tailwind no cubre pseudo-elementos webkit */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: #444c56; border-radius: 4px; }
::-webkit-scrollbar-track { background: transparent; }
```

**Step 4: `src/renderer/index.tsx`** — leer el archivo y agregar `import './index.css';` ANTES del import de `styles.css` (convivencia temporal; preflight de Tailwind es a nivel elemento, `styles.css` usa clases → las clases ganan).

**Step 5: Verificar**

```bash
npm run build:renderer
```
Expected: build exitoso, `dist-renderer/` contiene el CSS con utilidades generadas.

**Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/renderer/index.css src/renderer/index.tsx
git commit -m "chore: add tailwind v4 with github-dark theme tokens"
```

---

## Task 2: Types compartidos de capabilities

**Objective:** Definir los tipos mínimos de tools/resources/prompts que el SDK devuelve, para uso del renderer.

**Files:**
- Modify: `src/shared/types.ts` (append al final)

**Step 1: Agregar al final de `src/shared/types.ts`**

```ts
/** Tool descubierta via tools/list (subset de lo que devuelve el SDK). */
export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown; // JSON Schema
}

/** Resource descubierta via resources/list. */
export interface ResourceInfo {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

/** Prompt descubierto via prompts/list. */
export interface PromptInfo {
  name: string;
  description?: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
}

/** Resultado de un clientRequest para display en tabs. */
export interface TabResult {
  label: string;
  result?: unknown;
  error?: string;
}
```

**Step 2: Verificar**

```bash
npx tsc -p tsconfig.renderer.json --noEmit
```
Expected: sin errores.

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: shared types for tools/resources/prompts discovery"
```

---

## Task 3: `lib/transactions.ts` — agrupación por transacción (TDD)

**Objective:** Función pura que agrupa `LogEntry[]` en transacciones (req+resp por `rpcId`), notificaciones standalone y eventos (stderr/lifecycle), + filtros.

**Files:**
- Create: `tests/transactions.test.ts`
- Create: `src/renderer/lib/transactions.ts`
- Modify: `package.json` (script test)

**Step 1: Write failing test — `tests/transactions.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupTransactions, filterTransactions } from '../src/renderer/lib/transactions';
import type { LogEntry } from '../src/shared/types';

let seq = 0;
function entry(p: Partial<LogEntry>): LogEntry {
  return {
    seq: ++seq, ts: '2026-08-29T14:00:00.000Z', dir: 'c2s', kind: 'request',
    rpcId: null, raw: '', ...p,
  };
}

test('request + response con mismo id → una transacción call con duración', () => {
  const txs = groupTransactions([
    entry({ method: 'tools/list', rpcId: 2, dir: 'c2s', kind: 'request', ts: '2026-08-29T14:00:01.000Z' }),
    entry({ rpcId: 2, dir: 's2c', kind: 'response', result: { tools: [] }, ts: '2026-08-29T14:00:01.250Z' }),
  ]);
  assert.equal(txs.length, 1);
  assert.equal(txs[0]!.kind, 'call');
  assert.equal(txs[0]!.method, 'tools/list');
  assert.equal(txs[0]!.status, 'ok');
  assert.equal(txs[0]!.durationMs, 250);
});

test('response con error → status error', () => {
  const txs = groupTransactions([
    entry({ method: 'tools/call', rpcId: 3, kind: 'request' }),
    entry({ rpcId: 3, dir: 's2c', kind: 'error', error: { code: -32602, message: 'not found' } }),
  ]);
  assert.equal(txs[0]!.status, 'error');
});

test('request sin respuesta aún → pending', () => {
  const txs = groupTransactions([entry({ method: 'ping', rpcId: 4 })]);
  assert.equal(txs[0]!.status, 'pending');
});

test('notification → transacción standalone kind notification', () => {
  const txs = groupTransactions([
    entry({ method: 'notifications/initialized', dir: 'c2s', kind: 'notification', rpcId: null }),
  ]);
  assert.equal(txs.length, 1);
  assert.equal(txs[0]!.kind, 'notification');
  assert.equal(txs[0]!.status, 'pending');
});

test('stderr / lifecycle / proxy → kind event', () => {
  const txs = groupTransactions([
    entry({ method: '[stderr]', dir: 's2c', kind: 'notification', stderr: 'log line' }),
    entry({ method: '[lifecycle]', dir: 's2c', kind: 'notification', stderr: 'server spawned' }),
  ]);
  assert.equal(txs.length, 2);
  assert.ok(txs.every((t) => t.kind === 'event'));
});

test('response huérfana (sin request) → event', () => {
  const txs = groupTransactions([entry({ rpcId: 9, dir: 's2c', kind: 'response', result: 1 })]);
  assert.equal(txs[0]!.kind, 'event');
});

test('requests concurrentes con ids distintos no se mezclan', () => {
  const txs = groupTransactions([
    entry({ method: 'a', rpcId: 1 }),
    entry({ method: 'b', rpcId: 2 }),
    entry({ rpcId: 2, dir: 's2c', kind: 'response', result: null }),
    entry({ rpcId: 1, dir: 's2c', kind: 'response', result: null }),
  ]);
  assert.equal(txs.length, 2);
  assert.equal(txs[0]!.method, 'a');
  assert.equal(txs[1]!.method, 'b');
  assert.ok(txs.every((t) => t.status === 'ok'));
});

test('id reutilizado tras cerrar → transacción nueva', () => {
  const txs = groupTransactions([
    entry({ method: 'a', rpcId: 1 }),
    entry({ rpcId: 1, dir: 's2c', kind: 'response', result: null }),
    entry({ method: 'b', rpcId: 1 }),
    entry({ rpcId: 1, dir: 's2c', kind: 'response', result: null }),
  ]);
  assert.equal(txs.length, 2);
});

test('filterTransactions: query por method y chips de categoría', () => {
  const txs = groupTransactions([
    entry({ method: 'tools/list', rpcId: 2, raw: 'tools/list' }),
    entry({ rpcId: 2, dir: 's2c', kind: 'response', result: {}, raw: 'resp' }),
    entry({ method: 'notifications/message', dir: 's2c', kind: 'notification', raw: 'notif' }),
  ]);
  const all = { query: '', c2s: true, s2c: true, notif: true, err: true };
  assert.equal(filterTransactions(txs, all).length, 2);
  const onlyNotif = { ...all, c2s: false, s2c: false };
  assert.equal(filterTransactions(txs, onlyNotif).length, 1);
  assert.equal(filterTransactions(txs, { ...all, query: 'tools' }).length, 1);
});
```

**Step 2: Run — verificar que falla**

```bash
node --test --import tsx tests/transactions.test.ts
```
Expected: FAIL —Cannot find module `../src/renderer/lib/transactions`.

**Step 3: Implement — `src/renderer/lib/transactions.ts`**

```ts
/**
 * Agrupación del tráfico MITM en "transacciones" para la timeline:
 *  - call: request con id + su response/error (emparejados por rpcId, cualquier dirección)
 *  - notification: mensaje sin id
 *  - event: stderr / lifecycle / proxy / responses huérfanas
 * Puro y testeable — opera sobre LogEntry[] sin depender de React.
 */
import type { JsonRpcId, LogEntry } from '../../shared/types';

export type TxKind = 'call' | 'notification' | 'event';
export type TxStatus = 'pending' | 'ok' | 'error';

export interface Transaction {
  key: string;
  kind: TxKind;
  method: string;
  rpcId: JsonRpcId;
  request: LogEntry | null;
  response: LogEntry | null;
  entries: LogEntry[];
  status: TxStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number | null;
}

export interface TrafficFilter {
  query: string;
  c2s: boolean;
  s2c: boolean;
  notif: boolean;
  err: boolean;
}

export const DEFAULT_FILTER: TrafficFilter = { query: '', c2s: true, s2c: true, notif: true, err: true };

const EVENT_METHODS = new Set(['[stderr]', '[lifecycle]', '[proxy]']);

export function groupTransactions(entries: LogEntry[]): Transaction[] {
  const txs: Transaction[] = [];
  const open = new Map<string, Transaction>();

  for (const e of entries) {
    // Eventos sintéticos del inspector
    if (EVENT_METHODS.has(e.method ?? '')) {
      txs.push(makeTx(`e${e.seq}`, 'event', e.method ?? '', null, e));
      continue;
    }

    // Response (con id, sin method): emparejar con call abierta
    if (e.kind === 'response' || e.kind === 'error') {
      const k = String(e.rpcId);
      const tx = e.rpcId != null ? open.get(k) : undefined;
      if (tx) {
        open.delete(k);
        tx.response = e;
        tx.entries.push(e);
        tx.status = e.kind === 'error' ? 'error' : 'ok';
        tx.endedAt = e.ts;
        tx.durationMs = Date.parse(e.ts) - Date.parse(tx.startedAt);
      } else {
        txs.push(makeTx(`e${e.seq}`, 'event', `← id ${String(e.rpcId)}`, null, e));
      }
      continue;
    }

    // Request con id → nueva call
    if (e.kind === 'request' && e.rpcId != null) {
      const tx = makeTx(`t${e.seq}`, 'call', e.method ?? '(?)', e, e);
      txs.push(tx);
      open.set(String(e.rpcId), tx);
      continue;
    }

    // Notification (sin id)
    txs.push(makeTx(`n${e.seq}`, 'notification', e.method ?? '(?)', null, e));
  }
  return txs;
}

function makeTx(
  key: string, kind: TxKind, method: string, request: LogEntry | null, e: LogEntry,
): Transaction {
  return {
    key, kind, method,
    rpcId: e.rpcId,
    request, response: null,
    entries: [e],
    status: kind === 'call' ? 'pending' : kind === 'event' && e.kind === 'error' ? 'error' : 'pending',
    startedAt: e.ts, endedAt: e.ts, durationMs: null,
  };
}

/** Filtra transacciones por query (method + raw) y chips de categoría. */
export function filterTransactions(txs: Transaction[], f: TrafficFilter): Transaction[] {
  const q = f.query.trim().toLowerCase();
  return txs.filter((t) => {
    if (q && !t.method.toLowerCase().includes(q) && !t.entries.some((e) => e.raw.toLowerCase().includes(q))) {
      return false;
    }
    return t.entries.some((e) => {
      if (e.dir === 'c2s' && f.c2s) return true;
      if (e.dir === 's2c' && f.s2c) return true;
      if (e.kind === 'notification' && f.notif) return true;
      if ((e.kind === 'error' || t.status === 'error') && f.err) return true;
      return false;
    });
  });
}
```

**Step 4: Run — verificar verde**

```bash
node --test --import tsx tests/transactions.test.ts
```
Expected: 9 pass, 0 fail.

**Step 5: Actualizar script de test en `package.json`**

```json
"test": "node --test --import tsx tests/parser.test.ts tests/transactions.test.ts"
```

**Step 6: Verificar suite completa + typecheck**

```bash
npm test && npx tsc -p tsconfig.renderer.json --noEmit
```
Expected: parser + transactions en verde, tsc sin errores.

**Step 7: Commit**

```bash
git add tests/transactions.test.ts src/renderer/lib/transactions.ts package.json
git commit -m "feat: transaction grouping + traffic filters (pure, tested)"
```

---

## Task 4: `lib/schemaForm.ts` — JSON Schema → campos (TDD)

**Objective:** Función pura que convierte el `inputSchema` de una tool (JSON Schema) a una lista de campos renderizables, + builder de arguments con validación.

**Files:**
- Create: `tests/schemaForm.test.ts`
- Create: `src/renderer/lib/schemaForm.ts`
- Modify: `package.json` (script test)

**Step 1: Write failing test — `tests/schemaForm.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemaToFields, buildArguments } from '../src/renderer/lib/schemaForm';

test('schema básico → campos tipados, required marcado', () => {
  const fields = schemaToFields({
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Mensaje a repetir' },
      count: { type: 'integer' },
      verbose: { type: 'boolean' },
    },
    required: ['message'],
  });
  assert.equal(fields.length, 3);
  const msg = fields.find((f) => f.name === 'message')!;
  assert.equal(msg.type, 'string');
  assert.equal(msg.required, true);
  assert.equal(msg.description, 'Mensaje a repetir');
  assert.equal(fields.find((f) => f.name === 'count')!.type, 'number');
  assert.equal(fields.find((f) => f.name === 'verbose')!.type, 'boolean');
  assert.equal(fields.find((f) => f.name === 'count')!.required, false);
});

test('enum directo o via anyOf → campo enum', () => {
  const direct = schemaToFields({ type: 'object', properties: { mode: { type: 'string', enum: ['a', 'b'] } } });
  assert.equal(direct[0]!.type, 'enum');
  assert.deepEqual(direct[0]!.enumValues, ['a', 'b']);

  const anyOf = schemaToFields({
    type: 'object',
    properties: {
      mode: { anyOf: [{ type: 'string', title: 'Slow' }, { type: 'string', title: 'Fast' }] },
    },
  });
  assert.equal(anyOf[0]!.type, 'enum');
  assert.deepEqual(anyOf[0]!.enumValues, ['Slow', 'Fast']);
});

test('schema vacío / no-objeto / sin properties → []', () => {
  assert.deepEqual(schemaToFields(undefined), []);
  assert.deepEqual(schemaToFields({}), []);
  assert.deepEqual(schemaToFields({ type: 'string' }), []);
});

test('propiedad anidada (object/array) → campo json', () => {
  const fields = schemaToFields({
    type: 'object',
    properties: { filter: { type: 'object', properties: { q: { type: 'string' } } } },
  });
  assert.equal(fields[0]!.type, 'json');
});

test('buildArguments: strings, números, opcional vacío se omite', () => {
  const fields = schemaToFields({
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'number' }, c: { type: 'string' } },
    required: ['a', 'b'],
  });
  const r = buildArguments(fields, { a: 'hola', b: '3', c: '' });
  assert.ok(r.ok);
  assert.deepEqual(r.args, { a: 'hola', b: 3 });
});

test('buildArguments: required faltante → error', () => {
  const fields = schemaToFields({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] });
  const r = buildArguments(fields, { a: '' });
  assert.ok(!r.ok);
});

test('buildArguments: number inválido → error', () => {
  const fields = schemaToFields({ type: 'object', properties: { b: { type: 'number' } } });
  const r = buildArguments(fields, { b: 'xyz' });
  assert.ok(!r.ok);
});

test('buildArguments: campo json parsea JSON', () => {
  const fields = schemaToFields({ type: 'object', properties: { f: { type: 'object' } } });
  const ok = buildArguments(fields, { f: '{"q":"x"}' });
  assert.ok(ok.ok);
  assert.deepEqual(ok.args, { f: { q: 'x' } });
  const bad = buildArguments(fields, { f: '{invalid' });
  assert.ok(!bad.ok);
});

test('buildArguments: boolean false se incluye', () => {
  const fields = schemaToFields({ type: 'object', properties: { v: { type: 'boolean' } } });
  const r = buildArguments(fields, { v: false });
  assert.ok(r.ok);
  assert.deepEqual(r.args, { v: false });
});
```

**Step 2: Run — verificar fail**

```bash
node --test --import tsx tests/schemaForm.test.ts
```
Expected: FAIL —Cannot find module.

**Step 3: Implement — `src/renderer/lib/schemaForm.ts`**

```ts
/**
 * Convierte el inputSchema (JSON Schema) de una tool MCP en campos de form
 * renderizables, y valida/arma el objeto arguments al ejecutar.
 * Puro y testeable — sin React.
 */

export type FieldType = 'string' | 'number' | 'boolean' | 'enum' | 'json';

export interface FormField {
  name: string;
  type: FieldType;
  required: boolean;
  description?: string;
  enumValues?: string[];
}

interface JsonSchemaProp {
  type?: string;
  description?: string;
  enum?: unknown[];
  anyOf?: { type?: string; title?: string; const?: unknown }[];
}

export function schemaToFields(schema: unknown): FormField[] {
  if (!schema || typeof schema !== 'object') return [];
  const s = schema as { type?: string; properties?: Record<string, JsonSchemaProp>; required?: unknown[] };
  if (!s.properties || typeof s.properties !== 'object') return [];
  const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);

  return Object.entries(s.properties).map(([name, prop]) => {
    const field: FormField = { name, type: 'string', required: required.has(name), description: prop.description };
    if (Array.isArray(prop.enum) && prop.enum.length > 0) {
      field.type = 'enum';
      field.enumValues = prop.enum.map(String);
    } else if (Array.isArray(prop.anyOf) && prop.anyOf.length > 0 && prop.anyOf.every((v) => v.title != null)) {
      field.type = 'enum';
      field.enumValues = prop.anyOf.map((v) => String(v.title));
    } else if (prop.type === 'number' || prop.type === 'integer') {
      field.type = 'number';
    } else if (prop.type === 'boolean') {
      field.type = 'boolean';
    } else if (prop.type === 'string') {
      field.type = 'string';
    } else {
      field.type = 'json'; // object, array, sin type, combos raros
    }
    return field;
  });
}

export type FieldValues = Record<string, string | boolean>;

export function buildArguments(
  fields: FormField[],
  values: FieldValues,
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  const args: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === 'boolean') {
      if (v === true) args[f.name] = true;
      else if (v === false) args[f.name] = false;
      continue; // boolean opcional sin tocar → omitir
    }
    const s = typeof v === 'string' ? v.trim() : '';
    if (s === '') {
      if (f.required) return { ok: false, error: `Falta el campo requerido: ${f.name}` };
      continue;
    }
    if (f.type === 'number') {
      const n = Number(s);
      if (Number.isNaN(n)) return { ok: false, error: `${f.name} debe ser numérico` };
      args[f.name] = n;
    } else if (f.type === 'json') {
      try {
        args[f.name] = JSON.parse(s);
      } catch {
        return { ok: false, error: `${f.name} no es JSON válido` };
      }
    } else {
      args[f.name] = s; // string | enum
    }
  }
  return { ok: true, args };
}
```

**Step 4: Run — verde**

```bash
node --test --import tsx tests/schemaForm.test.ts
```
Expected: 9 pass.

**Step 5: Actualizar `package.json` script test**

```json
"test": "node --test --import tsx tests/parser.test.ts tests/transactions.test.ts tests/schemaForm.test.ts"
```

**Step 6: `npm test && npx tsc -p tsconfig.renderer.json --noEmit`** — Expected: todo verde.

**Step 7: Commit**

```bash
git add tests/schemaForm.test.ts src/renderer/lib/schemaForm.ts package.json
git commit -m "feat: json-schema to form-fields converter (pure, tested)"
```

---

## Task 5: JsonTree rewrite (estado React, Tailwind)

**Objective:** Eliminar el hack de DOM del JsonTree; colapso con estado React por nodo; clases Tailwind. API idéntica (`{ data }`).

**Files:**
- Rewrite: `src/renderer/components/JsonTree.tsx`

**Implementación completa:**

```tsx
import React, { useState } from 'react';

/**
 * Vista de árbol JSON con resaltado. Colapso por nodo con estado React
 * (reemplaza el hack anterior de document.querySelector).
 */

const KEY_HIGHLIGHT = new Set(['id', 'method', 'params', 'result', 'error', 'jsonrpc', 'code', 'message']);

export default function JsonTree({ data }: { data: unknown }): React.ReactElement {
  return <div className="font-mono text-[11px] leading-relaxed">{render(data, '$', 0)}</div>;
}

function render(value: unknown, key: string, depth: number): React.ReactElement {
  if (value === null || typeof value !== 'object') {
    return <Leaf value={value} fieldKey={key} />;
  }
  return <Branch value={value} fieldKey={key} depth={depth} />;
}

function Branch({ value, fieldKey, depth }: { value: object; fieldKey: string; depth: number }): React.ReactElement {
  const [open, setOpen] = useState(depth < 2); // primeros 2 niveles abiertos
  const isArr = Array.isArray(value);
  const entries = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  return (
    <div className="whitespace-nowrap">
      <span
        className="cursor-pointer select-none mr-1 text-fg-dim hover:text-accent"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        {open ? '▼' : '▶'}
      </span>
      <Key name={fieldKey} />
      <span className="text-fg-dim mx-1">{isArr ? '[' : '{'}</span>
      {!open && <span className="text-fg-dim text-[10px] ml-1">{entries.length} {isArr ? 'items' : 'keys'}</span>}
      {open && (
        <div className="pl-4 ml-1 border-l border-dashed border-line">
          {entries.map(([k, v]) => <div key={k}>{render(v, k, depth + 1)}</div>)}
        </div>
      )}
      <span className="text-fg-dim mx-1">{isArr ? ']' : '}'}</span>
    </div>
  );
}

function Leaf({ value, fieldKey }: { value: unknown; fieldKey: string }): React.ReactElement {
  let cls = '';
  let display: string;
  if (value === null) { cls = 'text-fg-dim italic'; display = 'null'; }
  else if (typeof value === 'string') { cls = 'text-ok'; display = JSON.stringify(value); }
  else if (typeof value === 'number') { cls = 'text-warn'; display = String(value); }
  else if (typeof value === 'boolean') { cls = 'text-accent'; display = String(value); }
  else { cls = 'text-ok'; display = JSON.stringify(value); }
  return (
    <span className="inline-block mr-1">
      <Key name={fieldKey} />
      <span className="text-fg-dim">: </span>
      <span className={cls}>{display}</span>
    </span>
  );
}

function Key({ name }: { name: string }): React.ReactElement {
  const hot = KEY_HIGHLIGHT.has(name);
  return <span className={hot ? 'text-accent font-semibold' : 'text-purp'}>{name}</span>;
}
```

Nota: las clases `jt-*` de `styles.css` quedan sin uso — el `LogList` viejo lo usa pero será reemplazado en Task 8; degradación visual temporal aceptada.

**Verify:**

```bash
npx tsc -p tsconfig.renderer.json --noEmit && npm run build:renderer
```

**Commit:**

```bash
git add src/renderer/components/JsonTree.tsx
git commit -m "refactor: json tree with react state (drop dom hack) + tailwind"
```

---

## Task 6: App shell — sidebar + tabs + statusbar

**Objective:** Reestructurar `App.tsx`: grid topbar / (sidebar + main con tabbar) / statusbar. Tab state, discovery state (tools/resources/prompts), resultados por tab. La sidebar y tabs son placeholders que se llenan en los tasks siguientes.

**Files:**
- Rewrite: `src/renderer/App.tsx`

**Implementación completa** (los imports de tab components se agregan conforme se crean — en este task se referencian pero aún no existen; para no romper el build, este task crea `App.tsx` + versiones mínimas de `ConnectionPanel` y los 5 tab components como stubs, que los tasks siguientes reemplazan por la implementación real):

`src/renderer/App.tsx`:

```tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import ConnectionPanel from './components/ConnectionPanel';
import TrafficTab from './components/tabs/TrafficTab';
import ToolsTab from './components/tabs/ToolsTab';
import ResourcesTab from './components/tabs/ResourcesTab';
import PromptsTab from './components/tabs/PromptsTab';
import RawTab from './components/tabs/RawTab';
import {
  LogEntry, ServerConfig, ClientConfig, JsonRpcMessage,
  SavedServer, SavedClient, ToolInfo, ResourceInfo, PromptInfo, TabResult,
} from '../shared/types';

// (mantener íntegro el `declare global { interface Window { api: ... } }` actual de App.tsx:14-39)

type TabId = 'traffic' | 'tools' | 'resources' | 'prompts' | 'raw';

const TABS: { id: TabId; label: string }[] = [
  { id: 'traffic', label: 'Tráfico' },
  { id: 'tools', label: 'Tools' },
  { id: 'resources', label: 'Recursos' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'raw', label: 'Raw' },
];

export default function App(): React.ReactElement {
  // ——— Traffic / session state ——— (igual que hoy: entries, running, clientConnected,
  //    serverInfo, exitInfo, statusMsg, servers, clients, selectedServerId,
  //    selectedClientId, config, hasSelection, autoStarted)
  // ...copiar sin cambios de App.tsx:42-61...

  // ——— Nuevo: tabs + discovery + resultados ———
  const [tab, setTab] = useState<TabId>('traffic');
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [resources, setResources] = useState<ResourceInfo[]>([]);
  const [prompts, setPrompts] = useState<PromptInfo[]>([]);
  const [toolResult, setToolResult] = useState<TabResult | null>(null);
  const [resourceResult, setResourceResult] = useState<TabResult | null>(null);
  const [promptResult, setPromptResult] = useState<TabResult | null>(null);

  // ——— IPC event subscriptions ——— igual que hoy (App.tsx:84-106), con este
  // cambio en onConn: tras setServerInfo, disparar discovery():
  //   const offConn = window.api.onClientConnected((info) => {
  //     setClientConnected(true);
  //     setStatusMsg(`Cliente conectado a ${info.serverName} v${info.serverVersion} — handshake completo.`);
  //     void window.api.clientStatus().then((s) => {
  //       setServerInfo(s.server);
  //       void discover(s.server?.capabilities);
  //     });
  //   });
  // y en onExit/onClosed: limpiar discovery (setTools([]) etc.).

  // ——— Discovery: fetch capability-gated al conectar ———
  const discover = useCallback(async (caps: unknown) => {
    const c = (caps ?? {}) as Record<string, unknown>;
    if ('tools' in c) {
      const r = await window.api.clientRequest('tools/list');
      if (r.ok && r.result) setTools(((r.result as { tools?: ToolInfo[] }).tools) ?? []);
    }
    if ('resources' in c) {
      const r = await window.api.clientRequest('resources/list');
      if (r.ok && r.result) setResources(((r.result as { resources?: ResourceInfo[] }).resources) ?? []);
    }
    if ('prompts' in c) {
      const r = await window.api.clientRequest('prompts/list');
      if (r.ok && r.result) setPrompts(((r.result as { prompts?: PromptInfo[] }).prompts) ?? []);
    }
  }, []);

  // ——— CRUD handlers ——— (copiar sin cambios handleSelectServer…handleDeleteClient, App.tsx:109-192)
  // ——— Start/Stop ——— (copiar onStart/onStop, App.tsx:195-209; en onStart también
  //    resetear discovery: setTools([]), setResources([]), setPrompts([]), setToolResult(null), etc.)
  // ——— Auto-start effect ——— (copiar App.tsx:212-222)

  // ——— Interacción ———
  const doRequest = useCallback(async (method: string, params: unknown | undefined, label: string): Promise<TabResult> => {
    setStatusMsg(`Enviando ${label}…`);
    const r = await window.api.clientRequest(method, params);
    const res: TabResult = r.ok
      ? { label, result: r.result }
      : { label, error: r.error ?? 'unknown error' };
    setStatusMsg(r.ok ? `${label} OK — respuesta en Tráfico.` : `ERROR en ${label}: ${r.error}`);
    return res;
  }, []);

  const onPing = useCallback(() => { void doRequest('ping', undefined, 'ping'); }, [doRequest]);

  const onCallTool = useCallback(async (name: string, args: Record<string, unknown>) => {
    const res = await doRequest('tools/call', { name, arguments: args }, `tools/call ${name}`);
    setToolResult(res);
  }, [doRequest]);

  const onReadResource = useCallback(async (uri: string) => {
    const res = await doRequest('resources/read', { uri }, `resources/read ${uri}`);
    setResourceResult(res);
  }, [doRequest]);

  const onGetPrompt = useCallback(async (name: string, args: Record<string, string>) => {
    const res = await doRequest('prompts/get', { name, arguments: args }, `prompts/get ${name}`);
    setPromptResult(res);
  }, [doRequest]);

  const onSendRaw = useCallback(async (raw: string) => {
    try {
      const msg = JSON.parse(raw) as JsonRpcMessage;
      const r = await window.api.write(msg);
      setStatusMsg(r.ok ? 'Raw enviado (c2s en el log).' : 'Server no vivo — no se pudo enviar.');
    } catch {
      setStatusMsg('JSON inválido — no se envió.');
    }
  }, []);

  // onExport / onImport: copiar de App.tsx:258-270 (mover a RawTab).

  return (
    <div className="h-screen flex flex-col bg-canvas text-fg text-[13px]">
      {/* Topbar */}
      <header className="h-14 shrink-0 flex items-center gap-4 px-4 bg-panel border-b border-line">
        <div className="flex items-center gap-2 font-semibold">
          <div className="w-7 h-7 grid place-items-center rounded-md bg-gradient-to-br from-accent to-purp text-[15px]">⌘</div>
          MCP Inspector
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-fg-dim">
          <Pill on={running} text={running ? '● Capturando' : '○ Detenido'} />
          <Pill on={clientConnected} text={clientConnected ? '● Cliente conectado' : '○ Cliente idle'} />
          <span className="px-2.5 py-0.5 rounded-full bg-card border border-line font-mono text-[11px]">
            {entries.length} mensajes
          </span>
        </div>
      </header>

      {/* Sidebar + main */}
      <div className="flex flex-1 min-h-0">
        <ConnectionPanel
          /* props: servers, selectedServerId, config, onSelect, onChange, onAdd, onUpdate, onDelete,
             clients, selectedClientId, onSelectClient, onAddClient, onUpdateClient, onDeleteClient,
             running, clientConnected, serverInfo, onStart, onStop, onPing */
        />
        <main className="flex-1 min-w-0 flex flex-col bg-canvas">
          {/* Tabbar */}
          <nav className="shrink-0 flex items-center gap-1 px-3 pt-2 bg-panel border-b border-line">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3.5 py-2 text-[12px] rounded-t-md border border-b-0 font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-canvas border-line text-fg'
                    : 'bg-transparent border-transparent text-fg-dim hover:text-fg'
                }`}
              >
                {t.label}
                {t.id === 'tools' && tools.length > 0 && <span className="ml-1.5 text-fg-dim font-mono text-[10px]">{tools.length}</span>}
                {t.id === 'resources' && resources.length > 0 && <span className="ml-1.5 text-fg-dim font-mono text-[10px]">{resources.length}</span>}
                {t.id === 'prompts' && prompts.length > 0 && <span className="ml-1.5 text-fg-dim font-mono text-[10px]">{prompts.length}</span>}
              </button>
            ))}
          </nav>

          <div className="flex-1 min-h-0 overflow-hidden">
            {tab === 'traffic' && <TrafficTab entries={entries} onClear={() => setEntries([])} />}
            {tab === 'tools' && (
              <ToolsTab tools={tools} connected={clientConnected} onCall={onCallTool} result={toolResult}
                onRefresh={() => void doRequest('tools/list', undefined, 'tools/list')}
                onViewTraffic={() => setTab('traffic')} />
            )}
            {tab === 'resources' && (
              <ResourcesTab resources={resources} connected={clientConnected} onRead={onReadResource} result={resourceResult}
                onRefresh={() => void doRequest('resources/list', undefined, 'resources/list')}
                onViewTraffic={() => setTab('traffic')} />
            )}
            {tab === 'prompts' && (
              <PromptsTab prompts={prompts} connected={clientConnected} onGet={onGetPrompt} result={promptResult}
                onRefresh={() => void doRequest('prompts/list', undefined, 'prompts/list')}
                onViewTraffic={() => setTab('traffic')} />
            )}
            {tab === 'raw' && <RawTab connected={clientConnected} onSendRaw={onSendRaw} onPing={onPing} onExport={onExport} onImport={onImport} />}
          </div>
        </main>
      </div>

      {/* Statusbar */}
      <footer className="h-8 shrink-0 flex items-center gap-4 px-4 bg-panel border-t border-line font-mono text-[11px] text-fg-dim">
        <span className="truncate">{statusMsg}</span>
        <span className="ml-auto shrink-0">
          {serverInfo?.name ? `${serverInfo.name} v${serverInfo.version ?? '?'}` : ''}
        </span>
        {exitInfo && exitInfo.code !== null && <span className="shrink-0 text-bad">exit {exitInfo.code}</span>}
        {exitInfo && exitInfo.code === null && exitInfo.signal && <span className="shrink-0 text-warn">signal {exitInfo.signal}</span>}
      </footer>
    </div>
  );
}

function Pill({ on, text }: { on: boolean; text: string }): React.ReactElement {
  return (
    <span className={`px-2.5 py-0.5 rounded-full border font-mono text-[11px] ${
      on ? 'text-ok border-ok/40' : 'text-fg-dim border-line'
    }`}>{text}</span>
  );
}
```

**Stubs mínimos** para no romper el build (cada task siguiente los reemplaza):
- `src/renderer/components/ConnectionPanel.tsx`: `export default function ConnectionPanel(_props: unknown): React.ReactElement { return <aside className="w-80 shrink-0 border-r border-line bg-panel overflow-y-auto" />; }`
- `src/renderer/components/tabs/TrafficTab.tsx`, `ToolsTab.tsx`, `ResourcesTab.tsx`, `PromptsTab.tsx`, `RawTab.tsx`: export default con props tipadas `any`-free según el App de arriba (los bodies completos vienen en Tasks 7-11).

Nota el fix incluido del bug de la pill `exit code=` (mostrar `exit N` solo si code !== null, si no `signal X`).

**Verify:**

```bash
npx tsc -p tsconfig.renderer.json --noEmit && npm run build:renderer && npm test
```
Expected: todo verde. (App arranca con sidebar vacía y tabs vacíos — estado transitorio.)

**Commit:**

```bash
git add src/renderer/App.tsx src/renderer/components/ConnectionPanel.tsx src/renderer/components/tabs/
git commit -m "feat: app shell — sidebar + capability tabs + statusbar (tailwind)"
```

---

## Task 7: ConnectionPanel (sidebar)

**Objective:** Merge de ServerPanel + ClientPanel en el sidebar: selección/CRUD de server y client, config del server en `<details>` colapsable, Start/Stop, estado con capabilities y quick ping.

**Files:**
- Rewrite: `src/renderer/components/ConnectionPanel.tsx`

**Approach (mover + adaptar, la lógica ya existe):**
- Props: las que define el App del Task 6.
- Estructura:

```tsx
<aside className="w-80 shrink-0 border-r border-line bg-panel overflow-y-auto flex flex-col">
  {/* Sección SERVER: header "MCP Server · target", dropdown (ServerPanel.tsx:106-120),
      CRUD row (125-136), edit form (139-173) — mismas funciones startAdd/startEdit/saveEdit/
      handleDelete copiadas de ServerPanel.tsx:56-92 */}
  {/* Config en <details> (colapsada por defecto): Comando / Args / Preview
      — ServerPanel.tsx:176-204. Estilo: bg-card rounded-lg border border-line p-3 space-y-3 */}
  {/* Sección CLIENT: header "MCP Client", dropdown + CRUD + edit form
      — ClientPanel.tsx:130-205 (sin el select de type en el form si molesta: mantenerlo) */}
  {/* Estado (ClientPanel.tsx:210-232): nombre/versión del server + capabilities como chips;
      quick action 📡 ping (visible si clientConnected) */}
  {/* Start/Stop pegajoso abajo (sticky bottom-0): ServerPanel.tsx:216-224 */}
</aside>
```

- Clases Tailwind equivalentes a las actuales: dropdown → `w-full bg-canvas text-fg border border-line rounded-md px-2.5 py-1.5 font-mono text-xs focus:border-accent focus:outline-none disabled:opacity-50`; botones → `flex-1 bg-card border border-line rounded-md px-2.5 py-1 text-xs hover:bg-line disabled:opacity-50` (primary → `bg-accent/15 text-accent border-accent`, danger → `text-bad border-bad/30`).
- Validaciones de disabled idénticas a las actuales (running bloquea edición de server, presets no eliminables).

**Verify:**

```bash
npx tsc -p tsconfig.renderer.json --noEmit && npm run build:renderer
```
Además smoke manual: cerrar instancia vieja de la app y `npm start` → seleccionar everything-server, verificar dropdowns, CRUD, Start.

**Commit:**

```bash
git add src/renderer/components/ConnectionPanel.tsx
git commit -m "feat: connection sidebar (server+client merged, tailwind)"
```

---

## Task 8: TrafficTab — timeline por transacción (prioridad #1)

**Objective:** La vista estrella: toolbar (chips filtro + búsqueda + limpiar) + timeline de transacciones con req/resp anidados y auto-scroll.

**Files:**
- Rewrite: `src/renderer/components/tabs/TrafficTab.tsx`

**Implementación completa:**

```tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LogEntry } from '../../../shared/types';
import { groupTransactions, filterTransactions, DEFAULT_FILTER, TrafficFilter, Transaction } from '../../lib/transactions';
import JsonTree from '../JsonTree';

interface Props {
  entries: LogEntry[];
  onClear: () => void;
}

const CHIPS: { key: keyof Pick<TrafficFilter, 'c2s' | 's2c' | 'notif' | 'err'>; label: string }[] = [
  { key: 'c2s', label: 'c→s' },
  { key: 's2c', label: 's→c' },
  { key: 'notif', label: 'notif' },
  { key: 'err', label: 'err' },
];

export default function TrafficTab({ entries, onClear }: Props): React.ReactElement {
  const [filter, setFilter] = useState<TrafficFilter>(DEFAULT_FILTER);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const txs = useMemo(() => filterTransactions(groupTransactions(entries), filter), [entries, filter]);

  // Auto-scroll solo si el usuario ya está abajo (±40px)
  const stick = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [txs.length]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-line bg-panel">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => setFilter({ ...filter, [c.key]: !filter[c.key] })}
            className={`px-2 py-0.5 rounded font-mono text-[11px] border transition-colors ${
              filter[c.key] ? 'bg-accent/15 text-accent border-accent/50' : 'text-fg-dim border-line hover:text-fg'
            }`}
          >{c.label}</button>
        ))}
        <input
          value={filter.query}
          onChange={(e) => setFilter({ ...filter, query: e.target.value })}
          placeholder="Buscar método o contenido…"
          className="flex-1 min-w-0 bg-canvas border border-line rounded-md px-2.5 py-1 text-xs font-mono focus:border-accent focus:outline-none"
        />
        <span className="font-mono text-[11px] text-fg-dim shrink-0">{txs.length} tx</span>
        <button onClick={onClear} className="shrink-0 text-xs text-fg-dim hover:text-bad border border-line rounded-md px-2 py-1">
          Limpiar
        </button>
      </div>

      {/* Timeline */}
      <div ref={listRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto font-mono text-xs">
        {txs.length === 0 && (
          <div className="p-6 text-center text-fg-dim italic text-xs">
            {entries.length === 0
              ? 'Sin tráfico. Inicia el server desde el panel de conexión.'
              : 'Nada coincide con el filtro actual.'}
          </div>
        )}
        {txs.map((tx) => (
          <TxRow key={tx.key} tx={tx} open={expanded.has(tx.key)} onToggle={() => toggle(tx.key)} />
        ))}
      </div>
    </div>
  );
}

function TxRow({ tx, open, onToggle }: { tx: Transaction; open: boolean; onToggle: () => void }): React.ReactElement {
  const statusBadge =
    tx.status === 'error' ? <span className="text-bad">✕ error</span>
    : tx.status === 'ok' ? <span className="text-ok">✓ ok</span>
    : <span className="text-warn">⏳ pending</span>;

  return (
    <div className={`border-b border-panel ${open ? 'bg-card' : 'hover:bg-panel'}`}>
      <button onClick={onToggle} className="w-full text-left grid grid-cols-[86px_64px_1fr_auto] gap-2 items-center px-3 py-2">
        <span className="text-fg-dim text-[11px]">{fmtTs(tx.startedAt)}</span>
        <KindTag tx={tx} />
        <span className="truncate font-semibold">
          {tx.method}
          {tx.rpcId != null && <span className="ml-2 text-fg-dim text-[11px] font-normal">id={String(tx.rpcId)}</span>}
        </span>
        <span className="text-[11px] text-fg-dim shrink-0 flex items-center gap-2">
          {tx.durationMs != null && <span>{tx.durationMs}ms</span>}
          {statusBadge}
          <span className="text-fg-dim">{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 grid gap-2 md:grid-cols-2">
          {tx.request && <MsgCard title={tx.request.dir === 'c2s' ? 'Request → c2s' : 'Request ← s2c'} entry={tx.request} />}
          {tx.response && <MsgCard title={tx.response.dir === 's2c' ? 'Response ← s2c' : 'Response → c2s'} entry={tx.response} />}
          {!tx.request && !tx.response && tx.entries[0] && <MsgCard title={tx.kind === 'notification' ? 'Notificación' : 'Evento'} entry={tx.entries[0]} />}
        </div>
      )}
    </div>
  );
}

function KindTag({ tx }: { tx: Transaction }): React.ReactElement {
  const map: Record<Transaction['kind'], { label: string; cls: string }> = {
    call: { label: 'call', cls: 'text-accent bg-accent/20' },
    notification: { label: 'notif', cls: 'text-warn bg-warn/20' },
    event: { label: 'event', cls: 'text-fg-dim bg-card' },
  };
  const s = map[tx.kind];
  return <span className={`text-center text-[10px] font-semibold rounded px-1.5 py-0.5 ${s.cls}`}>{s.label}</span>;
}

function MsgCard({ title, entry }: { title: string; entry: LogEntry }): React.ReactElement {
  return (
    <div className="bg-canvas border border-line rounded-md overflow-hidden">
      <div className="px-2.5 py-1 text-[10px] uppercase tracking-wide text-fg-dim border-b border-line bg-panel">{title}</div>
      <div className="p-2.5 max-h-72 overflow-auto">
        <JsonTree data={buildMsg(entry)} />
      </div>
    </div>
  );
}

function buildMsg(e: LogEntry): unknown {
  if (e.stderr) return e.stderr;
  if (e.method && e.rpcId != null) return { jsonrpc: '2.0', id: e.rpcId, method: e.method, params: e.params ?? null };
  if (e.method) return { jsonrpc: '2.0', method: e.method, params: e.params ?? null };
  if (e.error) return { jsonrpc: '2.0', id: e.rpcId, error: e.error };
  return { jsonrpc: '2.0', id: e.rpcId, result: e.result ?? null };
}

function fmtTs(iso: string): string {
  const d = new Date(iso);
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}
```

**Verify:**

```bash
npx tsc -p tsconfig.renderer.json --noEmit && npm run build:renderer && npm test
```
Smoke manual (`npm start`): everything-server → Start → verificar: handshake (initialize como call con duración), notifications/initialized como notif, ping/tools/list apareados con su respuesta, chips filtran, búsqueda funciona, Limpiar vacía la timeline.

**Commit:**

```bash
git add src/renderer/components/tabs/TrafficTab.tsx
git commit -m "feat: traffic timeline grouped by transaction with filters"
```

---

## Task 9: ToolsTab — lista + form dinámico + resultado

**Objective:** La pestaña tipo "Try it" del Inspector oficial: lista de tools, form auto-generado desde `inputSchema`, ejecución y resultado con link a Tráfico.

**Files:**
- Rewrite: `src/renderer/components/tabs/ToolsTab.tsx`

**Implementación completa:**

```tsx
import React, { useState } from 'react';
import { ToolInfo, TabResult } from '../../../shared/types';
import { schemaToFields, buildArguments, FormField, FieldValues } from '../../lib/schemaForm';
import JsonTree from '../JsonTree';

interface Props {
  tools: ToolInfo[];
  connected: boolean;
  onCall: (name: string, args: Record<string, unknown>) => void;
  result: TabResult | null;
  onRefresh: () => void;
  onViewTraffic: () => void;
}

export default function ToolsTab({ tools, connected, onCall, result, onRefresh, onViewTraffic }: Props): React.ReactElement {
  const [selected, setSelected] = useState<ToolInfo | null>(null);
  const [values, setValues] = useState<FieldValues>({});
  const [formError, setFormError] = useState('');

  const fields: FormField[] = selected ? schemaToFields(selected.inputSchema) : [];

  const pick = (t: ToolInfo) => {
    setSelected(t);
    setValues({});
    setFormError('');
  };

  const run = () => {
    if (!selected) return;
    const r = buildArguments(fields, values);
    if (!r.ok) { setFormError(r.error); return; }
    setFormError('');
    onCall(selected.name, r.args);
  };

  if (!connected) return <Empty text="Conecta un server con capabilities de tools para verlas aquí." />;

  return (
    <div className="h-full grid grid-cols-[300px_1fr] min-h-0">
      {/* Lista */}
      <div className="border-r border-line overflow-y-auto">
        <div className="flex items-center justify-between px-3 py-2 bg-panel border-b border-line">
          <span className="text-[11px] uppercase tracking-wide text-fg-dim font-semibold">Tools ({tools.length})</span>
          <button onClick={onRefresh} className="text-[11px] text-accent hover:underline">↻ refrescar</button>
        </div>
        {tools.length === 0 && <Empty text="El server no expuso tools (o aún no se descubren)." />}
        {tools.map((t) => (
          <button key={t.name} onClick={() => pick(t)}
            className={`w-full text-left px-3 py-2 border-b border-panel ${selected?.name === t.name ? 'bg-accent/10 border-l-2 border-l-accent' : 'hover:bg-panel border-l-2 border-l-transparent'}`}>
            <div className="font-mono text-xs font-semibold">{t.name}</div>
            {t.description && <div className="text-[11px] text-fg-dim truncate">{t.description}</div>}
          </button>
        ))}
      </div>

      {/* Detalle + form */}
      <div className="overflow-y-auto p-4 space-y-4 min-w-0">
        {!selected && <Empty text="Selecciona una tool para probarla." />}
        {selected && (
          <>
            <div>
              <h2 className="font-mono text-sm font-semibold">{selected.name}</h2>
              {selected.description && <p className="text-xs text-fg-dim mt-1">{selected.description}</p>}
            </div>

            {fields.length === 0 && (
              <p className="text-xs text-fg-dim italic">Esta tool no recibe arguments.</p>
            )}
            <div className="space-y-3 max-w-lg">
              {fields.map((f) => (
                <FieldInput key={f.name} field={f} value={values[f.name] ?? ''} 
                  onChange={(v) => setValues({ ...values, [f.name]: v })} />
              ))}
            </div>

            {formError && <p className="text-xs text-bad">{formError}</p>}

            <button onClick={run}
              className="bg-accent/15 text-accent border border-accent rounded-md px-4 py-1.5 text-xs font-medium hover:bg-accent/25">
              ▶ Ejecutar tools/call
            </button>

            {result && (
              <ResultCard result={result} onViewTraffic={onViewTraffic} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: FormField; value: string | boolean; onChange: (v: string | boolean) => void }): React.ReactElement {
  const label = (
    <label className="block text-[11px] font-medium mb-1">
      <span className="font-mono">{field.name}</span>
      {field.required && <span className="text-bad ml-1">*</span>}
      {field.description && <span className="text-fg-dim font-normal ml-2">{field.description}</span>}
    </label>
  );
  const base = 'w-full bg-canvas border border-line rounded-md px-2.5 py-1.5 text-xs font-mono focus:border-accent focus:outline-none';
  if (field.type === 'boolean') {
    return (
      <div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span className="font-mono">{field.name}</span>
          {field.description && <span className="text-fg-dim">{field.description}</span>}
        </label>
      </div>
    );
  }
  return (
    <div>
      {label}
      {field.type === 'enum' ? (
        <select className={base} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {field.enumValues!.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      ) : field.type === 'json' ? (
        <textarea className={`${base} min-h-20`} rows={3} placeholder='{"key": "value"}'
          value={String(value)} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={base} type={field.type === 'number' ? 'number' : 'text'}
          value={String(value)} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

export function ResultCard({ result, onViewTraffic }: { result: TabResult; onViewTraffic: () => void }): React.ReactElement {
  return (
    <div className="border border-line rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-panel border-b border-line">
        <span className="text-[11px] uppercase tracking-wide text-fg-dim font-semibold">
          Resultado — {result.label}
        </span>
        <button onClick={onViewTraffic} className="text-[11px] text-accent hover:underline">ver en Tráfico →</button>
      </div>
      <div className="p-3 max-h-80 overflow-auto">
        {result.error
          ? <p className="text-xs text-bad font-mono">{result.error}</p>
          : <JsonTree data={result.result ?? null} />}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }): React.ReactElement {
  return <div className="p-6 text-center text-fg-dim italic text-xs">{text}</div>;
}
```

`ResultCard` se exporta para reutilizarlo en Resources/Prompts tabs.

**Verify:**

```bash
npx tsc -p tsconfig.renderer.json --noEmit && npm run build:renderer && npm test
```
Smoke: everything-server → Start → tab Tools muestra las tools descubiertas automáticamente → seleccionar `echo` → llenar `message` → Ejecutar → resultado + entrada en Tráfico.

**Commit:**

```bash
git add src/renderer/components/tabs/ToolsTab.tsx
git commit -m "feat: tools tab with auto-generated forms from inputSchema"
```

---

## Task 10: ResourcesTab + PromptsTab

**Objective:** Tabs de resources (list + read) y prompts (list + get con args string), reutilizando `ResultCard`.

**Files:**
- Rewrite: `src/renderer/components/tabs/ResourcesTab.tsx`
- Rewrite: `src/renderer/components/tabs/PromptsTab.tsx`

**ResourcesTab** — lista izquierda (uri/name/mimeType) + al seleccionar, botón "Leer resources/read" + `ResultCard`. Si `resources.length === 0` y no conectado → Empty; conectado sin resources → Empty con texto. Misma estructura grid `[300px_1fr]` que ToolsTab.

**PromptsTab** — lista izquierda + al seleccionar: form simple con un `input` string por cada `prompt.arguments` (required → `*`), botón "Obtener prompts/get" + `ResultCard`.

Ambos: header con contador + botón ↻ refrescar (props `onRefresh` ya definidas en el App del Task 6), Empty states con `connected` gate.

**Verify:**

```bash
npx tsc -p tsconfig.renderer.json --noEmit && npm run build:renderer && npm test
```
Smoke: everything-server expone resources y prompts — verificar lists, read de un resource, get de un prompt con argument.

**Commit:**

```bash
git add src/renderer/components/tabs/ResourcesTab.tsx src/renderer/components/tabs/PromptsTab.tsx
git commit -m "feat: resources + prompts tabs with read/get"
```

---

## Task 11: RawTab — envío raw + sesión

**Objective:** Mover envío raw JSON-RPC, ping rápido, export/import de sesión a su tab.

**Files:**
- Rewrite: `src/renderer/components/tabs/RawTab.tsx`

**Estructura:** dos tarjetas apiladas (`max-w-2xl mx-auto space-y-4 p-4`):
1. **Envío raw (JSON-RPC)** — textarea + botón Enviar (deshabilitado si `!connected || !raw.trim()`), placeholder `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`. Nota: los raw requests NO pasan por el cliente SDK — el emparejamiento en Tráfico funciona igual porque `proxy:write` emite c2s con id.
2. **Sesión** — botones ⤓ Exportar / ⤒ Importar (mismos handlers actuales movidos aquí vía props `onExport/onImport`) + quick 📡 ping button.

**Verify:**

```bash
npx tsc -p tsconfig.renderer.json --noEmit && npm run build:renderer && npm test
```
Smoke: enviar `{"jsonrpc":"2.0","id":41,"method":"tools/list"}` raw → aparece en Tráfico como call + respuesta emparejada.

**Commit:**

```bash
git add src/renderer/components/tabs/RawTab.tsx
git commit -m "feat: raw json-rpc + session tab"
```

---

## Task 12: Cleanup + polish final

**Objective:** Borrar código muerto, pulir estados hover/focus/empty, y verificación completa end-to-end.

**Files:**
- Delete: `src/renderer/components/ServerPanel.tsx`, `src/renderer/components/ClientPanel.tsx`, `src/renderer/components/LogList.tsx`, `src/renderer/styles.css`
- Modify: `src/renderer/index.tsx` (quitar import de `styles.css`)
- Modify: `src/renderer/components/ConnectionPanel.tsx` (si quedaron detalles del Task 7)

**Steps:**

1. `git rm src/renderer/components/ServerPanel.tsx src/renderer/components/ClientPanel.tsx src/renderer/components/LogList.tsx src/renderer/styles.css`
2. Quitar `import './styles.css'` de `index.tsx`.
3. Revisar con `grep -rn "styles.css\|LogList\|ServerPanel\|ClientPanel" src/` que no queden referencias.
4. Polish pass (visuales, Tailwind):
   - `focus-visible:ring-1 ring-accent` en botones e inputs interactivos.
   - Empty states consistentes (mismo componente `Empty` — extraer a `components/tabs/Empty.tsx` y reutilizar si conviene).
   - Truncate de methods largos en TxRow (ya está) + `title` tooltip con el nombre completo.
5. **Verificación completa:**

```bash
npm test
npm run build
```

6. **Smoke test end-to-end** (cerrar instancia vieja primero):

```bash
npm start
```

Checklist manual:
- [ ] App abre con GitHub-dark idéntico al actual (tokens).
- [ ] Sidebar: seleccionar/editar/agregar/eliminar server y client; presets no eliminables.
- [ ] Start everything-server → handshake visible en Tráfico como calls (initialize/initialized) + notif.
- [ ] Discovery automático: badges con conteo en tabs Tools/Recursos/Prompts.
- [ ] Tools: form de `echo` con campo message → Ejecutar → resultado + tx en Tráfico con duración.
- [ ] Tool con enum (p.ej. anything de everything-server) renderiza select.
- [ ] Resources: read un resource → contents en ResultCard.
- [ ] Prompts: get con argument → messages en ResultCard.
- [ ] Raw: enviar tools/list raw → tx emparejada en Tráfico.
- [ ] Filtros + búsqueda + limpiar en Tráfico; auto-scroll sigue nuevas tx si estás abajo.
- [ ] Stop server → statusbar muestra `signal SIGTERM` (no `exit code=null` — bug fixeado).
- [ ] Export/import sesión funciona desde RawTab.

Opcional (si Hermes desktop con auxiliary.vision disponible): capturar la ventana con `computer_use` (mode=vision) para verificar visualmente el layout y pegar hallazgos en el PR/commit final.

7. **Commit:**

```bash
git add -A
git commit -m "chore: remove legacy 3-column ui, final polish"
```

---

## Tests / Validation resumen

| Qué | Comando | Expected |
|---|---|---|
| Unit (puras) | `npm test` | parser + transactions + schemaForm, todo pass |
| Typecheck renderer | `npx tsc -p tsconfig.renderer.json --noEmit` | sin errores |
| Build full | `npm run build` | main + preload + renderer exitosos |
| Smoke E2E | `npm start` + checklist del Task 12 | todos los checks |

## Riesgos / Tradeoffs / Open questions

- **Tailwind v4 usa un binary nativo (oxide)** — si falla en este Windows con Node 22, fallback: `tailwindcss@3.4` + `postcss` + `autoprefixer` + `tailwind.config.js` clásico (mismos tokens). Detectarlo en Task 1 (build falla al importar).
- **Coexistencia CSS transitoria** (Tasks 1-12): el preflight de Tailwind resetea elementos; `styles.css` usa clases así que mayormente gana, pero puede haber glitches visuales menores hasta el Task 12. Aceptable — no intentar arreglar los intermedios.
- **Discovery agrega 1-3 tx al tráfico al conectar** — es correcto para un inspector MITM (se ve el handshake + discovery en la timeline). Si molesta, gate tras checkbox en futuro.
- **`nextCursor` de tools/list (paginación)** — ignorado (primera página). Futuro: botón "cargar más".
- **Limpiar Tráfico** solo vacía el renderer; `sessionEntries` del main mantiene todo para export. Decisión: export preserva la sesión completa (documentar en tooltip del botón Limpiar). Open question si se quiere un "clear" real en main (nuevo IPC `session:clear`).
- **No soportado todavía** (YAGNI, futuros): `resources/subscribe`, `completion/complete`, sampling/roots desde el server (s2c requests sí se agrupan bien en la timeline, pero no hay UI para responderlas — es read-only MITM, correcto).
- **`confirm()` nativo** para deletes — en Electron funciona, pero un dialog custom sería más pro. Futuro.
- **Auto-start en selección** (lógica actual de App.tsx:212-222) se conserva tal cual — verificar que sigue disparando con el nuevo shell.