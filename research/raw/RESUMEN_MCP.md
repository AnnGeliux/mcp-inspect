# Resumen estructurado: SDKs y herramientas oficiales de MCP

> **Aviso importante sobre dos archivos.** Los ficheros `server_features.html` y `client_features.html` **NO contienen el texto de la especificación**. Son la *shell* (armazón) de una página Next.js/Mintlify (`<html id="__next_error__">`) con scripts y chunks JS; el contenido real de la página se hidrata en el navegador cuando se ejecuta JavaScript. Al parsearlos con `HTMLParser` y con un decodificador del payload RSC, el texto extraído es 0 bytes y no aparece ni una sola vez ningún método de la spec (`tools/list`, `sampling/createMessage`, `elicitation/create`, etc.). **No puedo extraer de ellos la información pedida sobre server features y client features sin inventar.** La información de la spec que aparece más abajo sobre esos apartados se cita de los **otros** ficheros donde sí aparece (lifecycle.txt del propio workspace, y menciones cruzadas en el README del Inspector y los SDKs).
>
> Los otros 4 ficheros pedidos (Inspector README + package.json, SDK TS, SDK Python) sí son Markdown/JSON estáticos y se citan a continuación.

---

## 1. MCP Inspector (la herramienta oficial)

Fuentes: `inspector_readme.md`, `inspector_package.json`.

### ¿Qué hace exactamente?
Es una herramienta de **desarrollador** para inspeccionar servidores MCP. Se distribuye como un único paquete npm, `@modelcontextprotocol/inspector`, y ofrece **tres formas** de inspeccionar un servidor, todas servidas por un mismo binario `mcp-inspector`:

