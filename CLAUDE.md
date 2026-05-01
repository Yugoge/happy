# CLAUDE.md

> Project-specific settings for happy
> Last updated: 2026-03-25

---

# Happy Monorepo

Yarn workspaces monorepo for the Happy platform.

## Package CLAUDE.md Files

Each package has its own CLAUDE.md with detailed guidelines. Always consult the relevant package's file:

- `packages/happy-server/CLAUDE.md` -- Server development, API patterns, Prisma, deployment
- `packages/happy-cli/CLAUDE.md` -- CLI architecture, daemon lifecycle, session protocol, deployment
- `packages/happy-cli/src/daemon/CLAUDE.md` -- Daemon control flow, state machine, WebSocket protocol
- `packages/happy-app/CLAUDE.md` -- React Native app, styling, i18n, routing, deployment

---

## Three-Layer Architecture

```
happy-app (browser/mobile React Native) <--WS--> happy-server (Fastify+PG) <--WS--> happy-cli (Daemon+CLI+Claude)
```

All data encrypted client-side before transmission. Server stores only encrypted blobs.

## Repository Structure

Monorepo layout mirrors `/root/happy`: packages `happy-server` (Fastify/Prisma/Postgres), `happy-cli` (daemon/CLI), `happy-app` (Expo web/mobile), `happy-wire` (protocol/Zod), `happy-agent` (ACP library); Dockerfiles: standalone server, server-slim, webapp; deployment compose lives in `/root/deploy/docker-compose.yml`.

## Shared Conventions

- **Package manager**: yarn (not npm) for workspace operations
- **TypeScript**: strict mode across all packages
- **Indentation**: 4 spaces
- **Imports**: `@/` alias maps to each package's source root
- **Encryption**: E2E via TweetNaCl (CLI) / libsodium (app), all data encrypted before leaving device
- **Testing**: Vitest across all packages
- **Token**: Uses `privacy-kit` library, NOT standard JWT

---

## Production Deployment

All Docker services managed via `/root/deploy/docker-compose.yml`.

| Service | Container | How it runs | Port | Build |
|---------|-----------|-------------|------|-------|
| **happy-server** | `happy-server` | Docker (compose build) | 3000->3005 | `Dockerfile.server-slim` |
| **happy-web** | `happy-web` | Docker (pre-built image) | 8090->80 | `Dockerfile.webapp` |
| **happy-web-dev** | `happy-web-dev` | Docker (pre-built image) | 8097->80 | `Dockerfile.webapp` |
| **happy-cli** | -- (systemd) | Host process, not Docker | -- | `npm install -g happy-coder` |

### Deploy Commands

`bash scripts/deploy.sh <server|web-prod|web-dev|cli-latest>` — rebuilds/restarts happy-server, production web (`happy-app:message-fixes`, `HAPPY_SERVER_URL=https://api.life-ai.app`), dev web (`happy-app:dev`, same API), or installs `happy-coder@latest`; container side effects occur in `/root/deploy`.

### Docker Image Tags

- Server: `happy-server-happy-server:latest`
- Web (production): `happy-app:message-fixes`
- Web (dev): `happy-app:dev`

### Cloudflare Tunnel Routes

| Domain | Service |
|--------|---------|
| `api.life-ai.app` | `http://localhost:3000` (happy-server) |
| `life-ai.app` | `http://localhost:8090` (happy-web, production) |
| `dev.life-ai.app` | `http://localhost:8097` (happy-web-dev) |

---

## Server Infrastructure

**Hardware**: Hetzner vServer, 16 vCPU, 32GB RAM, 20GB Swap
**Disk**: Single NVMe `/dev/sda1` (610G), all data on sda1, no external volumes

### Key Environment Variables

```
HAPPY_SERVER_URL=http://188.245.32.161:3000   # Direct IP, bypasses Cloudflare
IS_SANDBOX=1                                   # Bypass Claude CLI root permission check
```

### Database

