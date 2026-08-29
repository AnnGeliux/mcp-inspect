# MCP Inspector

**Visualizador man-in-the-middle (MITM) de conexiones MCP** — intercepta, inspecciona y depura el tráfico JSON-RPC 2.0 entre cualquier servidor MCP y cualquier cliente MCP, en tiempo real.

![dark theme](https://img.shields.io/badge/theme-dark%20GitHub-0d1117-58a6ff)
![electron](https://img.shields.io/badge/Electron-44-47848f)
![react](https://img.shields.io/badge/React-19-61dafb)
![tests](https://img.shields.io/badge/tests-92%20passing-3fb950)

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

MCP Inspector se interpone entre un servidor MCP y un cliente MCP como un proxy de solo lectura. Captura todo el tráfico JSON-RPC 2.0 que pasa entre ambos y lo muestra en una interfaz visual con timestamps, sintaxis coloreada, filtros y búsqueda.

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
- **Filtros por tipo:** requests, responses, notifications, errors, all
- **Búsqueda** por método, ID JSON-RPC o contenido del payload
- **Colapsar/expandir** cada entrada (click para ver payload completo)
- **Syntax highlighting JSON:** keys (azul), strings (verde), numbers (naranja), booleans (morado), null (gris)
- **Contadores** por tipo con badges

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

### ✅ Completado
- **Phase 1:** STDIO MITM MVP — parser, proxy, Electron shell, UI básica
- **Phase 2:** Selectores intercambiables — cards, CRUD, persistencia
- **Phase 3:** UX overhaul — wizard, syntax highlighting, filtros, design system
- **Phase 4:** Tests unitarios — 92 tests cubriendo parser + componentes

### 🔜 Próximo
- **Phase 5:** Streamable HTTP proxy — soporte para transporte HTTP+SSE (POST + SSE)
- **Phase 6:** Comparador de sesiones — diff entre dos sesiones capturadas
- **Phase 7:** Replay — reenviar mensajes capturados a un servidor diferente

---

## 📄 Licencia

MIT