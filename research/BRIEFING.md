# MCP Inspector — Briefing Técnico Consolidado

> Documento de referencia derivado de la spec oficial de MCP (2025-06-18), el Inspector oficial y los SDKs de TS/Python.
> Citas: `[transports]`, `[lifecycle]`, `[features]`, `[inspector]`, `[sdk-ts]`, `[sdk-py]`.
> Fuentes raw en `research/raw/`; resúmenes intermedios en `research/{transports_summary.md, raw/RESUMEN_MCP.md, raw/FEATURES_SPEC_RESUMEN.md}`.

---

## 1. ¿Qué es MCP?

**Model Context Protocol (MCP)** es un protocolo abierto basado en JSON-RPC 2.0 que estandariza la integración entre aplicaciones LLM (hosts) y servidores externos que exponen **tools** (funciones invocables), **resources** (datos leíbles) y **prompts** (plantillas). El cliente MCP vive dentro del host; el servidor MCP expone capacidades. `[transports] [architecture]`

### Actores
- **Host** — la aplicación LLM (Claude Desktop, Cursor, IDE…)
- **MCP Client** — vive en el host, conecta con uno o varios servers vía MCP
- **MCP Server** — proceso externo que expone tools/resources/prompts

### Primitivas (server-side)
| Feature | Capability key | Métodos JSON-RPC | Notificaciones |
|---|---|---|---|
| **Tools** | `tools: { listChanged }` | `tools/list`, `tools/call` | `notifications/tools/list_changed` |
| **Resources** | `resources: { subscribe, listChanged }` | `resources/list`, `resources/read`, `resources/templates/list`, `resources/subscribe`, `resources/unsubscribe` | `notifications/resources/list_changed`, `notifications/resources/updated` |
| **Prompts** | `prompts: { listChanged }` | `prompts/list`, `prompts/get` | `notifications/prompts/list_changed` |
| (modern) | `subscriptions/listen` | (long-lived) | `subscriptions/created`, `updated`, `acknowledged` |

### Primitivas (client-side, server-initiated)
| Feature | Capability key | Método server→client | Notificaciones |
|---|---|---|---|
| **Roots** | `roots: { listChanged }` | `roots/list` | `notifications/roots/list_changed` |
| **Sampling** | `sampling: {}` | `sampling/createMessage` | — |
| **Elicitation** | `elicitation: {}` | `elicitation/create` | — |

**Importante:** "Tools/Resources/Prompts los expone el server, Roots/Sampling/Elicitation los expone el client". Esto es clave para visualizar quién inicia cada mensaje en el log. `[features]`

---

## 2. Transportes — lo crítico para el MITM

### 2.1 STDIO

- **El cliente lanza el server como subprocess** y se comunica por `stdin`/`stdout`. `[transports]`
- **Framing:** JSON-RPC 2.0, **newline-delimited** (un JSON object por línea terminada en `\n`). NO embedded newlines, NO length-prefix, NO CRLF. `[transports]`
- **Stderr** es canal libre para logs del server (UTF-8). El cliente decide si capturar/forward/ignore. NO es parte del canal MCP.
- **MUST NOTs del spec:** "Server MUST NOT write anything to its stdout that is not a valid MCP message". Cualquier log a stdout rompe el framing.
- **Shutdown:** EOF en stdout = fin de sesión. Sin mensaje de shutdown en el wire.
- **Windows:** el spec no lo menciona. Implicación práctica — usar stdin/stdout en **binary mode** para preservar `\n` puro (los SDKs ya lo hacen).

### 2.2 Streamable HTTP

> "Replaces the HTTP+SSE transport from protocol version 2024-11-05." `[transports]`

- **Un único endpoint HTTP** que soporta tres métodos:
  - **POST** — cliente→server (uno o más mensajes JSON-RPC). Headers: `Accept: application/json, text/event-stream`.
  - **GET** — abre stream SSE para server-push. Header: `Accept: text/event-stream`.
  - **DELETE** — cerrar sesión (si el server lo soporta).
- **Respuestas bimodales:** el server responde con `Content-Type: application/json` (objeto único) o `text/event-stream` (stream request-scoped). El cliente **debe** soportar ambos.
- **Headers importantes:**
  | Header | Dirección | Significado |
  |---|---|---|
  | `Mcp-Session-Id` | bidireccional | ID de sesión (post-init) |
  | `MCP-Protocol-Version` | cliente→server | Versión (ej. `2025-06-18`) |
  | `Last-Event-ID` | cliente→server (GET) | Cursor para resumability (per-stream) |
  | `Origin` | cliente→server | Validación obligatoria anti DNS-rebinding |
