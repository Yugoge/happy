# CLAUDE.md

> Project-specific settings for happy-dev
> Last updated: 2026-03-27

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

`bash scripts/deploy-services.sh <server|web-prod|web-dev|cli-latest>` — server/prod web still target production paths, while `web-dev` builds `happy-app:dev` from this happy-dev repo with `HAPPY_SERVER_URL=https://api-dev.life-ai.app` and restarts `happy-web-dev` in `/root/deploy`.

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
| `happy-session-watcher.service` | Continuous session monitoring + auto-restore (monitors all 3 homes) |
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

### Key Source Files

- Derivation: `happy-app/sources/encryption/deriveKey.ts`
- Encryption.create(): `happy-app/sources/sync/encryption/encryption.ts`
- NaCl box: `happy-app/sources/encryption/libsodium.ts` (native) / `libsodium.lib.web.ts` (web uses `libsodium-wrappers`)
- Machine DEK encrypt: `happy-cli/src/api/api.ts:279` (`libsodiumEncryptForPublicKey`)
- Machine DEK decrypt: `happy-app/sources/sync/encryption/encryption.ts:162` (`decryptEncryptionKey`)
- Server serialization: `happy-server/sources/app/api/routes/machinesRoutes.ts:149` (`Buffer.from(bytea).toString('base64')`)

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

- CLI encryption: `happy-cli/src/api/encryption.ts`

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

### Triple Daemon Architecture

| | Default Daemon | Jade Daemon | Dev Daemon |
|---|---|---|---|
| Home dir | `/root/.happy/` | `/root/.happy-jade/` | `/root/.happy-dev/` |
| Env var | default | `HAPPY_HOME_DIR=/root/.happy-jade` | `HAPPY_HOME_DIR=/root/.happy-dev` |
| systemd | `happy-daemon.service` | `happy-daemon-jade.service` | `happy-daemon-dev.service` |
| Account | default | jade (`cmmu4tj8f4gi5nv14xz4nr6ud`) | dev (`cmi5mv9eh00wzpg14ph73jj3n`) |
| Purpose | Production sessions | Production sessions (jade) | **Dev/overnight testing** |

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

```bash
bash /root/bin/happy-session-recovery.sh save       # Save current session snapshot
bash /root/bin/happy-session-recovery.sh check      # Check saved sessions
bash /root/bin/happy-session-recovery.sh restore     # Restore saved sessions
bash /root/bin/happy-session-recovery.sh history 10  # Show event history
bash /root/bin/happy-session-recovery.sh snapshots 48  # Show snapshots from last 48h
```

### Recovery Files

- `~/.happy/session_dirs.txt` -- UUID:working_dir per line
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

`scripts/playwright-login-dev.js` — Playwright helper for `https://dev.life-ai.app`; injects `AUTH_CREDENTIALS_JSON` above and MMKV `server-config\custom-server-url=https://api-dev.life-ai.app`, then reloads so sessions come from the DEV API.

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

### Dev-Overnight Worktree Build & Deploy (MANDATORY for QA)

**Problem**: `docker-compose.yml` hardcodes `build.context: /root/happy` for `happy-server-dev`. Worktree changes are NOT picked up by `docker compose build`. You MUST use `docker build` directly with the worktree path as context.

**Frontend/backend from worktree**: `bash scripts/dev-overnight-build-deploy.sh <worktree-path> [frontend|backend|all]` — builds `happy-app:dev` with `HAPPY_SERVER_URL=https://api-dev.life-ai.app` and/or `happy-server-dev:latest` from the absolute worktree context, then restarts only `happy-web-dev`/`happy-server-dev`.

**Rules:**
- NEVER use `docker compose build` for dev services during overnight — it reads from `/root/happy` not the worktree
- NEVER use `HAPPY_SERVER_URL=https://api.life-ai.app` for dev — that's production
- NEVER build dev from `/root/happy` — build from the worktree or `/dev/shm/dev-workspace/happy-dev`
- After `docker compose up -d`, wait 5s then verify: `curl -s http://localhost:3005/health` (backend), `curl -s http://localhost:8097/ | head -1` (frontend)
- Both Dockerfiles use relative paths only — any directory with the monorepo structure works as context

