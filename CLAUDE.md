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

```
/root/happy/
├── packages/
│   ├── happy-server/    # Backend API (Fastify + Prisma + PostgreSQL)
│   ├── happy-cli/       # CLI + Daemon (wraps Claude Code)
│   ├── happy-app/       # React Native mobile + web UI (Expo SDK 54)
│   ├── happy-wire/      # Shared protocol types & Zod schemas
│   └── happy-agent/     # Standalone agent library (ACP compatible)
├── Dockerfile           # Standalone happy-server (PGlite, no external deps)
├── Dockerfile.server-slim  # Production happy-server (external PG/Redis/MinIO)
├── Dockerfile.webapp    # Production happy-web (Expo web export -> nginx)
└── docker-compose.yml   # Not used directly; see /root/deploy/docker-compose.yml
```

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

```bash
# Rebuild and deploy server
cd /root/deploy && docker compose build happy-server && docker compose up -d happy-server

# Rebuild and deploy web PRODUCTION (must build image manually, compose has no build: section)
cd /root/happy && docker build -f Dockerfile.webapp -t happy-app:message-fixes .
cd /root/deploy && docker compose up -d happy-web

# Rebuild and deploy web DEV (safe to do during dev-overnight, doesn't affect production)
cd /root/happy && docker build -f Dockerfile.webapp -t happy-app:dev .
cd /root/deploy && docker compose up -d happy-web-dev

# CLI update (daemon auto-restarts on version mismatch via heartbeat)
npm install -g happy-coder@latest
```

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

```
browser localStorage['auth_credentials'].secret (base64url masterSecret)
  -> masterSecret (32 bytes)
  -> deriveKey(masterSecret, 'Happy EnCoder', ['content'])  // HMAC-SHA512 tree
  -> contentDataKey (32 bytes)
  -> sodium.crypto_box_seed_keypair(contentDataKey)
  -> contentKeyPair = { publicKey, privateKey }
```

### deriveKey Implementation

```
deriveKey(master, usage, path):
  1. root = HMAC-SHA512(key="{usage} Master Seed", data=master) -> {key: first_32, chainCode: last_32}
  2. For each index in path: child = HMAC-SHA512(key=chainCode, data=0x00 || utf8(index))
  3. Return final key (32 bytes)
```

### access.key File Structure

```json
{
  "encryption": {
    "publicKey": "base64 Curve25519 box public key",
    "machineKey": "base64 AES-256 key"
  },
  "token": "privacy-kit token (NOT standard JWT)"
}
```

### Key Source Files

- Derivation: `happy-app/sources/encryption/deriveKey.ts`
- Encryption.create(): `happy-app/sources/sync/encryption/encryption.ts`
- NaCl box: `happy-app/sources/encryption/libsodium.ts`
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

```
happy daemon start
  -> daemon/run.ts:startDaemon()
  -> acquire lock (~/.happy/daemon.lock)
  -> authAndSetupMachineIfNeeded() -> read access.key -> encrypt machineKey -> write to server
  -> connect WebSocket (apiMachine)
  -> start HTTP control service (127.0.0.1:random port)
  -> register RPC handlers (spawn-happy-session, stop-session)
  -> write daemon.state.json { pid, httpPort, startTime, ... }
  -> start heartbeat loop (every 60s)
```

### daemon.state.json

```json
{
  "pid": 12345,
  "httpPort": 50097,
  "startTime": "2026-03-19T10:00:00.000Z",
  "startedWithCliVersion": "0.14.0",
  "lastHeartbeat": "...",
  "daemonLogPath": "/root/.happy-jade/logs/daemon.log"
}
```

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

```javascript
// 1. Navigate to the app domain first (localStorage is domain-scoped)
await page.goto('https://life-ai.app');

// 2. Inject auth credentials into localStorage
await page.evaluate(() => {
    localStorage.setItem('auth_credentials', '{"token":"eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJjbWk1bXY5ZWgwMHd6cGcxNHBoNzNqajNuIiwiaWF0IjoxNzczNDc4MzIwLCJuYmYiOjE3NzM0NzgzMjAsImlzcyI6ImhhbmR5IiwianRpIjoiOGE2MTRjNDAtMWVhNS00ZGRjLWFiYjgtYmI2NDdhZjNhNDVlIn0.qtK1jZFkprfJXyJ_DzuDX5yAXgUWVPzxRKLGdQSENueFC3u7xPwBT0Y9fsntDCJD5Q4eg2JZXMriqyBRx6lCBw","secret":"gWwKFlcU7I3OixXUE-aiUEEEZyzRCQSL583hd3WgALs"}');
});

// 3. Reload to trigger auth flow
await page.reload();
// App will read localStorage, derive keys, connect WebSocket, and show sessions
```