```bash
docker exec -it happy-postgres psql -U yuge -d happydb
# User: yuge, Password: yuge1210, DB: happydb
# Note: `postgres` user cannot login
```

### Systemd Services

| Service | Purpose |
|---------|---------|
| `happy-daemon.service` | Default account daemon (`/root/.happy/`) |
| `happy-daemon-jade.service` | Jade account daemon (`/root/.happy-jade/`, account `cmmu4tj8f4gi5nv14xz4nr6ud`) |
| `happy-daemon-dev.service` | Dev account daemon (`/root/.happy-dev/`, account `cmi5mv9eh00wzpg14ph73jj3n`) |
| `happy-daemon-qijie.service` | Qijie account daemon (`/root/.happy-qijie/`, account `c0199b9c94ea34f0d457d2418`) |
| `happy-session-watcher.service` | Continuous session monitoring + auto-restore (monitors all 4 homes) |
| `happy-claude-cleanup.timer` | Hourly orphan Claude process cleanup |

---

## Encryption Key System

**Three key types -- NEVER confuse**:

| Key | Type | Encoding | Purpose |
|-----|------|----------|---------|
| `Account.publicKey` | Ed25519 signing | hex | Identity verification |
| `contentKeyPair.publicKey` | Curve25519 box | base64 | Encrypt machineKey/sessionKey |
| `machineKey` | AES-256 symmetric | base64 | Encrypt machine metadata |

### Key Derivation Chain

Key derivation: browser `localStorage['auth_credentials'].secret` (base64url masterSecret) → HMAC-SHA512 tree `deriveKey(masterSecret, 'Happy EnCoder', ['content'])` → 32-byte contentDataKey → libsodium Curve25519 `contentKeyPair`.

### deriveKey Implementation

```
deriveKey(master, usage, path):
  1. root = HMAC-SHA512(key="{usage} Master Seed", data=master) -> {key: first_32, chainCode: last_32}
  2. For each index in path: child = HMAC-SHA512(key=chainCode, data=0x00 || utf8(index))
  3. Return final key (32 bytes)
```

### access.key File Structure

`access.key` schema: `encryption.publicKey` = base64 Curve25519 box public key, `encryption.machineKey` = base64 AES-256 key, `token` = privacy-kit token (NOT standard JWT).

### Key Derivation Pitfall: CLI vs App

Both CLI and App derive the same keypair, but use different code paths:
- **CLI** (`encryption.ts`): `SHA512(contentDataKey).slice(0,32)` → `tweetnacl.box.keyPair.fromSecretKey`
- **App** (`encryption.ts`): `sodium.crypto_box_seed_keypair(contentDataKey)` (internally also SHA512)

These produce **identical** keys. But when manually creating `access.key`, you MUST use the correct derivation — the publicKey must match what the browser derives from the same masterSecret, or machine data decryption silently fails.

### Machine Registration: dataEncryptionKey

When daemon registers with `POST /v1/machines`, it encrypts `machineKey` with `publicKey`:
```
dataEncryptionKey = [version=0x00] + NaCl.box(machineKey, nonce, publicKey, ephemeralSecretKey)
```
Server stores this as bytea, returns as base64 in GET responses. Browser decrypts with `contentKeyPair.privateKey`.

**Critical**: `POST /v1/machines` does NOT update `dataEncryptionKey` for existing machines unless explicitly coded. If you change `publicKey` in `access.key`, delete the machine from DB first, then restart daemon.

### Key Source Files

- Derivation: `happy-app/sources/encryption/deriveKey.ts`
- Encryption.create(): `happy-app/sources/sync/encryption/encryption.ts`
- NaCl box: `happy-app/sources/encryption/libsodium.ts` (native) / `libsodium.lib.web.ts` (web uses `libsodium-wrappers`)
- CLI encryption: `happy-cli/src/api/encryption.ts`
- Machine DEK encrypt: `happy-cli/src/api/api.ts:279` (`libsodiumEncryptForPublicKey`)
- Machine DEK decrypt: `happy-app/sources/sync/encryption/encryption.ts:162` (`decryptEncryptionKey`)
- Server serialization: `happy-server/sources/app/api/routes/machinesRoutes.ts:149` (`Buffer.from(bytea).toString('base64')`)

