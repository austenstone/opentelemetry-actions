#!/usr/bin/env python3
import json
from datetime import datetime, timezone
import os
import sys
from pathlib import Path
from urllib.parse import urlparse, urlunparse


def env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {'1', 'true', 'yes', 'on'}


def parse_key_values(raw: str) -> dict[str, str]:
    result: dict[str, str] = {}
    if not raw:
        return result

    for chunk in raw.replace(';', ',').split(','):
        item = chunk.strip()
        if not item or '=' not in item:
            continue
        key, value = item.split('=', 1)
        key = key.strip()
        value = value.strip()
        if key and value:
            result[key] = value

    return result


def parse_duration_millis(raw: str | None, default: int) -> int:
    if not raw:
        return default

    value = raw.strip().lower()
    try:
        if value.endswith('ms'):
            return int(float(value[:-2]))
        if value.endswith('s'):
            return int(float(value[:-1]) * 1000)
        if value.endswith('m'):
            return int(float(value[:-1]) * 60_000)
        return int(float(value))
    except ValueError:
        return default


def normalize_metrics_endpoint(endpoint: str) -> str:
    if not endpoint:
        return endpoint

    parsed = urlparse(endpoint)
    path = parsed.path or ''
    if path in ('', '/'):
        parsed = parsed._replace(path='/v1/metrics')
        return urlunparse(parsed)

    return endpoint


def normalize_traces_endpoint(endpoint: str, explicit_trace_endpoint: str) -> str:
    if explicit_trace_endpoint:
        return normalize_metrics_endpoint(explicit_trace_endpoint).replace('/v1/metrics', '/v1/traces')

    if not endpoint:
        return ''

    parsed = urlparse(endpoint)
    path = parsed.path or ''
    if path in ('', '/'):
        parsed = parsed._replace(path='/v1/traces')
        return urlunparse(parsed)

    if path.endswith('/v1/metrics'):
        parsed = parsed._replace(path=path[:-len('/v1/metrics')] + '/v1/traces')
        return urlunparse(parsed)

    return endpoint


def load_event_inputs() -> dict[str, str]:
    event_path = os.getenv('GITHUB_EVENT_PATH')
    if not event_path:
        return {}

    try:
        payload = json.loads(Path(event_path).read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return {}

    inputs = payload.get('inputs')
    if not isinstance(inputs, dict):
        return {}

    normalized: dict[str, str] = {}
    for key, value in inputs.items():
        if isinstance(value, str):
            normalized[key] = value

    return normalized


output_path = Path(sys.argv[1])
inputs = load_event_inputs()
runtime_dir = output_path.parent
endpoint = normalize_metrics_endpoint(
    inputs.get('otlp_endpoint', '')
    or os.getenv('RUNNER_OTEL_EXPORTER_OTLP_ENDPOINT')
    or os.getenv('OTEL_EXPORTER_OTLP_ENDPOINT')
)
headers = parse_key_values(
    inputs.get('otlp_headers', '')
    or os.getenv('RUNNER_OTEL_EXPORTER_OTLP_HEADERS')
    or os.getenv('OTEL_EXPORTER_OTLP_HEADERS')
)
additional_attributes = parse_key_values(os.getenv('RUNNER_OTEL_RESOURCE_ATTRIBUTES') or '')

job_name = os.getenv('GITHUB_JOB', 'unknown')
benchmark = os.getenv('RUNNER_OTEL_BENCHMARK', '') or job_name.replace('_', '-')

if 'benchmark' not in additional_attributes and benchmark:
    additional_attributes['benchmark'] = benchmark

config = {
    'endpoint': endpoint,
    'traceEndpoint': normalize_traces_endpoint(endpoint, inputs.get('otlp_traces_endpoint', '')),
    'headers': headers,
    'githubToken': '',
    'summaryOnly': not endpoint,
    'serviceName': os.getenv('RUNNER_OTEL_SERVICE_NAME', 'github-runner-telemetry'),
    'metricPrefix': 'github.runner',
    'sampleIntervalMs': parse_duration_millis(os.getenv('RUNNER_OTEL_COLLECTION_INTERVAL'), 5000),
    'exportTimeoutMs': parse_duration_millis(os.getenv('RUNNER_OTEL_EXPORTER_TIMEOUT'), 5000),
    'includeNetwork': env_flag('RUNNER_OTEL_INCLUDE_NETWORK', True),
    'includeFilesystem': env_flag('RUNNER_OTEL_INCLUDE_FILESYSTEM', True),
    'includeLoad': env_flag('RUNNER_OTEL_INCLUDE_LOAD', True),
    'enableJobSummary': False,
    'enableTraces': False,
    'enableGitHubApiEnrichment': False,
    'thresholds': {
        'cpuPct': 85,
        'memoryPct': 80,
        'diskPct': 85,
    },
    'additionalResourceAttributes': additional_attributes,
    'github': {
        'repository': os.getenv('GITHUB_REPOSITORY', 'unknown'),
        'workflow': os.getenv('GITHUB_WORKFLOW', 'unknown'),
        'workflowRef': os.getenv('GITHUB_WORKFLOW_REF', 'unknown'),
        'workflowSha': os.getenv('GITHUB_WORKFLOW_SHA', 'unknown'),
        'job': job_name,
        'runId': os.getenv('GITHUB_RUN_ID', 'unknown'),
        'runAttempt': os.getenv('GITHUB_RUN_ATTEMPT', '1'),
        'actor': os.getenv('GITHUB_ACTOR', 'unknown'),
        'triggeringActor': os.getenv('GITHUB_TRIGGERING_ACTOR', os.getenv('GITHUB_ACTOR', 'unknown')),
        'ref': os.getenv('GITHUB_REF', 'unknown'),
        'refName': os.getenv('GITHUB_REF_NAME', 'unknown'),
        'sha': os.getenv('GITHUB_SHA', 'unknown'),
        'runnerName': os.getenv('RUNNER_NAME', 'unknown'),
        'runnerOs': os.getenv('RUNNER_OS', 'unknown'),
        'runnerArch': os.getenv('RUNNER_ARCH', 'unknown'),
    },
    'paths': {
        'directory': str(runtime_dir),
        'config': str(output_path),
        'samples': str(runtime_dir / 'samples.jsonl'),
        'summary': str(runtime_dir / 'summary.json'),
        'rawBundle': str(runtime_dir / 'raw-telemetry.json'),
        'stopSignal': str(runtime_dir / 'stop.signal'),
        'errorLog': str(runtime_dir / 'daemon-error.log'),
    },
    'startedAt': datetime.now(timezone.utc).isoformat(),
}

output_path.write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')
