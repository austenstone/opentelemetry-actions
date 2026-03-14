import * as os from 'node:os';
import * as path from 'node:path';
import { access, mkdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

import type { GitHubContextInfo, SampleSnapshot, TelemetryPaths } from './types';

export const STATE_KEYS = {
  configPath: 'telemetryConfigPath',
  samplesPath: 'telemetrySamplesPath',
  summaryPath: 'telemetrySummaryPath',
  stopPath: 'telemetryStopPath',
  directory: 'telemetryDirectory',
} as const;

export function buildTelemetryPaths(token: string): TelemetryPaths {
  const baseDirectory = path.join(
    process.env.RUNNER_TEMP ?? process.cwd(),
    'otel-runner-telemetry',
    token,
  );

  return {
    directory: baseDirectory,
    config: path.join(baseDirectory, 'config.json'),
    samples: path.join(baseDirectory, 'samples.jsonl'),
    summary: path.join(baseDirectory, 'summary.json'),
    stopSignal: path.join(baseDirectory, 'stop.signal'),
    errorLog: path.join(baseDirectory, 'daemon-error.log'),
  };
}

export async function ensureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

export function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function parseKeyValuePairs(value: string | undefined): Record<string, string> {
  if (!value) {
    return {};
  }

  return value
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((accumulator, entry) => {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex <= 0) {
        return accumulator;
      }

      const key = entry.slice(0, separatorIndex).trim();
      const rawValue = entry.slice(separatorIndex + 1).trim();
      if (!key || !rawValue) {
        return accumulator;
      }

      accumulator[key] = rawValue;
      return accumulator;
    }, {});
}

export function normalizeMetricPrefix(prefix: string | undefined): string {
  const rawPrefix = (prefix?.trim() || 'github.runner').replace(/\.+/g, '.');
  return rawPrefix.replace(/^\./, '').replace(/\.$/, '');
}

export function normalizeMetricsEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.pathname === '/' || url.pathname === '') {
    url.pathname = '/v1/metrics';
  }
  return url.toString();
}

export function normalizeTracesEndpoint(
  endpoint: string,
  explicitTraceEndpoint?: string,
): string {
  if (explicitTraceEndpoint) {
    const explicitUrl = new URL(explicitTraceEndpoint);
    if (explicitUrl.pathname === '/' || explicitUrl.pathname === '') {
      explicitUrl.pathname = '/v1/traces';
    }
    return explicitUrl.toString();
  }

  const url = new URL(endpoint);
  if (url.pathname === '/' || url.pathname === '') {
    url.pathname = '/v1/traces';
    return url.toString();
  }

  if (url.pathname.endsWith('/v1/metrics')) {
    url.pathname = url.pathname.replace(/\/v1\/metrics$/, '/v1/traces');
  }

  return url.toString();
}

export function buildGitHubContext(): GitHubContextInfo {
  return {
    repository: process.env.GITHUB_REPOSITORY ?? 'unknown',
    workflow: process.env.GITHUB_WORKFLOW ?? 'unknown',
    workflowRef: process.env.GITHUB_WORKFLOW_REF ?? 'unknown',
    workflowSha: process.env.GITHUB_WORKFLOW_SHA ?? 'unknown',
    job: process.env.GITHUB_JOB ?? 'unknown',
    runId: process.env.GITHUB_RUN_ID ?? 'unknown',
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? '1',
    actor: process.env.GITHUB_ACTOR ?? 'unknown',
    triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR ?? process.env.GITHUB_ACTOR ?? 'unknown',
    ref: process.env.GITHUB_REF ?? 'unknown',
    refName: process.env.GITHUB_REF_NAME ?? 'unknown',
    sha: process.env.GITHUB_SHA ?? 'unknown',
    runnerName: process.env.RUNNER_NAME ?? os.hostname(),
    runnerOs: process.env.RUNNER_OS ?? os.platform(),
    runnerArch: process.env.RUNNER_ARCH ?? os.arch(),
  };
}

export function buildSampleAttributes(github: GitHubContextInfo): Record<string, string> {
  return {
    repository: github.repository,
    workflow: github.workflow,
    workflow_ref: github.workflowRef,
    workflow_sha: github.workflowSha,
    job: github.job,
    run_id: github.runId,
    run_attempt: github.runAttempt,
    actor: github.actor,
    triggering_actor: github.triggeringActor,
    git_ref: github.ref,
    ref_name: github.refName,
    sha: github.sha,
    runner_name: github.runnerName,
    runner_os: github.runnerOs,
    runner_arch: github.runnerArch,
  };
}

export function buildResourceAttributes(
  serviceName: string,
  github: GitHubContextInfo,
  additionalResourceAttributes: Record<string, string>,
): Record<string, string> {
  return {
    'service.name': serviceName,
    'github.repository': github.repository,
    'github.workflow': github.workflow,
    'github.job': github.job,
    'github.run_id': github.runId,
    'github.run_attempt': github.runAttempt,
    'github.ref': github.ref,
    'github.sha': github.sha,
    'github.runner_name': github.runnerName,
    'github.runner_os': github.runnerOs,
    'github.runner_arch': github.runnerArch,
    ...additionalResourceAttributes,
  };
}

export async function parseSamplesFile(filePath: string): Promise<SampleSnapshot[]> {
  const content = await readFile(filePath, 'utf8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SampleSnapshot);
}
