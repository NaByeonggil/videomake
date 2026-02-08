/**
 * Extract Last Frame API
 * Extracts the last frame from a clip video for "Continue from Clip" feature
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prismaClient';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const execAsync = promisify(exec);

const COMFYUI_INPUT_PATH = process.env.COMFYUI_INPUT_PATH || '/home/n1/Desktop/videomake/ComfyUI/input';

export async function POST(
  request: NextRequest,
  { params }: { params: { clipId: string } }
) {
  try {
    const clip = await prisma.clip.findUnique({
      where: { id: params.clipId },
      select: { id: true, filePath: true, prompt: true, clipStatus: true },
    });

    if (!clip) {
      return NextResponse.json(
        { success: false, error: 'Clip not found' },
        { status: 404 }
      );
    }

    if (clip.clipStatus !== 'completed' || !clip.filePath) {
      return NextResponse.json(
        { success: false, error: 'Clip has no video file' },
        { status: 400 }
      );
    }

    // Resolve video path
    const videoPath = clip.filePath.startsWith('./')
      ? path.join(process.cwd(), clip.filePath)
      : clip.filePath;

    if (!existsSync(videoPath)) {
      return NextResponse.json(
        { success: false, error: 'Video file not found on disk' },
        { status: 404 }
      );
    }

    // Extract last frame using ffmpeg (same pattern as longVideoWorker.ts)
    const outputFilename = `continue_${clip.id}_lastframe.jpg`;
    const outputPath = path.join(COMFYUI_INPUT_PATH, outputFilename);

    await execAsync(
      `ffmpeg -y -sseof -0.1 -i "${videoPath}" -vframes 1 -q:v 2 "${outputPath}"`
    );

    if (!existsSync(outputPath)) {
      return NextResponse.json(
        { success: false, error: 'Failed to extract frame' },
        { status: 500 }
      );
    }

    // Read the extracted frame as base64 for UI preview
    const frameBuffer = await readFile(outputPath);
    const base64 = frameBuffer.toString('base64');
    const preview = `data:image/jpeg;base64,${base64}`;

    return NextResponse.json({
      success: true,
      data: {
        filename: outputFilename,
        preview,
        sourceClipId: clip.id,
        sourcePrompt: clip.prompt,
      },
    });
  } catch (error) {
    console.error('Extract frame error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to extract frame from video' },
      { status: 500 }
    );
  }
}
