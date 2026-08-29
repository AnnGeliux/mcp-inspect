# Resumen del spec MCP enfocado en Transportes (para implementación de MITM)

**Archivos fuente**:
- `transports.html` — `/specification/2026-07-28/basic/transports` (Overview + base protocol)
- `transports/index.html` → `transports.txt` (extraído) — contiene las páginas detalladas `stdio` y `Streamable HTTP`
- `jsonrpc.html` → `jsonrpc.txt` — `/specification/2025-06-18/basic/jsonrpc` (mensajes JSON-RPC + base)
- `lifecycle.html` → `lifecycle.txt` — `/specification/2025-06-18/basic/lifecycle`

> **Nota sobre lo que el spec NO cubre** (relevante para MITM):
> - No se documentan aquí los argumentos exactos (`argv`), variables de entorno o formato de comando para lanzar el server stdio — eso vive en docs del SDK/Inspector, no en estos 3 archivos.
> - No hay consideraciones específicas de Windows (CRLF, line endings, paths). El spec habla de "newlines" en abstracto.
> - No se documentan los mecanismos de autenticación (Bearer, OAuth, API keys). El spec solo dice "implementar autenticación adecuada" y enlaza a una página separada `Authorization` que NO está en estos archivos.

---

## STDIO transport

### ¿Cómo se invoca el server? [transports.html]
- "**The client launches the MCP server as a subprocess.**" [transports.txt L54]
- El spec **no** define en estos archivos la sintaxis exacta de invocación (qué comando, qué `argv`, qué env vars). Solo establece la **relación proceso**: el cliente es padre, el server es hijo.
- Para un MITM implica: hay que **spawnear el proceso** y obtener acceso a sus `stdin`/`stdout` (no viene del spec cómo, eso es del SDK).

### ¿Cómo se comunican cliente y server? [transports.txt L54-74]
- El server **lee JSON-RPC messages de su stdin** y **escribe a su stdout**.
- Direcciones: cliente→server por stdin; server→cliente por stdout.
- No hay otra dirección de mensaje: "per the message patterns, servers do not initiate JSON-RPC requests and clients do not send JSON-RPC responses" [transports.html]
- Reglas estrictas:
  - "**The server MUST NOT write anything to its stdout that is not a valid MCP message.**" [transports.txt L70]
  - "**The client MUST NOT write anything to the server's stdin that is not a valid MCP message.**" [transports.txt L73]
  - Implicación para MITM: cualquier log/debug impreso a stdout **rompe** el framing. Solo stderr está permitido para logs.

### Framing de mensajes [transports.txt L61-63]
- "**Messages are individual JSON-RPC requests, notifications, or responses.**"
- "**Messages are delimited by newlines, and MUST NOT contain embedded newlines.**"
- Es decir: **newline-delimited JSON (NDJSON / JSON Lines)**, un mensaje JSON-RPC completo por línea.
- Un mensaje = un objeto JSON en una sola línea terminado en `\n`.
- Los mensajes JSON-RPC **deben ser UTF-8** [transports.txt L36, L47].
- El spec reitera: "the stdio binding is just newline-delimited JSON-RPC over a byte stream" [transports.html]

### ¿Qué pasa con stderr? [transports.txt L65-67]
- "**The server MAY write UTF-8 strings to its standard error (stderr) for logging purposes. Clients MAY capture, forward, or ignore this logging.**"
- stderr es **canal libre para logs** del server — el cliente decide qué hacer (capturar, redirigir, ignorar).
- Implicación MITM: stderr es tráfico observable por separado, **no es parte del canal MCP**. Un proxy puede capturar/inyectar ahí sin romper el framing (siempre que respete UTF-8).

### Identificación de mensajes [transports.txt L36, L61] + [lifecycle.txt L67-115]
- Los mensajes son **JSON-RPC 2.0** puros: la identificación se hace por el campo **`id`** del sobre JSON-RPC.
  - `request` → tiene `id` (string/number/null)
  - `notification` → NO tiene `id` (no espera respuesta)
  - `response` → tiene `id` (debe coincidir con el de la request original)
  - `error` → es una `response` con `error` en vez de `result`
