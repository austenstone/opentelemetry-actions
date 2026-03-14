import type { ActionConfig, RunnerSizingRecommendation, RunnerSummary, SampleSnapshot, SummaryStats } from './types';

function toSummaryStats(values: number[]): SummaryStats {
  if (values.length === 0) {
    return { avg: 0, p95: 0, max: 0, min: 0 };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const total = values.reduce((sum, value) => sum + value, 0);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);

  return {
    avg: Number((total / values.length).toFixed(2)),
    p95: Number(sorted[p95Index].toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
    min: Number(sorted[0].toFixed(2)),
  };
}

function buildRecommendation(
  summary: Omit<RunnerSummary, 'recommendation'>,
  config: ActionConfig,
): RunnerSummary['recommendation'] {
  const reasons: string[] = [];
  let score = 0;
  const cpuPressure = summary.cpu.p95 / config.thresholds.cpuPct;
  const memoryPressure = summary.memory.max / config.thresholds.memoryPct;
  const diskPressure = summary.disk.max / config.thresholds.diskPct;

  if (summary.cpu.p95 >= config.thresholds.cpuPct) {
    score += 45;
    reasons.push(
      `CPU p95 hit ${summary.cpu.p95}% which is above the ${config.thresholds.cpuPct}% threshold.`,
    );
  }

  if (summary.memory.max >= config.thresholds.memoryPct) {
    score += 40;
    reasons.push(
      `Memory peaked at ${summary.memory.max}% which is above the ${config.thresholds.memoryPct}% threshold.`,
    );
  }

  if (summary.disk.max >= config.thresholds.diskPct) {
    score += 20;
    reasons.push(
      `Disk usage peaked at ${summary.disk.max}% on ${summary.diskMount}, brushing past the ${config.thresholds.diskPct}% threshold.`,
    );
  }

  if (summary.load1m.max > 0 && summary.load1m.max >= summary.cpu.max / 100 *  summary.cpu.max) {
    score += 10;
  }

  const customImageCandidate =
    summary.durationSeconds >= 180 &&
    summary.cpu.avg < 35 &&
    summary.memory.max < 70 &&
    summary.disk.max < 80;

  if (customImageCandidate) {
    reasons.push(
      'Resource pressure stayed low for most of the run, which usually means setup or dependency installation is the real villain. A custom image is likely the better move than just buying more cores.',
    );
  }

  let sizing: RunnerSizingRecommendation = 'right-sized';
  if (score >= 60) {
    sizing = 'move-to-larger-runner';
  } else if (score >= 30) {
    sizing = 'consider-larger-runner';
  }

  const pressureRanking = [
    { label: 'cpu', score: cpuPressure },
    { label: 'memory', score: memoryPressure },
    { label: 'disk', score: diskPressure },
    {
      label: customImageCandidate ? 'setup / dependency install' : 'balanced',
      score: customImageCandidate ? 1.1 : 0.1,
    },
  ].sort((left, right) => right.score - left.score);

  if (reasons.length === 0) {
    reasons.push('No sustained CPU, memory, or disk pressure was detected during the monitored window.');
  }

  return {
    score,
    sizing,
    customImageCandidate,
    likelyBottleneck: pressureRanking[0]?.label ?? 'balanced',
    reasons,
  };
}

export function summarizeSamples(samples: SampleSnapshot[], config: ActionConfig): RunnerSummary {
  const startedAt = samples[0]?.timestamp ?? config.startedAt;
  const endedAt = samples[samples.length - 1]?.timestamp ?? new Date().toISOString();
  const durationSeconds = Math.max(
    0,
    Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
  );

  const partialSummary = {
    generatedAt: new Date().toISOString(),
    sampleCount: samples.length,
    startedAt,
    endedAt,
    durationSeconds,
    diskMount: samples[0]?.diskMount ?? '/',
    cpu: toSummaryStats(samples.map((sample) => sample.cpuUtilizationPct)),
    memory: toSummaryStats(samples.map((sample) => sample.memoryUtilizationPct)),
    disk: toSummaryStats(samples.map((sample) => sample.diskUtilizationPct)),
    load1m: toSummaryStats(samples.map((sample) => sample.load1m)),
    networkRxBytesPerSec: toSummaryStats(samples.map((sample) => sample.networkRxBytesPerSec)),
    networkTxBytesPerSec: toSummaryStats(samples.map((sample) => sample.networkTxBytesPerSec)),
    filesystemThroughputBytesPerSec: toSummaryStats(
      samples.map((sample) => sample.filesystemThroughputBytesPerSec),
    ),
  };

  return {
    ...partialSummary,
    recommendation: buildRecommendation(partialSummary, config),
  };
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let workingValue = value;
  let unitIndex = 0;

  while (workingValue >= 1024 && unitIndex < units.length - 1) {
    workingValue /= 1024;
    unitIndex += 1;
  }

  return `${workingValue.toFixed(1)} ${units[unitIndex]}`;
}

export function buildJobSummaryMarkdown(summary: RunnerSummary): string {
  const recommendationLabel = summary.recommendation.sizing.replace(/-/g, ' ');
  const customImageLabel = summary.recommendation.customImageCandidate ? 'Yes' : 'No';

  return [
    '## Runner telemetry summary',
    '',
    `**Sizing verdict:** ${recommendationLabel}`,
    `**Likely bottleneck:** ${summary.recommendation.likelyBottleneck}`,
    `**Custom image candidate:** ${customImageLabel}`,
    '',
    '| Signal | Avg | P95 | Max |',
    '| --- | ---: | ---: | ---: |',
    `| CPU utilization | ${formatPercent(summary.cpu.avg)} | ${formatPercent(summary.cpu.p95)} | ${formatPercent(summary.cpu.max)} |`,
    `| Memory utilization | ${formatPercent(summary.memory.avg)} | ${formatPercent(summary.memory.p95)} | ${formatPercent(summary.memory.max)} |`,
    `| Disk utilization (${summary.diskMount}) | ${formatPercent(summary.disk.avg)} | ${formatPercent(summary.disk.p95)} | ${formatPercent(summary.disk.max)} |`,
    `| Load average (1m) | ${summary.load1m.avg.toFixed(2)} | ${summary.load1m.p95.toFixed(2)} | ${summary.load1m.max.toFixed(2)} |`,
    `| Network RX | ${formatBytes(summary.networkRxBytesPerSec.avg)}/s | ${formatBytes(summary.networkRxBytesPerSec.p95)}/s | ${formatBytes(summary.networkRxBytesPerSec.max)}/s |`,
    `| Network TX | ${formatBytes(summary.networkTxBytesPerSec.avg)}/s | ${formatBytes(summary.networkTxBytesPerSec.p95)}/s | ${formatBytes(summary.networkTxBytesPerSec.max)}/s |`,
    `| Filesystem throughput | ${formatBytes(summary.filesystemThroughputBytesPerSec.avg)}/s | ${formatBytes(summary.filesystemThroughputBytesPerSec.p95)}/s | ${formatBytes(summary.filesystemThroughputBytesPerSec.max)}/s |`,
    '',
    `Monitored **${summary.sampleCount}** samples over **${summary.durationSeconds}s**.`,
    '',
    '### Why this verdict',
    ...summary.recommendation.reasons.map((reason) => `- ${reason}`),
    '',
    '> If CPU and memory stay chill but the job still drags, custom images usually beat brute-force bigger runners. More cores do not fix `apt-get` being dramatic.',
    '',
  ].join('\n');
}