---

## Session Lifecycle

### State Machine

```
ACTIVE (active=true, happy-cli running, session-alive heartbeats)
  -> OFFLINE: process exit (daemon notifySessionEnd) OR 2min heartbeat timeout
  -> ARCHIVED: manual archive (metadata.lifecycleState='archived')
```

### Heartbeat Parameters

| Heartbeat | Frequency | Source | Timeout |
|-----------|-----------|--------|---------|
| Session (session-alive) | SDK-driven | CLI apiSession.ts | 2 minutes |
| Machine (machine-alive) | 20 seconds | CLI apiMachine.ts | 20 minutes |
| Daemon local | 60 seconds | daemon/run.ts | N/A |

### Two Offline Paths

- **Path A (immediate)**: process exit -> daemon onChildExited -> apiMachine.notifySessionEnd -> server sets active=false
- **Path B (timeout)**: server timeout.ts every 1min checks lastActiveAt < 2min ago

### Session Creation

```
happy claude [--resume UUID]
  -> runClaude() -> apiClient.getOrCreateSession()
  -> POST /v1/sessions { tag, metadata(encrypted), agentState(encrypted), dataEncryptionKey(encrypted) }
  -> Server: tag idempotent (accountId + tag unique)
```

---

## Daemon Lifecycle

### Startup Flow

Startup flow: `happy daemon start` → `daemon/run.ts:startDaemon()` → lock `~/.happy/daemon.lock` → read `access.key` + encrypt machineKey → connect `apiMachine` WebSocket → start localhost HTTP control service → register `spawn-happy-session`/`stop-session` RPCs → write `daemon.state.json` → heartbeat every 60s.

### daemon.state.json

`daemon.state.json` stores `pid`, `httpPort`, `startTime`, `startedWithCliVersion`, `lastHeartbeat`, and `daemonLogPath` (example path `/root/.happy-jade/logs/daemon.log`).

### Quad Daemon Architecture

| | Default Daemon | Jade Daemon | Dev Daemon | Qijie Daemon |
|---|---|---|---|---|
| Home dir | `/root/.happy/` | `/root/.happy-jade/` | `/root/.happy-dev/` | `/root/.happy-qijie/` |
| Env var | default | `HAPPY_HOME_DIR=/root/.happy-jade` | `HAPPY_HOME_DIR=/root/.happy-dev` | `HAPPY_HOME_DIR=/root/.happy-qijie` |
| systemd | `happy-daemon.service` | `happy-daemon-jade.service` | `happy-daemon-dev.service` | `happy-daemon-qijie.service` |
| Account | default | jade (`cmmu4tj8f4gi5nv14xz4nr6ud`) | dev (`cmi5mv9eh00wzpg14ph73jj3n`) | qijie (`c0199b9c94ea34f0d457d2418`) |
| Purpose | Production sessions | Production sessions (jade) | **Dev/overnight testing** | **Production sessions (qijie)** |

### Auto-Upgrade

Heartbeat detects version mismatch (package.json on disk vs compiled version) -> spawn new daemon -> new daemon HTTP /stop on old -> takeover.

---

## Message Flow

```
Claude SDK output (stream-json JSONL)
  -> CLI parse -> encrypt -> POST /v3/sessions/{sessionId}/messages
  -> Server: create SessionMessage(content=encrypted blob), increment seq
  -> WebSocket broadcast "new-message"
  -> Browser/phone receive -> decrypt -> render
```

### Envelope Types (for rendering)

| Type | Description |
|------|-------------|
| `wrap` | Collapsible skill/command prompt (label + content) |
| `service` | System notifications (gray text) |
| `text` | Regular messages |
| `tool-call-start`/`tool-call-end` | Tool lifecycle |
| `start`/`stop` | Subagent lifecycle |