**Isolation verification (all must be true):**
| Check | Command | Expected |
|-------|---------|----------|
| Dev web port | `curl -s http://localhost:8097/ \| head -c 50` | HTML content |
| Dev API port | `curl -s http://localhost:3005/health` | `{"status":"ok"}` |
| Prod web port | `curl -s http://localhost:8090/ \| head -c 50` | HTML content (DIFFERENT image) |
| Prod API port | `curl -s http://localhost:3000/health` | `{"status":"ok"}` (DIFFERENT container) |
| Dev DB | `docker exec happy-postgres-dev psql -U yuge -d happydb_dev -c "SELECT 1"` | success |
| Prod DB | `docker exec happy-postgres psql -U yuge -d happydb -c "SELECT 1"` | success (DIFFERENT) |

## Dev-Overnight Verification Protocol

This section makes the global "Long-Running Process Verification" rule concrete for happy-dev. Three classes of cycle, each with its own verification path:

### Cycle classes

| Class | Targets | Restart needed? | Verification path |
|---|---|---|---|
| **A: happy-app (web)** | `packages/happy-app/**` | No — Expo HMR or `docker compose up -d happy-web-dev` | Playwright on `http://localhost:8097` |
| **B: happy-server** | `packages/happy-server/**` | Yes — `docker compose up -d happy-server-dev` (container restart, daemons unaffected) | `curl http://localhost:3005/health` then UI |
| **C: happy-cli daemon** | `packages/happy-cli/src/daemon/**`, `packages/happy-cli/src/api/apiMachine.ts`, anything loaded by the live daemon process | **YES — and MUST be PAUSE-PENDING-USER or sandbox-only for subagents** | see below |

### Cycle C — daemon code changes

A subagent that changes daemon code MUST pick exactly one of:

1. **Sandbox daemon mode** (preferred for autonomous cycles):
   ```bash
   SANDBOX_HOME=$(mktemp -d /tmp/happy-sandbox-XXXX)
   cp /root/.happy-dev/access.key $SANDBOX_HOME/   # if testing with dev account
   HAPPY_HOME_DIR=$SANDBOX_HOME \
   HAPPY_SERVER_URL=http://localhost:3005 \
   IS_SANDBOX=1 \
     node /dev/shm/dev-workspace/happy-dev/packages/happy-cli/dist/index.mjs daemon start
   ```
   Verify the change against the sandbox daemon. The live `happy-daemon-dev.service` is untouched.

2. **PAUSE-PENDING-USER**: output a REQUEST naming the SOP command (`/root/bin/safe-daemon-restart.sh dev --reason "<text>"`) and stop. User runs it.

**Forbidden** for subagents (in any cycle): direct `systemctl restart happy-daemon-*`, daemon HTTP `POST /stop`, `kill` against `happy-cli` PIDs, writing the restart command into a `/tmp/*.sh` to bypass the bash-safety hook.

### safe-daemon-restart SOP (user-only entry point)

`/root/bin/safe-daemon-restart.sh <dev|default|jade> [--reason <text>] [--no-confirm] [--prod-acknowledged]` is the only sanctioned daemon restart path. It runs pre-flight save → confirmation gate → graceful stop → start → post-flight recover + audit log. Subagents must never invoke it directly; they output a REQUEST and let the user run it from a TTY.

### Hook bypass — project-specific consequences

The global "Subagent Hook Discipline" rule applies. In happy-dev specifically, the bash-safety hook blocks: `npm install -g`, `/usr/bin/happy`, `systemctl restart` against non-dev units, `kill` with bare PIDs, writes to `/usr/lib/node_modules/happy*`, and exact-name matches on `happy-session-recovery.sh`. If a hook rejects an operation here, the correct action is REQUEST to user — never wrap in `nohup`/`systemd-run`/`/tmp/*.sh`.

### Why hook files may contain project-specific names while skill files may not

Hooks are **execution artifacts** — they are configuration that enforces rules at runtime. Project-specific service names (`happy-daemon-dev`, etc.) appearing inside a hook variable are configuration data, not a layering violation. Skill / command / agent files are **declarative artifacts** — documentation that ships across projects. A project-specific identifier in a skill file pollutes other projects that import the same skill set. Therefore: project names live freely in hooks (`~/.claude/hooks/*.sh`) and in this project's CLAUDE.md, but never in shared skill / command / agent prompts.

### Playwright Debug for Dev Web

