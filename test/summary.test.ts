import { describe, expect, it } from 'vitest';

import { summarizeSamples } from '../src/summary';
import type { ActionConfig, SampleSnapshot } from '../src/types';

const baseConfig: ActionConfig = {
  endpoint: 'https://collector.example.com/v1/metrics',
  traceEndpoint: 'https://collector.example.com/v1/traces',
  headers: {},
  githubToken: '',
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
  thresholds: {
    cpuPct: 85,
    memoryPct: 80,
    diskPct: 85,
  },
  additionalResourceAttributes: {},
  github: {
    repository: 'octo/repo',
    workflow: 'ci',
    workflowRef: 'octo/repo/.github/workflows/ci.yml@refs/heads/main',
    workflowSha: 'abc123',
    job: 'build',
    runId: '1',
    runAttempt: '1',
    actor: 'monalisa',
    triggeringActor: 'monalisa',
    ref: 'refs/heads/main',
    refName: 'main',
    sha: 'abc123',
    runnerName: 'GitHub Actions 1',
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
  startedAt: '2026-03-13T02:00:00.000Z',
};

function makeSample(overrides: Partial<SampleSnapshot>, offsetSeconds: number): SampleSnapshot {
  return {
    timestamp: new Date(Date.parse(baseConfig.startedAt) + offsetSeconds * 1000).toISOString(),
    cpuUtilizationPct: 25,
    cpuUserPct: 20,
    cpuSystemPct: 5,
    cpuLogicalCores: 4,
    memoryUtilizationPct: 40,
    memoryUsedBytes: 4 * 1024 ** 3,
    memoryAvailableBytes: 6 * 1024 ** 3,
    memoryTotalBytes: 10 * 1024 ** 3,
    swapUtilizationPct: 0,
    diskMount: '/',
    diskUtilizationPct: 40,
    diskUsedBytes: 40 * 1024 ** 3,
    diskAvailableBytes: 60 * 1024 ** 3,
    diskTotalBytes: 100 * 1024 ** 3,
    filesystemThroughputBytesPerSec: 1_000_000,
    diskReadOpsPerSec: 120,
    diskWriteOpsPerSec: 80,
    networkRxBytesPerSec: 100_000,
    networkTxBytesPerSec: 80_000,
    load1m: 1.2,
    load5m: 1.1,
    load15m: 1,
    processesRunning: 4,
    processesBlocked: 0,
    processesSleeping: 120,
    ...overrides,
  };
}

describe('summarizeSamples', () => {
  it('recommends a larger runner when sustained resource pressure is high', () => {
    const samples = [
      makeSample({ cpuUtilizationPct: 88, memoryUtilizationPct: 76, diskUtilizationPct: 70 }, 0),
      makeSample({ cpuUtilizationPct: 92, memoryUtilizationPct: 82, diskUtilizationPct: 72 }, 60),
      makeSample({ cpuUtilizationPct: 95, memoryUtilizationPct: 84, diskUtilizationPct: 75 }, 120),
    ];

    const summary = summarizeSamples(samples, baseConfig);

    expect(summary.recommendation.sizing).toBe('move-to-larger-runner');
    expect(summary.recommendation.reasons.join(' ')).toContain('CPU p95 hit');
    expect(summary.recommendation.reasons.join(' ')).toContain('Memory peaked');
  });

  it('flags custom images when runtime is long but pressure is low', () => {
    const samples = [
      makeSample({ cpuUtilizationPct: 18, memoryUtilizationPct: 42 }, 0),
      makeSample({ cpuUtilizationPct: 22, memoryUtilizationPct: 43 }, 120),
      makeSample({ cpuUtilizationPct: 19, memoryUtilizationPct: 44 }, 240),
      makeSample({ cpuUtilizationPct: 20, memoryUtilizationPct: 45 }, 360),
    ];

    const summary = summarizeSamples(samples, baseConfig);

    expect(summary.recommendation.sizing).toBe('right-sized');
    expect(summary.recommendation.customImageCandidate).toBe(true);
    expect(summary.recommendation.likelyBottleneck).toBe('setup / dependency install');
  });
});