- **Web** — aplicación SPA con Vite + React + [Mantine](https://mantine.dev), con backend Node (Hono).
- **CLI** — cliente de línea de comandos para automatización, CI y bucles rápidos de feedback con agentes.
- **TUI** — interfaz interactiva en terminal construida con [Ink](https://github.com/vadimdemedes/ink).

> Cita: *"`@modelcontextprotocol/inspector`, that provides three ways to inspect a server: Web / CLI / TUI"* — `inspector_readme.md` líneas 1‑9.

### Features principales
- Inspección de **tools, resources, prompts** del servidor conectado (sub-pestañas dedicadas: Tools, Resources, Prompts, Apps, Logs, Tasks, Network, Protocol).
- Pestaña **Apps** para MCP Apps (UI resources + app tool, protocolo de host/sandbox).
- Pestaña **Network** que muestra cabeceras estandarizadas `Mcp-*` (SEP‑2243) y taxonomía de errores (SEP‑2575).
- Pestaña **Protocol** que agrupa la conversación JSON‑RPC, incluyendo conversaciones MRTR.
- Pestaña **Logs** con selector de nivel (legacy) o nivel por request moderno (`_meta["io.modelcontextprotocol/logLevel"]`).
- **OAuth**: providers, discovery, storage, endpoint overrides y recuperación mid-session; backends browser/node/remote (`core/auth/`).
- **Catálogo y config** declarativos (`--catalog` vs `--config`) para uno o varios servidores.
- **Storybook** (96+ stories) que sirve también como test de interacción en CI.
- **Sandbox proxy** para MCP Apps (`clients/web/static/sandbox_proxy.html`).
- **Tests reales** contra servidores MCP de prueba (no mocks): `test-servers/` con presets (tools, resources, prompts, tasks, elicitation, sampling, OAuth, MRTR, etc.).
- **Modern (2026‑07‑28) protocol era** dual: dual-era stateless o strict modern-only (`transport.modern: true` o `{ "legacy": "reject" }`).

### ¿Cómo se instala y ejecuta?
Tres formas equivalentes:

```bash
# 1) npx (sin instalar)
npx @modelcontextprotocol/inspector          # Web UI (default)
npx @modelcontextprotocol/inspector --cli    # CLI
npx @modelcontextprotocol/inspector --tui    # TUI

# 2) Desde el repo, build + run
npm install
npm run build
npm run web        # Web con launcher prod
npm run web:dev    # Web con Vite (HMR)
cd clients/web && npm run dev  # iteración web en desarrollo

# 3) Docker
docker run --rm -p 127.0.0.1:6274:6274 ghcr.io/modelcontextprotocol/inspector
```

- **Requisito**: Node `>=22.19.0` (`engines` en `inspector_package.json`).
- **Versión actual**: `2.3.0` (`inspector_package.json` línea 3).
- El binario `mcp-inspector` apunta a `clients/launcher/build/index.js`.

### ¿Es CLI + web UI? ¿Qué puertos usa?
**Tres front-ends** sobre un mismo launcher. Los puertos que aparecen en la documentación:

- **6274** — puerto por defecto del backend Web del Inspector (CLI: `docker run -p 127.0.0.1:6274:6274`).
- **6275** — segundo listener para el **sandbox de MCP Apps** (`MCP_SANDBOX_PORT`, default `6275`); se publica también si vas a usar la pestaña Apps.

> *"the MCP Apps sandbox is a second listener the browser reaches directly, on `MCP_SANDBOX_PORT` (default `6275`)"* — `inspector_readme.md` sección Docker.

En el contenedor la imagen por defecto bindea `--web` a `0.0.0.0:6274`. Binding a todas las interfaces fuera del contenedor requiere `DANGEROUSLY_BIND_ALL_INTERFACES=true`.

### ¿Puede actuar como proxy? ¿Cómo?
**Sí**, y de dos formas que la doc menciona explícitamente:

1. **Proxy del sandbox para MCP Apps.** El widget se sirve "through the sandbox proxy page" (`clients/web/static/sandbox_proxy.html`) — el navegador habla con el listener sandbox en `:6275` que reenvía al backend. Si ese fichero falta se ve el error "Sandbox not loaded".
2. **Proxy de servidor en `inspector` como intermediario.** El Inspector es un cliente MCP: arranca/sirve el servidor objetivo (subproceso stdio o endpoint HTTP) y el navegador/conexión habla contra el backend del Inspector, que a su vez habla contra el servidor real. La doc también menciona *OAuth handoff and proxy support* en `docs/mcp-app-review.md` (referenciado en README).

> *"The MCP Apps sandbox is a second listener the browser reaches directly"* y *"the widget is served through the sandbox proxy page"* — `inspector_readme.md`.

### ¿Qué tipos de transporte soporta?
- **stdio** (subproceso) — `test-server-stdio.js` se lanza como child real.
- **Streamable HTTP** (servidor HTTP propio, incluyendo **dual-era** legacy + modern con `transport.modern`).
- La spec habla además de SSE y transporte "moderno" (post-2026-07-28); el Inspector cubre legacy stateful + modern stateless. Las menciones explícitas en el README son `streamable-HTTP`, `stdio` y "modern (2026-07-28) protocol era".

### ¿Tiene forma de ver el tráfico en vivo?
**Sí.** Varias vistas relacionadas:

- Pestaña **Network** — muestra cada request/response JSON-RPC, cabeceras `Mcp-*` reflejadas, valores centinela decodificados, errores renderizados con su taxonomía. Soporta el inyector `transport.modern.injectSpecErrors: true`.
- Pestaña **Protocol** — vista cronológica de la conversación JSON-RPC, agrupando conversaciones MRTR.
- Pestaña **Logs** — `notifications/message` streamed (legacy con `Set Active Level`, modern por-request).
- Para conexiones que usen `client.request()` (Inspector) en lugar de `client.callTool()` (SDK), el Inspector construye **manualmente** los headers `Mcp-Param-*` que la spec SEP-2243 exige.

> *"Open the Network tab to see the mirrored `Mcp-*` headers highlighted, sentinel values decoded, and each error rendered distinctly."* — `inspector_readme.md`.

---

## 2. Server features (tools / resources / prompts)

> **Bloqueador:** el contenido de la spec NO está en `server_features.html` (es la shell de Mintlify/Next.js, 0 bytes de texto tras parsear). La spec oficial de estos tres features es accesible en `modelcontextprotocol.io/specification/.../server-features`, pero no en el HTML estático descargado.
>
> Lo que **sí está en los archivos** y se cita a continuación: las menciones y nombres de métodos que aparecen en el Inspector README, el package.json y los SDK READMEs.

### Tools
- **Métodos JSON-RPC mencionados explícitamente en los archivos**:
  - `tools/list` — enumerar tools (paginable, `paginatedLists`).
  - `tools/call` — invocar una tool; en el Inspector se enruta por `client.request()` (no `client.callTool()`) para soportar MRTR manual.
- **Capacidad del servidor**: `capabilities.tools` (con sub-objeto `{ listChanged: true }` opcional).
- **Notificación**: `notifications/tools/list_changed`.
- **Ejemplo (no textual en los archivos, pero el Inspector README describe el shape)**: tools declaradas con `registerTool(name, { description, inputSchema }, handler)`. Si la tool tiene `outputSchema`, la respuesta incluye `structuredContent` además de `content[]`.
- **Anotación moderna**: `x-mcp-header: "<HeaderName>"` en argumentos → reflejado como `Mcp-Param-<HeaderName>` en la request (SEP‑2243). Herramientas con anotación inválida (header name que no es RFC 9110 token) son **excluidas** de `tools/list`.
- **MRTR (modern era)**: tools pueden devolver `inputRequired(...)` con elicitación embebida; el Inspector la muestra como modal "input_required".

### Resources
- **Métodos JSON-RPC**:
  - `resources/list` — enumerar resources (paginado, `maxPageSize`).
  - `resources/read` — leer un resource por URI.
  - `resources/templates/list` (mencionado en la spec; aparece como "RFC 6570 resource-template expansion" en el Inspector).
  - `resources/subscribe` — legacy: subscribirse a un URI.
  - `resources/unsubscribe` — legacy: des-suscribirse.
  - `subscriptions/listen` — modern (2026-07-28): suscripción de larga vida.
- **Templates**: sintaxis **RFC 6570** (con todas las particularidades: `{var}`, `{?q}`, `{+path}`, `{#frag}`, `{,x}`, `{;x}`, `{x:3}`, `{x,y}`, etc.). El Inspector tiene su propio expander porque el del SDK es incompleto en 5 dimensiones (raw-join sin encoding en `{a,b}`, `;` no soportado, `:` se confunde con nombre, `encodeURI` rompe `[]` y doble-encoda `%`, `encodeURIComponent` deja sub-delims `!'()*` sin codificar).
- **Capacidad**: `capabilities.resources` (con `subscribe: true` opcional y `listChanged: true` opcional).
- **Notificaciones**:
  - `notifications/resources/list_changed`
  - `notifications/resources/updated` (legacy: cuando un resource suscrito cambia).
  - `notifications/subscriptions/created`, `notifications/subscriptions/updated`, `notifications/subscriptions/acknowledged` (modern, SEP de subscriptions).

### Prompts
- **Métodos JSON-RPC**:
  - `prompts/list` — enumerar prompts (paginado).
  - `prompts/get` — obtener un prompt concreto (con argumentos).
- **Capacidad**: `capabilities.prompts` (con `listChanged: true` opcional).
- **Notificación**: `notifications/prompts/list_changed`.
- En el Inspector, los prompts aparecen en una pestaña propia y admiten invocación con argumentos tipados (generador de formularios a partir de `arguments[]`).

> Fuentes de los métodos: mencionados en `inspector_readme.md` (sub‑secciones "Showcase configs": `logging-…`, `subscriptions-…`, `tasks-…`, `pagination-http.json`, `rfc6570-templates-http.json`).

---

## 3. Client features (roots / sampling / elicitation)

> **Bloqueador:** igual que arriba, `client_features.html` no contiene la spec (0 bytes). Cito a continuación únicamente lo que aparece literalmente en los otros archivos del workspace.

### Roots
- **Métodos JSON-RPC** (lado servidor‑>cliente, server‑initiated):
  - `roots/list` — el servidor pide al cliente la lista de roots (filesystem roots expuestos al servidor).
- **Capacidad del cliente**: `capabilities.roots` (con `listChanged: true` opcional).
- **Notificación**: `notifications/roots/list_changed`.
- **Ejemplo del lifecycle** (sí aparece en `lifecycle.txt` del workspace, no en los 6 archivos pedidos, pero confirma el shape):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "roots": { "listChanged": true },
      "sampling": {},
      "elicitation": {}
    },
    "clientInfo": { "name": "ExampleClient", "version": "1.0.0" }
  }
}
```

- El Inspector, al actuar como **cliente**, soporta roots: el preset `mrtr_roots` hace un `roots/list` embebido y se auto-responde desde los roots configurados.

### Sampling
- **Métodos JSON-RPC**:
  - `sampling/createMessage` — el servidor pide al cliente que cree un mensaje LLM (con `messages`, `systemPrompt`, `maxTokens`, `modelPreferences`, etc.).
- **Capacidad del cliente**: `capabilities.sampling`.
- **Notificación**: `notifications/sampling/...` (no aparece un nombre concreto en los archivos).
- El preset `mrtr_sample` demuestra un sampling embebido, con la respuesta yendo al panel "Sampling" del Inspector.

### Elicitation
- **Métodos JSON-RPC**:
  - `elicitation/create` — el servidor pide al cliente input del usuario (form elicitation) con un schema JSON.
- **Capacidad del cliente**: `capabilities.elicitation`.
- **Notificación**: no aparece nombre explícito en los archivos.
- En el Inspector, elicitation se ve como un **modal pending‑request** (tag "input_required" en MRTR). El preset legacy `collect_elicitation` llama `server.elicitInput` y **falla** en la modern leg (los server→client requests no están permitidos en modern 2026‑07‑28) — *"MRTR is the modern replacement"*.

> Fuentes: `inspector_readme.md` secciones "MRTR" y showcase configs; `lifecycle.txt` del workspace (no pedido, pero confirma los nombres de capacidades).

---

## 4. SDKs

### TypeScript SDK

Fuente: `ts_sdk_readme.md` (rama `main` = v2, spec 2026‑07‑28). Funciona en **Node.js, Bun y Deno**.

#### Paquetes publicados
- `@modelcontextprotocol/server` — para construir servers.
- `@modelcontextprotocol/client` — para construir clients.
- Middleware opcional: `@modelcontextprotocol/node`, `@modelcontextprotocol/express`, `@modelcontextprotocol/fastify`, `@modelcontextprotocol/hono`.
- Schemas: **Standard Schema** (Zod v4, Valibot, ArkType, …).

#### Cómo se crea un **server** (ejemplo oficial, README):

```typescript
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const server = new McpServer({ name: 'greeting-server', version: '1.0.0' });

