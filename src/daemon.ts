import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

import { collectSystemSnapshot } from './sampler';
import { buildSampleAttributes } from './shared';
import { summarizeSamples } from './summary';
import type { ActionConfig, SampleSnapshot } from './types';

async function run(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath) {
    throw new Error('The daemon expects the config path as its first argument.');
  }

  const config = JSON.parse(await readFile(configPath, 'utf8')) as ActionConfig;
  const attributes = {
    'service.name': config.serviceName,
    'github.repository': config.github.repository,
    'github.workflow': config.github.workflow,
    'github.job': config.github.job,
    'github.run_id': config.github.runId,
    'github.run_attempt': config.github.runAttempt,
    'github.ref': config.github.ref,
    'github.sha': config.github.sha,
    'github.runner_name': config.github.runnerName,
    'github.runner_os': config.github.runnerOs,
    'github.runner_arch': config.github.runnerArch,
    ...config.additionalResourceAttributes,
  };

  const exporter = new OTLPMetricExporter({
    url: config.endpoint,
    headers: config.headers,
  });

  const meterProvider = new MeterProvider({
    resource: resourceFromAttributes(attributes),
    readers: [
      new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: config.sampleIntervalMs,
        exportTimeoutMillis: config.exportTimeoutMs,
      }),
    ],
  });

  const meter = meterProvider.getMeter(config.serviceName);
  const sampleAttributes = buildSampleAttributes(config.github);
  const prefix = config.metricPrefix;

  const gauges = {
    cpuUtilization: meter.createGauge(`${prefix}.cpu.utilization_pct`, {
      description: 'Current CPU utilization percent on the GitHub-hosted runner.',
    }),
    cpuUser: meter.createGauge(`${prefix}.cpu.user_pct`, {
      description: 'Current CPU user space utilization percent on the runner.',
    }),
    cpuSystem: meter.createGauge(`${prefix}.cpu.system_pct`, {
      description: 'Current CPU system space utilization percent on the runner.',
    }),
    cpuLogicalCores: meter.createGauge(`${prefix}.cpu.logical_cores`, {
      description: 'Logical CPU cores available on the runner.',
    }),
    memoryUtilization: meter.createGauge(`${prefix}.memory.utilization_pct`, {
      description: 'Current memory utilization percent on the runner.',
    }),
    memoryUsedBytes: meter.createGauge(`${prefix}.memory.used_bytes`, {
      description: 'Memory used in bytes on the runner.',
    }),
    memoryAvailableBytes: meter.createGauge(`${prefix}.memory.available_bytes`, {
      description: 'Memory available in bytes on the runner.',
    }),
    memoryTotalBytes: meter.createGauge(`${prefix}.memory.total_bytes`, {
      description: 'Total memory in bytes on the runner.',
    }),
    swapUtilization: meter.createGauge(`${prefix}.swap.utilization_pct`, {
      description: 'Current swap utilization percent on the runner.',
    }),
    diskUtilization: meter.createGauge(`${prefix}.disk.utilization_pct`, {
      description: 'Disk utilization percent for the primary writable filesystem.',
    }),
    diskUsedBytes: meter.createGauge(`${prefix}.disk.used_bytes`, {
      description: 'Disk bytes used for the primary writable filesystem.',
    }),
    diskAvailableBytes: meter.createGauge(`${prefix}.disk.available_bytes`, {
      description: 'Disk bytes available for the primary writable filesystem.',
    }),
    diskTotalBytes: meter.createGauge(`${prefix}.disk.total_bytes`, {
      description: 'Disk bytes provisioned for the primary writable filesystem.',
    }),
    filesystemThroughput: meter.createGauge(`${prefix}.filesystem.throughput_bytes_per_sec`, {
      description: 'Combined filesystem read and write throughput in bytes per second.',
    }),
    diskReadOps: meter.createGauge(`${prefix}.disk.io_read_ops_per_sec`, {
      description: 'Disk read operations per second for the runner.',
    }),
    diskWriteOps: meter.createGauge(`${prefix}.disk.io_write_ops_per_sec`, {
      description: 'Disk write operations per second for the runner.',
    }),
    networkRx: meter.createGauge(`${prefix}.network.rx_bytes_per_sec`, {
      description: 'Aggregated receive throughput in bytes per second.',
    }),
    networkTx: meter.createGauge(`${prefix}.network.tx_bytes_per_sec`, {
      description: 'Aggregated transmit throughput in bytes per second.',
    }),
    load1m: meter.createGauge(`${prefix}.load_1m`, {
      description: 'One minute load average for the runner.',
    }),
    load5m: meter.createGauge(`${prefix}.load_5m`, {
      description: 'Five minute load average for the runner.',
    }),
    load15m: meter.createGauge(`${prefix}.load_15m`, {
      description: 'Fifteen minute load average for the runner.',
    }),
    processesRunning: meter.createGauge(`${prefix}.processes.running`, {
      description: 'Running processes currently visible on the runner.',
    }),
    processesBlocked: meter.createGauge(`${prefix}.processes.blocked`, {
      description: 'Blocked processes currently visible on the runner.',
    }),
    processesSleeping: meter.createGauge(`${prefix}.processes.sleeping`, {
      description: 'Sleeping processes currently visible on the runner.',
    }),
  };

  const samples: SampleSnapshot[] = [];
  let stopping = false;
  let interval: NodeJS.Timeout | undefined;
  let activeSample: Promise<void> | undefined;

  const persistSummary = async (): Promise<void> => {
    const summary = summarizeSamples(samples, config);
    await writeFile(config.paths.summary, JSON.stringify(summary, null, 2), 'utf8');
  };

  const recordSample = async (): Promise<void> => {
    if (stopping || existsSync(config.paths.stopSignal)) {
      await shutdown();
      return;
    }

    const snapshot = await collectSystemSnapshot(config);
    samples.push(snapshot);
    await appendFile(config.paths.samples, `${JSON.stringify(snapshot)}\n`, 'utf8');

    const diskAttributes = {
      ...sampleAttributes,
      disk_mount: snapshot.diskMount,
    };

    gauges.cpuUtilization.record(snapshot.cpuUtilizationPct, sampleAttributes);
    gauges.cpuUser.record(snapshot.cpuUserPct, sampleAttributes);
    gauges.cpuSystem.record(snapshot.cpuSystemPct, sampleAttributes);
    gauges.cpuLogicalCores.record(snapshot.cpuLogicalCores, sampleAttributes);
    gauges.memoryUtilization.record(snapshot.memoryUtilizationPct, sampleAttributes);
    gauges.memoryUsedBytes.record(snapshot.memoryUsedBytes, sampleAttributes);
    gauges.memoryAvailableBytes.record(snapshot.memoryAvailableBytes, sampleAttributes);
    gauges.memoryTotalBytes.record(snapshot.memoryTotalBytes, sampleAttributes);
    gauges.swapUtilization.record(snapshot.swapUtilizationPct, sampleAttributes);
    gauges.diskUtilization.record(snapshot.diskUtilizationPct, diskAttributes);
    gauges.diskUsedBytes.record(snapshot.diskUsedBytes, diskAttributes);
    gauges.diskAvailableBytes.record(snapshot.diskAvailableBytes, diskAttributes);
    gauges.diskTotalBytes.record(snapshot.diskTotalBytes, diskAttributes);
    gauges.filesystemThroughput.record(snapshot.filesystemThroughputBytesPerSec, diskAttributes);
    gauges.diskReadOps.record(snapshot.diskReadOpsPerSec, diskAttributes);
    gauges.diskWriteOps.record(snapshot.diskWriteOpsPerSec, diskAttributes);
    gauges.processesRunning.record(snapshot.processesRunning, sampleAttributes);
    gauges.processesBlocked.record(snapshot.processesBlocked, sampleAttributes);
    gauges.processesSleeping.record(snapshot.processesSleeping, sampleAttributes);

    if (config.includeNetwork) {
      gauges.networkRx.record(snapshot.networkRxBytesPerSec, sampleAttributes);
      gauges.networkTx.record(snapshot.networkTxBytesPerSec, sampleAttributes);
    }

    if (config.includeLoad) {
      gauges.load1m.record(snapshot.load1m, sampleAttributes);
      gauges.load5m.record(snapshot.load5m, sampleAttributes);
      gauges.load15m.record(snapshot.load15m, sampleAttributes);
    }
  };

  const loop = (): void => {
    if (activeSample) {
      return;
    }

    activeSample = recordSample()
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        await writeFile(config.paths.errorLog, message, 'utf8');
        await shutdown();
      })
      .finally(() => {
        activeSample = undefined;
      });
  };

  const shutdown = async (): Promise<void> => {
    if (stopping) {
      return;
    }

    stopping = true;
    if (interval) {
      clearInterval(interval);
    }

    if (activeSample) {
      await activeSample;
    }

    await persistSummary();
    await meterProvider.forceFlush();
    await meterProvider.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.on('uncaughtException', async (error) => {
    await writeFile(config.paths.errorLog, error.stack ?? error.message, 'utf8');
    await shutdown();
  });
  process.on('unhandledRejection', async (reason) => {
    await writeFile(config.paths.errorLog, String(reason), 'utf8');
    await shutdown();
  });

  loop();
  interval = setInterval(loop, config.sampleIntervalMs);
};

run().catch(async (error: unknown) => {
  const configPath = process.argv[2];
  if (configPath) {
    try {
      const config = JSON.parse(await readFile(configPath, 'utf8')) as ActionConfig;
      await writeFile(
        config.paths.errorLog,
        error instanceof Error ? error.stack ?? error.message : String(error),
        'utf8',
      );
    } catch {
      // no-op
    }
  }

  process.exit(1);
});
