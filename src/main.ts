import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { buildGitHubContext, buildTelemetryPaths, ensureDirectory, normalizeMetricPrefix, normalizeMetricsEndpoint, normalizeTracesEndpoint, parseBoolean, parseKeyValuePairs, parseNumber, STATE_KEYS } from './shared';
import type { ActionConfig } from './types';

async function run(): Promise<void> {
  const core = await import('@actions/core');
  const endpointInput = core.getInput('otlp-endpoint') || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpointInput) {
    throw new Error(
      'Missing OTLP endpoint. Set the action input `otlp-endpoint` or the environment variable `OTEL_EXPORTER_OTLP_ENDPOINT`.',
    );
  }

  const headersInput = core.getInput('otlp-headers') || process.env.OTEL_EXPORTER_OTLP_HEADERS;
  if (headersInput) {
    core.setSecret(headersInput);
  }

  const githubToken = core.getInput('github-token') || process.env.GITHUB_TOKEN || '';
  if (githubToken) {
    core.setSecret(githubToken);
  }

  const token = `${Date.now()}-${randomUUID()}`;
  const paths = buildTelemetryPaths(token);
  await ensureDirectory(paths.directory);

  const config: ActionConfig = {
    endpoint: normalizeMetricsEndpoint(endpointInput),
    traceEndpoint: normalizeTracesEndpoint(
      endpointInput,
      core.getInput('otlp-traces-endpoint') || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    ),
    headers: parseKeyValuePairs(headersInput),
    githubToken,
    serviceName:
      core.getInput('service-name') ||
      process.env.OTEL_RUNNER_TELEMETRY_SERVICE_NAME ||
      'github-runner-telemetry',
    metricPrefix: normalizeMetricPrefix(core.getInput('metric-prefix') || 'github.runner'),
    sampleIntervalMs: parseNumber(
      core.getInput('sample-interval-ms') || process.env.OTEL_RUNNER_TELEMETRY_SAMPLE_INTERVAL_MS,
      5000,
    ),
    exportTimeoutMs: parseNumber(core.getInput('export-timeout-ms'), 10000),
    includeNetwork: parseBoolean(core.getInput('include-network'), true),
    includeFilesystem: parseBoolean(core.getInput('include-filesystem'), true),
    includeLoad: parseBoolean(core.getInput('include-load'), true),
    enableJobSummary: parseBoolean(core.getInput('enable-job-summary'), true),
    enableTraces: parseBoolean(core.getInput('enable-traces'), true),
    enableGitHubApiEnrichment: parseBoolean(core.getInput('enable-github-api-enrichment'), true),
    thresholds: {
      cpuPct: parseNumber(core.getInput('recommendation-cpu-threshold'), 85),
      memoryPct: parseNumber(core.getInput('recommendation-memory-threshold'), 80),
      diskPct: parseNumber(core.getInput('recommendation-disk-threshold'), 85),
    },
    additionalResourceAttributes: parseKeyValuePairs(core.getInput('additional-resource-attributes')),
    github: buildGitHubContext(),
    paths,
    startedAt: new Date().toISOString(),
  };

  await writeFile(paths.config, JSON.stringify(config, null, 2), 'utf8');

  const daemonScript = path.resolve(__dirname, '../daemon/index.js');
  const child = spawn(process.execPath, [daemonScript, paths.config], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      OTEL_RUNNER_TELEMETRY_DAEMON: '1',
    },
  });

  child.unref();

  core.saveState(STATE_KEYS.directory, paths.directory);
  core.saveState(STATE_KEYS.configPath, paths.config);
  core.saveState(STATE_KEYS.samplesPath, paths.samples);
  core.saveState(STATE_KEYS.summaryPath, paths.summary);
  core.saveState(STATE_KEYS.stopPath, paths.stopSignal);

  core.setOutput('telemetry-directory', paths.directory);
  core.setOutput('samples-path', paths.samples);
  core.setOutput('summary-path', paths.summary);

  core.info(
    `Streaming runner telemetry to ${config.endpoint} every ${config.sampleIntervalMs}ms from ${config.github.runnerName}. Traces ${config.enableTraces ? `enabled via ${config.traceEndpoint}` : 'disabled'}.`,
  );
}

void (async () => {
  const core = await import('@actions/core');

  try {
    await run();
  } catch (error: unknown) {
    core.setFailed(
      error instanceof Error ? error.message : 'Unknown error while starting runner telemetry',
    );
  }
})();
