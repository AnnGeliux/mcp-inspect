# MCP Inspector

**Visualizador man-in-the-middle (MITM) de conexiones MCP** — intercepta, inspecciona y depura el tráfico JSON-RPC 2.0 entre cualquier servidor MCP y cualquier cliente MCP, en tiempo real.

---

## 📋 Tabla de contenidos

- [¿Qué hace?](#-qué-hace)
- [Características](#-características)
- [Stack](#-stack)
- [Estructura del proyecto](#-estructura-del-proyecto)
- [Instalación](#-instalación)
- [Uso](#-uso)
- [Arquitectura](#-arquitectura)
- [Testing](#-testing)
- [Scripts disponibles](#-scripts-disponibles)
- [Roadmap](#-roadmap)

---

## 🎯 ¿Qué hace?

MCP Inspector se interpone entre un servidor MCP y un cliente MCP como un proxy MITM. Captura todo el tráfico JSON-RPC 2.0, lo muestra en una interfaz visual con timestamps, latencia, filtros y búsqueda — y permite pausarlo con breakpoints para editar peticiones y respuestas al vuelo (enviar, modificar, descartar o responder manualmente) sin tocar el server ni el cliente.

**Casos de uso:**
- Depurar por qué un cliente MCP no recibe respuestas correctas de un servidor
- Verificar que un servidor MCP implementa correctamente el handshake `initialize → initialized`
- Inspeccionar qué tools/resources/prompts expone un servidor antes de integrarlo en producción
- Auditar el tráfico entre tu agente y los MCPs que usa

---

## ✨ Características

### Selectores intercambiables
- **Cards visuales** para elegir servidor y cliente MCP
- CRUD completo: agregar, editar y eliminar servidores/clientes custom
- Presets pre-cargados: `everything-server`, `echo` (test), SDK Client, Inspector oficial
- Persistencia en JSON local (`~/.mcp-inspector/servers.json` y `clients.json`)

### Panel de tráfico en vivo
- Log cronológico con timestamps absolutos y relativos ("hace 2s")
- **Latencia por transacción** — correlación request↔response por ID, delta en ms en cada respuesta
- **Filtros por tipo:** requests, responses, notifications, errors, all
- **Filtro por método MCP** — `tools/call`, `resources/read`, `prompts/get`, `notifications/*`…
- **Visor dual** — tab *Formatted* (árbol coloreado) + tab *Raw* (JSON copiable al portapapeles)
- **Validación de spec MCP** — cada trama se valida contra los schemas zod del SDK oficial; badge ⚠ en las no conformes
- **Búsqueda** por método, ID JSON-RPC o contenido del payload
- **Colapsar/expandir** cada entrada (click para ver payload completo)
- **Syntax highlighting JSON:** keys (azul), strings (verde), numbers (naranja), booleans (morado), null (gris)
- **Contadores** por tipo con badges

### Interceptación MITM (breakpoints)
- **Breakpoints de petición (→)** — pausa cualquier mensaje cliente→server antes de llegar al server
- **Breakpoints de respuesta (←)** — pausa cualquier mensaje server→cliente antes de llegar al LLM
- **Reglas por método** — intercepta solo `tools/call`, `resources/read`, o todo el tráfico
- **Editor inline** — edita el JSON retenido y decide: Enviar / Enviar editado / Drop / Responder manual
- **Orden FIFO garantizado** — los mensajes nunca se reordenan aunque resuelvas fuera de orden
- **Entrega post-pipeline consistente** — el log muestra exactamente lo que se entregó

### Gestor de procesos
- **Reiniciar / Stop / Matar** el subprocess MCP sin reiniciar el cliente (Claude/Cursor/VS Code)

### Wizard de configuración
- Flujo guiado de 2 pasos: elegir server → elegir client → tráfico en vivo
- Barra de progreso visual
- Se puede cambiar server/client en cualquier momento

### Design system
- Tema dark estilo GitHub DevTools
- Paleta consistente: accent `#58a6ff`, success `#3fb950`, error `#f85149`, background `#0d1117`
- Animaciones suaves: hover en cards, fade-in en entradas del log
- Scrollbars custom dark
- Tooltips nativos
- Estados vacíos con mensajes contextuales

---

## 🛠 Stack

| Tecnología | Versión | Uso |
|---|---|---|
| Electron | 44 | App de escritorio multiplataforma |
| React | 19 | UI renderer |
| TypeScript | 5.9 | Tipado estático |
| Vite | 6 | Bundler del renderer |
| @modelcontextprotocol/sdk | 1.30+ | Cliente MCP real para handshake |
| @modelcontextprotocol/server-everything | 2026.8+ | Servidor MCP de prueba |
| happy-dom | 20+ | Entorno DOM para tests |
| tsx | 4.19 | Ejecución de TypeScript en tests |

---

## 📁 Estructura del proyecto

```
mcp-inspect/
├── src/
│   ├── main/                    # Proceso principal de Electron
│   │   ├── index.ts             # Entry point + IPC handlers
│   │   ├── proxy.ts             # Proxy STDIO MITM (spawn + tee)
│   │   ├── parser.ts            # Parser NDJSON JSON-RPC 2.0
│   │   ├── mcpClient.ts        # Cliente MCP real (SDK)
│   │   └── persistence.ts       # Guardar/cargar servers y clients
│   ├── preload/
│   │   └── index.ts             # Bridge seguro (contextBridge)
│   ├── renderer/                 # UI React
│   │   ├── App.tsx              # Componente raíz + wizard state
│   │   ├── index.tsx            # Entry point del renderer
│   │   ├── styles.css           # Design system completo
│   │   └── components/
│   │       ├── ServerPanel.tsx   # Panel izquierdo (servers)
│   │       ├── ClientPanel.tsx   # Panel derecho (clients)
│   │       ├── LogList.tsx       # Panel central (tráfico)
│   │       ├── ServerCard.tsx    # Card visual de server
│   │       ├── ClientCard.tsx    # Card visual de client
│   │       ├── Wizard.tsx        # Wizard de 2 pasos
│   │       ├── JsonHighlight.tsx # Syntax highlighter JSON
│   │       └── JsonTree.tsx      # Árbol JSON expandible
│   └── shared/
│       └── types.ts             # Tipos compartidos
├── tests/                        # 92 tests unitarios
│   ├── parser.test.ts            # 13 tests del parser NDJSON
│   ├── jsonhighlight.test.tsx    # 14 tests syntax highlighter
│   ├── wizard.test.tsx           # 12 tests del wizard
│   ├── servercard.test.tsx       # 15 tests ServerCard
│   ├── clientcard.test.tsx       # 15 tests ClientCard
│   ├── loglist.test.tsx          # 12 tests LogList
│   ├── persistence.test.ts       # 11 tests persistencia
│   ├── dom-setup.ts              # Setup de happy-dom
│   ├── render.tsx                # Helper de render React
│   ├── proxy.demo.ts             # Demo end-to-end del proxy
│   └── client.demo.ts            # Demo del cliente MCP
├── design/
│   └── ui_mockup.html            # Boceto visual original
├── research/                      # Investigación MCP spec
│   ├── BRIEFING.md
│   └── raw/                       # HTML de specs oficiales
├── dist/                          # Build output (main + preload)
├── dist-renderer/                 # Build output (renderer)
├── package.json
├── tsconfig.main.json
├── tsconfig.preload.json
├── tsconfig.renderer.json
└── vite.config.ts
```

---

## 🚀 Instalación

```bash
# Clonar el repositorio
git clone <repo-url>
cd mcp-inspect

# Instalar dependencias
npm install
```

**Requisitos:**
- Node.js 24+ (recomendado) o 20+
- npm 10+
- Windows, macOS o Linux

---

## 💻 Uso

### Iniciar la app

```bash
npm start
```

Esto lanza Electron con la UI completa.

### Flujo de uso

1. **Al abrir la app** — si no hay server ni client seleccionados, aparece el wizard
2. **Step 1** — elegir un MCP Server de las cards disponibles (o agregar uno custom con el botón "+")
3. **Step 2** — elegir un MCP Client de las cards disponibles (o agregar uno custom)
4. **Tráfico en vivo** — el panel central muestra toda la comunicación JSON-RPC capturada

### Agregar un servidor custom

1. Click en "+" en el panel de servers
2. Llenar: nombre, comando, args (uno por línea)
3. Ejemplo:
   - Nombre: `My Server`
   - Comando: `npx`
   - Args: `-y` (línea 1), `@my-org/my-mcp-server` (línea 2)

### Interactuar con el servidor

Desde el panel del cliente:
- **📡 ping** — enviar un ping al servidor
- **📋 tools/list** — listar todas las tools disponibles
- **🔧 tools/call — echo** — llamar la tool echo del everything-server
- **⏳ tools/call — longRunning** — llamar una tool con progreso
- **Envío raw** — enviar cualquier mensaje JSON-RPC custom

### Exportar/Importar sesión

- **Exportar:** guarda toda la sesión (config + log) como JSON
- **Importar:** carga una sesión exportada previamente

---

## 🏗 Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                     │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  ServerPanel  │    │   LogList    │    │  ClientPanel │  │
│  │  (selecciona  │    │  (tráfico    │    │ (selecciona  │  │
│  │   servidor)   │    │  capturado)  │    │   cliente)   │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │           │
│         ▼                   ▼                   ▼           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                     Proxy (MITM)                      │  │
│  │  spawn(server) → tee stdout → parse NDJSON → log     │  │
│  └──────────────────────────────────────────────────────┘  │
│         │                                       │           │
│         ▼                                       ▼           │
│  ┌──────────────┐                    ┌──────────────┐       │
│  │  MCP Server   │◄──── JSON-RPC ────►│  MCP Client  │       │
│  │  (stdio)       │    2.0 over NDJSON │  (SDK)       │       │
│  └──────────────┘                    └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### Flujo de datos

1. El proceso main hace `spawn` del servidor MCP seleccionado
2. El proxy intercepta stdin/stdout via `tee` (captura bidireccional)
3. El parser NDJSON procesa cada línea como un mensaje JSON-RPC 2.0
4. Cada mensaje se clasifica: request, response, notification o error
5. El cliente MCP real (SDK) se conecta al proxy y ejecuta el handshake
6. Todo el tráfico se envía al renderer via IPC para mostrarlo en el log

### Persistencia

- Los servidores y clientes custom se guardan en `~/.mcp-inspector/`
- Los presets (everything-server, echo, SDK, inspector) se re-derivan siempre, no se persisten
- Formato: JSON simple, editable manualmente

---

## 🧪 Testing

```bash
# Todos los tests (92)
npm test

# Solo parser
npm run test:parser

# Solo componentes UX
npm run test:unit

# Demo del proxy end-to-end
npm run test:proxy
```

### Cobertura

| Suite | Tests | Qué cubre |
|---|---|---|
| parser | 13 | NDJSON parsing: request, response, notification, error, CRLF, feeds incrementales |
| jsonhighlight | 14 | Syntax highlighting: keys, strings, numbers, booleans, null, HTML escaping |
| wizard | 12 | Steps, navegación, progreso, botones Siguiente/Atrás |
| servercard | 15 | Badges preset/idle/running, botones CRUD, clicks, selected, disabled |
| clientcard | 15 | Iconos por tipo, badges, CRUD, clicks, selected |
| loglist | 12 | Filtros por tipo, búsqueda, contadores, colapsar/expandir |
| persistence | 11 | Guardar/cargar servers/clients, presets no se persisten, round-trip |
| **Total** | **92** | |

---

## 📜 Scripts disponibles

| Script | Descripción |
|---|---|
| `npm start` | Inicia la app Electron |
| `npm run build` | Compila main + preload + renderer (TypeScript + Vite) |
| `npm test` | Corre todos los tests (92) |
| `npm run test:parser` | Solo tests del parser NDJSON (13) |
| `npm run test:unit` | Solo tests de componentes UX (79) |
| `npm run test:proxy` | Demo end-to-end del proxy con subprocess real |

---

## 🗺 Roadmap

> **Estado actual (auditoría ago-2026):** sniffer STDIO read-only. De las 18 features de referencia para la herramienta MITM MCP definitiva: **1 completa, 8 parciales, 9 faltantes**. Este roadmap integra las 18.

### ✅ Completado
- **Phase 1:** STDIO MITM MVP — parser NDJSON, proxy tee bidireccional, Electron shell, UI básica
- **Phase 2:** Selectores intercambiables — cards, CRUD, persistencia
- **Phase 3:** UX overhaul — wizard, syntax highlighting, filtros, design system
- **Phase 4:** Tests unitarios — 92 tests cubriendo parser + componentes
- **Cubierto fuera de fases:** búsqueda global en payload (2d) y los fragmentos ya implementados de las parciales: timeline con timestamps absolutos/relativos (2a), puente STDIO (1b), stop de procesos (1c), CRUD multi-server persistido (1d), syntax highlighting (2b), filtros por tipo (2c), export/import `.json` (5a), env vars por server (5c)

### 📊 Estado por categoría

| # | Categoría | Hoy | Faltante principal | Fases que la cierran |
|---|---|---|---|---|
| 1 | Conectividad y setup | 30% | HTTP/SSE, multi-server simultáneo, auto-proxy | 5, 8, 10, 11 |
| 2 | Monitoreo e inspección | 60% | latencia ms, visor raw + copy, filtro por método | 5 |
| 3 | Interceptación y edición | 0% | breakpoints req/resp, mocks, replay | 6, 7, 9 |
| 4 | Resiliencia y simulación | 0% | fault injection, throttling, validación spec | 5, 7 |
| 5 | Persistencia y DX | 35% | `.har`, tray + atajo global, bóveda `.env` | 12 |

### 🔜 Plan de fases

> Esfuerzo: 🟢 días · 🟡 1–2 semanas · 🔴 3+ semanas

#### Phase 5 — Observabilidad pro 🟢
*Cierra: 2a (latencia), 2b (visor dual), 2c (filtro por método), 1c (gestor de procesos), 4c (validación spec).*

- [x] **Latencia por transacción** — correlación request↔response por `rpcId`, delta en ms visible en cada entrada
- [x] **Filtro por método MCP** — `tools/call`, `resources/read`, `prompts/get`, `notifications/*` (además del filtro por tipo existente)
- [x] **Visor dual** — tab *Formatted* (coloreado actual) + tab *Raw* con JSON sin formato y botón copiar
- [x] **Gestor de procesos** — botones Reiniciar / Pausar / Matar el subprocess sin reiniciar el cliente (Claude/Cursor)
- [x] **Validación de spec MCP** — cada trama se valida contra los schemas zod del SDK oficial; badge visual en las no conformes

*Base existente: timestamps, filtros por kind, `JsonHighlight`, stop SIGTERM→SIGKILL; el SDK ya incluye schemas zod.*

#### Phase 6 — Interceptación MITM 🔴
*Cierra: 3a (breakpoint de petición) y 3b (breakpoint de respuesta). El salto de sniffer → MITM.*

- [x] **Re-arquitectura del proxy** — de tee ciego a pipeline con hooks `onClientMessage` / `onServerMessage`, transport-agnóstico
- [x] **Breakpoint de petición** — pausar el c2s, editar `params`/inputSchema, reenviar alterado al server
- [x] **Breakpoint de respuesta** — pausar el s2c, editar `result`/`error`, liberar al cliente/LLM y evaluar su reacción
- [x] **UI de interceptación** — banner "⏸ interceptado", editor inline, acciones Enviar / Enviar editado / Drop / Responder manual
- [x] **Reglas** — breakpoints siempre, por método o condicionales; toggle global on/off

*Base existente: ninguna — el proxy hoy es read-only byte a byte. Esta fase habilita las fases 7 y 9.*

#### Phase 7 — Simulación de comportamiento 🟡
*Cierra: 3c (auto-mocking), 4a (fault injection) y 4b (throttling). Construye sobre los hooks de Phase 6.*

- [ ] **Auto-mocking** — mapeo método → respuesta predefinida; responde al cliente sin golpear el server real
- [ ] **Fault injection** — inyectar errores JSON-RPC estándar: `-32601` Method Not Found, `-32602` Invalid Params, `-32603` Internal Error, timeouts
- [ ] **Throttling** — retraso artificial configurable por método para probar cómo maneja timeouts el cliente/LLM
- [ ] **Perfiles de simulación** — presets guardables: normal / degradado / offline

#### Phase 8 — Transporte HTTP/SSE 🟡
*Cierra: 1b (dual STDIO + SSE). Era la "Phase 5" del roadmap original.*

- [ ] **Proxy Streamable HTTP** — POST (request) + GET (SSE standalone), respuesta bimodal `application/json` o `text/event-stream`
- [ ] **Headers críticos** — `Mcp-Session-Id`, `MCP-Protocol-Version`, `Last-Event-ID` (resumabilidad por stream)
- [ ] **Interceptación sobre ambos transports** — los hooks de Phase 6 operan igual en STDIO y HTTP
- [ ] **Selector de transporte en la UI** — stdio / http(s) en la config del server

*Base existente: parser NDJSON reutilizable para framing; el proxy HTTP es nuevo.*

#### Phase 9 — Replay y comparación 🟡
*Cierra: 3d (replay). Absorbe las "Phases 6–7" del roadmap original (diff de sesiones + replay).*

- [ ] **Replay 1-click** — re-ejecutar cualquier petición capturada contra el server en vivo (o uno distinto)
- [ ] **Replay editado** — replay + modificación, reutilizando el editor de breakpoints de Phase 6
- [ ] **Comparador de sesiones** — diff entre dos capturas: antes/después de un fix, reportes de fallos, PRs

*Base existente: export/import de sesión `.json` ya funciona.*

#### Phase 10 — Multi-servidor simultáneo 🟡
*Cierra: 1d.*

- [ ] **Registry de sesiones** — proxy singleton → Map id → sesión {proxy, cliente, entries} concurrentes
- [ ] **UI multi-sesión** — tabs o panel lateral por server, cada uno con su timeline propio
- [ ] **Control individual** — start / stop / restart por pestaña, sin reiniciar la app

*Base existente: CRUD y persistencia multi-server ya existen; hoy solo corre uno a la vez.*

#### Phase 11 — Auto-proxy con 1 clic 🔴
*Cierra: 1a.*

- [ ] **Detección de clientes** — Claude Desktop (`claude_desktop_config.json`), Cursor (`mcp.json`), VS Code (`mcp.json` workspace)
- [ ] **Reescritura automática** — injectar el proxy como intermediario de los servers configurados, sin edición manual de rutas
- [ ] **Backup y restore** — undo 1 clic de las configs originales
- [ ] **Aviso de reinicio** — el cliente (Claude/Cursor/VS Code) debe reiniciarse para aplicar el cambio

#### Phase 12 — DX de escritorio 🟢
*Cierra: 5a (.har), 5b (tray + atajo) y 5c (bóveda .env).*

- [ ] **Export `.har`** — además del `.json` actual, formato compartible en reportes de fallos y PRs
- [ ] **Modo tray + atajo global** — minimizar a bandeja del sistema; desplegar con Ctrl/Cmd + Shift + I
- [ ] **Bóveda de entornos** — perfiles con API keys y credenciales cifradas (`safeStorage`), inyectadas dinámicamente al spawn

*Base existente: env vars por server ya se inyectan y persisten (texto plano hoy).*

### 🎯 Orden sugerido

```
5 → 6 → 7 → 8 → 10 → 9 → 11 → 12
```

- **5 y 6 pueden avanzar en paralelo** — 5 es UI-only, 6 es re-arquitectura del proxy
- **6 y 7 son un mismo arco arquitectónico** (hooks de interceptación) — hacerlas seguidas evita rework
- **8 puede adelantarse** si los servers remotos son la prioridad; los hooks de 6 se diseñan transport-agnóstico
- **11 al final** — toca configs de terceros; conviene con la app estable y el backup/restore bien probado

---

## 📄 Licencia

MIT