#### Alternative: Generate Fresh Token for CLI access.key

If you need to connect a daemon to an existing account (not browser):

```bash
# Step 1: Get masterSecret from browser
# In DevTools: JSON.parse(localStorage.getItem('auth_credentials')).secret

# Step 2: Derive contentKeyPair.publicKey from masterSecret
cd /root/happy && node << 'SCRIPT'
const sodium = require('libsodium-wrappers');
const crypto = require('crypto');
const MASTER_SECRET_B64URL = 'YOUR_SECRET_HERE';  // <- replace

function decodeBase64Url(str) {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    return Buffer.from(b64, 'base64');
}
function hmacSha512(key, data) { return crypto.createHmac('sha512', key).update(data).digest(); }
function deriveKey(master, usage, path) {
    let I = hmacSha512(Buffer.from(usage + ' Master Seed'), master);
    let state = { key: I.subarray(0, 32), chainCode: I.subarray(32) };
    for (const index of path) {
        I = hmacSha512(state.chainCode, Buffer.concat([Buffer.from([0x00]), Buffer.from(index, 'utf-8')]));
        state = { key: I.subarray(0, 32), chainCode: I.subarray(32) };
    }
    return state.key;
}
(async () => {
    await sodium.ready;
    const masterSecret = decodeBase64Url(MASTER_SECRET_B64URL);
    const contentDataKey = deriveKey(masterSecret, 'Happy EnCoder', ['content']);
    const keypair = sodium.crypto_box_seed_keypair(contentDataKey);
    console.log('publicKey (base64):', Buffer.from(keypair.publicKey).toString('base64'));
})();
SCRIPT

# Step 3: Generate privacy-kit token
docker exec happy-server node -e "
const { createPersistentTokenGenerator } = require('privacy-kit');
const gen = createPersistentTokenGenerator({ service: 'handy', seed: 'adocKlifsn8A09BTADtSPpb+F0F6Z9atZC5GciycNt0=' });
console.log(gen.new({ user: 'YOUR_ACCOUNT_ID' }));
"

# Step 4: Update access.key with new publicKey and token
# Step 5: Restart daemon -> auto re-encrypts machineKey with new publicKey
```

Full guide: `/root/docs/ACCOUNT-MIGRATION.md` Section 11.3

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

```javascript
// Connect to dev web instance (localhost or public domain both work)
await page.goto('http://localhost:8097');  // or 'https://dev.life-ai.app'
await page.evaluate(() => {
    localStorage.setItem('auth_credentials', '{"token":"eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJjbWk1bXY5ZWgwMHd6cGcxNHBoNzNqajNuIiwiaWF0IjoxNzczNDc4MzIwLCJuYmYiOjE3NzM0NzgzMjAsImlzcyI6ImhhbmR5IiwianRpIjoiOGE2MTRjNDAtMWVhNS00ZGRjLWFiYjgtYmI2NDdhZjNhNDVlIn0.qtK1jZFkprfJXyJ_DzuDX5yAXgUWVPzxRKLGdQSENueFC3u7xPwBT0Y9fsntDCJD5Q4eg2JZXMriqyBRx6lCBw","secret":"gWwKFlcU7I3OixXUE-aiUEEEZyzRCQSL583hd3WgALs"}');
});
await page.reload();
// App loads with dev account, can inspect sessions, UI, etc.
```

---

## Critical Operational Rules

1. **NEVER** stop/restart happy daemon without saving session snapshot first
2. **NEVER** delete session data without backup + explicit confirmation
3. **NEVER** use `docker run` -- always `docker compose up -d` from `/root/deploy/`
4. **NEVER** confuse `Account.publicKey` (Ed25519 hex) with `contentKeyPair.publicKey` (Curve25519 base64)
5. **NEVER** restart daemon from within a daemon-managed Claude session (cgroup kill)
6. Safe Docker restart: `docker restart happy-server` or `happy-web` (doesn't affect daemon/sessions)
7. Before daemon restart: `bash /root/bin/happy-session-recovery.sh save && check` -> get user confirmation

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
