/**
 * Free VRAM API - proxies to ComfyUI /free endpoint
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const COMFYUI_URL = process.env.COMFYUI_URL || 'http://localhost:8188';

export async function POST() {
  try {
    const res = await fetch(`${COMFYUI_URL}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: `ComfyUI returned ${res.status}` },
        { status: res.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to connect to ComfyUI' },
      { status: 502 }
    );
  }
}
