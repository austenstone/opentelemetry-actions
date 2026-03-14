import * as os from 'node:os';

import si from 'systeminformation';

import type { ActionConfig, SampleSnapshot } from './types';

function round(value: number, precision = 2): number {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function selectPrimaryFilesystem(fsSizes: Awaited<ReturnType<typeof si.fsSize>>): Awaited<ReturnType<typeof si.fsSize>>[number] {
  const writable = fsSizes.filter((entry) => entry.rw !== false);
  const candidates = writable.length > 0 ? writable : fsSizes;
  return [...candidates].sort((left, right) => right.size - left.size)[0];
}

export async function collectSystemSnapshot(config: ActionConfig): Promise<SampleSnapshot> {
  const [currentLoad, memory, filesystems, filesystemStats, disksIo, networkStats, processes] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    config.includeFilesystem ? si.fsSize() : Promise.resolve([]),
    config.includeFilesystem ? si.fsStats() : Promise.resolve(null),
    config.includeFilesystem ? si.disksIO() : Promise.resolve(null),
    config.includeNetwork ? si.networkStats() : Promise.resolve([]),
    si.processes(),
  ]);

  const primaryFilesystem = filesystems.length > 0 ? selectPrimaryFilesystem(filesystems) : undefined;
  const loadAverage = config.includeLoad ? os.loadavg() : [0, 0, 0];
  const networkInterfaces = networkStats.filter((entry) => entry.operstate === 'up');

  const networkRxBytesPerSec = sum(networkInterfaces.map((entry) => entry.rx_sec));
  const networkTxBytesPerSec = sum(networkInterfaces.map((entry) => entry.tx_sec));
  const filesystemThroughputBytesPerSec = filesystemStats?.tx_sec ?? 0;

  return {
    timestamp: new Date().toISOString(),
    cpuUtilizationPct: round(currentLoad.currentLoad),
    cpuUserPct: round(currentLoad.currentLoadUser),
    cpuSystemPct: round(currentLoad.currentLoadSystem),
    cpuLogicalCores: os.cpus().length,
    memoryUtilizationPct: memory.total > 0 ? round((memory.used / memory.total) * 100) : 0,
    memoryUsedBytes: memory.used,
    memoryAvailableBytes: memory.available,
    memoryTotalBytes: memory.total,
    swapUtilizationPct:
      memory.swaptotal > 0 ? round((memory.swapused / memory.swaptotal) * 100) : 0,
    diskMount: primaryFilesystem?.mount || '/',
    diskUtilizationPct: primaryFilesystem?.use ? round(primaryFilesystem.use) : 0,
    diskUsedBytes: primaryFilesystem?.used ?? 0,
    diskAvailableBytes: primaryFilesystem?.available ?? 0,
    diskTotalBytes: primaryFilesystem?.size ?? 0,
    filesystemThroughputBytesPerSec: round(filesystemThroughputBytesPerSec),
    diskReadOpsPerSec: round(disksIo?.rIO_sec ?? 0),
    diskWriteOpsPerSec: round(disksIo?.wIO_sec ?? 0),
    networkRxBytesPerSec: round(networkRxBytesPerSec),
    networkTxBytesPerSec: round(networkTxBytesPerSec),
    load1m: round(loadAverage[0] ?? 0),
    load5m: round(loadAverage[1] ?? 0),
    load15m: round(loadAverage[2] ?? 0),
    processesRunning: processes.running,
    processesBlocked: processes.blocked,
    processesSleeping: processes.sleeping,
  };
}