---

## Server API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /v1/sessions` | GET | All sessions (unfiltered) |
| `GET /v2/sessions/active` | GET | Active sessions within 15min |
| `POST /v1/sessions` | POST | Create/get session (tag idempotent) |
| `POST /v1/sessions/:id/reactivate` | POST | Reactivate offline session |
| `POST /v3/sessions/:id/messages` | POST | Send message (limit 500 per request) |
| `POST /v1/machines` | POST | Register machine |

### WebSocket Events

- Client->Server: `session-alive`, `session-end`, `machine-alive`, `message`, `rpc-request`
- Server->Client: `update`, `rpc-request`, `ephemeral`

---

## Session Recovery System

**Primary script**: `/root/bin/happy-session-recovery.sh`

### Key Commands

Key commands: `bash /root/bin/happy-session-recovery.sh save|check|restore|history 10|snapshots 48`; single-session recovery is `recover <uuid> [working-dir] --home <home-dir>` and must include `--home`.

**CRITICAL: To restore a single session, use `recover <uuid>`. NEVER manually edit `session_dirs.txt` — the session-watcher monitors this file and any change triggers a full restore of ALL sessions.**

### Recovery Files

- `~/.happy/session_dirs.txt` -- UUID:working_dir per line (**READ-ONLY for agents — never edit directly**)
- `~/.happy/session_history.jsonl` -- add/remove event log
- `~/.happy/session_backup_history/` -- timestamped JSON snapshots

### Manual Session Spawn (bypassing recovery script)

```bash
cd /root/knowledge-system-jade
HAPPY_HOME_DIR=/root/.happy-jade HAPPY_SERVER_URL=http://188.245.32.161:3000 IS_SANDBOX=1 \
  nohup node /root/happy/packages/happy-cli/dist/index.mjs claude \
  --happy-starting-mode remote --started-by daemon --resume "$UUID" > /dev/null 2>&1 &
```

---

## Debugging happy-web with Playwright

### Playwright MCP Setup

Playwright MCP is globally configured with anti-detection on this server:
- Stealth wrapper: `/usr/local/bin/playwright-mcp-stealth`
- Config tool: `/usr/local/bin/playwright-mcp-global-config`
- 9 anti-detection Chrome flags (disable AutomationControlled, custom user-agent, etc.)
- Xvfb virtual display at `:99` (1920x1080x24)

```bash
# Check status
playwright-mcp-global-config status

# Restart with anti-detection
playwright-mcp-global-config restart
```

### Direct Authentication (Bypass QR Code)

To connect to a happy account via Playwright without scanning QR code, inject auth credentials into the browser's localStorage.

#### Pre-configured Credentials (Default Account)

Account ID: `cmi5mv9eh00wzpg14ph73jj3n`

```
AUTH_CREDENTIALS_JSON='{"token":"eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJjbWk1bXY5ZWgwMHd6cGcxNHBoNzNqajNuIiwiaWF0IjoxNzczNDc4MzIwLCJuYmYiOjE3NzM0NzgzMjAsImlzcyI6ImhhbmR5IiwianRpIjoiOGE2MTRjNDAtMWVhNS00ZGRjLWFiYjgtYmI2NDdhZjNhNDVlIn0.qtK1jZFkprfJXyJ_DzuDX5yAXgUWVPzxRKLGdQSENueFC3u7xPwBT0Y9fsntDCJD5Q4eg2JZXMriqyBRx6lCBw","secret":"gWwKFlcU7I3OixXUE-aiUEEEZyzRCQSL583hd3WgALs"}'
```

#### Playwright Login Flow

**IMPORTANT**: You must also set the server URL in MMKV, otherwise all API calls go to the wrong server (`api.cluster-fluster.com`).

`scripts/playwright-login-production.js` — Playwright helper for `https://life-ai.app`; injects the `AUTH_CREDENTIALS_JSON` above and MMKV `server-config\custom-server-url=https://api.life-ai.app`, then reloads.

