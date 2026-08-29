# Resumen consolidado — Spec de features MCP (versión 2025-06-18)

## Paso 1 — Estado de descarga y verificación de shell vacía

| Archivo | URL origen | Tamaño (bytes) | HTTP | `__next_error__` | Resultado |
|---|---|---|---|---|---|
| `tools.html` | `/specification/2025-06-18/server/tools` | 576.423 | 200 | 0 | ✅ Contenido real |
| `resources.html` | `/specification/2025-06-18/server/resources` | 559.740 | 200 | 0 | ✅ Contenido real |
| `prompts.html` | `/specification/2025-06-18/server/prompts` | 446.468 | 200 | 0 | ✅ Contenido real |
| `roots.html` | `/specification/2025-06-18/client/roots` | 373.738 | 200 | 0 | ✅ Contenido real |
| `sampling.html` | `/specification/2025-06-18/client/sampling` | 409.875 | 200 | 0 | ✅ Contenido real |
| `elicitation.html` | `/specification/2025-06-18/client/elicitation` | 500.406 | 200 | 0 | ✅ Contenido real |

**SHELL VACÍA en URL X:** ninguna. Los seis endpoints sirvieron la página hidratada completa (todos > 5.000 bytes, sin `__next_error__`). Se procesaron los seis.

> Nota: el subagente anterior procesó `server_features.html` y `client_features.html`, que eran páginas de índice de Next.js sin el contenido de las features. Para obtener la spec real hubo que bajar las URLs finales de cada feature (`/server/tools`, `/server/resources`, etc.).

Texto extraído a `research/raw/features_extracted.txt` (1.571 líneas, 39 KB) con `extract_features.py`.

---

## Paso 3 — Spec por feature

### 1) `tools.html` — Server feature: **Tools**

- **Capability declarada:** `{ "capabilities": { "tools": { "listChanged": true } } }`
- **Modelo de interacción:** model-controlled (el LLM puede invocar tools; apps SHOULD pedir confirmación humana).
- **Métodos JSON-RPC:**
  - `tools/list` — listar tools (paginado con `cursor` → `nextCursor`).
  - `tools/call` — invocar una tool.
  - `notifications/tools/list_changed` — notificación (si `listChanged:true`).
- **Ejemplo `tools/list` Request:**
  ```json
  { "jsonrpc":"2.0", "id":1, "method":"tools/list",
    "params": { "cursor":"optional-cursor-value" } }
  ```
- **Ejemplo `tools/list` Response:**
  ```json
  { "jsonrpc":"2.0", "id":1, "result": {
      "tools": [{
        "name":"get_weather",
        "title":"Weather Information Provider",
        "description":"Get current weather information for a location",
        "inputSchema": {
          "type":"object",
          "properties": { "location": { "type":"string", "description":"City name or zip code" } },
          "required":["location"]
        }
      }],
      "nextCursor":"next-page-cursor" } }
  ```
- **Ejemplo `tools/call`:**
  ```json
  // request
  { "jsonrpc":"2.0", "id":2, "method":"tools/call",
    "params": { "name":"get_weather", "arguments": { "location":"New York" } } }
  // response
  { "jsonrpc":"2.0", "id":2, "result": {
      "content":[{"type":"text","text":"Current weather in New York:\nTemperature: 72°F\nConditions: Partly cloudy"}],
      "isError": false } }
  ```
- **Tipos de contenido en `result.content`:** `text`, `image` (base64 + mimeType), `audio`, `resource_link`, `resource` embebido. Todos aceptan `annotations` (`audience`, `priority`, `lastModified`).
- **`structuredContent` y `outputSchema`:** los tools pueden definir `outputSchema` (JSON Schema) y devolver resultado estructurado en `result.structuredContent`; los servidores MUST conformar al schema si está declarado.
- **Errores:** protocolo JSON-RPC estándar (p. ej. `-32602` Unknown tool) **o** resultado con `"isError": true`.

---

