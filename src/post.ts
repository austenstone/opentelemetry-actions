import { readFile, writeFile } from 'node:fs/promises';

import { buildJobSummaryMarkdown, summarizeSamples } from './summary';
import { fileExists, parseSamplesFile, sleep, STATE_KEYS } from './shared';
import { exportWorkflowTrace } from './tracing';
import type { ActionConfig, RunnerSummary } from './types';

async function waitForSummary(summaryPath: string, fallbackSamplesPath: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await fileExists(summaryPath)) {
      return;
    }

    if (!(await fileExists(fallbackSamplesPath))) {
      await sleep(1000);
      continue;
    }

    await sleep(1000);
  }
}

async function loadSummary(config: ActionConfig): Promise<RunnerSummary | null> {
  if (await fileExists(config.paths.summary)) {
    return JSON.parse(await readFile(config.paths.summary, 'utf8')) as RunnerSummary;
  }

  if (!(await fileExists(config.paths.samples))) {
    return null;
  }

  const samples = await parseSamplesFile(config.paths.samples);
  if (samples.length === 0) {
    return null;
  }

  const summary = summarizeSamples(samples, config);
  await writeFile(config.paths.summary, JSON.stringify(summary, null, 2), 'utf8');
  return summary;
}

async function run(): Promise<void> {
  const core = await import('@actions/core');
  const configPath = core.getState(STATE_KEYS.configPath);
  if (!configPath) {
    core.info('No runner telemetry config was found in state. Skipping post-run summary.');
    return;
  }

  const config = JSON.parse(await readFile(configPath, 'utf8')) as ActionConfig;
  await writeFile(config.paths.stopSignal, new Date().toISOString(), 'utf8');
  await waitForSummary(config.paths.summary, config.paths.samples);

  if (await fileExists(config.paths.errorLog)) {
    const daemonError = await readFile(config.paths.errorLog, 'utf8');
    core.warning(`Runner telemetry daemon reported an error: ${daemonError}`);
  }

  const summary = await loadSummary(config);
  if (!summary) {
    core.warning('No runner telemetry samples were captured, so no sizing recommendation was produced.');
    return;
  }

  let traceSummaryLine = '';
  if (config.enableTraces) {
    try {
      const traceResult = await exportWorkflowTrace(config, summary);
      if (traceResult) {
        traceSummaryLine = `**Workflow trace ID:** \`${traceResult.traceId}\` (${traceResult.workflowJobs} enriched jobs)`;
        core.notice(`Exported workflow trace ${traceResult.traceId}.`);
      }
    } catch (error: unknown) {
      core.warning(
        `Failed to export workflow traces: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.enableJobSummary && process.env.GITHUB_STEP_SUMMARY) {
    const markdown = buildJobSummaryMarkdown(summary);
    await core.summary.addRaw(traceSummaryLine ? `${traceSummaryLine}\n\n${markdown}` : markdown).write();
  }

  if (summary.recommendation.sizing === 'move-to-larger-runner') {
    core.warning(
      `Runner pressure was high enough to justify a larger runner. Score ${summary.recommendation.score}.`,
    );
  } else {
    core.notice(
      `Runner sizing verdict: ${summary.recommendation.sizing}. Score ${summary.recommendation.score}.`,
    );
  }

  if (summary.recommendation.customImageCandidate) {
    core.notice('Low resource pressure with a long runtime detected. A custom image is probably the cheaper win.');
  }
}

void (async () => {
  const core = await import('@actions/core');

  try {
    await run();
  } catch (error: unknown) {
    core.setFailed(
      error instanceof Error ? error.message : 'Unknown error while finalizing runner telemetry',
    );
  }
})();