- **Session lifecycle:** server asigna `Mcp-Session-Id` en la respuesta al `initialize`. Cliente debe reenviarlo. 404 con session ID → nueva init sin session.
- **SSE events:** cada evento puede llevar `id` propio (per-stream). Permite resumability via `Last-Event-ID`.
- **Notifications server→client:** van por SSE stream (POST response SSE o GET stream standalone).
- **Auth:** spec solo dice "implementar autenticación adecuada". Bearer, OAuth, API keys viven en headers HTTP estándar.

### 2.3 Lifecycle

- **`initialize`** request con `protocolVersion`, `capabilities`, `clientInfo`. El server responde con sus capabilities.
- **`notifications/initialized`** (sin id) — el cliente confirma que está listo.
- **`tools/list`, `resources/list`, `prompts/list`** — el cliente descubre capacidades.
- **`tools/call`, `resources/read`, `prompts/get`, etc.** — operación normal.
- **Sin mensaje de shutdown** — fin por cierre de transporte.

---

## 3. Inspector oficial (referencia)

`@modelcontextprotocol/inspector` v2.3.0. Stack: **Hono (backend) + Vite + React 19 + Mantine (web)**, Ink (TUI), Commander (CLI). Node ≥22.19.0.

### Tres modos
- **Web** (default) — SPA React
- **CLI** — para CI/automatización
- **TUI** — Ink interactivo

### Puertos
- **6274** — backend web (default)
- **6275** — sandbox para MCP Apps

### Transportes soportados
- `stdio` (subprocess)
- Streamable HTTP (incluye **dual-era**: legacy + modern con `transport.modern`)
- Legacy SSE para retrocompatibilidad

### Vistas relacionadas con tráfico
- **Network tab** — cada request/response JSON-RPC con headers `Mcp-*` reflejados, valores centinela decodificados, taxonomía de errores (SEP-2575).
- **Protocol tab** — vista cronológica JSON-RPC agrupando conversaciones MRTR.
- **Logs tab** — `notifications/message` streamed (legacy o modern con `_meta["io.modelcontextprotocol/logLevel"]`).
- **OAuth** completo: providers, discovery, storage, endpoint overrides.

### Cómo actúa como proxy
El inspector **es un cliente MCP**: arranca el server (subprocess o endpoint HTTP) y el navegador habla contra el backend del inspector, que a su vez habla contra el server real. OAuth handoff + proxy support. `[inspector]`

**Para nuestro inspector MITM** — la diferencia clave es que **queremos ver el tráfico en crudo, no parsearlo e inyectarlo**. El inspector oficial hace un trabajo similar pero con el foco en "usar el server", no en "ver qué pasa".

---

## 4. SDKs

### TypeScript SDK v2 (spec 2026-07-28)
```typescript
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const server = new McpServer({ name: 'greeting-server', version: '1.0.0' });
server.registerTool('greet', { description: '...', inputSchema: z.object({...}) }, async (args) => ({...}));

const transport = new StdioServerTransport();
await server.connect(transport);
```
- Paquetes: `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, middleware `@modelcontextprotocol/{node,express,fastify,hono}`.
- Schemas: Standard Schema (Zod v4, Valibot, ArkType).

### Python SDK v2 (spec 2026-07-28)
```python
from mcp.server import MCPServer
mcp = MCPServer("Demo")

@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b

# Cliente
import asyncio
from mcp import Client
async def main():
    async with Client("http://localhost:8000/mcp") as client:
        result = await client.call_tool("add", {"a": 1, "b": 2})
