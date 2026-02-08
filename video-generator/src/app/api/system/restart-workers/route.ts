/**
 * Restart Workers API
 * Kills all existing worker processes and spawns fresh ones.
 */

import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

export const dynamic = 'force-dynamic';

const execAsync = promisify(exec);

const WORKER_DIR = process.env.WORKER_DIR || '/home/n1/Desktop/videomake/video-generator';

export async function POST() {
  try {
    // Kill all existing worker processes
    try {
      await execAsync('pkill -f "workers:all" 2>/dev/null; sleep 0.5');
    } catch { /* no processes to kill */ }
    try {
      await execAsync('pkill -f "generateWorker|longVideoWorker|mergeWorker|exportWorker|upscaleWorker|interpolateWorker" 2>/dev/null; sleep 1');
    } catch { /* no processes to kill */ }

    // Force kill any remaining
    try {
      await execAsync('pkill -9 -f "generateWorker|longVideoWorker|mergeWorker|exportWorker|upscaleWorker|interpolateWorker" 2>/dev/null; sleep 0.5');
    } catch { /* none remaining */ }

    // Start fresh workers in background
    const cmd = `cd "${WORKER_DIR}" && npm run workers:all > /tmp/workers.log 2>&1 &`;
    await execAsync(cmd);

    // Wait a moment and verify
    await new Promise(r => setTimeout(r, 2000));

    const { stdout } = await execAsync('ps aux | grep -E "(generateWorker|longVideoWorker)" | grep -v grep | wc -l');
    const workerCount = parseInt(stdout.trim(), 10);

    return NextResponse.json({
      success: true,
      message: `Workers restarted (${workerCount} active)`,
      workerCount,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to restart workers' },
      { status: 500 }
    );
  }
}
