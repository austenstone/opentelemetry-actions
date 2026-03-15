#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="/tmp/otelcol-contrib-hook"
CONFIG_PATH="$RUNTIME_DIR/config.yaml"
PID_FILE="$RUNTIME_DIR/otelcol.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No otelcol-contrib PID file found; skipping post-job hook"
  rm -f "$CONFIG_PATH"
  exit 0
fi

collector_pid="$(cat "$PID_FILE")"
if [[ -n "$collector_pid" ]] && kill -0 "$collector_pid" >/dev/null 2>&1; then
  kill "$collector_pid" >/dev/null 2>&1 || true
  for _ in {1..20}; do
    if ! kill -0 "$collector_pid" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done

  if kill -0 "$collector_pid" >/dev/null 2>&1; then
    kill -9 "$collector_pid" >/dev/null 2>&1 || true
  fi

  echo "Stopped otelcol-contrib PID $collector_pid"
fi

rm -f "$PID_FILE" "$CONFIG_PATH"
exit 0
