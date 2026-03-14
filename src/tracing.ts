import * as github from '@actions/github';
import { ROOT_CONTEXT, SpanKind, trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

import { buildResourceAttributes } from './shared';
import type {
  ActionConfig,
  RunnerSummary,
  TraceExportResult,
  WorkflowJobInfo,
  WorkflowJobStepInfo,
} from './types';

interface SpanDefinition {
  key: string;
  parentKey?: string;
  name: string;
  startTime: Date;
  endTime: Date;
  attributes: Record<string, boolean | number | string | string[]>;
}

function parseDate(value: string | null | undefined, fallback: string): Date {
  return new Date(value ?? fallback);
}

function safeEnd(startTime: Date, endTime: Date): Date {
  return endTime.getTime() >= startTime.getTime() ? endTime : startTime;
}

function workflowUrl(config: ActionConfig): string {
  return `https://github.com/${config.github.repository}/actions/runs/${config.github.runId}`;
}

function splitRepository(repository: string): { owner: string; repo: string } {
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repository format: ${repository}`);
  }

  return { owner, repo };
}

async function listWorkflowJobs(config: ActionConfig): Promise<WorkflowJobInfo[]> {
  if (!config.githubToken || !config.enableGitHubApiEnrichment) {
    return [];
  }

  const octokit = github.getOctokit(config.githubToken);
  const { owner, repo } = splitRepository(config.github.repository);
  const runId = Number(config.github.runId);
  const attemptNumber = Number(config.github.runAttempt);
  const jobs: WorkflowJobInfo[] = [];

  let page = 1;
  let totalCount = Infinity;

  while (jobs.length < totalCount) {
    const response = await octokit.rest.actions.listJobsForWorkflowRunAttempt({
      owner,
      repo,
      run_id: runId,
      attempt_number: attemptNumber,
      per_page: 100,
      page,
    });

    totalCount = response.data.total_count;
    jobs.push(
      ...response.data.jobs.map((job) => ({
        id: job.id,
        name: job.name,
        status: job.status ?? 'unknown',
        conclusion: job.conclusion ?? 'unknown',
        startedAt: job.started_at,
        completedAt: job.completed_at,
        runnerName: job.runner_name ?? '',
        labels: job.labels ?? [],
        steps: (job.steps ?? []).map<WorkflowJobStepInfo>((step) => ({
          number: step.number,
          name: step.name,
          status: step.status ?? 'unknown',
          conclusion: step.conclusion ?? 'unknown',
          startedAt: step.started_at,
          completedAt: step.completed_at,
        })),
      })),
    );

    if (response.data.jobs.length < 100) {
      break;
    }

    page += 1;
  }

  return jobs;
}

export function buildTraceDefinitions(
  config: ActionConfig,
  summary: RunnerSummary,
  jobs: WorkflowJobInfo[],
): SpanDefinition[] {
  const summaryStart = parseDate(summary.startedAt, config.startedAt);
  const summaryEnd = safeEnd(summaryStart, parseDate(summary.endedAt, summary.startedAt));
  const jobStarts = jobs
    .map((job) => (job.startedAt ? new Date(job.startedAt) : null))
    .filter((value): value is Date => value !== null);
  const jobEnds = jobs
    .map((job) => (job.completedAt ? new Date(job.completedAt) : null))
    .filter((value): value is Date => value !== null);

  const rootStart = jobStarts.length > 0
    ? new Date(Math.min(summaryStart.getTime(), ...jobStarts.map((value) => value.getTime())))
    : summaryStart;
  const rootEnd = jobEnds.length > 0
    ? new Date(Math.max(summaryEnd.getTime(), ...jobEnds.map((value) => value.getTime())))
    : summaryEnd;

  const spans: SpanDefinition[] = [
    {
      key: 'workflow',
      name: config.github.workflow,
      startTime: rootStart,
      endTime: rootEnd,
      attributes: {
        'github.span.type': 'workflow',
        'github.repository': config.github.repository,
        'github.workflow': config.github.workflow,
        'github.workflow_ref': config.github.workflowRef,
        'github.workflow_sha': config.github.workflowSha,
        'github.run_id': config.github.runId,
        'github.run_attempt': config.github.runAttempt,
        'github.actor': config.github.actor,
        'github.triggering_actor': config.github.triggeringActor,
        'github.ref': config.github.ref,
        'github.ref_name': config.github.refName,
        'github.sha': config.github.sha,
        'github.url': workflowUrl(config),
        'runner.telemetry.recommendation': summary.recommendation.sizing,
        'runner.telemetry.score': summary.recommendation.score,
        'runner.telemetry.custom_image_candidate': summary.recommendation.customImageCandidate,
        'runner.telemetry.likely_bottleneck': summary.recommendation.likelyBottleneck,
        'runner.telemetry.sample_count': summary.sampleCount,
        'runner.telemetry.duration_seconds': summary.durationSeconds,
      },
    },
    {
      key: 'runner-analysis',
      parentKey: 'workflow',
      name: 'runner.telemetry.analysis',
      startTime: summaryStart,
      endTime: summaryEnd,
      attributes: {
        'github.span.type': 'runner-analysis',
        'github.job_id': config.github.job,
        'github.runner_name': config.github.runnerName,
        'github.runner_os': config.github.runnerOs,
        'github.runner_arch': config.github.runnerArch,
        'runner.telemetry.cpu.avg_pct': summary.cpu.avg,
        'runner.telemetry.cpu.p95_pct': summary.cpu.p95,
        'runner.telemetry.cpu.max_pct': summary.cpu.max,
        'runner.telemetry.memory.avg_pct': summary.memory.avg,
        'runner.telemetry.memory.p95_pct': summary.memory.p95,
        'runner.telemetry.memory.max_pct': summary.memory.max,
        'runner.telemetry.disk.avg_pct': summary.disk.avg,
        'runner.telemetry.disk.p95_pct': summary.disk.p95,
        'runner.telemetry.disk.max_pct': summary.disk.max,
        'runner.telemetry.disk_mount': summary.diskMount,
        'runner.telemetry.load1m.max': summary.load1m.max,
        'runner.telemetry.network_rx_p95_bps': summary.networkRxBytesPerSec.p95,
        'runner.telemetry.network_tx_p95_bps': summary.networkTxBytesPerSec.p95,
        'runner.telemetry.fs_throughput_p95_bps': summary.filesystemThroughputBytesPerSec.p95,
        'runner.telemetry.recommendation': summary.recommendation.sizing,
        'runner.telemetry.custom_image_candidate': summary.recommendation.customImageCandidate,
        'runner.telemetry.likely_bottleneck': summary.recommendation.likelyBottleneck,
        'runner.telemetry.reasons': summary.recommendation.reasons,
      },
    },
  ];

  for (const job of jobs) {
    const jobStart = parseDate(job.startedAt, summary.startedAt);
    const jobEnd = safeEnd(jobStart, parseDate(job.completedAt, summary.endedAt));
    const jobKey = `job-${job.id}`;

    spans.push({
      key: jobKey,
      parentKey: 'workflow',
      name: job.name,
      startTime: jobStart,
      endTime: jobEnd,
      attributes: {
        'github.span.type': 'job',
        'github.job_name': job.name,
        'github.job_database_id': job.id,
        'github.job_status': job.status,
        'github.job_conclusion': job.conclusion,
        'github.runner_name': job.runnerName,
        'github.runner_labels': job.labels,
      },
    });

    for (const step of job.steps) {
      const stepStart = parseDate(step.startedAt, job.startedAt ?? summary.startedAt);
      const stepEnd = safeEnd(stepStart, parseDate(step.completedAt, job.completedAt ?? summary.endedAt));

      spans.push({
        key: `${jobKey}-step-${step.number}`,
        parentKey: jobKey,
        name: step.name,
        startTime: stepStart,
        endTime: stepEnd,
        attributes: {
          'github.span.type': 'step',
          'github.step_number': step.number,
          'github.step_name': step.name,
          'github.step_status': step.status,
          'github.step_conclusion': step.conclusion,
        },
      });
    }
  }

  return spans;
}

export async function exportWorkflowTrace(
  config: ActionConfig,
  summary: RunnerSummary,
): Promise<TraceExportResult | null> {
  if (!config.enableTraces) {
    return null;
  }

  const jobs = await listWorkflowJobs(config);
  const definitions = buildTraceDefinitions(config, summary, jobs);
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes(
      buildResourceAttributes(config.serviceName, config.github, config.additionalResourceAttributes),
    ),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: config.traceEndpoint,
          headers: config.headers,
        }),
        {
          exportTimeoutMillis: config.exportTimeoutMs,
          scheduledDelayMillis: 200,
          maxExportBatchSize: 128,
          maxQueueSize: 256,
        },
      ),
    ],
  });

  const tracer = provider.getTracer(config.serviceName);
  const startedSpans = new Map<string, ReturnType<typeof tracer.startSpan>>();

  for (const definition of definitions) {
    const parentContext = definition.parentKey
      ? trace.setSpan(ROOT_CONTEXT, startedSpans.get(definition.parentKey)!)
      : ROOT_CONTEXT;
    const span = tracer.startSpan(
      definition.name,
      {
        kind: SpanKind.INTERNAL,
        startTime: definition.startTime,
        attributes: definition.attributes,
      },
      parentContext,
    );
    startedSpans.set(definition.key, span);
  }

  const reverseDefinitions = [...definitions].sort(
    (left, right) => right.startTime.getTime() - left.startTime.getTime(),
  );

  for (const definition of reverseDefinitions) {
    startedSpans.get(definition.key)?.end(definition.endTime);
  }

  const traceId = startedSpans.get('workflow')?.spanContext().traceId;
  await provider.forceFlush();
  await provider.shutdown();

  return traceId
    ? {
        traceId,
        workflowJobs: jobs.length,
      }
    : null;
}
