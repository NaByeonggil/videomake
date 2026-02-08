/**
 * Restart ComfyUI API
 * Kills the running ComfyUI process and restarts it.
 * Waits for ComfyUI to become available before returning.
 */

import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

export const dynamic = 'force-dynamic';

const execAsync = promisify(exec);

const COMFYUI_DIR = process.env.COMFYUI_DIR || '/home/n1/Desktop/videomake/ComfyUI';
const COMFYUI_URL = process.env.COMFYUI_URL || 'http://localhost:8188';

async function waitForComfyUI(timeoutMs: number = 180000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${COMFYUI_URL}/system_stats`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

export async function POST() {
  try {
    // 1. Kill existing ComfyUI process
    try {
      await execAsync('pkill -f "python main.py" 2>/dev/null');
    } catch { /* no process */ }

    // Wait for process to fully exit
    await new Promise(r => setTimeout(r, 2000));

    // Force kill if still alive
    try {
      await execAsync('pkill -9 -f "python main.py" 2>/dev/null');
    } catch { /* already dead */ }

    await new Promise(r => setTimeout(r, 1000));

    // 2. Restart ComfyUI in background
    const cmd = `cd "${COMFYUI_DIR}" && source venv/bin/activate && python main.py > /tmp/comfyui.log 2>&1 &`;
    await execAsync(`bash -c '${cmd}'`);

    // 3. Wait for ComfyUI to become available (up to 3min for model loading)
    const ready = await waitForComfyUI(180000);

    if (!ready) {
      return NextResponse.json({
        success: false,
        error: 'ComfyUI started but not responding within 3min. Check /tmp/comfyui.log',
      }, { status: 504 });
    }

    return NextResponse.json({
      success: true,
      message: 'ComfyUI restarted successfully',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to restart ComfyUI' },
      { status: 500 }
    );
  }
}
