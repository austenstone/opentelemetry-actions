#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="/tmp/otelcol-contrib-hook"
CONFIG_PATH="$RUNTIME_DIR/config.yaml"
PID_FILE="$RUNTIME_DIR/otelcol.pid"
SUMMARY_PATH="$RUNTIME_DIR/summary.json"
STOP_SIGNAL_PATH="$RUNTIME_DIR/stop.signal"
ERROR_LOG_PATH="$RUNTIME_DIR/daemon-error.log"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No runner telemetry daemon PID file found; skipping post-job hook"
  rm -f "$CONFIG_PATH"
  exit 0
fi

collector_pid="$(cat "$PID_FILE")"
if [[ -n "$collector_pid" ]] && kill -0 "$collector_pid" >/dev/null 2>&1; then
  touch "$STOP_SIGNAL_PATH"
  for _ in {1..20}; do
    if ! kill -0 "$collector_pid" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done

  if kill -0 "$collector_pid" >/dev/null 2>&1; then
    kill -9 "$collector_pid" >/dev/null 2>&1 || true
  fi

  echo "Stopped runner telemetry daemon PID $collector_pid"
fi

if [[ -f "$SUMMARY_PATH" ]]; then
  echo "Runner telemetry summary written to $SUMMARY_PATH"
fi

if [[ -f "$ERROR_LOG_PATH" ]]; then
  echo "Runner telemetry daemon error log detected:"
  cat "$ERROR_LOG_PATH"
fi

rm -f "$PID_FILE" "$CONFIG_PATH" "$STOP_SIGNAL_PATH"
exit 0
