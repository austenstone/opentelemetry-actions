#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/observability/docker-compose.yml"

cd "$ROOT_DIR"

if [[ -f .env ]]; then
  eval "$({ python3 - <<'PY'
from pathlib import Path
import shlex

for raw_line in Path('.env').read_text().splitlines():
    line = raw_line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    key = key.strip()
    if not key:
        continue
    print(f'export {key}={shlex.quote(value.strip())}')
PY
  })"
fi

pick_port() {
  python3 - "$1" <<'PY'
import socket
import sys

start = int(sys.argv[1])

for candidate in range(start, start + 100):
  sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
  try:
    sock.bind(("127.0.0.1", candidate))
  except OSError:
    sock.close()
    continue
  sock.close()
  print(candidate)
  raise SystemExit(0)

raise SystemExit(1)
PY
}

export GRAFANA_PORT="${GRAFANA_PORT:-$(pick_port 3000)}"
export PROMETHEUS_PORT="${PROMETHEUS_PORT:-$(pick_port 9090)}"
export OTEL_HTTP_PORT="${OTEL_HTTP_PORT:-$(pick_port 4318)}"
export OTEL_PROMETHEUS_EXPORT_PORT="${OTEL_PROMETHEUS_EXPORT_PORT:-$(pick_port 8889)}"
export NGROK_INSPECT_PORT="${NGROK_INSPECT_PORT:-$(pick_port 4040)}"

echo "Starting local OTel collector, Prometheus, and Grafana..."
docker compose -f "$COMPOSE_FILE" up -d otel-collector prometheus grafana

echo
echo "Grafana: http://127.0.0.1:${GRAFANA_PORT}"
echo "Prometheus: http://127.0.0.1:${PROMETHEUS_PORT}"
echo "Collector OTLP HTTP: http://127.0.0.1:${OTEL_HTTP_PORT}/v1/metrics"
echo "Collector Prometheus export: http://127.0.0.1:${OTEL_PROMETHEUS_EXPORT_PORT}/metrics"

if [[ -z "${NGROK_AUTHTOKEN:-}" ]]; then
  echo
  echo "NGROK_AUTHTOKEN is not set. Local stack is running, but GitHub-hosted runners will not be able to reach your collector."
  echo "Add NGROK_AUTHTOKEN to .env and re-run this script when you want a public OTLP endpoint."
  exit 0
fi

echo
echo "Starting ngrok tunnel for the OTLP HTTP collector..."
docker compose -f "$COMPOSE_FILE" --profile tunnel up -d ngrok

public_url=""
for _ in {1..30}; do
  public_url="$({ curl -fsS "http://127.0.0.1:${NGROK_INSPECT_PORT}/api/tunnels" || true; } | python3 -c 'import json, sys
raw = sys.stdin.read().strip()
if not raw:
  print("")
  raise SystemExit(0)
try:
  payload = json.loads(raw)
except json.JSONDecodeError:
  print("")
  raise SystemExit(0)
for tunnel in payload.get("tunnels", []):
  url = tunnel.get("public_url", "")
  if url.startswith("https://"):
    print(url)
    break
else:
  print("")')"

  if [[ -n "$public_url" ]]; then
    break
  fi

  sleep 2
done

if [[ -z "$public_url" ]]; then
  echo "Failed to discover the ngrok public URL from the local inspection API." >&2
  exit 1
fi

otlp_endpoint="${public_url%/}/v1/metrics"

echo
echo "ngrok collector URL: $public_url"
echo "OTLP metrics endpoint: $otlp_endpoint"
echo "ngrok inspection UI: http://127.0.0.1:${NGROK_INSPECT_PORT}"

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo
  echo "Updating GitHub secrets for this repo..."
  gh secret set OTEL_EXPORTER_OTLP_ENDPOINT --body "$otlp_endpoint"
  gh secret delete OTEL_EXPORTER_OTLP_HEADERS >/dev/null 2>&1 || true
  echo "Set OTEL_EXPORTER_OTLP_ENDPOINT and cleared OTEL_EXPORTER_OTLP_HEADERS for local collector mode."
else
  echo
  echo "GitHub CLI is not authenticated. Set this repo secret manually:"
  echo "OTEL_EXPORTER_OTLP_ENDPOINT=$otlp_endpoint"
fi