#### Alternative: Generate Fresh Token for CLI access.key

If you need to connect a daemon to an existing account (not browser):

`bash scripts/generate-access-key-material.sh <masterSecret-base64url> <account-id>` — derives the base64 Curve25519 publicKey with libsodium and mints a privacy-kit token using the `handy` seed; it does not edit `access.key` or restart daemons. Full guide: `/root/docs/ACCOUNT-MIGRATION.md` Section 11.3


---

## Key Timeout Parameters

| Parameter | Value | Location | Configurable |
|-----------|-------|----------|-------------|
| Session offline timeout | 2 min | server presence/timeout.ts | hardcoded |
| Machine offline timeout | 20 min | server presence/timeout.ts | hardcoded |
| Machine heartbeat | 20 sec | cli apiMachine.ts:299 | hardcoded |
| Daemon local heartbeat | 60 sec | cli daemon/run.ts:723 | `HAPPY_DAEMON_HEARTBEAT_INTERVAL` |
| Session webhook wait | 15 sec | cli daemon/run.ts:577 | hardcoded |
| Timeout loop frequency | 1 min | server presence/timeout.ts | hardcoded |
| Daemon HTTP request timeout | 10 sec | cli controlClient.ts | `HAPPY_DAEMON_HTTP_TIMEOUT` |
| Recovery peak protection | 30 min | bin/happy-session-recovery.sh | hardcoded |
| Recovery watcher frequency | 60 sec | bin/happy-session-recovery.sh | `POLL_INTERVAL` |

---

## Plan A: Always-Online (Partially Implemented)

Commit `38226fc9` -- "Plan A: keep happy-cli alive when Claude process dies"

**Implemented**: Claude crash -> happy-cli stays alive in while loop, crash counter max 5, `--resume` restarts.

**Not implemented**: Idle timer (auto-exit Claude after N minutes of no interaction to save RAM, respawn on new message).

**Current behavior**: After Claude completes a task, it blocks forever in `waitForMessagesAndGetAsString(signal)`.

Full plan: `/root/docs/ALWAYS-ONLINE-PLAN.md`

---

## Key Source Files

### Authentication
- `happy-cli/src/ui/auth.ts` -- QR flow
- `happy-cli/src/api/auth.ts` -- Auth client
- `happy-cli/src/persistence.ts` -- Credential storage (access.key)

### Encryption
- `happy-cli/src/api/encryption.ts` -- CLI-side NaCl encryption
- `happy-app/sources/sync/encryption/encryption.ts` -- App-side Encryption.create()
- `happy-app/sources/encryption/deriveKey.ts` -- Key derivation

### Daemon
- `happy-cli/src/daemon/run.ts` -- Main lifecycle
- `happy-cli/src/daemon/controlClient.ts` -- HTTP client to daemon
- `happy-cli/src/daemon/controlServer.ts` -- HTTP control endpoints
- `happy-cli/src/api/apiMachine.ts` -- Machine WebSocket, heartbeat

### Session
- `happy-server/sources/app/api/routes/sessionRoutes.ts` -- Session REST API
- `happy-cli/src/api/apiSession.ts` -- Session WebSocket client
- `happy-server/sources/app/presence/timeout.ts` -- Timeout management

### Claude Integration
- `happy-cli/src/claude/claudeRemoteLauncher.ts` -- While loop, mode detection, crash recovery
- `happy-cli/src/claude/claudeRemote.ts` -- SDK call, nextMessage, result handling
- `happy-cli/src/claude/runClaude.ts` -- Mode hash calculation
- `happy-cli/src/claude/sdk/query.ts` -- Claude process spawn

### Session Protocol
- `happy-wire/src/sessionProtocol.ts` -- Envelope type definitions
- `happy-cli/src/claude/sessionProtocolMapper.ts` -- JSONL -> SessionEnvelopes
- `happy-app/sources/sync/typesRaw.ts` -- Normalization for rendering

---

## Dev-Overnight Environment

