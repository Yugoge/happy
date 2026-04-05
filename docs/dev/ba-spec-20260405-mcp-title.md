# BA Specification: MCP change_title Survives Daemon/Session Restarts

**Request ID**: dev-20260405-mcp-title
**Created**: 2026-04-05T18:00:00Z

## Goal

Ensure the `mcp__happy__change_title` MCP tool continues to work after daemon restarts and session re-spawns, without requiring manual intervention. Currently the fix from Bug #62 works within a single session lifecycle but breaks when the daemon or session process restarts.

## Context

### Previous fixes (Bug #15 + Bug #62)

**Bug #15** fixed four layers of the metadata update chain: server callback on missing session, CLI error swallowing in `updateMetadata`, missing Promise return, and app-side decryption crash.

**Bug #62** fixed two additional layers: (1) ajv@6 vs ajv@8 version conflict causing the STDIO bridge to crash on import, and (2) MCP SDK >=1.27 rejecting transport reuse, fixed by per-request McpServer+Transport creation. Both fixes are committed to main (`ccffa5a1`, `00c760cc`).

### Architecture of the MCP title tool

The chain has 4 components:

1. **HTTP MCP server** (`startHappyServer.ts`): Started in `runClaude()` on a random port (`:0`), bound to the `ApiSessionClient` instance for that session. Registers the `change_title` tool.

2. **STDIO bridge** (`happyMcpStdioBridge.ts`): Spawned by Claude SDK as a child process. Receives the HTTP MCP URL via `--url` CLI arg at spawn time. Forwards `change_title` calls from Claude to the HTTP server.

3. **Claude SDK mcpServers config** (`runClaude.ts:530-536`): Configured once at session start with `happyServer.url` baked into the `args` array. This config is passed to `loop()` -> `Session` -> `claudeRemote()` -> `query()`.

4. **Claude Code process**: Connects to the STDIO bridge, discovers `change_title` tool, uses it.

### Why the fix does not persist across restarts

The MCP tool chain is **per-session-process**: when `runClaude()` starts, it creates a fresh HTTP MCP server on a random port, then hardcodes that port into the `mcpServers` config. This works perfectly within a single session lifecycle.

**The "restart" the user observes is NOT a daemon restart.** The actual failure mode is:

**Scenario A: Claude process crash/restart within the while-loop** (`claudeRemoteLauncher.ts:359`). When Claude crashes and the while-loop respawns it, the `mcpServers` object in `Session` still contains the original URL. Since the HTTP MCP server (`happyServer`) is started once in `runClaude()` and lives for the entire session lifetime, this actually WORKS. The STDIO bridge is re-spawned by the new Claude process, connects to the same HTTP server. **This path is fine.**

**Scenario B: Daemon restart** (systemd `happy-daemon-dev.service` restart). The daemon kills all child processes (happy-cli sessions), then re-spawns them. Each re-spawned session calls `runClaude()` fresh, creating a new HTTP MCP server on a new random port. This also WORKS because everything is re-initialized.

**Scenario C: The STDIO bridge's HTTP client caches a stale connection.** The bridge (`happyMcpStdioBridge.ts:47-58`) uses `ensureHttpClient()` which creates a single `Client` instance and caches it (`httpClient`). If the HTTP MCP server restarts (unlikely within normal lifecycle), the cached client points to a dead connection. However, since the HTTP server and bridge share the same process lifecycle, this should not be an issue.

**ACTUAL ROOT CAUSE: The STDIO bridge process itself silently fails.** Bug #62 documented that "bridge crash is silent" (lesson #3). When the bridge process fails to start (e.g., due to ajv conflict in a fresh `yarn install`, or node_modules state after deploy), Claude SDK marks the MCP server as "failed" but does NOT surface any error. Claude simply proceeds without the `change_title` tool. The user sees sessions working but titles never change.

