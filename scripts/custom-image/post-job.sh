#!/usr/bin/env bash
set -u

RUNTIME_DIR="/tmp/otelcol-contrib-hook"
PID_FILE="$RUNTIME_DIR/otelcol.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No otelcol-contrib PID file found; skipping post-job hook"
  exit 0
fi

collector_pid="$(cat "$PID_FILE")"
if [[ -n "$collector_pid" ]] && kill -0 "$collector_pid" >/dev/null 2>&1; then
  kill "$collector_pid" >/dev/null 2>&1 || true
  wait "$collector_pid" 2>/dev/null || true
  echo "Stopped otelcol-contrib PID $collector_pid"
fi

rm -f "$PID_FILE"
exit 0