```
- Python 3.10+
- CLI: `mcp dev`, `mcp run`, `mcp install` (con extra `[cli]`)
- Cliente acepta URL (Streamable HTTP), stdio subprocess, o transport custom.

**Implicación para nuestro inspector:** si queremos reusar código de transporte, **Python SDK** es ideal — la clase `Client` acepta URL directo, así que podemos apuntarla a nuestro proxy y leer de ella. Pero como queremos ser MITM genérico, mejor escribimos nuestro propio proxy en Node/Python sin acoplarnos a un SDK específico.

---

## 5. Mapa completo de mensajes JSON-RPC que veremos

### Cliente → Server (request/response)
- `initialize` (id=1) → `InitializeResult`
- `tools/list` (paginado) → `tools[]`
- `tools/call` → `result.content[]` o `error`
- `resources/list`, `resources/read`, `resources/templates/list`
- `resources/subscribe`, `resources/unsubscribe` (legacy)
- `prompts/list`, `prompts/get`
- `ping` (heartbeat)
- (modern) `subscriptions/listen`

### Server → Client (request/response, server-initiated)
- `roots/list` → `roots[]`
- `sampling/createMessage` → mensaje LLM
- `elicitation/create` → `{action: accept|decline|cancel, content?}`

### Notifications (sin id, sin respuesta)
- `notifications/initialized` (cliente→server)
- `notifications/tools/list_changed`
- `notifications/resources/list_changed`, `notifications/resources/updated`
- `notifications/prompts/list_changed`
- `notifications/roots/list_changed`
- `notifications/cancelled` (cancelar un request pendiente)
- `notifications/progress` (larga operación)
- `notifications/message` (logging legacy)

---

## 6. Implicaciones de diseño para el inspector

### STDIO MITM
- **Capturar:** spawn del subprocess con stdin/stdout en **binary mode**.
- **Parsear:** un objeto JSON por línea, `\n` como delimitador.
- **Identificar:** campo `id` para correlación request/response; notifications sin id.
- **Capturar stderr por separado** — no es MCP pero es útil para debug.
- **Cerrar:** EOF en stdout + exit code.

### HTTP MITM
- **Proxy transparente en localhost:puerto.**
- **Reenviar:** POST, GET, DELETE con headers `Mcp-Session-Id`, `MCP-Protocol-Version`, `Last-Event-ID`, `Origin`.
- **Decodificar respuestas bimodales:** `application/json` (objeto único) vs `text/event-stream` (parsear `data:` líneas como NDJSON).
- **Stream SSE GET:** mantener conexión abierta, log cada evento con su `id` y data.
- **Bearer headers:** enmascarar en UI pero reenviar tal cual.
- **Session management:** trackear `Mcp-Session-Id` por sesión lógica; reset en 404.

### Lifecycle detection
- Primer `id=1, method=initialize` → marcar inicio de sesión.
- Correlacionar `id=1` request con su response → extraer `protocolVersion`, `capabilities`, `serverInfo`, `clientInfo`.
- Esperar `notifications/initialized` (sin id).

---

## 7. Decisiones de stack (a validar contigo)

| Capa | Opción recomendada | Por qué |
|---|---|---|
| Lenguaje backend | **Node.js** (TypeScript) | Trivial spawn stdio, fetch/HTTP nativo, ecosystem ya está aquí con el Inspector oficial. Reutilizar libs. |
| Framework HTTP | **Hono** o **Express** | Hono es lo que usa el inspector oficial; ligero. |
| UI | **Electron** o **Tauri** | Tauri más ligero; Electron más maduro. |
| Render UI | **React** | Mismo stack que el inspector oficial, fácil mantener consistencia. |
| Persistencia | **SQLite** vía `better-sqlite3` (sync, simple) o **JSON files** | JSON suficiente para v1 read-only. |

> **Aún por decidir contigo antes de empezar a codear.** El stack se decide después de validar el plan de implementación.

---

## 8. Fases de implementación (propuesta)

### Fase 0 — Setup & diseño ✅ (en curso)
- Recabar información de spec ✅
- Boceto HTML del UI ✅

### Fase 1 — MVP STDIO MITM (1-2 días)
- Spawn de subprocess con binary mode stdin/stdout/stderr
- Parser NDJSON de stdout → log entries
- Reenviar stdin del client al proceso y stdout del proceso al client
- UI mínima: dos paneles (server/client) + log central cronológico
- Vista de árbol del JSON con resaltado de campos clave (`id`, `method`, `params`, `result`, `error`)
- Export/import JSON de la sesión

### Fase 2 — Streamable HTTP MITM (1-2 días)
- Servidor proxy HTTP en localhost (Hono)
- Reenvío POST con captura de headers
- Manejo de respuestas bimodales (JSON vs SSE)
- GET SSE standalone para server-push
- Session management (track `Mcp-Session-Id`)
- Soporte para auth headers (masked en UI)

### Fase 3 — Polish (1 día)
- Presets preconfigurados (everything-server + inspector como cliente)
- Vista de arquitectura (diagrama de capas)
- Filtros básicos (por método/dirección)

### Fase 4 — Extensibilidad (futuro, no en v1)
- Filtros avanzados, búsqueda, indicadores de duración, replay, etc.
- Soporte para HTTP+SSE legacy (2024-11-05)
- WebSocket

---

## 9. Out of scope v1 (confirmado contigo)

- ❌ Modificación de mensajes en vivo (read-only MITM)
- ❌ Replay de mensajes
- ❌ WebSocket
- ❌ Cross-platform (solo Windows)
- ❌ Auth (más allá de reenviar bearer headers enmascarados)

---

## Referencias

- Spec oficial: `https://modelcontextprotocol.io/specification/2025-06-18/`
- Conceptos: `https://modelcontextprotocol.io/docs/concepts/{architecture,transports,server-features,client-features}`
- Inspector oficial: `https://github.com/modelcontextprotocol/inspector`
- SDK TS: `https://github.com/modelcontextprotocol/typescript-sdk`
- SDK Python: `https://github.com/modelcontextprotocol/python-sdk`
