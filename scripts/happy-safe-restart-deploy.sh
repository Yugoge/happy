#!/usr/bin/env bash
# happy-safe-restart-deploy.sh — M20 drift-prevention deploy step for
# scripts/happy-safe-restart.sh (ticket 20260726-165120).
#
# Copies the COMMITTED staging script to the canonical executed location,
# embedding provenance so the canonical copy can prove (and self-verify) which
# commit it came from. The staging copy refuses to run by design; only a copy
# produced by this step executes.
#
# Usage:
#   happy-safe-restart-deploy.sh                 # → /root/bin/happy-safe-restart (USER-run only)
#   happy-safe-restart-deploy.sh --dest /tmp/<n> # QA-executable destination (automated tests)
#
# Exit codes: 0 = deployed and verified; 1 = refused (dirty staging / bad
# destination / verify failure); 2 = usage error.
#
# Drift guarantees (M20):
#   (a) REFUSES unless the staged file is byte-identical to the committed HEAD
#       blob — provenance can never pair uncommitted content with a commit id.
#   (b) embeds PROVENANCE_COMMIT=<HEAD> and the staged file's sha256; the
#       canonical copy self-verifies at startup (normalize-then-hash) and
#       refuses if hand-edited.
#   (c) divergence is detectable at any time:
#       git show <commit>:scripts/happy-safe-restart.sh | sha256sum
#       must equal the embedded STAGED_SHA256.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGING_REL="scripts/happy-safe-restart.sh"
STAGING="$REPO_ROOT/$STAGING_REL"
DEST="/root/bin/happy-safe-restart"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dest) if [[ $# -lt 2 ]]; then echo "usage error: --dest requires a path" >&2; exit 2; fi
                DEST="$2"; shift 2 ;;
        -h|--help) sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "usage error: unknown argument '$1' (only --dest <path>)" >&2; exit 2 ;;
    esac
done
[[ -n "$DEST" ]] || { echo "usage error: --dest requires a path" >&2; exit 2; }
[[ -f "$STAGING" ]] || { echo "REFUSED: staging file not found: $STAGING" >&2; exit 1; }

# (a) staging must match the committed HEAD blob exactly.
if ! git -C "$REPO_ROOT" diff --quiet HEAD -- "$STAGING_REL" 2>/dev/null; then
    echo "REFUSED: $STAGING_REL differs from the committed HEAD blob (uncommitted changes)." >&2
    echo "Commit the staging script first — provenance must never pair uncommitted content with a commit id (M20(a))." >&2
    exit 1
fi
if ! git -C "$REPO_ROOT" cat-file -e "HEAD:$STAGING_REL" 2>/dev/null; then
    echo "REFUSED: $STAGING_REL is not tracked at HEAD — commit it before deploying." >&2
    exit 1
fi

COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"

# Materialize the COMMITTED snapshot once and embed from IT — never from a
# later re-read of the working-tree file (a concurrent edit between the dirty
# check and the embed could otherwise pair a commit id with different bytes).
SNAP="$(mktemp /tmp/happy-safe-restart-snap.XXXXXX)"
trap 'rm -f "$SNAP"' EXIT
git -C "$REPO_ROOT" show "$COMMIT:$STAGING_REL" > "$SNAP"
if ! cmp -s "$SNAP" "$STAGING"; then
    echo "REFUSED: $STAGING_REL changed between the dirty check and the snapshot read — re-run the deploy." >&2
    exit 1
fi
STAGED_SHA="$(sha256sum "$SNAP" | awk '{print $1}')"

# Sanity: the committed snapshot must carry both placeholders.
grep -q '^PROVENANCE_COMMIT="__PROVENANCE_COMMIT_UNFILLED__"$' "$SNAP" \
    || { echo "REFUSED: committed staging copy does not carry the PROVENANCE_COMMIT placeholder" >&2; exit 1; }
grep -q '^STAGED_SHA256="__STAGED_SHA256_UNFILLED__"$' "$SNAP" \
    || { echo "REFUSED: committed staging copy does not carry the STAGED_SHA256 placeholder" >&2; exit 1; }

# (b) fill provenance into a temp file, then atomically move into place.
TMP="$(mktemp "${DEST}.XXXXXX")"
sed -e "s|^PROVENANCE_COMMIT=\"__PROVENANCE_COMMIT_UNFILLED__\"\$|PROVENANCE_COMMIT=\"$COMMIT\"|" \
    -e "s|^STAGED_SHA256=\"__STAGED_SHA256_UNFILLED__\"\$|STAGED_SHA256=\"$STAGED_SHA\"|" \
    "$SNAP" > "$TMP"
chmod 755 "$TMP"

# Verify the deployed copy round-trips: normalizing its provenance lines back
# to placeholders must reproduce the staged file's sha256 (the same check the
# canonical copy performs at startup).
ROUNDTRIP_SHA="$(sed -e 's|^PROVENANCE_COMMIT=.*|PROVENANCE_COMMIT="__PROVENANCE_COMMIT_UNFILLED__"|' \
                     -e 's|^STAGED_SHA256=.*|STAGED_SHA256="__STAGED_SHA256_UNFILLED__"|' \
                     "$TMP" | sha256sum | awk '{print $1}')"
if [[ "$ROUNDTRIP_SHA" != "$STAGED_SHA" ]]; then
    rm -f "$TMP"
    echo "REFUSED: provenance round-trip verification failed (embed produced $ROUNDTRIP_SHA, staged is $STAGED_SHA)" >&2
    exit 1
fi
mv "$TMP" "$DEST"

echo "deployed: $DEST"
echo "  provenance commit: $COMMIT"
echo "  staged sha256:     $STAGED_SHA"
echo "  verify anytime:    git show $COMMIT:$STAGING_REL | sha256sum   # must print $STAGED_SHA"
exit 0
