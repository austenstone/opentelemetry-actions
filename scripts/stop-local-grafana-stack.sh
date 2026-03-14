#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/observability/docker-compose.yml"
RUNTIME_DIR="$ROOT_DIR/.otel-runner-telemetry"
NGROK_PID_FILE="$RUNTIME_DIR/ngrok.pid"

cd "$ROOT_DIR"

if [[ -f "$NGROK_PID_FILE" ]]; then
	ngrok_pid="$(cat "$NGROK_PID_FILE")"
	if [[ -n "$ngrok_pid" ]] && kill -0 "$ngrok_pid" >/dev/null 2>&1; then
		kill "$ngrok_pid" >/dev/null 2>&1 || true
	fi
	rm -f "$NGROK_PID_FILE"
fi

docker compose -f "$COMPOSE_FILE" --profile tunnel down

echo "Stopped local Grafana, Prometheus, collector, and ngrok stack."