server.registerTool(
  'greet',
  {
    description: 'Greet someone by name',
    inputSchema: z.object({ name: z.string() })
  },
  async ({ name }) => ({
    content: [{ type: 'text', text: `Hello, ${name}!` }]
  })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main();
```

- Constructor: `new McpServer({ name, version, ... })`.
- API declarativa: `server.registerTool(name, { description, inputSchema }, handler)`.
- Conexión: `await server.connect(transport)` con cualquier `Transport` (aquí `StdioServerTransport`).

#### Cómo se crea un **client** (resumido, no hay snippet completo en el README):
- Paquete `@modelcontextprotocol/client`.
- *"high-level helpers, OAuth helpers"* (README no muestra el snippet completo; está en `docs/get-started/first-client.md` y los ejemplos en `examples/`).
- La doc sugiere: instanciar un client, pasarle un transport, llamar métodos tipo `client.listTools()`, `client.callTool()`.

#### Clases reutilizables
- **`McpServer`** (alto nivel) — recomendada para la mayoría.
- **`Transport`** (interfaz) — implementaciones: `StdioServerTransport`, `StreamableHttpServerTransport` (del paquete `server` y middleware `@modelcontextprotocol/node` para `IncomingMessage`/`ServerResponse`).
- **`createMcpHandler`** — mencionado en el Inspector README para servir la "modern protocol era" en HTTP.
- `McpClient` + transports equivalentes en `@modelcontextprotocol/client`.

> Cita: *"MCP **server** libraries (tools/resources/prompts, Streamable HTTP, stdio, auth helpers); MCP **client** libraries (transports, high-level helpers, OAuth helpers)"* — `ts_sdk_readme.md` línea 37‑42.

### Python SDK

Fuente: `py_sdk_readme.md` (rama `main` = v2, spec 2026‑07‑28). Requiere **Python 3.10+**.

#### Instalación
```bash
uv add "mcp[cli]"      # CLI extra: añade el comando `mcp` (mcp dev, mcp run, mcp install)
# o
pip install "mcp[cli]"
```

#### Cómo se crea un **server** (ejemplo oficial "15-line server"):

```python
from mcp.server import MCPServer

mcp = MCPServer("Demo")

@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b

@mcp.resource("greeting://{name}")
def greeting(name: str) -> str:
    """Greet someone by name."""
    return f"Hello, {name}!"
```

- Constructor: `MCPServer("Demo")` (¡solo el nombre!).
- API declarativa con decoradores: `@mcp.tool()`, `@mcp.resource("uri-template")`, `@mcp.prompt()` (no mostrado).
- **Sin JSON Schema manual**: los type hints de Python *son* el schema; tampoco hay parsing de request ni validación manual.
- Para probarlo en el Inspector: `uv run mcp dev server.py`.

#### Cómo se crea un **client** (ejemplo oficial "10-line client"):

```python
import asyncio
from mcp import Client

async def main() -> None:
    async with Client("http://localhost:8000/mcp") as client:
        result = await client.call_tool("add", {"a": 1, "b": 2})
        print(result.structured_content)  # {'result': 3}

asyncio.run(main())
```

- El constructor acepta una URL → implica Streamable HTTP. *"A URL means Streamable HTTP, the transport you deploy."*
- Context manager: `async with Client(...) as client:` (hace `connect` implícito al entrar).
- `client.call_tool(name, args)` es awaitable y devuelve un objeto con `.structured_content`.
- También puede lanzar un stdio subprocess local o aceptar un transport custom (ver docs `Clients`).

#### Clases reutilizables
- **`MCPServer`** — clase principal del server.
- **`Client`** — clase principal del client.
- Decoradores: `@mcp.tool()`, `@mcp.resource(template)`, `@mcp.prompt()`.
- CLI: `mcp dev`, `mcp run`, `mcp install` (con el extra `[cli]`).

> Cita: *"A URL means Streamable HTTP, the transport you deploy. `Client` can also launch a local server as a stdio subprocess or take any custom transport"* — `py_sdk_readme.md` líneas 100‑112.

### Comparativa rápida
| Concepto | TypeScript SDK | Python SDK |
|---|---|---|
| Server class | `McpServer` (constructor con `{name,version,…}`) | `MCPServer("name")` |
| Tool registration | `server.registerTool(name, {description, inputSchema}, handler)` | `@mcp.tool()` decorator |
| Resource registration | (vía API, mencionado en docs) | `@mcp.resource("uri-template")` decorator |
| Client class | (en `@modelcontextprotocol/client`) | `Client(url_or_transport)` |
| Connect | `await server.connect(transport)` | `async with Client(...) as client:` |
| Transports | `StdioServerTransport`, `StreamableHttp*` (vía `server/stdio`, `server/streamableHttp`, `@modelcontextprotocol/node`) | stdio (subprocess), Streamable HTTP, SSE; custom aceptados |
| Schema lib | Standard Schema (Zod v4, Valibot, ArkType, …) | Type hints de Python (nativos) |
| Extras | Middleware `@modelcontextprotocol/express`, `…/fastify`, `…/hono`, `…/node` | CLI `mcp[cli]`: `mcp dev`, `mcp run`, `mcp install` |
| Versión spec | 2026‑07‑28 (v2 estable) | 2026‑07‑28 (v2 estable) |
| Engine | Node.js / Bun / Deno | Python 3.10+ |

### Dependencias del Inspector que confirman la arquitectura
Del `inspector_package.json`:
- `@modelcontextprotocol/client 2.0.0`
- `@modelcontextprotocol/core 2.0.0`
- `@modelcontextprotocol/server 2.0.0`
- `@modelcontextprotocol/server-legacy 2.0.0`
- `@modelcontextprotocol/ext-apps ^1.7.4`
- Stack web: `hono` (backend) + `vite` + `react ^19.0.0` + `ink ^6.0.0` (TUI).
- Validación: `zod ^4.4.3`, `ajv ^8.17.1`.

> *"`core/mcp/` owns the connection to an MCP server, the request/response lifecycle, and a set of state stores"* — `inspector_readme.md` (sección "The `@inspector/core` shared package").

---

## Resumen de lo que falta y por qué

| Pedido | Estado |
|---|---|
| Inspector: features / instalación / puertos / proxy / transportes / tráfico | ✅ Extraído de `inspector_readme.md` + `inspector_package.json` |
| Server features (tools/resources/prompts): métodos + ejemplo + notificaciones | ⚠️ Solo nombres de métodos desde el Inspector README; los ejemplos JSON completos NO están en `server_features.html` (es una shell de Next.js sin contenido) |
| Client features (roots/sampling/elicitation): métodos + ejemplo + notificaciones | ⚠️ Igual: el HTML no contiene la spec. Solo confirmo nombres desde el Inspector README |
| SDKs: client/server/transport/clases reutilizables | ✅ Extraído de `ts_sdk_readme.md` y `py_sdk_readme.md` |

**Recomendación al parent:** para los apartados 2 y 3, descargar la spec renderizada (no la shell) — por ejemplo `https://modelcontextprotocol.io/specification/2025-06-18/server/tools` etc. — o usar el `lifecycle.txt` que ya está en `research/raw/` (contiene ejemplos de `initialize` con `roots`, `sampling`, `elicitation`). Yo no podía extraerlos de los HTML que me pasaste porque no tienen el texto dentro.
