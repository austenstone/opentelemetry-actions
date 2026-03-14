#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse, urlunparse


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
    '    collection_interval: 30s',
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
]

processor_names = ['batch']
if resource_attributes:
    processor_names.insert(0, 'resource/job_context')
    lines.extend(['  resource/job_context:', '    attributes:'])
    for key, value in resource_attributes.items():
        lines.extend(
            [
                f'      - key: {json.dumps(key)}',
                f'        value: {json.dumps(value)}',
                '        action: upsert',
            ]
        )

lines.extend(['  batch: {}', '', 'exporters:', '  debug:', '    verbosity: basic'])

exporter_names = ['debug']
if endpoint:
    exporter_names.append('otlphttp/upstream')
    lines.extend(['  otlphttp/upstream:', f'    endpoint: {json.dumps(endpoint)}'])
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