### 2) `resources.html` — Server feature: **Resources**

- **Capability declarada:** `{ "capabilities": { "resources": { "subscribe": true, "listChanged": true } } }` (ambas flags opcionales e independientes).
- **Modelo de interacción:** application-driven (la UI decide cómo mostrar/filtrar/incluir recursos).
- **Métodos JSON-RPC:**
  - `resources/list` — listar (paginado).
  - `resources/read` — leer contenido por URI.
  - `resources/templates/list` — listar URI templates parametrizados (paginado).
  - `resources/subscribe` — suscribirse a cambios de un recurso.
  - `notifications/resources/list_changed` — notifica cambio en la lista.
  - `notifications/resources/updated` — notifica actualización de un recurso suscrito.
- **Ejemplo `resources/list` Response:**
  ```json
  { "jsonrpc":"2.0", "id":1, "result": {
      "resources": [{
        "uri":"file:///project/src/main.rs",
        "name":"main.rs",
        "title":"Rust Software Application Main File",
        "description":"Primary application entry point",
        "mimeType":"text/x-rust"
      }],
      "nextCursor":"next-page-cursor" } }
  ```
- **Ejemplo `resources/read`:**
  ```json
  // request
  { "jsonrpc":"2.0", "id":2, "method":"resources/read",
    "params": { "uri":"file:///project/src/main.rs" } }
  // response (text)
  { "jsonrpc":"2.0", "id":2, "result": {
      "contents":[{
        "uri":"file:///project/src/main.rs",
        "mimeType":"text/x-rust",
        "text":"fn main() {\n println!(\"Hello world!\");\n}"
      }] } }
  // binary usa "blob":"base64-encoded-data" en vez de "text"
  ```
- **Ejemplo `resources/templates/list`:**
  ```json
  { "jsonrpc":"2.0","id":3,"method":"resources/templates/list",
    "params":{ "cursor":"optional-cursor-value" } }
  // response
  { "jsonrpc":"2.0","id":3,"result":{
      "resourceTemplates":[{
        "uriTemplate":"file:///{path}",
        "name":"Project Files",
        "title":"📁 Project Files",
        "description":"Access files in the project directory",
        "mimeType":"application/octet-stream"
      }],"nextCursor":"next-page-cursor" } }
  ```
- **Ejemplo subscribe / updated:**
  ```json
  // subscribe
  { "jsonrpc":"2.0","id":4,"method":"resources/subscribe",
    "params":{ "uri":"file:///project/src/main.rs" } }
  // notification de update
  { "jsonrpc":"2.0",
    "method":"notifications/resources/updated",
    "params":{ "uri":"file:///project/src/main.rs" } }
  ```
- **Campos de `Resource`:** `uri` (requerido), `name`, `title`, `description`, `mimeType`, `size`. Annotations: `audience` (`["user","assistant"]`), `priority` (0.0–1.0), `lastModified` (ISO 8601).
- **URI schemes estándar:** `https://`, `file://`, `git://`; custom schemes deben cumplir RFC3986.
- **Errores:** `-32002` Resource not found, `-32603` Internal error.

---

### 3) `prompts.html` — Server feature: **Prompts**

- **Capability declarada:** `{ "capabilities": { "prompts": { "listChanged": true } } }`
- **Modelo de interacción:** user-controlled (slash commands en UI, descubiertos/invocados por el usuario).
- **Métodos JSON-RPC:**
  - `prompts/list` — listar prompts (paginado).
  - `prompts/get` — recuperar un prompt con argumentos.
  - `notifications/prompts/list_changed` — si `listChanged:true`.
- **Ejemplo `prompts/list` Response:**
  ```json
  { "jsonrpc":"2.0","id":1,"result":{
      "prompts":[{
        "name":"code_review",
        "title":"Request Code Review",
        "description":"Asks the LLM to analyze code quality and suggest improvements",
        "arguments":[{
          "name":"code","description":"The code to review","required":true
        }]
      }],
      "nextCursor":"next-page-cursor" } }
  ```