- Ejemplo concreto del lifecycle: `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}` [lifecycle.txt L67-86]
- Implicación MITM: para correlacionar request/response basta con el `id`. Para reordenar o reinyectar es trivial parsear el `method` + `id` + `params`.

### Shutdown del transporte stdio [lifecycle.txt L246-263]
- **No hay mensaje de shutdown** en el wire — el cierre es a nivel de proceso.
- Cliente → server: cerrar stdin → esperar exit → `SIGTERM` → `SIGKILL` si no responde.
- Server → cliente: cerrar stdout y exit.
- Implicación MITM: el fin de sesión se detecta por **EOF en stdout** (y opcionalmente por el exit code del proceso).

### Consideraciones para Windows (extraídas del spec)
- **El spec no contiene ninguna mención a Windows**, CRLF, paths con backslash, ni particularidades del OS. Solo habla de "newlines" en abstracto.
- **Para un MITM en Windows esto significa**:
  - El framing es newline-delimited: si el server o el cliente convierte automáticamente `\n` → `\r\n` (modo text de Windows CRT), el JSON puede romperse.
  - En la práctica, los SDKs (Python, Node, etc.) abren stdin/stdout en **binary mode** para preservar `\n` puro.
  - El spec asume stream de bytes confiable; el detalle OS-específico queda para los implementadores.

---

## Streamable HTTP transport

> "This replaces the HTTP+SSE transport from protocol version 2024-11-05." [transports.txt L80-83]

### Endpoint único y métodos [transports.txt L85-94]
- El server expone **un solo endpoint HTTP** (llamado "MCP endpoint"), por ejemplo `https://example.com/mcp`.
- Soporta **tres métodos**:
  - **POST** — enviar mensajes JSON-RPC del cliente al server
  - **GET** — abrir un stream SSE para que el server envíe mensajes al cliente
  - **DELETE** — terminar la sesión (ver Session Management)

### Enviar mensajes al server (POST) [transports.txt L113-170]
- **Cada mensaje JSON-RPC** del cliente = **un nuevo HTTP POST** al MCP endpoint.
- **Body**: un único JSON-RPC request, notification o response (UTF-8).
- **Headers obligatorios del request**:
  - `Accept: application/json, text/event-stream` — el cliente debe declarar que soporta ambas respuestas.
- **Tres casos de respuesta del server**:

  1. **Si el body es una `response` o `notification`** (cliente → server, no espera respuesta inmediata):
     - Si el server acepta → **HTTP 202 Accepted** con **body vacío**.
     - Si rechaza → HTTP error (ej. **400 Bad Request**), body opcional con un JSON-RPC error sin `id`.

  2. **Si el body es una `request`** (cliente → server, espera respuesta):
     - El server responde con **uno de dos `Content-Type`**:
       - `Content-Type: text/event-stream` → abre un **SSE stream** (request-scoped)
       - `Content-Type: application/json` → devuelve **un único objeto JSON**
     - El cliente **debe soportar ambos** casos.

### SSE stream semantics (en respuesta a un POST) [transports.txt L145-170]
- El stream SSE **debería** incluir eventualmente el JSON-RPC `response` a la request original.
- El server **puede** enviar JSON-RPC requests y notifications adicionales **antes** del response final — "These messages SHOULD relate to the originating client request" (ej. progress notifications).
- El server **NO debe** cerrar el stream antes de mandar el response, salvo que la sesión expire.
- Después de enviar el `response`, el server **debería** cerrar el stream.
- **Desconexión ≠ cancelación**: si el stream se rompe, no asumir que el cliente canceló. El cliente debe enviar explícitamente `notifications/cancelled` (JSON-RPC) si quiere cancelar. [transports.html]

