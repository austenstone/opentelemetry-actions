#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="/tmp/otelcol-contrib-hook"
CONFIG_PATH="$RUNTIME_DIR/config.yaml"
PID_FILE="$RUNTIME_DIR/otelcol.pid"
LOG_FILE="$RUNTIME_DIR/otelcol.log"

umask 077
mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"

if [[ ! -x /usr/local/bin/otelcol-contrib ]]; then
  echo "otelcol-contrib is not installed; skipping pre-job hook"
  exit 0
fi

if [[ ! -x /opt/runner/render-otel-config.py ]]; then
  echo "Collector config renderer not found; skipping pre-job hook"
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is not installed; skipping pre-job hook"
  exit 0
fi

python3 /opt/runner/render-otel-config.py "$CONFIG_PATH"
chmod 600 "$CONFIG_PATH"

touch "$LOG_FILE"
chmod 600 "$LOG_FILE"

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(cat "$PID_FILE")"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
    echo "otelcol-contrib already running with PID $existing_pid"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

nohup /usr/local/bin/otelcol-contrib --config "$CONFIG_PATH" >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
chmod 600 "$PID_FILE"
echo "Started otelcol-contrib with PID $(cat "$PID_FILE")"
exit 0
