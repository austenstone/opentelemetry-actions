import { describe, expect, it } from 'vitest';

import { normalizeTracesEndpoint } from '../src/shared';
import { buildTraceDefinitions } from '../src/tracing';
import type { ActionConfig, RunnerSummary, WorkflowJobInfo } from '../src/types';

const config: ActionConfig = {
  endpoint: 'https://collector.example.com/v1/metrics',
  traceEndpoint: 'https://collector.example.com/v1/traces',
  headers: {},
  githubToken: '',
  summaryOnly: false,
  serviceName: 'github-runner-telemetry',
  metricPrefix: 'github.runner',
  sampleIntervalMs: 5000,
  exportTimeoutMs: 10000,
  includeNetwork: true,
  includeFilesystem: true,
  includeLoad: true,
  enableJobSummary: true,
  enableTraces: true,
  enableGitHubApiEnrichment: true,
  thresholds: { cpuPct: 85, memoryPct: 80, diskPct: 85 },
  additionalResourceAttributes: {},
  github: {
    repository: 'octo/repo',
    workflow: 'ci',
    workflowRef: 'octo/repo/.github/workflows/ci.yml@refs/heads/main',
    workflowSha: 'abc123',
    job: 'build',
    runId: '100',
    runAttempt: '2',
    actor: 'monalisa',
    triggeringActor: 'monalisa',
    ref: 'refs/heads/main',
    refName: 'main',
    sha: 'abc123',
    runnerName: 'GitHub Actions 10',
    runnerOs: 'Linux',
    runnerArch: 'X64',
  },
  paths: {
    directory: '/tmp/otel',
    config: '/tmp/otel/config.json',
    samples: '/tmp/otel/samples.jsonl',
    summary: '/tmp/otel/summary.json',
    stopSignal: '/tmp/otel/stop.signal',
    errorLog: '/tmp/otel/error.log',
  },
  startedAt: '2026-03-13T00:00:00.000Z',
};

const summary: RunnerSummary = {
  generatedAt: '2026-03-13T00:10:01.000Z',
  sampleCount: 10,
  startedAt: '2026-03-13T00:00:00.000Z',
  endedAt: '2026-03-13T00:10:00.000Z',
  durationSeconds: 600,
  diskMount: '/',
  cpu: { avg: 40, p95: 92, max: 98, min: 12 },
  memory: { avg: 52, p95: 78, max: 81, min: 32 },
  disk: { avg: 44, p95: 70, max: 72, min: 41 },
  load1m: { avg: 2.1, p95: 5.2, max: 5.8, min: 0.9 },
  networkRxBytesPerSec: { avg: 1000, p95: 9000, max: 15000, min: 10 },
  networkTxBytesPerSec: { avg: 800, p95: 7000, max: 12000, min: 10 },
  filesystemThroughputBytesPerSec: { avg: 5000, p95: 30000, max: 45000, min: 100 },
  recommendation: {
    score: 85,
    sizing: 'move-to-larger-runner',
    customImageCandidate: false,
    likelyBottleneck: 'cpu',
    reasons: ['CPU p95 hit 92%.'],
  },
};

describe('normalizeTracesEndpoint', () => {
  it('derives the trace path from the metrics path', () => {
    expect(normalizeTracesEndpoint('https://collector.example.com/v1/metrics')).toBe(
      'https://collector.example.com/v1/traces',
    );
  });

  it('prefers an explicit traces endpoint', () => {
    expect(
      normalizeTracesEndpoint(
        'https://collector.example.com/v1/metrics',
        'https://tempo.example.com/custom/traces',
      ),
    ).toBe('https://tempo.example.com/custom/traces');
  });
});

describe('buildTraceDefinitions', () => {
  it('creates workflow, analysis, job, and step spans', () => {
    const jobs: WorkflowJobInfo[] = [
      {
        id: 42,
        name: 'build',
        status: 'completed',
        conclusion: 'success',
        startedAt: '2026-03-13T00:00:05.000Z',
        completedAt: '2026-03-13T00:09:58.000Z',
        runnerName: 'GitHub Actions 10',
        labels: ['ubuntu-latest'],
        steps: [
          {
            number: 1,
            name: 'Checkout',
            status: 'completed',
            conclusion: 'success',
            startedAt: '2026-03-13T00:00:05.000Z',
            completedAt: '2026-03-13T00:00:15.000Z',
          },
        ],
      },
    ];

    const definitions = buildTraceDefinitions(config, summary, jobs);

    expect(definitions.map((definition) => definition.name)).toEqual([
      'ci',
      'runner.telemetry.analysis',
      'build',
      'Checkout',
    ]);
    expect(definitions[0]?.attributes['runner.telemetry.recommendation']).toBe('move-to-larger-runner');
    expect(definitions[2]?.parentKey).toBe('workflow');
    expect(definitions[3]?.parentKey).toBe('job-42');
  });
});
