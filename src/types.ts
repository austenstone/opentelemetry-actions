export type RunnerSizingRecommendation =
  | 'right-sized'
  | 'consider-larger-runner'
  | 'move-to-larger-runner';

export interface ThresholdConfig {
  cpuPct: number;
  memoryPct: number;
  diskPct: number;
}

export interface TelemetryPaths {
  directory: string;
  config: string;
  samples: string;
  summary: string;
  rawBundle: string;
  stopSignal: string;
  errorLog: string;
}

export interface GitHubContextInfo {
  repository: string;
  workflow: string;
  workflowRef: string;
  workflowSha: string;
  job: string;
  runId: string;
  runAttempt: string;
  actor: string;
  triggeringActor: string;
  ref: string;
  refName: string;
  sha: string;
  runnerName: string;
  runnerOs: string;
  runnerArch: string;
}

export interface ActionConfig {
  endpoint: string;
  traceEndpoint: string;
  headers: Record<string, string>;
  githubToken: string;
  summaryOnly: boolean;
  serviceName: string;
  metricPrefix: string;
  sampleIntervalMs: number;
  exportTimeoutMs: number;
  includeNetwork: boolean;
  includeFilesystem: boolean;
  includeLoad: boolean;
  enableJobSummary: boolean;
  enableTraces: boolean;
  enableGitHubApiEnrichment: boolean;
  thresholds: ThresholdConfig;
  additionalResourceAttributes: Record<string, string>;
  github: GitHubContextInfo;
  paths: TelemetryPaths;
  startedAt: string;
}

export interface SampleSnapshot {
  timestamp: string;
  cpuUtilizationPct: number;
  cpuUserPct: number;
  cpuSystemPct: number;
  cpuLogicalCores: number;
  memoryUtilizationPct: number;
  memoryUsedBytes: number;
  memoryAvailableBytes: number;
  memoryTotalBytes: number;
  swapUtilizationPct: number;
  diskMount: string;
  diskUtilizationPct: number;
  diskUsedBytes: number;
  diskAvailableBytes: number;
  diskTotalBytes: number;
  filesystemThroughputBytesPerSec: number;
  diskReadOpsPerSec: number;
  diskWriteOpsPerSec: number;
  networkRxBytesPerSec: number;
  networkTxBytesPerSec: number;
  load1m: number;
  load5m: number;
  load15m: number;
  processesRunning: number;
  processesBlocked: number;
  processesSleeping: number;
}

export interface SummaryStats {
  avg: number;
  p95: number;
  max: number;
  min: number;
}

export interface RunnerSummary {
  generatedAt: string;
  sampleCount: number;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  diskMount: string;
  cpu: SummaryStats;
  memory: SummaryStats;
  disk: SummaryStats;
  load1m: SummaryStats;
  networkRxBytesPerSec: SummaryStats;
  networkTxBytesPerSec: SummaryStats;
  filesystemThroughputBytesPerSec: SummaryStats;
  recommendation: {
    score: number;
    sizing: RunnerSizingRecommendation;
    customImageCandidate: boolean;
    likelyBottleneck: string;
    reasons: string[];
  };
}

export interface WorkflowJobStepInfo {
  number: number;
  name: string;
  status: string;
  conclusion: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface WorkflowJobInfo {
  id: number;
  name: string;
  status: string;
  conclusion: string;
  startedAt: string | null;
  completedAt: string | null;
  runnerName: string;
  labels: string[];
  steps: WorkflowJobStepInfo[];
}

export interface TraceExportResult {
  traceId: string;
  workflowJobs: number;
}

export interface RawTelemetryBundle {
  exportedAt: string;
  summaryOnly: boolean;
  config: {
    serviceName: string;
    metricPrefix: string;
    sampleIntervalMs: number;
    includeNetwork: boolean;
    includeFilesystem: boolean;
    includeLoad: boolean;
    thresholds: ThresholdConfig;
    additionalResourceAttributes: Record<string, string>;
    github: GitHubContextInfo;
    startedAt: string;
  };
  summary: RunnerSummary;
  samples: SampleSnapshot[];
  trace?: TraceExportResult | null;
  daemonError?: string;
}