**Why "after every server restart":** When the daemon restarts, it spawns new sessions. Each session runs `runClaude()` which spawns the STDIO bridge. If `node_modules` state is wrong (e.g., `yarn install` was not run after deploy, or hoisted ajv@6 reappears after workspace dependency changes), the bridge crashes on every spawn. The fix (adding ajv@8 to package.json) only persists if `yarn install` is run from the correct directory with the correct package.json.

**The persistent root cause is the fragility of the monorepo dependency resolution.** The ajv@8 explicit dependency in `packages/happy-cli/package.json` can be overridden by:
1. Running `yarn install` at workspace root after adding/removing other packages
2. Yarn's hoisting algorithm deciding to flatten ajv@6 over ajv@8
3. Node modules cache/deduplication changing resolution order

## Requirements (MoSCoW)

### Must Have
- The STDIO bridge must validate that it can successfully import `@modelcontextprotocol/sdk` before entering the main loop, and log a clear error to stderr if it cannot
- The HTTP MCP server start must be verified (health check) before passing the URL to the mcpServers config
- Daemon logs must contain a clear indication of whether the MCP bridge started successfully or failed for each session
- A startup self-test that verifies the full chain (HTTP server -> STDIO bridge -> tool call) works

### Should Have
- The bridge should report its status back to the parent process (happy-cli) so the session can log "MCP tools available: [change_title]" or "MCP tools unavailable: bridge failed"
- Consider bundling the MCP server inline (no STDIO bridge) to eliminate the ajv resolution issue entirely

### Could Have
- A monitoring endpoint in the daemon that reports MCP bridge health per session
- Automatic retry of bridge startup if initial spawn fails

### Won't Have (Non-Goals)
- Changing the MCP SDK version or transport protocol
- Making the title change work without the MCP bridge (e.g., via direct tool registration)
- Solving the general monorepo dependency hoisting problem

## Edge Cases & Risks

- **Risk**: Removing the STDIO bridge in favor of inline MCP would require changes to how Claude SDK discovers tools (currently via stdio MCP protocol)
- **Edge case**: If the HTTP MCP server port is reused by another process between restart and bridge startup, the bridge will connect to the wrong service
- **Edge case**: yarn workspaces `nohoist` config may conflict with other packages that depend on ajv@6

## Acceptance Criteria

### AC1: Bridge startup failure is visible in daemon logs
- GIVEN a session is spawned by the daemon
- WHEN the STDIO bridge fails to start (e.g., ajv conflict)
- THEN the daemon log contains "MCP bridge failed: <error message>" within 10 seconds of session start

### AC2: Successful title change after daemon restart
- GIVEN the dev daemon has been restarted (`systemctl restart happy-daemon-dev`)
- WHEN a user sends a message to a session and Claude calls `mcp__happy__change_title`
- THEN the session title updates in both the session header and session list

### AC3: MCP bridge self-test on startup
- GIVEN `runClaude()` starts and creates the HTTP MCP server
- WHEN the STDIO bridge is about to be configured in mcpServers
- THEN a verification step confirms the HTTP server responds to a health-check request before proceeding

### AC4: ajv dependency is pinned and verified
- GIVEN `packages/happy-cli/package.json` contains `ajv@^8.17.1`
- WHEN `yarn install` is run at workspace root
- THEN `node -e "require('ajv')"` from within `packages/happy-cli/` resolves to ajv@8.x (not 6.x)

## Technical Hints

- Affected files: `packages/happy-cli/src/claude/utils/startHappyServer.ts`, `packages/happy-cli/src/codex/happyMcpStdioBridge.ts`, `packages/happy-cli/src/claude/runClaude.ts`, `packages/happy-cli/package.json`
- Related patterns: The `startHookServer` in the same codebase follows a similar pattern and could serve as reference
- The `projectPath()` function resolves to the happy-cli dist directory; bridge path is `dist/codex/happyMcpStdioBridge.mjs`
- Constraints: Must not change the MCP protocol or Claude SDK integration interface
