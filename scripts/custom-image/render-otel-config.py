#!/usr/bin/env python3
import json
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


def normalize_metrics_endpoint(endpoint: str) -> str:
    if not endpoint:
        return endpoint

    parsed = urlparse(endpoint)
    path = parsed.path or ''
    if path in ('', '/'):
        parsed = parsed._replace(path='/v1/metrics')
        return urlunparse(parsed)

    return endpoint


output_path = Path(sys.argv[1])
collection_interval = os.getenv('RUNNER_OTEL_COLLECTION_INTERVAL', '30s')
memory_limit_mib = int(os.getenv('RUNNER_OTEL_MEMORY_LIMIT_MIB', '128'))
memory_spike_limit_mib = int(os.getenv('RUNNER_OTEL_MEMORY_SPIKE_LIMIT_MIB', '32'))
batch_timeout = os.getenv('RUNNER_OTEL_BATCH_TIMEOUT', '10s')
batch_send_size = int(os.getenv('RUNNER_OTEL_BATCH_SEND_SIZE', '512'))
export_timeout = os.getenv('RUNNER_OTEL_EXPORTER_TIMEOUT', '10s')
export_queue_size = int(os.getenv('RUNNER_OTEL_EXPORTER_QUEUE_SIZE', '256'))
retry_initial_interval = os.getenv('RUNNER_OTEL_EXPORTER_RETRY_INITIAL_INTERVAL', '5s')
retry_max_interval = os.getenv('RUNNER_OTEL_EXPORTER_RETRY_MAX_INTERVAL', '30s')
retry_max_elapsed_time = os.getenv('RUNNER_OTEL_EXPORTER_RETRY_MAX_ELAPSED_TIME', '5m')
debug_exporter_enabled = env_flag('RUNNER_OTEL_DEBUG_EXPORTER', default=False)
endpoint = normalize_metrics_endpoint(
    os.getenv('RUNNER_OTEL_EXPORTER_OTLP_ENDPOINT')
    or os.getenv('OTEL_EXPORTER_OTLP_ENDPOINT')
    or ''
)
headers = parse_key_values(
    os.getenv('RUNNER_OTEL_EXPORTER_OTLP_HEADERS')
    or os.getenv('OTEL_EXPORTER_OTLP_HEADERS')
    or ''
)
extra_attributes = parse_key_values(os.getenv('RUNNER_OTEL_RESOURCE_ATTRIBUTES') or '')

resource_attributes = {
    'service.name': os.getenv('RUNNER_OTEL_SERVICE_NAME', 'github-runner-hostmetrics'),
    'github.repository': os.getenv('GITHUB_REPOSITORY', ''),
    'github.workflow': os.getenv('GITHUB_WORKFLOW', ''),
    'github.job': os.getenv('GITHUB_JOB', ''),
    'github.run_id': os.getenv('GITHUB_RUN_ID', ''),
    'github.run_attempt': os.getenv('GITHUB_RUN_ATTEMPT', ''),
    'github.ref': os.getenv('GITHUB_REF', ''),
    'github.ref_name': os.getenv('GITHUB_REF_NAME', ''),
    'github.sha': os.getenv('GITHUB_SHA', ''),
    'github.actor': os.getenv('GITHUB_ACTOR', ''),
    'github.triggering_actor': os.getenv('GITHUB_TRIGGERING_ACTOR', ''),
    'github.runner_name': os.getenv('RUNNER_NAME', ''),
    'github.runner_os': os.getenv('RUNNER_OS', ''),
    'github.runner_arch': os.getenv('RUNNER_ARCH', ''),
}

optional_defaults = {
    'environment': os.getenv('RUNNER_OTEL_ENVIRONMENT', ''),
    'team': os.getenv('RUNNER_OTEL_TEAM', ''),
    'runner_class': os.getenv('RUNNER_OTEL_CLASS', ''),
    'repo_type': os.getenv('RUNNER_OTEL_REPO_TYPE', ''),
    'benchmark': os.getenv('RUNNER_OTEL_BENCHMARK', ''),
}

for key, value in optional_defaults.items():
    if value:
        resource_attributes[key] = value

resource_attributes.update(extra_attributes)
resource_attributes = {key: value for key, value in resource_attributes.items() if value}

lines = [
    'receivers:',
    '  hostmetrics:',
    f'    collection_interval: {collection_interval}',
    '    scrapers:',
    '      cpu:',
    '      memory:',
    '      filesystem:',
    '      disk:',
    '      load:',
    '      network:',
    '      processes:',
    '',
    'processors:',
    '  memory_limiter:',
    '    check_interval: 5s',
    f'    limit_mib: {memory_limit_mib}',
    f'    spike_limit_mib: {memory_spike_limit_mib}',
]

processor_names = ['memory_limiter', 'batch']
if resource_attributes:
    processor_names.insert(1, 'resource/job_context')
    lines.extend(['  resource/job_context:', '    attributes:'])
    for key, value in resource_attributes.items():
        lines.extend(
            [
                f'      - key: {json.dumps(key)}',
                f'        value: {json.dumps(value)}',
                '        action: upsert',
            ]
        )

lines.extend(
    [
        '  batch:',
        f'    timeout: {batch_timeout}',
        f'    send_batch_size: {batch_send_size}',
        '',
        'exporters:',
    ]
)

exporter_names: list[str] = []
if debug_exporter_enabled or not endpoint:
    exporter_names.append('debug')
    lines.extend(['  debug:', '    verbosity: basic'])

if endpoint:
    exporter_names.append('otlphttp/upstream')
    lines.extend(
        [
            '  otlphttp/upstream:',
            f'    endpoint: {json.dumps(endpoint)}',
            f'    timeout: {export_timeout}',
            '    compression: gzip',
            '    sending_queue:',
            '      enabled: true',
            f'      queue_size: {export_queue_size}',
            '    retry_on_failure:',
            '      enabled: true',
            f'      initial_interval: {retry_initial_interval}',
            f'      max_interval: {retry_max_interval}',
            f'      max_elapsed_time: {retry_max_elapsed_time}',
        ]
    )
    if headers:
        lines.append('    headers:')
        for key, value in headers.items():
            lines.append(f'      {json.dumps(key)}: {json.dumps(value)}')

processors_list = ', '.join(processor_names)
exporters_list = ', '.join(exporter_names)
lines.extend(
    [
        '',
        'service:',
        '  pipelines:',
        '    metrics:',
        '      receivers: [hostmetrics]',
        f'      processors: [{processors_list}]',
        f'      exporters: [{exporters_list}]',
    ]
)

output_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