### Recibir mensajes del server (GET) [transports.txt L176-205]
- El cliente **puede** hacer un `HTTP GET` al MCP endpoint para abrir un SSE stream **sin necesidad de enviar nada antes** (server-push standalone).
- Header obligatorio: `Accept: text/event-stream`.
- Respuesta del server:
  - `Content-Type: text/event-stream` → SSE abierto
  - **HTTP 405 Method Not Allowed** → este server no ofrece stream GET
- En este stream, el server puede enviar JSON-RPC requests y notifications. **No debe** enviar responses (salvo que esté resumiendo un stream anterior).
- Tanto cliente como server pueden cerrar el stream en cualquier momento.

### Múltiples conexiones [transports.txt L207-216]
- El cliente **puede** mantener varios SSE streams simultáneos.
- El server **debe** enviar cada mensaje JSON-RPC en **uno solo** de los streams conectados (no broadcast).
- Riesgo de pérdida se mitiga haciendo el stream **resumable**.

### Resumability y redelivery [transports.txt L219-246]
- Los servers **pueden** adjuntar un campo `id` a sus eventos SSE (idéntico al campo `id:` del estándar SSE).
- **El `id` debe ser globalmente único** dentro de la sesión (o entre todos los streams con ese cliente, si no hay session management).
- Si el cliente quiere **reanudar** una conexión rota:
  - Hace un `HTTP GET` al MCP endpoint con el header **`Last-Event-ID`** indicando el último evento recibido.
  - El server **puede** usar ese header para **replay de mensajes** posteriores al `Last-Event-ID`, en el mismo stream que se desconectó.
- **Restricción crítica**: el server **NO debe** reenviar mensajes que habrían ido a un stream diferente. Los IDs son **cursores por stream**, no globales.
- Implicación MITM: el `Last-Event-ID` es un cursor confiable para reproducir el tráfico; si se captura, se puede reanudar la sesión suplantando al cliente.

### Session Management [transports.txt L250-293]
- Una "sesión MCP" = interacciones lógicamente relacionadas cliente↔server, empezando por la inicialización.
- El server **puede** asignar un session ID durante la inicialización, incluyéndolo en el header **`Mcp-Session-Id`** de la respuesta HTTP que contiene el `InitializeResult`.
- **Reglas del session ID**:
  - **SHOULD** ser globalmente único y criptográficamente seguro (UUID, JWT, hash criptográfico).
  - **MUST** contener solo caracteres ASCII visibles (rango `0x21` a `0x7E`).
- Una vez devuelto, **el cliente debe** incluir `Mcp-Session-Id` en **todos** sus requests HTTP siguientes.
- Si el server requiere session ID y recibe un request (no init) sin él → **HTTP 400 Bad Request**.
- Si el server termina la sesión → responde con **HTTP 404 Not Found** a requests con ese session ID.
- Si el cliente recibe `404` con `Mcp-Session-Id` → **debe** iniciar una nueva sesión enviando un nuevo `InitializeRequest` **sin** session ID.
- **Cierre de sesión por el cliente**: `HTTP DELETE` al MCP endpoint con `Mcp-Session-Id`.
- El server **puede** responder `HTTP 405 Method Not Allowed` si no permite que el cliente cierre la sesión.

### Protocol Version Header [transports.txt L301-319]
- El cliente **debe** incluir el header **`MCP-Protocol-Version: <protocol-version>`** en todos los requests HTTP siguientes al de inicialización.
- Ejemplo: `MCP-Protocol-Version: 2025-06-18`.
- Versión **debería** ser la negociada durante initialize.
- **Backwards compat**: si el server no recibe `MCP-Protocol-Version` y no tiene otra forma de identificar la versión (ej. por session ID), debe asumir `2025-03-26`.
- Si recibe un valor inválido/unsupported → **HTTP 400 Bad Request**.

### Backwards Compatibility con HTTP+SSE antiguo [transports.txt L323-359]
- Servers que quieran soportar clientes viejos (pre-2025-06-18) deben:
  - Hostear **ambos endpoints** (SSE y POST del viejo + MCP endpoint nuevo).
