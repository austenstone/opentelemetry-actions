#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OTELCOL_VERSION="${OTELCOL_VERSION:-0.121.0}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

apt-get update
apt-get install -y curl jq fio python3 stress-ng sysstat tar unzip

arch="$(dpkg --print-architecture)"
case "$arch" in
  amd64) otel_arch="amd64" ;;
  arm64) otel_arch="arm64" ;;
  *)
    echo "Unsupported architecture for otelcol-contrib: $arch" >&2
    exit 1
    ;;
esac

release_url="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}"
otel_pkg="otelcol-contrib_${OTELCOL_VERSION}_linux_${otel_arch}.tar.gz"
checksums_pkg="opentelemetry-collector-releases_otelcol-contrib_checksums.txt"
curl -fsSL \
  -o "$TMP_DIR/${otel_pkg}" \
  "$release_url/${otel_pkg}"

curl -fsSL \
  -o "$TMP_DIR/${checksums_pkg}" \
  "$release_url/${checksums_pkg}"

checksum_line="$(awk -v pkg="$otel_pkg" '$2 == pkg { print }' "$TMP_DIR/${checksums_pkg}")"
if [[ -z "$checksum_line" ]]; then
  echo "Failed to find checksum entry for ${otel_pkg}" >&2
  exit 1
fi

if ! printf '%s\n' "$checksum_line" | (cd "$TMP_DIR" && sha256sum -c -); then
  echo "Checksum verification failed for ${otel_pkg}" >&2
  exit 1
fi

tar -xzf "$TMP_DIR/${otel_pkg}" -C "$TMP_DIR"
install -m 0755 "$TMP_DIR/otelcol-contrib" /usr/local/bin/otelcol-contrib

mkdir -p /opt/runner /etc/otelcol-contrib
install -m 0755 "$SCRIPT_DIR/render-otel-config.py" /opt/runner/render-otel-config.py
install -m 0755 "$SCRIPT_DIR/pre-job.sh" /opt/runner/pre-job.sh
install -m 0755 "$SCRIPT_DIR/post-job.sh" /opt/runner/post-job.sh

cat > /etc/otelcol-contrib/README.txt <<'EOF'
This image uses /opt/runner/render-otel-config.py to generate a runtime collector config.
Supported environment variables:
- RUNNER_OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_ENDPOINT
- RUNNER_OTEL_EXPORTER_OTLP_HEADERS or OTEL_EXPORTER_OTLP_HEADERS
- RUNNER_OTEL_RESOURCE_ATTRIBUTES
- RUNNER_OTEL_SERVICE_NAME
- RUNNER_OTEL_ENVIRONMENT
- RUNNER_OTEL_TEAM
- RUNNER_OTEL_CLASS
- RUNNER_OTEL_REPO_TYPE
- RUNNER_OTEL_BENCHMARK
EOF

if ! grep -q '^ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/runner/pre-job.sh$' /etc/environment 2>/dev/null; then
  echo 'ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/runner/pre-job.sh' >> /etc/environment
fi

if ! grep -q '^ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/runner/post-job.sh$' /etc/environment 2>/dev/null; then
  echo 'ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/runner/post-job.sh' >> /etc/environment
fi