The `happy-dev` instance is dedicated for autonomous development and testing. Sessions running under happy-dev daemon can safely:

- **Rebuild & deploy** `happy-web-dev` (image `happy-app:dev`, port 8097) without affecting production
- **Restart** `happy-daemon-dev.service` -- only kills dev sessions, not production
- **Use Playwright** to test `http://localhost:8097` (dev web) with injected auth credentials
- **Run builds**: `yarn build` in any package, type-check, lint

### Dev-Overnight Safety Boundaries

- **SAFE**: rebuild `happy-app:dev`, restart `happy-web-dev`, restart `happy-daemon-dev`
- **UNSAFE**: touch `happy-app:message-fixes` (production web), `happy-server`, default/jade daemons
- **NEVER**: restart Docker daemon, stop happy-server, modify production images

### Playwright Debug for Dev Web

DEV_AUTH_CREDENTIALS_JSON='{"token":"eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJjbW41dmxma3cwMDAwbGQzbHlxZGd6MWx3IiwiaWF0IjoxNzc0NDMzMDM2LCJuYmYiOjE3NzQ0MzMwMzYsImlzcyI6ImhhbmR5IiwianRpIjoiNzhmMDg0OGItNjIxMC00ZDlhLTk0YTctZjJiOTVkOTY2MzM3In0.2-X3j3nxZsXdEsD1Q-CyWTLeFwnmxBxUUWSwBLCUWW_Y710bU11CMlh0voLSH7zxc9YRUd-K6mphBqg_4DEcBw","secret":"Zd78yMPVHtUYnbR9yWWdBgzecja4UHwXaAF8Jody7Ag"}'

**CRITICAL**: The web app needs THREE localStorage entries to work properly:
1. `auth_credentials` -- token + masterSecret for authentication and encryption
2. `mmkv.server-config\custom-server-url` -- API server URL (without this, app defaults to `api.cluster-fluster.com` which is wrong)
3. Sessions must exist for machine cards to appear (empty account shows "Ready to code?" even if machine is online)

`scripts/playwright-login-dev-web.js` — Playwright helper for `https://dev.life-ai.app`; injects `DEV_AUTH_CREDENTIALS_JSON`, MMKV `server-config\custom-server-url=https://api.life-ai.app`, then reloads (app should load with dev account).

### Web App Server URL Architecture

The server URL is determined by `sync/serverConfig.ts` with this priority:
1. MMKV `server-config` storage key `custom-server-url` (highest)
2. `process.env.EXPO_PUBLIC_HAPPY_SERVER_URL` (build-time env)
3. Hardcoded default `https://api.cluster-fluster.com` (lowest -- **WRONG for our server**)

**CRITICAL**: Docker builds MUST pass the correct `--build-arg HAPPY_SERVER_URL`:
- **Production** (`happy-app:message-fixes`): `HAPPY_SERVER_URL=https://api.life-ai.app` -- build from `/root/happy`
- **Dev** (`happy-app:dev`): `HAPPY_SERVER_URL=https://api-dev.life-ai.app` -- build from `/dev/shm/dev-workspace/happy-dev` or worktree
- Without this arg, fresh builds connect to the wrong server and return 401.

**Key gotcha**: MMKV instances are domain-scoped. Each MMKV `id` maps to a separate localStorage prefix:
- `mmkv.default\...` -- general app storage (profile, settings, changelog)
- `mmkv.server-config\...` -- server config (custom URL, persists across logouts)

### UI Behavior with No Sessions

`SessionsListWrapper.tsx` decides what to show:
- `sessionListViewData === null` → loading spinner
- `sessionListViewData.length === 0` → `EmptyMainScreen` ("Ready to code?")
- `sessionListViewData.length > 0` → `SessionsList` (machine cards + sessions)

Machine cards are rendered as part of the session list, NOT independently. So a machine can be online and decrypted correctly, but if there are zero sessions, the UI shows the empty state instead.

### Spawning a Test Session via Daemon HTTP