- **Ejemplo `prompts/get`:**
  ```json
  // request
  { "jsonrpc":"2.0","id":2,"method":"prompts/get",
    "params":{ "name":"code_review",
               "arguments":{ "code":"def hello():\n print('world')" } } }
  // response
  { "jsonrpc":"2.0","id":2,"result":{
      "description":"Code review prompt",
      "messages":[{
        "role":"user",
        "content":{
          "type":"text",
          "text":"Please review this Python code:\ndef hello():\n print('world')"
        }
      }] } }
  ```
- **`PromptMessage`:** `role` (`"user"|"assistant"`) + `content` con tipos `text`, `image` (base64 + mimeType), `audio` (base64 + mimeType), o `resource` embebido (con `uri`, `mimeType`, `text` o `blob`). Soportan `annotations`.
- **Errores:** `-32602` (Invalid params: nombre inválido / argumentos faltantes), `-32603` (Internal error).

---

### 4) `roots.html` — Client feature: **Roots**

- **Capability declarada:** `{ "capabilities": { "roots": { "listChanged": true } } }`
- **Modelo de interacción:** el cliente expone filesystem "roots" al servidor para delimitar el alcance de operaciones.
- **Métodos JSON-RPC:**
  - `roots/list` — el servidor pide la lista de roots al cliente.
  - `notifications/roots/list_changed` — el cliente notifica cambios (si `listChanged:true`).
- **Ejemplo `roots/list`:**
  ```json
  // request
  { "jsonrpc":"2.0","id":1,"method":"roots/list" }
  // response
  { "jsonrpc":"2.0","id":1,"result":{
      "roots":[{
        "uri":"file:///home/user/projects/myproject",
        "name":"My Project"
      }] } }
  ```
- **Ejemplo notification de cambio:**
  ```json
  { "jsonrpc":"2.0",
    "method":"notifications/roots/list_changed" }
  ```
- **`Root`:** `uri` (requerido, **debe** ser `file://` en la spec actual) y `name` opcional.
- **Errores:** `-32601` Method not found (cliente sin capability `roots`), `-32603` Internal error.

---

### 5) `sampling.html` — Client feature: **Sampling**

- **Capability declarada:** `{ "capabilities": { "sampling": {} } }`
- **Modelo de interacción:** el **servidor** solicita al cliente una generación LLM (agentic/nested). El cliente mantiene control sobre modelo, permisos y aprobación humana.
- **Métodos JSON-RPC:**
  - `sampling/createMessage` — el servidor pide una generación al LLM del cliente.
- **Ejemplo `sampling/createMessage`:**
  ```json
  // request
  { "jsonrpc":"2.0","id":1,"method":"sampling/createMessage",
    "params":{
      "messages":[{
        "role":"user",
        "content":{ "type":"text", "text":"What is the capital of France?" }
      }],
      "modelPreferences":{
        "hints":[{ "name":"claude-3-sonnet" }],
        "intelligencePriority":0.8,
        "speedPriority":0.5
      },
      "systemPrompt":"You are a helpful assistant.",
      "maxTokens":100
    } }
  // response
  { "jsonrpc":"2.0","id":1,"result":{
      "role":"assistant",
      "content":{ "type":"text", "text":"The capital of France is Paris." },
      "model":"claude-3-sonnet-20240307",
      "stopReason":"endTurn"
    } }
  ```
- **Tipos de mensaje:** `text`, `image`, `audio` (todos con base64 + mimeType).
- **`modelPreferences`:** sistema de tres prioridades 0–1 (`costPriority`, `speedPriority`, `intelligencePriority`) más hints de modelo (substrings, evaluados en orden, mapeables por el cliente a modelos equivalentes de otros providers). Hints son advisory.
- **Errores:** ejemplo custom (`code: -1`, "User rejected sampling request"); se usan códigos JSON-RPC estándar para fallos internos.

---

### 6) `elicitation.html` — Client feature: **Elicitation**

