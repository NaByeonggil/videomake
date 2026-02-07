/**
 * System status API - returns CPU, GPU, storage, and network metrics
 */

import { NextResponse } from 'next/server';
import os from 'os';
import { execSync } from 'child_process';

export const dynamic = 'force-dynamic';

// Module-level state for CPU delta calculation
let prevCpuTimes: { idle: number; total: number } | null = null;

function getCpuUsage(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }

  if (!prevCpuTimes) {
    prevCpuTimes = { idle, total };
    // First call: return instantaneous estimate
    const usage = ((total - idle) / total) * 100;
    return Math.round(usage * 10) / 10;
  }

  const idleDelta = idle - prevCpuTimes.idle;
  const totalDelta = total - prevCpuTimes.total;
  prevCpuTimes = { idle, total };

  if (totalDelta === 0) return 0;
  const usage = ((totalDelta - idleDelta) / totalDelta) * 100;
  return Math.round(usage * 10) / 10;
}

interface GpuInfo {
  utilization: number;
  memoryUsed: number;
  memoryTotal: number;
  memoryPercent: number;
  powerDraw: number;
  powerLimit: number;
  temperature: number;
  name: string;
}

function getGpuInfo(): GpuInfo | null {
  try {
    const output = execSync(
      'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,power.draw,power.limit,temperature.gpu,name --format=csv,noheader,nounits',
      { timeout: 3000, encoding: 'utf-8' }
    ).trim();

    const parts = output.split(',').map((s) => s.trim());
    if (parts.length < 7) return null;

    const memUsed = parseFloat(parts[1]);
    const memTotal = parseFloat(parts[2]);

    return {
      utilization: parseFloat(parts[0]),
      memoryUsed: memUsed,
      memoryTotal: memTotal,
      memoryPercent: memTotal > 0 ? Math.round((memUsed / memTotal) * 1000) / 10 : 0,
      powerDraw: parseFloat(parts[3]),
      powerLimit: parseFloat(parts[4]),
      temperature: parseFloat(parts[5]),
      name: parts[6],
    };
  } catch {
    return null;
  }
}

interface StorageInfo {
  total: string;
  used: string;
  available: string;
  percent: number;
}

function getStorageInfo(): StorageInfo | null {
  try {
    // BusyBox (Alpine) compatible: df -h /
    // Output: Filesystem  Size  Used  Available  Use%  Mounted on
    const output = execSync("df -h /", {
      timeout: 3000,
      encoding: 'utf-8',
    }).trim();

    const lines = output.split('\n');
    if (lines.length < 2) return null;
    const parts = lines[1].split(/\s+/);
    if (parts.length < 5) return null;

    return {
      total: parts[1],
      used: parts[2],
      available: parts[3],
      percent: parseInt(parts[4].replace('%', ''), 10),
    };
  } catch {
    return null;
  }
}

interface MemoryInfo {
  totalGB: number;
  usedGB: number;
  percent: number;
}

function getMemoryInfo(): MemoryInfo {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const totalGB = Math.round((totalBytes / (1024 ** 3)) * 10) / 10;
  const usedGB = Math.round((usedBytes / (1024 ** 3)) * 10) / 10;
  const percent = Math.round((usedBytes / totalBytes) * 1000) / 10;
  return { totalGB, usedGB, percent };
}

function getNetworkIp(): string {
  // Use HOST_IP env var if set (Docker)
  if (process.env.HOST_IP) return process.env.HOST_IP;

  // Fallback: first non-loopback, non-docker IPv4
  const interfaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs || name === 'lo') continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('172.')) {
        return addr.address;
      }
    }
  }
  return 'N/A';
}

export async function GET() {
  const cpu = getCpuUsage();
  const gpu = getGpuInfo();
  const memory = getMemoryInfo();
  const storage = getStorageInfo();
  const ip = getNetworkIp();

  return NextResponse.json({
    cpu,
    gpu,
    memory,
    storage,
    ip,
    timestamp: Date.now(),
  });
}