Use the dev web UI at https://dev.life-ai.app to create test sessions; do not create sessions through daemon HTTP/API helpers because the safety hook forbids code-created sessions.

### Web Auth Pages (Mobile/Desktop Browser Login)

Password-protected static HTML pages that inject `auth_credentials` + server URL into localStorage, then redirect to the app. Deployed via volume mount (`/root/deploy/auth-pages/` → `/usr/share/nginx/html/auth/` in happy-web and happy-web-dev containers).

| Account | URL | Password |
|---------|-----|----------|
| Default | `https://life-ai.app/auth/default` | `1900015516` |
| Jade | `https://life-ai.app/auth/jade` | `1900015516` |
| Qijie | `https://life-ai.app/auth/qijie` | `15828522037` |
| Dev | `https://dev.life-ai.app/auth/dev` | `1900015516` |

**Files**: `/root/deploy/auth-pages/{default,jade,qijie,dev}/index.html`

**How it works**: Password verified via charCode comparison (no crypto.subtle dependency for compatibility with Chinese domestic browsers). On success: sets `localStorage['auth_credentials']` and `localStorage['mmkv.server-config\custom-server-url']`, then redirects to app root.

**Key constraints**:
- Must use HTTPS (crypto.subtle required by app for key derivation)
- Auth page includes HTTP→HTTPS auto-redirect for domestic browser compatibility
- Volume mount is read-only (`:ro`), pages update without container restart
- Docker compose: `./auth-pages:/usr/share/nginx/html/auth:ro` on both happy-web and happy-web-dev

---

## Critical Operational Rules