- **Capability declarada:** `{ "capabilities": { "elicitation": {} } }`
- **Estado:** "newly introduced in this version" (su diseño puede evolucionar). Servidores **MUST NOT** solicitar información sensible.
- **Modelo de interacción:** el **servidor** pide datos al usuario a través del cliente usando un JSON Schema restringido.
- **Métodos JSON-RPC:**
  - `elicitation/create` — solicitar input del usuario con schema.
- **Ejemplo simple text request:**
  ```json
  // request
  { "jsonrpc":"2.0","id":1,"method":"elicitation/create",
    "params":{
      "message":"Please provide your GitHub username",
      "requestedSchema":{
        "type":"object",
        "properties":{ "name":{ "type":"string" } },
        "required":["name"]
      } } }
  // response (accept)
  { "jsonrpc":"2.0","id":1,"result":{
      "action":"accept",
      "content":{ "name":"octocat" } } }
  ```
- **Ejemplo structured data + reject + cancel:**
  ```json
  // request (objeto plano con primitivos)
  { "jsonrpc":"2.0","id":2,"method":"elicitation/create",
    "params":{
      "message":"Please provide your contact information",
      "requestedSchema":{
        "type":"object",
        "properties":{
          "name":{ "type":"string","description":"Your full name" },
          "email":{ "type":"string","format":"email","description":"Your email address" },
          "age":{ "type":"number","minimum":18,"description":"Your age" }
        },
        "required":["name","email"]
      } } }
  // accept
  { "jsonrpc":"2.0","id":2,"result":{
      "action":"accept",
      "content":{ "name":"Monalisa Octocat","email":"octocat@github.com","age":30 } } }
  // decline
  { "jsonrpc":"2.0","id":2,"result":{ "action":"decline" } }
  // cancel
  { "jsonrpc":"2.0","id":2,"result":{ "action":"cancel" } }
  ```
- **Tres acciones de respuesta:** `accept` (con `content` matching schema), `decline` (rechazo explícito), `cancel` (dismiss sin elección).
- **`requestedSchema`:** restringido a flat objects con primitivos: `string` (formatos: `email`, `uri`, `date`, `date-time`; `minLength`/`maxLength`), `number`/`integer` (`minimum`/`maximum`), `boolean` (con `default`), `string` con `enum` + `enumNames`. **No** se permiten estructuras anidadas, arrays de objetos ni features avanzadas de JSON Schema.

---

## Apéndice — Capabilities (resumen para handshake `initialize`)

| Feature | Capability key | Flags | Lado |
|---|---|---|---|
| Tools | `tools` | `listChanged` | server |
| Resources | `resources` | `subscribe`, `listChanged` | server |
| Prompts | `prompts` | `listChanged` | server |
| Roots | `roots` | `listChanged` | client |
| Sampling | `sampling` | — | client |
| Elicitation | `elicitation` | — | client |

## Archivos creados en esta tarea

- `C:\Users\Ann Palestina\Desktop\mcp_inspect\research\raw\tools.html`
- `C:\Users\Ann Palestina\Desktop\mcp_inspect\research\raw\resources.html`
- `C:\Users\Ann Palestina\Desktop\mcp_inspect\research\raw\prompts.html`
- `C:\Users\Ann Palestina\Desktop\mcp_inspect\research\raw\roots.html`
- `C:\Users\Ann Palestina\Desktop\mcp_inspect\research\raw\sampling.html`
- `C:\Users\Ann Palestina\Desktop\mcp_inspect\research\raw\elicitation.html`
- `C:\Users\Ann Palestina\Desktop\mcp_inspect\research\raw\extract_features.py` (extractor reutilizable)
- `C:\Users\Ann Palestina\Desktop\mcp_inspect\research\raw\features_extracted.txt` (texto plano extraído)
- `C:\Users\Ann Palestina\Desktop\mcp_inspect\research\raw\FEATURES_SPEC_RESUMEN.md` (este documento)
