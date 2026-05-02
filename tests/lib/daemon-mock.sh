#!/usr/bin/env bash
# tests/lib/daemon-mock.sh — M-DAEMONMOCK
# Pre-stages daemon.state.json files in $SANDBOX/daemons/{default,jade,qijie}/
# so deploy.sh / rollback.sh's daemon-version polling sees deterministic state
# WITHOUT needing a real daemon process.

# shellcheck disable=SC2034
_DAEMON_MOCK_LIB_LOADED=1

# pre_stage_daemon <home_dir> <version>
pre_stage_daemon() {
  local home="$1" version="$2"
  mkdir -p "$home"
  cat >"$home/daemon.state.json" <<JSON
{"startedWithCliVersion":"$version","pid":12345,"httpPort":50000,"startTime":"2026-01-01T00:00:00Z"}
JSON
}

# pre_stage_all_daemons <version>
pre_stage_all_daemons() {
  local version="$1"
  : "${SANDBOX:?pre_stage_all_daemons requires SANDBOX}"
  pre_stage_daemon "$SANDBOX/daemons/default" "$version"
  pre_stage_daemon "$SANDBOX/daemons/jade" "$version"
  pre_stage_daemon "$SANDBOX/daemons/qijie" "$version"
}

# omit_daemon <home_dir> -> ensure no daemon.state.json
omit_daemon() {
  local home="$1"
  rm -f "$home/daemon.state.json"
}
