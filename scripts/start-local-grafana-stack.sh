#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/observability/docker-compose.yml"
RUNTIME_DIR="$ROOT_DIR/.otel-runner-telemetry"
NGROK_PID_FILE="$RUNTIME_DIR/ngrok.pid"

cd "$ROOT_DIR"
mkdir -p "$RUNTIME_DIR"

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

discover_existing_tunnel() {
  local target_addr="$1"
  local port

  for port in 4040 4041 4042 4043; do
    curl -fsS "http://127.0.0.1:${port}/api/tunnels" 2>/dev/null | python3 -c 'import json, sys
target = sys.argv[1]
raw = sys.stdin.read().strip()
if not raw:
    raise SystemExit(1)
payload = json.loads(raw)
for tunnel in payload.get("tunnels", []):
    config = tunnel.get("config", {})
    if config.get("addr") == target and tunnel.get("public_url", "").startswith("https://"):
        print(f"{port}|{tunnel['public_url']}")
        raise SystemExit(0)
raise SystemExit(1)
' "$target_addr" && return 0
  done

  return 1
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

existing_tunnel="$(discover_existing_tunnel "http://127.0.0.1:${OTEL_HTTP_PORT}" || true)"
if [[ -n "$existing_tunnel" ]]; then
  NGROK_INSPECT_PORT="${existing_tunnel%%|*}"
  public_url="${existing_tunnel#*|}"
  echo "Reusing existing ngrok tunnel on inspection port ${NGROK_INSPECT_PORT}."
else

  if command -v ngrok >/dev/null 2>&1; then
    if [[ -f "$NGROK_PID_FILE" ]]; then
      old_pid="$(cat "$NGROK_PID_FILE")"
      if [[ -n "$old_pid" ]] && kill -0 "$old_pid" >/dev/null 2>&1; then
        kill "$old_pid" >/dev/null 2>&1 || true
        sleep 1
      fi
      rm -f "$NGROK_PID_FILE"
    fi

    nohup ngrok http "http://127.0.0.1:${OTEL_HTTP_PORT}" \
      --log=stdout \
      --log-format=json \
      > "$RUNTIME_DIR/ngrok.log" 2>&1 &
    echo $! > "$NGROK_PID_FILE"
  else
    docker compose -f "$COMPOSE_FILE" --profile tunnel up -d ngrok
  fi

  public_url=""
  for _ in {1..30}; do
    discovered="$({ curl -fsS "http://127.0.0.1:${NGROK_INSPECT_PORT}/api/tunnels" 2>/dev/null || true; } | python3 -c 'import json, sys
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

    if [[ -n "$discovered" ]]; then
      public_url="$discovered"
      break
    fi

    if [[ -f "$RUNTIME_DIR/ngrok.log" ]]; then
      discovered_from_log="$(python3 - "$RUNTIME_DIR/ngrok.log" <<'PY'
from pathlib import Path
import json
import sys

log_path = Path(sys.argv[1])
if not log_path.exists():
    print("")
    raise SystemExit(0)

for line in log_path.read_text().splitlines():
    line = line.strip()
    if not line or not line.startswith('{'):
        continue
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        continue
    for key in ("url", "public_url"):
        value = payload.get(key, "")
        if isinstance(value, str) and value.startswith("https://"):
            print(value)
            raise SystemExit(0)
    msg = payload.get("msg", "")
    url = payload.get("obj", "")
print("")
PY
 )"
      if [[ -n "$discovered_from_log" ]]; then
        public_url="$discovered_from_log"
        break
      fi
    fi

    sleep 2
  done
fi

if [[ -z "$public_url" ]]; then
  echo "Failed to discover the ngrok public URL from the local inspection API." >&2
  exit 1
fi

otlp_endpoint="${public_url%/}/v1/metrics"

echo
echo "ngrok collector URL: $public_url"
echo "OTLP metrics endpoint: $otlp_endpoint"
echo "ngrok inspection UI: http://127.0.0.1:${NGROK_INSPECT_PORT}"
if [[ -f "$RUNTIME_DIR/ngrok.log" ]]; then
  echo "ngrok log: $RUNTIME_DIR/ngrok.log"
fi

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