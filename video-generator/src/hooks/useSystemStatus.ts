/**
 * System status polling hook - fetches system metrics every 2 seconds
 */

import { useQuery } from '@tanstack/react-query';

interface GpuStatus {
  utilization: number;
  memoryUsed: number;
  memoryTotal: number;
  memoryPercent: number;
  powerDraw: number;
  powerLimit: number;
  temperature: number;
  name: string;
}

interface StorageStatus {
  total: string;
  used: string;
  available: string;
  percent: number;
}

interface MemoryStatus {
  totalGB: number;
  usedGB: number;
  percent: number;
}

export interface SystemStatus {
  cpu: number;
  gpu: GpuStatus | null;
  memory: MemoryStatus;
  storage: StorageStatus | null;
  ip: string;
  timestamp: number;
}

async function fetchSystemStatus(): Promise<SystemStatus> {
  const res = await fetch('/api/system/status');
  if (!res.ok) throw new Error('Failed to fetch system status');
  return res.json();
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ['systemStatus'],
    queryFn: fetchSystemStatus,
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
  });
}
