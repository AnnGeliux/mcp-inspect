# MCP Inspector

**Man-in-the-middle (MITM) visualizer for MCP connections** — intercepts, inspects and debugs JSON-RPC 2.0 traffic between any MCP server and any MCP client, in real time.

![version](https://img.shields.io/badge/version-0.1.0-58a6ff) ![tests](https://img.shields.io/badge/tests-168%20pass-3fb950) ![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

---

## 📋 Table of contents

- [What does it do?](#-what-does-it-do)
- [Features](#-features)
- [Stack](#-stack)
- [Project structure](#-project-structure)
- [Installation](#-installation)
- [Usage](#-usage)
- [Architecture](#-architecture)
- [Testing](#-testing)
- [Available scripts](#-available-scripts)
- [Roadmap](#-roadmap)
- [License](#-license)

---

## 🎯 What does it do?

MCP Inspector sits between an MCP server and an MCP client as a MITM proxy. It captures all JSON-RPC 2.0 traffic, renders it in a visual UI with timestamps, latency, filters and search — and lets you pause it with breakpoints to edit requests and responses on the fly (send, modify, drop or manually respond) without touching the server or the client.

**Use cases:**
- Debug why an MCP client is not receiving correct responses from a server
- Verify that an MCP server correctly implements the `initialize → initialized` handshake
- Inspect which tools/resources/prompts a server exposes before integrating it in production
- Audit the traffic between your agent and the MCPs it uses

---

## ✨ Features

### Interchangeable selectors
- **Visual cards** for choosing the MCP server and client
- Full CRUD: add, edit and delete custom servers/clients
- **Multi-select** — check several server cards (checkbox or `Ctrl+Click`) and start them all with one click
- Preloaded presets: `everything-server`, `echo` (test), SDK Client, official Inspector
- Local JSON persistence (`~/.mcp-inspector/servers.json` and `clients.json`)

### Multi-server (live sessions)
- **One session per server, concurrent** — every started server gets its own proxy, its own `MITMPipeline` and its own traffic timeline
- **Browser-style tab strip** docked above the traffic panel: one tab per live session with name, transport kind and a status dot (`●` capturing, `○` stopped, `⏸` paused)
- **Per-session isolation** — interception rules, holds, simulation config, pause state and client SDK connection are all scoped to the session's own pipeline
- **Group start** — with cards checked, `▶ Start` spawns them sequentially (spawn + handshake before the next) and reports the outcome in the status line
- **Queued-message counter** per tab while a session is frozen
- **✕ on a tab** tears that session down (flush holds + stop subprocess) without deleting the saved card

### Live traffic — chat view
- **Transaction blocks** — each request↔response pair rendered as a full-width block: header with method/id/latency, client bubble (right, blue) and server bubble (left, purple)
- **Loose bubbles** for notifications and technical entries, interleaved chronologically
- Absolute + relative timestamps ("2s ago")
- **Latency per transaction** — request↔response correlation by ID, delta in ms on each response
- **Type filters:** requests, responses, notifications, errors, all
- **MCP method filter** — `tools/call`, `resources/read`, `prompts/get`, `notifications/*`…
- **Dual viewer** — *Formatted* tab (colored tree) + *Raw* tab (copyable JSON)
- **MCP spec validation** — every frame is validated against the official SDK zod schemas; ⚠ badge on non-conforming ones
- **Search** by method, JSON-RPC ID or payload content
- **Expand/collapse** each entry inline (click to see full payload)
- **JSON syntax highlighting:** keys (blue), strings (green), numbers (orange), booleans (purple), null (gray)
- Per-type counters with badges

### MITM interception (breakpoints)
- **Request breakpoints (→)** — pause any client→server message before it reaches the server
- **Response breakpoints (←)** — pause any server→client message before it reaches the LLM
- **Per-method rules** — intercept only `tools/call`, `resources/read`, or all traffic
- **Inline editor** — edit the held JSON and decide: Send / Send edited / Drop / Manually respond
- **Guaranteed FIFO order** — messages are never reordered even if you resolve out of order
- **Consistent post-pipeline delivery** — the log shows exactly what was delivered

### Behavior simulation (fault / mock / throttle)
- **⚡ Fault injection** — auto-respond with standard JSON-RPC errors (`-32601`, `-32602`, `-32603`)
- **🧪 Auto-mock** — replace a response with a synthetic one, no hold needed
- **🕒 Throttling** — delay delivery by N ms to test client timeouts
- Simulations **auto-resolve** without user intervention; only `hold` (breakpoint) retains
- Synthetic responses for c2s faults/mocks carry the request's ID — the client receives a well-formed answer

### Global pause
- **⏸ Freeze all traffic** of a session without killing the subprocess — messages queue up in a FIFO and re-enter the pipeline on resume
- Per-direction queue counters in the topbar and per-tab queued badge

### Process manager
- **▶ Start / ⏸ Pause / ☠ Kill** the MCP subprocess (no restart of the client needed)
- **↻ Reset buttons in panel headers** — server restart (same config, session preserved) and client reconnect (fresh handshake), tinted to match the chat view colors
- SDK client requests never expire during long pauses/holds (10-min timeout)

### Setup wizard
- Guided 2-step flow: choose server → choose client → live traffic
- Visual progress bar
- Server/client can be changed at any time

### Design system
- GitHub DevTools-style dark theme
- Consistent palette: accent `#58a6ff`, success `#3fb950`, error `#f85149`, background `#0d1117`
- Smooth animations: card hover, log entry fade-in
- Custom dark scrollbars
- Native tooltips
- Contextual empty states

---

## 🛠 Stack

| Technology | Version | Use |
|---|---|---|
| Electron | 44 | Cross-platform desktop app |
| React | 19 | UI renderer |
| TypeScript | 5.9 | Static typing |
| Vite | 6 | Renderer bundler |
| @modelcontextprotocol/sdk | 1.30+ | Real MCP client for the handshake |
| @modelcontextprotocol/server-everything | 2026.8+ | Test MCP server |
| happy-dom | 20+ | DOM environment for tests |
| @testing-library/react | 16+ | Component tests |
| tsx | 4.23+ | TypeScript execution in tests |

---

## 📁 Project structure

```
mcp-inspect/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # Entry point + IPC handlers + session registry
│   │   ├── proxy.ts             # STDIO MITM proxy (spawn + bidirectional pipeline)
│   │   ├── pipeline.ts          # MITMPipeline — rules, holds, pause, simulations, correlation
│   │   ├── specValidation.ts    # Validation against official SDK zod schemas
│   │   ├── parser.ts            # NDJSON JSON-RPC 2.0 parser
│   │   ├── mcpClient.ts         # Real MCP client (SDK)
│   │   └── persistence.ts       # Save/load servers and clients
│   ├── preload/
│   │   └── index.ts             # Secure bridge (contextBridge)
│   ├── renderer/                # React UI
│   │   ├── App.tsx              # Root component + wizard state + session state
│   │   ├── index.tsx            # Renderer entry point
│   │   ├── styles.css           # Full design system
│   │   ├── utils/
│   │   │   └── format.ts        # Path truncation + type badges
│   │   └── components/
│   │       ├── ServerPanel.tsx   # Left panel (servers + process control)
│   │       ├── ClientPanel.tsx   # Right panel (clients)
│   │       ├── LogList.tsx       # Center chat view (traffic)
│   │       ├── SessionTabs.tsx   # Tab strip — one tab per live session
│   │       ├── InterceptBar.tsx  # Interception bar (breakpoints + rules + simulations)
│   │       ├── ServerCard.tsx    # Visual server card (incl. multi-select checkbox)
│   │       ├── ClientCard.tsx    # Visual client card
│   │       ├── Wizard.tsx        # 2-step wizard
│   │       ├── JsonHighlight.tsx # JSON syntax highlighter
│   │       └── JsonTree.tsx      # Expandable JSON tree
│   └── shared/
│       └── types.ts             # Shared types
├── tests/                        # 168 tests
│   ├── parser.test.ts                 # 13 — NDJSON parser
│   ├── pipeline.test.ts               # 27 — rules, FIFO holds, pause, correlation
│   ├── pipeline-sim.test.ts           # 17 — fault/mock/throttle simulations
│   ├── specvalidation.test.ts         # 16 — MCP spec validation
│   ├── persistence.test.ts            # 11 — persistence
│   ├── jsonhighlight.test.tsx         # 14 — syntax highlighter
│   ├── wizard.test.tsx                # 12 — wizard
│   ├── servercard.test.tsx            # 17 — ServerCard
│   ├── servercard-multiselect.test.tsx #  5 — multi-select checkbox + group start
│   ├── clientcard.test.tsx            # 18 — ClientCard
│   ├── loglist.test.tsx               # 12 — LogList (chat view)
│   ├── sessiontabs.test.tsx           #  6 — session tabs
│   ├── dom-setup.ts                   # happy-dom setup
│   ├── render.tsx                     # React render helper
│   ├── proxy.demo.ts                  # End-to-end proxy demo
│   ├── pause.demo.ts                  # Global pause end-to-end demo
│   └── client.demo.ts                 # MCP client end-to-end demo
├── dist/                          # Build output (main + preload)
├── dist-renderer/                 # Build output (renderer)
├── package.json
├── tsconfig.main.json
├── tsconfig.preload.json
├── tsconfig.renderer.json
├── vite.config.ts
└── LICENSE
```

---

## 🚀 Installation

```bash
# Clone the repository
git clone https://github.com/AnnGeliux/mcp-inspect.git
cd mcp-inspect

# Install dependencies
npm install
```

**Requirements:**
- Node.js 22.19+ (enforced by the `engines` field; tested on Node 26)
- npm 10+
- Windows, macOS or Linux

---

## 💻 Usage

### Starting the app

```bash
npm start
```

Launches Electron with the full UI. The current app version (semver `MAJOR.MINOR.PATCH`) is displayed next to the app name in the topbar.

### Usage flow

1. **On open** — if no server or client is selected, the wizard appears
2. **Step 1** — choose an MCP Server from the available cards (or add a custom one with the "+ Add" button)
3. **Step 2** — choose an MCP Client from the available cards (or add a custom one)
4. **Live traffic** — the center panel shows all captured JSON-RPC communication as a chat

### Running several servers at once

Each started server gets its own session, its own interception state and its own tab:

1. **Check** the cards you want (checkbox in the card corner, or `Ctrl+Click` the card)
2. Press **▶ Start** — the checked servers are spawned sequentially (each one spawns and completes its handshake before the next starts), and the status line reports `n servers running — one tab per session`
3. Switch between timelines with the **session tabs** above the traffic panel
4. **✕ on a tab** closes only that session (holds are flushed and the subprocess is stopped); the saved card stays in the panel

With no card checked, `▶ Start` behaves as before: it starts the selected server on its own.

### Adding a custom server

1. Click "+ Add" in the servers panel
2. Fill in: name, command, args (one per line)
3. Example:
   - Name: `My Server`
   - Command: `npx`
   - Args: `-y` (line 1), `@my-org/my-mcp-server` (line 2)

### Interacting with the server

From the client panel:
- **📡 ping** — send a ping to the server
- **📋 tools/list** — list all available tools
- **🔧 tools/call — echo** — call the everything-server's echo tool
- **⏳ tools/call — longRunning** — call a tool with progress
- **Raw send** — send any custom JSON-RPC message

### Session control

- **↻ Reset (server header)** — restart the subprocess with the same config, session preserved
- **↻ Reset (client header)** — disconnect + reconnect the client with a fresh handshake
- **⏸ Pause / ▶ Resume** — freeze and release all traffic without killing the subprocess
- **☠ Kill** — immediate SIGKILL of the subprocess
- **✕ Tab close** — end one session (its proxy and client SDK connection), keep the saved server

### Exporting/Importing a session

- **Export:** saves the whole session (config + log) as JSON
- **Import:** loads a previously exported session

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                     │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  ServerPanel  │    │   LogList    │    │  ClientPanel │  │
│  │  (selects     │    │  (captured   │    │ (selects     │  │
│  │   server)      │    │   traffic)  │    │   client)    │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │           │
│         ▼                   ▼                   ▼           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Session registry: Map<serverId, Session>      │  │
│  │   each session owns its own StdioProxy + pipeline      │  │
│  └──────────────────────────────────────────────────────┘  │
│         │                                       │           │
│         ▼                                       ▼           │
│  ┌──────────────┐                    ┌──────────────┐       │
│  │  MCP Server   │◄──── JSON-RPC ────►│  MCP Client  │       │
│  │  (stdio)      │    2.0 over NDJSON │  (SDK)       │       │
│  └──────────────┘                    └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### Data flow

1. The main process `spawn`s the selected MCP server and registers a `Session` under its `SavedServer` id
2. All traffic crosses that session's `MITMPipeline` before delivery, in both directions
3. The NDJSON parser processes each line as a JSON-RPC 2.0 message
4. Each message is classified: request, response, notification or error
5. The real MCP client (SDK) connects to the proxy and runs the handshake
6. All traffic is pushed to the renderer via IPC, tagged with its `serverId`, for display in the chat view
7. With active breakpoints the pipeline holds the message until the user decides (send / edit / drop / respond); with simulations (fault/mock/throttle) it auto-resolves
8. The global pause queues every message per direction in FIFO order and re-enters them into the pipeline on resume
9. Interception state is per session: `intercept:*` IPC handlers all take a `serverId` first, so rules, holds and simulations never leak between servers

### Persistence

- Custom servers and clients are saved in `~/.mcp-inspector/`
- Presets (everything-server, echo, SDK, inspector) are always re-derived, never persisted
- Format: plain JSON, manually editable

---

## 🧪 Testing

```bash
# All tests (168)
npm test

# Parser only
npm run test:parser

# Interception pipeline + simulations + spec validation + parser
npm run test:pipeline

# UX components only
npm run test:unit

# End-to-end proxy demo
npm run test:proxy

# Real MCP client end-to-end demo
npm run test:client
```

### Coverage

| Suite | Tests | What it covers |
|---|---|---|
| parser | 13 | NDJSON parsing: request, response, notification, error, CRLF, incremental feeds |
| pipeline | 27 | Interception rules, FIFO holds, resolutions, global pause, id→method correlation |
| pipeline-sim | 17 | Fault injection, auto-mock, throttling, synthetic responses |
| specvalidation | 16 | MCP spec validation against official SDK zod schemas |
| persistence | 11 | Save/load servers/clients, presets not persisted, round-trip |
| jsonhighlight | 14 | Syntax highlighting: keys, strings, numbers, booleans, null, HTML escaping |
| wizard | 12 | Steps, navigation, progress, Next/Back buttons |
| servercard | 17 | preset/idle/running badges, CRUD buttons, clicks, selected, disabled |
| servercard-multiselect | 5 | Multi-select checkbox, `Ctrl+Click`, checked card state |
| clientcard | 18 | Per-type icons, badges, CRUD, clicks, selected |
| loglist | 12 | Type filters, search, counters, expand/collapse |
| sessiontabs | 6 | Tab rendering, active tab, status dot, queued badge, close |
| **Total** | **168** | |

---

## 📜 Available scripts

| Script | Description |
|---|---|
| `npm start` | Launches the Electron app |
| `npm run build` | Compiles main + preload + renderer (TypeScript + Vite) |
| `npm test` | Runs all tests (168) |
| `npm run test:parser` | NDJSON parser tests only (13) |
| `npm run test:pipeline` | Interception pipeline + simulations + spec + parser (27 + 17 + 16 + 13) |
| `npm run test:unit` | UX component tests only (95) |
| `npm run test:proxy` | End-to-end proxy demo with real subprocess |
| `npm run test:client` | Real MCP client + everything-server end-to-end demo |

---

## 🗺 Roadmap

### In progress

- **Phase 8 — Multi-server + HTTP/SSE (Streamable HTTP)**
  - ✅ **M1 — multi-server foundation**: session registry, per-session pipeline, session tabs, group start (this milestone is done)
  - ⬜ **M2 — Streamable HTTP transport**: local reverse-proxy listener that pushes HTTP traffic through the same `MITMPipeline` (`Mcp-Session-Id` passthrough, deterministic local ports, copyable endpoint in the card)
  - ⬜ **M3 — mixed protocols**: one client talking to local stdio servers and remote HTTP servers at the same time

### Upcoming features

- **Replay and compare** — re-run captured requests against the live server and diff sessions
- **One-click auto-proxy** — automatically rewrite Claude Desktop, Cursor and VS Code configs to intercept their traffic, with backup and restore
- **Desktop DX** — `.har` export, tray mode with global `Ctrl/Cmd + Shift + I` shortcut, and an encrypted credential vault for `.env`

### Completed

- ✅ MITM proxy STDIO + NDJSON parsing + spec validation
- ✅ Breakpoints with inline editing, FIFO guarantees
- ✅ Global pause (freeze traffic without killing the subprocess)
- ✅ Behavior simulation: fault injection, auto-mock, throttling
- ✅ Chat-style live traffic view
- ✅ Multi-server foundation: session registry + session tabs + group start
- ✅ Reset buttons in panel headers (server restart / client reconnect)
- ✅ Semver version display in topbar

---

## 📄 License

MIT — see [LICENSE](./LICENSE).
