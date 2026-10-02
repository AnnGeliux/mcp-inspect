# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Group start** — server cards gain a multi-select checkbox and `Ctrl+Click`
  toggling; with cards checked, `▶ Start` spawns them sequentially and reports
  the outcome (`n servers running — one tab per session`).
- **Multi-server foundation (Phase 8 / M1)** — the singleton proxy is replaced by
  a session registry (`Map<serverId, Session>`); every started server owns its own
  `StdioProxy`, its own `MITMPipeline` and its own traffic log.
- **Session tabs** — a browser-style tab strip docked above the traffic panel, with
  name, transport kind, status dot and a queued-message badge per session.
- **Per-session IPC surface** — `proxy:*`, `intercept:*`, `client:*` and `session:*`
  handlers take a `serverId`, so rules, holds, simulations and pause state are scoped
  per session instead of globally.
- `LogEntry.serverId` and the `SessionInfo` type.
- `LICENSE` file (MIT) — the README declared MIT but the file was missing.
- `CHANGELOG.md`.

### Fixed
- **`.gitignore` was merged into one broken line** (`.DS_Store.hermes/`), which left
  `.hermes/` unignored — internal planning docs could have been committed by a plain
  `git add -A`. Split into two rules.
- `test:unit` did not run `sessiontabs.test.tsx` or `servercard-multiselect.test.tsx`
  (they only ran under `npm test`); `test:pipeline` now also runs `parser.test.ts`,
  matching what the README documents.
- README test counts and suite inventory were stale (157 → 168).

## [2026-09-01] — Phase 7: behavior simulation

### Added
- **Fault injection** — intercept rules can auto-respond with standard JSON-RPC errors
  (`-32601`, `-32602`, `-32603`).
- **Auto-mock** — replace a response with a synthetic one without holding it.
- **Throttling** — delay delivery by N ms to exercise client timeouts.
- `InterceptRule.simulation` (`hold | throttle | fault | mock`); `hold` keeps the
  Phase 6 breakpoint behavior. Simulations auto-resolve; only `hold` retains.
- Chat-style live traffic view — transaction blocks (request bubble right, response
  bubble left) with method, JSON-RPC id and latency in the header; notifications as
  loose bubbles; bubbles tinted by origin.
- `LogEntry.simulated` for the ⚡ / 🧪 / 🕒 badges.
- Full English translation of the UI, comments and logs.

## [2026-08-31] — Global pause

### Added
- **MITM pause** — freeze all traffic without killing the subprocess; messages queue
  per direction in FIFO order and re-enter the pipeline on resume.
- Per-direction queue counters in the topbar.

### Fixed
- SDK client requests no longer expire during long pauses/holds (request timeout
  raised from 15 s to 10 min).

### Changed
- Removed the redundant "client connected" pill from the topbar (the client panel
  already badges it).

## [2026-08-30] — Phase 5+6: MITM interception

### Added
- **`MITMPipeline`** — the extension point every message crosses before delivery:
  per-direction + per-method rules, intercept-all, FIFO holds, `id → {method, ts}`
  correlation, post-pipeline delivery.
- **Breakpoints** — pause client→server and server→client traffic, edit the held JSON
  inline and choose *send / send edited / drop / manually respond*.
- **Latency per transaction** — request↔response correlation by JSON-RPC id.
- **MCP spec validation** — every frame validated against the official SDK zod schemas
  (JSON-RPC framing always; each response payload against its method's result schema),
  with a ⚠ badge on non-conforming messages.
- Process manager — start / pause / kill the MCP subprocess and restart the server or
  reconnect the client from the panel headers.

## [2026-08-29] — Initial public release

### Added
- STDIO MITM proxy between an MCP server and any MCP client, with NDJSON JSON-RPC 2.0
  parsing.
- Setup wizard, visual server/client cards with full CRUD, and local JSON persistence
  in `~/.mcp-inspector/`.
- GitHub DevTools-style dark design system, JSON tree + raw viewers, syntax
  highlighting, filters, search and per-type counters.

### Security
- Removed `.hermes/` (internal plans) from the repository and stripped absolute paths
  containing the local username from documentation.

[Unreleased]: https://github.com/AnnGeliux/mcp-inspect/commits/master