DEV_AUTH_CREDENTIALS_JSON='{"token":"eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJjbWk1bXY5ZWgwMHd6cGcxNHBoNzNqajNuIiwiaWF0IjoxNzczNDc4MzIwLCJuYmYiOjE3NzM0NzgzMjAsImlzcyI6ImhhbmR5IiwianRpIjoiOGE2MTRjNDAtMWVhNS00ZGRjLWFiYjgtYmI2NDdhZjNhNDVlIn0.qtK1jZFkprfJXyJ_DzuDX5yAXgUWVPzxRKLGdQSENueFC3u7xPwBT0Y9fsntDCJD5Q4eg2JZXMriqyBRx6lCBw","secret":"gWwKFlcU7I3OixXUE-aiUEEEZyzRCQSL583hd3WgALs"}'

**CRITICAL**: The web app needs THREE localStorage entries to work properly:
1. `auth_credentials` -- token + masterSecret for authentication and encryption
2. `mmkv.server-config\custom-server-url` -- API server URL (without this, app defaults to `api.cluster-fluster.com` which is WRONG)
3. Sessions must exist for machine cards to appear (empty account shows "Ready to code?" even if machine is online)

`scripts/playwright-login-dev.js` — Playwright helper for `https://dev.life-ai.app`; injects `DEV_AUTH_CREDENTIALS_JSON`, MMKV `server-config\custom-server-url=https://api-dev.life-ai.app` (never production API), then reloads.

### Web App Server URL Architecture

The server URL is determined by `sync/serverConfig.ts` with this priority:
1. MMKV `server-config` storage key `custom-server-url` (highest)
2. `process.env.EXPO_PUBLIC_HAPPY_SERVER_URL` (build-time env)
3. Hardcoded default `https://api.cluster-fluster.com` (lowest -- **WRONG for our server**)

**CRITICAL**: Docker builds MUST pass the correct `--build-arg HAPPY_SERVER_URL`:
- **Production** (`happy-app:message-fixes`): `HAPPY_SERVER_URL=https://api.life-ai.app` — build from `/root/happy`
- **Dev** (`happy-app:dev`): `HAPPY_SERVER_URL=https://api-dev.life-ai.app` — build from `/dev/shm/dev-workspace/happy-dev` or worktree
- Without this arg, fresh builds connect to the wrong server and return 401.

**Key gotcha**: MMKV instances are domain-scoped. Each MMKV `id` maps to a separate localStorage prefix:
- `mmkv.default\...` -- general app storage (profile, settings, changelog)
- `mmkv.server-config\...` -- server config (custom URL, persists across logouts)

---

## ABSOLUTE ISOLATION: happy-dev must NEVER touch production happy (2026-04-04 incident)

**On 2026-04-04, `npm install -g` from a worktree replaced the global `/usr/bin/happy` binary, triggered auto-upgrade, killed the production daemon, and destroyed ALL production sessions. This is enforced by hook.**

- **NEVER** run `npm install -g` from happy-dev, worktrees, or /dev/shm — FORBIDDEN by hook
- **NEVER** invoke `/usr/bin/happy` or `happy --version` or `happy daemon` — FORBIDDEN by hook; triggers auto-upgrade
- **NEVER** modify `/usr/lib/node_modules/happy*` or `/usr/bin/happy` — FORBIDDEN by hook
- **NEVER** run `kill` with PIDs — FORBIDDEN by hook; use daemon HTTP /stop or systemctl
- The global CLI is shared by ALL 3 daemons. Touching it affects EVERYONE.
- To deploy CLI changes to dev: use `node <worktree>/dist/index.mjs` directly, NEVER npm install -g
- Only the USER may install the global CLI manually from `/root/happy`

### Three Daemon Binary Architecture (NEVER confuse)

| Daemon | Source tree | Binary path | Server |
|--------|-----------|-------------|--------|
| default | `/root/happy/` | `node /root/happy/packages/happy-cli/dist/index.mjs` | `http://188.245.32.161:3000` (prod) |
| jade | `/root/happy/` | `node /root/happy/packages/happy-cli/dist/index.mjs` | `http://188.245.32.161:3000` (prod) |
| **dev** | **`/root/happy-dev/`** | **`node /root/happy-dev/packages/happy-cli/dist/index.mjs`** | **`http://localhost:3005`** (dev) |