1. **NEVER** stop/restart happy daemon without saving session snapshot first
2. **NEVER** delete session data without backup + explicit confirmation
3. **NEVER** use `docker run` -- always `docker compose up -d` from `/root/deploy/`
4. **NEVER** confuse `Account.publicKey` (Ed25519 hex) with `contentKeyPair.publicKey` (Curve25519 base64)
5. **NEVER** restart daemon from within a daemon-managed Claude session (cgroup kill)
6. **NEVER** write/rsync/cp files from `/root/happy-dev/` into `/root/happy/packages/` — use git merge/cherry-pick only
7. **NEVER** use raw `systemctl start/stop` for daemon — always use `bash /root/bin/happy-restart.sh` (it handles orphan process cleanup, lock clearing, and session recovery)
8. **NEVER** treat happy-dev daemon the same as default/jade — dev uses independent source at `/root/happy-dev/`, not the global binary
9. Safe Docker restart: `docker restart happy-server` or `happy-web` (doesn't affect daemon/sessions)
10. Before daemon restart: `bash /root/bin/happy-session-recovery.sh save && check` -> get user confirmation
11. After every CLI build: verify binary with 3-point check (sendExisting, no shouldHideParentToolCall, Task||Agent present)
12. Session recovery `save`/`restore` in systemd ExecStartPre/ExecStartPost must use `--home <dir>` to scope to the starting daemon only — global restore causes cross-daemon cascade (Bug #61, 2026-04-05)

---

## Critical Build & Recovery Rules (from 2026-03-26 postmortem)

### Build: ALWAYS from /root/happy, NEVER from /root/happy-dev

`bash scripts/build-cli-production.sh` — builds `packages/happy-cli` and globally installs from `/root/happy` only; **NEVER** build/install from `/root/happy-dev` because dev worktrees can contaminate production binary.

After every build, verify BOTH critical markers in the compiled output:
`bash scripts/verify-cli-build.sh` — checks installed `happy-coder` for `sendExisting > 0`, `shouldHideParentToolCall == 0`, and `Task.*Agent > 0`; fail any check before restarting production daemons.

**Why `sendExisting`**: Controls .jsonl history upload on resume. Lost once via dev branch commit `1612a409`.

**Why `shouldHideParentToolCall`**: This function only exists in `/root/happy-dev/`. If present in the installed binary, it means the binary was built from contaminated source. It causes all Agent tool sidechain messages to use mismatched IDs, making agent blocks appear empty. This went undetected for 6 days (Bug #59).

### NEVER write to /root/happy/packages/ from external sources

```bash
# FORBIDDEN — any of these contaminate production source:
rsync ... /root/happy-dev/... /root/happy/packages/...
cp /root/happy-dev/.../file /root/happy/packages/.../file
# The ONLY way to get code into /root/happy is via git (merge/cherry-pick)
```

**Why**: On 2026-03-28, a dev-overnight agent rsynced worktree code into `/root/happy/packages/` then built from it. The binary contained a dev branch function that broke all sidechain rendering for 6 days. The source was later cleaned via git but the installed binary was never rebuilt.

### Recovery: spawn interval must be >= 5 seconds

When mass-spawning sessions (recovery, restart), each process needs time to initialize (auth, WebSocket, Claude SDK). Spawning at 3-second intervals causes resource contention and process death. The recovery script uses `sleep 5` between spawns.

### Recovery: `--resume` is the ONLY viable path, `--recover-session` does NOT work

`daemon_spawn_session()` uses `--resume $claude_uuid` (passed to Claude SDK as unknownArg). `--recover-session` is NOT an alternative — it triggers `runClaude.ts` full startup which fails with "Claude Code is not installed" because this server doesn't have a global Claude Code binary. `--resume` works because it flows through happy-cli's built-in SDK wrapper (`claude_remote_launcher.cjs`), bypassing the global binary check.

The full recovery chain: `--resume` loads Claude .jsonl history + `sendExisting=true` uploads it to happy-server = app sees complete conversation. If `sendExisting` is missing from the build, resumed sessions appear empty in the app. **This is the life-or-death variable.**

### Session recovery system: three-layer defense

1. **Cold boot detection** (`is_cold_boot()` via boot_id): prevents `ExecStartPre save` from overwriting `session_dirs.txt` after reboot
2. **Peak merge** (`PEAK_PROTECT_SECONDS=28800`): even if overwritten, merges with best historical snapshot within 8h window
3. **Periodic snapshots** (`PERIODIC_SNAPSHOT_INTERVAL=900`): writes JSON snapshot every 15min even during stable state, keeps peak window fresh

Full postmortem: `/root/docs/REBOOT-RECOVERY-POSTMORTEM.md`

---

## Documentation References

| Doc | Path | Topics |
|-----|------|--------|
| Architecture | `/root/docs/HAPPY-ARCHITECTURE.md` | Full 18-section deep dive |
| Account Migration | `/root/docs/ACCOUNT-MIGRATION.md` | Key derivation, QR bypass (Section 11.3) |
| Always-Online Plan | `/root/docs/ALWAYS-ONLINE-PLAN.md` | Persistent session architecture |
| Session Recovery | `/root/docs/SESSION-RECOVERY.md` | Recovery system v1 + v2 |
| Bug Fixes | `/root/docs/BUG-FIXES.md` | 60 bugs documented |
| Sidechain Bug | `/root/docs/SIDECHAIN-DISPLAY-BUG-INVESTIGATION.md` | Resolved: dev branch contamination |
| Docker Build | `/root/docs/DOCKER-BUILD.md` | Build commands, troubleshooting |
| Disk Architecture | `/root/docs/DISK-ARCHITECTURE.md` | Single-disk NVMe layout |
| Playwright Setup | `/root/docs/PLAYWRIGHT-SETUP.md` | Anti-detection MCP config |
| Server Setup | `/root/docs/SERVER-SETUP.md` | Systemd services, IS_SANDBOX |
| Claude Exit Investigation | `/root/docs/CLAUDE-SESSION-EXIT-INVESTIGATION.md` | Mode hash, context compaction |
| Implementation Notes | `/root/docs/IMPLEMENTATION-NOTES.md` | AsyncLock, backoff, protocol internals |
| Web Auth Pages | `/root/docs/WEB-AUTH-PAGES.md` | Mobile browser login, auth page setup, qijie account creation |