- Clientes que quieran soportar servers viejos deben:
  - Intentar `POST InitializeRequest` con `Accept` correcto al URL dado.
  - Si funciona → nuevo transport.
  - Si falla con 4xx (405, 404) → hacer `GET` esperando un evento SSE `endpoint` → asumir transport viejo.

### Headers importantes — resumen rápido para MITM

| Header | Dirección | Significado |
|---|---|---|
| `Accept: application/json, text/event-stream` | Cliente→Server (POST/GET) | Capacidades aceptadas de respuesta |
| `Accept: text/event-stream` | Cliente→Server (GET) | Apertura de stream SSE server-push |
| `Content-Type: application/json` | Server→Cliente | Respuesta JSON única |
| `Content-Type: text/event-stream` | Server→Cliente | Respuesta SSE stream |
| `Mcp-Session-Id` | Bidireccional | Identificador de sesión (post-init) |
| `MCP-Protocol-Version` | Cliente→Server | Versión del protocolo (ej. `2025-06-18`) |
| `Last-Event-ID` | Cliente→Server (GET) | Cursor para resumability |
| `Origin` | Cliente→Server | **Validación obligatoria** por el server (anti DNS-rebinding) [L102-103] |

### Autenticación [transports.txt L107]
- "**Servers SHOULD implement proper authentication for all connections.**"
- **El spec NO define aquí** el mecanismo concreto (Bearer, OAuth, API keys, etc.). Solo lo recomienda y enlaza a la página `Authorization` (que **no está** entre los 3 archivos leídos).
- Implicación MITM: cualquier credencial viaja en headers HTTP estándar (no se han descrito en este spec).

### Seguridad y binding [transports.txt L98-110]
- **El server DEBE validar el header `Origin`** en todas las conexiones (anti DNS-rebinding).
- **Cuando corre local, el server DEBERÍA bind solo a `127.0.0.1`**, NO a `0.0.0.0`.
- **El server DEBERÍA implementar autenticación** en todas las conexiones.
- "Without these protections, attackers could use DNS rebinding to interact with local MCP servers from remote websites."

---

## Lifecycle (relacionado con transporte)