- default/jade build: `cd /root/happy/packages/happy-cli && yarn build`
- **dev build**: `cd /root/happy-dev/packages/happy-cli && yarn build`
- **NEVER** build dev from `/root/happy`. **NEVER** build prod from `/root/happy-dev`.
- Dev daemon startup: `cd /root && HAPPY_HOME_DIR=/root/.happy-dev HAPPY_SERVER_URL=http://localhost:3005 IS_SANDBOX=1 nohup node --no-warnings --no-deprecation /root/happy-dev/packages/happy-cli/dist/index.mjs daemon start < /dev/null > /dev/null 2>&1 &`
- Prod daemon restart: `bash /root/bin/happy-restart.sh` (NEVER raw systemctl)

## Hook Enforcement Summary

| Hook | Scope | What it blocks |
|------|-------|---------------|
| `pretool-bash-safety.sh` | Bash | npm install -g, /usr/bin/happy, kill PIDs, rm, systemctl prod, docker prod |
| `pretool-block-production-files.sh` | Write, Edit | Any file in /root/happy/, /root/.happy/, /root/.happy-jade/, /usr/lib/node_modules/happy*, /usr/bin/happy* |
| `pretool-block-production.sh` | Playwright, WebFetch | life-ai.app (non-dev), localhost:8090, localhost:3000 |

## Critical Operational Rules

