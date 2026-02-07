/**
 * System Monitor Bar - displays real-time system metrics in a compact top bar
 */

'use client';

import { useSystemStatus } from '@/hooks/useSystemStatus';

function percentColor(value: number): string {
  if (value < 50) return 'text-green-400';
  if (value < 80) return 'text-yellow-400';
  return 'text-red-400';
}

function Metric({ label, value, unit = '%' }: { label: string; value: number | string; unit?: string }) {
  const numValue = typeof value === 'number' ? value : parseFloat(value);
  const colorClass = !isNaN(numValue) && unit === '%' ? percentColor(numValue) : 'text-gray-300';
  const display = typeof value === 'number' ? value.toFixed(1) : value;

  return (
    <span className="flex items-center gap-1">
      <span className="text-gray-500">{label}</span>
      <span className={colorClass}>
        {display}
        {unit}
      </span>
    </span>
  );
}

export function SystemMonitorBar() {
  const { data, isError } = useSystemStatus();

  if (isError || !data) {
    return (
      <div className="h-8 bg-gray-800 text-xs font-mono text-gray-500 flex items-center px-4">
        System monitor loading...
      </div>
    );
  }

  const { cpu, gpu, memory, storage, ip } = data;

  return (
    <div className="h-8 bg-gray-800 text-xs font-mono flex items-center px-4 justify-between select-none">
      {/* Left: compute metrics */}
      <div className="flex items-center gap-4">
        <Metric label="CPU" value={cpu} />
        <span className="flex items-center gap-1">
          <span className="text-gray-500">RAM</span>
          <span className={percentColor(memory.percent)}>
            {memory.usedGB}
            <span className="text-gray-600">/{memory.totalGB}GB</span>
            <span className="ml-1">({memory.percent}%)</span>
          </span>
        </span>
        {gpu && (
          <>
            <Metric label="GPU" value={gpu.utilization} />
            <Metric label="VRAM" value={gpu.memoryPercent} />
            <span className="flex items-center gap-1">
              <span className="text-gray-500">PWR</span>
              <span className="text-green-400">
                {gpu.powerDraw.toFixed(0)}
                <span className="text-green-700">/{gpu.powerLimit.toFixed(0)}W</span>
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-gray-500">TEMP</span>
              <span className={percentColor(gpu.temperature > 80 ? 90 : gpu.temperature > 60 ? 60 : 30)}>
                {gpu.temperature}°C
              </span>
            </span>
          </>
        )}
      </div>

      {/* Right: storage and network */}
      <div className="flex items-center gap-4">
        {storage && (
          <span className="flex items-center gap-1">
            <span className="text-gray-500">DISK</span>
            <span className="text-green-400">
              {storage.used}
              <span className="text-green-700">/{storage.total}</span>
              <span className="ml-1">({storage.percent}%)</span>
            </span>
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="text-gray-500">IP</span>
          <span className="text-gray-300">{ip}</span>
        </span>
      </div>
    </div>
  );
}