### Inicialización: `initialize` request/response [lifecycle.txt L47-115]
- El cliente **debe** iniciar la fase mandando un request `initialize` con:
  - `protocolVersion` — versión que soporta el cliente
  - `capabilities` — capacidades del cliente
  - `clientInfo` — `{name, title, version}`

  Ejemplo:
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {
        "roots": {"listChanged": true},
        "sampling": {},
        "elicitation": {}
      },
      "clientInfo": {
        "name": "ExampleClient",
        "title": "Example Client Display Name",
        "version": "1.0.0"
      }
    }
  }
  ```
- El server **debe** responder con sus propias `capabilities`, `serverInfo` y opcional `instructions`.
- Restricciones durante init:
  - "The client SHOULD NOT send requests other than pings before the server has responded to the initialize request." [L126-129]
  - "The server SHOULD NOT send requests other than pings and logging before receiving the initialized notification." [L131-135]

### `initialized` notification [lifecycle.txt L117-124]
- Tras recibir el `InitializeResult` con éxito, el cliente **debe** enviar:
  ```json
  {
    "jsonrpc": "2.0",
    "method": "notifications/initialized"
  }
  ```
- Es una **notification** (sin `id`, sin response esperada). Señala que el cliente está listo para operar normalmente.

### Version Negotiation [lifecycle.txt L139-154]
- Cliente envía la versión que soporta (idealmente la última que conozca).
- Si el server la soporta → responde con **la misma** versión.
- Si no → responde con **otra versión que sí soporte** (idealmente la última que soporte).
- Si el cliente no soporta la versión devuelta → **debería desconectar**.
- En HTTP, el cliente debe mandar el header `MCP-Protocol-Version` en todos los requests posteriores.

### Capability Negotiation [lifecycle.txt L157-223]
- Capacidades del **cliente**:
  - `roots` — proveer filesystem roots
  - `sampling` — soporte para LLM sampling requests
  - `elicitation` — soporte para elicitation requests del server
  - `experimental` — features no estándar
- Capacidades del **server**:
  - `prompts` — ofrece prompt templates
  - `resources` — recursos legibles
  - `tools` — herramientas invocables
  - `logging` — emite logs estructurados
  - `completions` — autocompletado de argumentos
  - `experimental` — features no estándar
- Sub-capacidades:
  - `listChanged` — soporta notificaciones de cambio de lista (prompts/resources/tools)
  - `subscribe` — soporta suscripción a cambios de items individuales (resources)

### Shutdown [lifecycle.txt L238-269]
- **No hay mensajes de shutdown definidos** — el cierre es a nivel de transporte:
  - **stdio**: cerrar stdin del proceso hijo → esperar exit → SIGTERM → SIGKILL. Server puede cerrar stdout y exit por su cuenta.
  - **HTTP**: cerrar la(s) conexión(es) HTTP asociada(s). Opcionalmente el cliente puede mandar `DELETE` con `Mcp-Session-Id` para terminar la sesión explícitamente (si el server lo soporta).

### Timeouts [lifecycle.txt L273-286]
- Las implementaciones **deberían** tener timeouts en todos los requests.
- Si se vence el timeout → emitir `notifications/cancelled` y dejar de esperar respuesta.
- SDKs/middleware **deberían** permitir configurar timeouts per-request.
- Se puede resetear el reloj con progress notifications, pero **siempre** debe haber un timeout máximo.

### Error Handling [lifecycle.txt L290-313]
Casos a manejar:
- Protocol version mismatch
- Failure to negotiate required capabilities
- Request timeouts

Ejemplo de error en init:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Unsupported protocol version",
    "data": {
      "supported": ["2024-11-05"],
      "requested": "1.0.0"
    }
  }
}
```

---

## Resumen ejecutivo para implementación del MITM

### STDIO MITM
- **Capturar**: spawn del proceso hijo, redirigir `stdin`/`stdout` (binary mode, no text) a un proxy.
- **Parsear**: una línea = un JSON object. `\n` como delimitador (no `\r\n`, no longitud prefijada).
- **Identificar mensajes**: campo `id` de JSON-RPC. Requests/responses con id; notifications sin id.
- **NO tocar stderr**: es canal separado para logs, no parte del protocolo.
- **Shrink**: EOF en stdout = fin de sesión.
- **Inyectar**: respetar MUST NOT — solo mensajes MCP válidos.

### Streamable HTTP MITM
- **Endpoint único** con 3 métodos: POST (request/response), GET (server-push SSE), DELETE (cierre).
- **Proxy transparente** que:
  - Reenvía POST capturando `Mcp-Session-Id`, `MCP-Protocol-Version`, `Last-Event-ID`, `Origin`.
  - Maneja respuestas bimodales: `application/json` (objeto único) vs `text/event-stream` (stream).
  - Implementa logic de session: si llega `404` con session ID → nueva init sin session.
- **Resumability**: `Last-Event-ID` permite re-play exacto del stream. Cuidado: el `id` SSE es **per-stream**, no global.
- **Versión**: header `MCP-Protocol-Version` debe reenviarse tal cual.
- **Auth**: no detallada aquí, pero el spec exige que el server valide `Origin` y autentique.

### Lifecycle MITM
- **Detectar inicio**: primer `id=1, method=initialize` (request) → correlacionar con su `id=1, result=InitializeResult` (response) → esperar `notifications/initialized` (notification sin id).
- **Negociación**: extraer `protocolVersion`, `capabilities`, `clientInfo`/`serverInfo` para fingerprinting.
- **Cierre**: stdio=EOF, HTTP=`DELETE` con session o cierre de conexión TCP.