1. **NEVER** stop/restart happy daemon without saving session snapshot first
2. **NEVER** delete session data without backup + explicit confirmation
3. **NEVER** use `docker run` -- always `docker compose up -d` from `/root/deploy/`
4. **NEVER** confuse `Account.publicKey` (Ed25519 hex) with `contentKeyPair.publicKey` (Curve25519 base64)
5. **NEVER** restart daemon from within a daemon-managed Claude session (cgroup kill)
6. Safe Docker restart: `docker restart happy-server` or `happy-web` (doesn't affect daemon/sessions)
7. Before daemon restart: `bash /root/bin/happy-session-recovery.sh save && check` -> get user confirmation
8. **NEVER access production (life-ai.app, localhost:8090)**. ALL testing MUST use dev (dev.life-ai.app, localhost:8097) ONLY. This is enforced by hook. Violating this will corrupt production data.
9. **NEVER use code/API/curl to create sessions**. ALWAYS use the normal UI workflow: navigate to dev.life-ai.app -> click "Start New Session" or the + button -> type a message -> send. Subagents that bypass the UI to create sessions via daemon HTTP or API calls will be terminated.

---

## ABSOLUTE PROHIBITIONS FOR ALL SUBAGENTS (2026-03-29 incident)

**These rules exist because subagents violated them and corrupted production data. Non-negotiable.**

### Production Access is FORBIDDEN

- **NEVER** navigate Playwright to `https://life-ai.app` (production web)
- **NEVER** navigate Playwright to `http://localhost:8090` (production web container)
- **NEVER** navigate Playwright to `https://api.life-ai.app` directly (production API)
- **ONLY** use `https://dev.life-ai.app` or `http://localhost:8097` (dev web)
- **ONLY** use `https://api-dev.life-ai.app` (dev API)
- This is enforced by `pretool-block-production.sh` hook. Any attempt will be blocked.
- If dev has no sessions, CREATE ONE via the UI. Do NOT "fall back" to production.

### Session Creation MUST Use the UI

- **NEVER** use `curl` to POST to `/spawn-session` or any daemon HTTP endpoint
- **NEVER** use `curl` to POST to `/v1/sessions` or any server API endpoint
- **ALWAYS** create sessions through the normal UI workflow:
  1. Navigate to `https://dev.life-ai.app`
  2. Click "Start New Session" button or the + icon in the sidebar
  3. Type a message in the input field
  4. Click Send
- If the UI "Start New Session" button doesn't work, use the + icon in the sidebar header
- If the UI is broken, REPORT IT AS A BUG. Do NOT bypass it with code.

### E2E Verification MUST Use Live Browser Content (mandatory for ALL subagents)

**Code review / bundle grep / curl is NEVER sufficient for UI verification. Every UI fix MUST be verified by rendering real content in the browser.**

- If the dev environment does not have sessions containing the content type being tested (e.g., no Agent/TodoWrite tool calls, no LaTeX, no Mermaid timeline with Chinese), the subagent MUST **send a message via the UI** to an active session to trigger that content, then verify the rendering result.
- Sending a message means: click the input field, type the message, press Enter or click Send. This is a normal UI interaction, not "creating sessions via code".
- Example: to verify TaskView (Agent tool), send "Please use the Agent tool to search for README files" to an active session. Wait for the response. Verify the rendered Task block has a single header, not duplicated.
- Example: to verify LaTeX, send "Please write $$E = mc^2$$" to an active session. Verify it renders as typeset math.
- **Any subagent (QA, dev, PM, user, architect, or any other type) that reports PASS based solely on code review, grep, or bundle inspection for a UI component will be considered a failure.** The only exception is fixes that are purely server-side or CLI-side (no UI rendering involved).
- **Every UI fix MUST be verified on BOTH desktop AND mobile viewports.** happy-app is a React Native app running on web and mobile simultaneously. Desktop-only verification is insufficient.
  - Desktop: default Playwright viewport (1280x720 or wider)
  - Mobile: resize browser to 390x844 (iPhone 14) using `browser_resize` tool BEFORE navigating
  - Verify: no layout overflow, no cut-off text, no broken components, content fits within viewport
  - `Platform.OS` is still `'web'` in a narrow browser — mobile viewport tests responsive layout, not native platform behavior
  - Tables/code blocks should be horizontally scrollable without breaking the page layout on mobile

---


### UI Behavior with No Sessions

`SessionsListWrapper.tsx` decides what to show:
- `sessionListViewData === null` → loading spinner
- `sessionListViewData.length === 0` → `EmptyMainScreen` ("Ready to code?")
- `sessionListViewData.length > 0` → `SessionsList` (machine cards + sessions)

Machine cards are rendered as part of the session list, NOT independently. So a machine can be online and decrypted correctly, but if there are zero sessions, the UI shows the empty state instead.

### Spawning a Test Session via Daemon HTTP

Use the dev web UI at https://dev.life-ai.app to create test sessions; do not create sessions through daemon HTTP/API helpers because the safety hook forbids code-created sessions.

## Critical Build & Recovery Rules (from 2026-03-26 postmortem)

### Build: ALWAYS from /root/happy, NEVER from /root/happy-dev

`bash scripts/build-cli-production.sh` — builds `packages/happy-cli` and globally installs from `/root/happy` only; **NEVER** build/install from `/root/happy-dev` because dev worktrees can contaminate production binary.

After every build, verify the `sendExisting` variable exists in the compiled output:
`bash scripts/verify-cli-build.sh` — checks installed `happy-coder` for `sendExisting > 0`; fail if missing because resumed session history upload is broken.

**Why**: `sendExisting` in `sessionScanner.ts` controls whether .jsonl history is uploaded to server on session resume. Without it, resumed sessions appear empty in the app. This was lost once when building from happy-dev where an overnight worktree commit (`1612a409`) rewrote the file without this parameter.

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
| Bug Fixes | `/root/docs/BUG-FIXES.md` | 57 bugs documented |
| Docker Build | `/root/docs/DOCKER-BUILD.md` | Build commands, troubleshooting |
| Disk Architecture | `/root/docs/DISK-ARCHITECTURE.md` | Single-disk NVMe layout |
| Playwright Setup | `/root/docs/PLAYWRIGHT-SETUP.md` | Anti-detection MCP config |
| Server Setup | `/root/docs/SERVER-SETUP.md` | Systemd services, IS_SANDBOX |
| Claude Exit Investigation | `/root/docs/CLAUDE-SESSION-EXIT-INVESTIGATION.md` | Mode hash, context compaction |
| Implementation Notes | `/root/docs/IMPLEMENTATION-NOTES.md` | AsyncLock, backoff, protocol internals |
| Reboot Recovery Postmortem | `/root/docs/REBOOT-RECOVERY-POSTMORTEM.md` | Cold-boot bug, sendExisting regression, recovery fixes |

---

## FIXED: Playwright Storage State Bug (2026-03-29)

**Fixed**: Updated `playwright-storage-state.json` with correct HTTPS domains (`dev.life-ai.app`, `life-ai.app`) + cleared contaminated `/tmp/chrome-debug-profile/`. Root cause was cross-subdomain cookie leakage from shared `.life-ai.app` Cloudflare tunnel (applio + happy). Chrome profile re-contaminates over time if subagents visit applio -- clear `/tmp/chrome-debug-profile/` if redirects recur.
