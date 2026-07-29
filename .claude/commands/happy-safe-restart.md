---
description: Run the single sanctioned happy daemon+web rebuild+restart path (dev|prod) via /root/bin/happy-safe-restart
---

# happy-safe-restart

Invoke the canonical safe rebuild+restart script. This is the ONLY sanctioned
restart path for the happy daemon + web stack (ticket 20260726-165120); it
supersedes all prior restart tooling.

## Invocation

Run exactly (sole command, no compounds — the hook allowlist requires it):

```
/root/bin/happy-safe-restart --target <dev|prod> [--component <cli|web|all>] [--dry-run] [--json-summary <path>]
```

- `--target dev|prod` (mandatory): all behavior differences come from the
  script's per-target config table.
- `--component cli|web|all` (default `all`): `web` is the fast path for a
  web-only redeploy (daemon phases and daemon gates are not evaluated).
- `--dry-run`: evaluates every gate read-only and prints the mutation plan;
  makes no changes.
- Prod safety lives at SCRIPT level: a non-dry `--target prod` run requires a
  TTY-issued `claude-allow-restart default` grant that agents cannot forge.
  If refused, relay the printed grant command to the user and stop.
- Dev non-dry runs auto-permit only during a live dev-overnight session;
  otherwise they need `claude-allow-restart dev` the same way.
- `--force-suicide-override` exists but is TTY-gated in the script; agents
  cannot satisfy it. If the self-suicide check refuses, report it — do not
  retry.

## Steps

1. Run the script with the requested target/component (start with `--dry-run`
   when the user has not explicitly asked for the mutation).
2. Relay the phase verdict summary. On any refusal, quote the refusal text
   verbatim (it names the exact user action required) and stop.
3. Never fall back to raw systemctl/docker/kill or any other restart method —
   a refusal from this script is an answer, not an obstacle.

Provenance: the executed copy is deployed from the versioned staging source
`scripts/happy-safe-restart.sh` by `scripts/happy-safe-restart-deploy.sh`
(user-run). Do not execute the staging copy — it refuses to run by design.
