#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="/tmp/otelcol-contrib-hook"
CONFIG_PATH="$RUNTIME_DIR/config.yaml"
PID_FILE="$RUNTIME_DIR/otelcol.pid"
LOG_FILE="$RUNTIME_DIR/otelcol.log"
DAEMON_PATH="/opt/runner/telemetry/daemon/index.js"

umask 077
mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "node is not installed; skipping pre-job hook"
  exit 0
fi

if [[ ! -x /opt/runner/render-otel-config.py ]]; then
  echo "Telemetry config renderer not found; skipping pre-job hook"
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is not installed; skipping pre-job hook"
  exit 0
fi

if [[ ! -f "$DAEMON_PATH" ]]; then
  echo "Telemetry daemon bundle not found at $DAEMON_PATH; skipping pre-job hook"
  exit 0
fi

python3 /opt/runner/render-otel-config.py "$CONFIG_PATH"
chmod 600 "$CONFIG_PATH"

touch "$LOG_FILE"
chmod 600 "$LOG_FILE"

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(cat "$PID_FILE")"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
    echo "runner telemetry daemon already running with PID $existing_pid"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

nohup node "$DAEMON_PATH" "$CONFIG_PATH" >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
chmod 600 "$PID_FILE"
echo "Started runner telemetry daemon with PID $(cat "$PID_FILE")"
exit 0
