#!/usr/bin/env bash
# Derive content publicKey and mint a privacy-kit token for access.key material.
# Inputs: masterSecret base64url and account id. Does not edit access.key or restart daemons.
set -euo pipefail
if [ $# -ne 2 ]; then
  echo "Usage: bash scripts/generate-access-key-material.sh <masterSecret-base64url> <account-id>" >&2
  echo "Get masterSecret with: JSON.parse(localStorage.getItem('auth_credentials')).secret" >&2
  exit 2
fi
MASTER_SECRET_B64URL="$1"
ACCOUNT_ID="$2"
cd /root/happy
printf 'publicKey (base64): '
node scripts/derive-content-public-key.js "$MASTER_SECRET_B64URL"
docker exec happy-server node -e "const { createPersistentTokenGenerator } = require('privacy-kit'); const gen = createPersistentTokenGenerator({ service: 'handy', seed: 'adocKlifsn8A09BTADtSPpb+F0F6Z9atZC5GciycNt0=' }); console.log('privacy-kit token:', gen.new({ user: process.argv[1] }));" "$ACCOUNT_ID"
echo "Update access.key with the publicKey/token, then restart the target daemon so it re-encrypts machineKey."
