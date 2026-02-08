import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { stat, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import prisma from '@/lib/prismaClient';

const enhanceSchema = z.object({
  clipId: z.string().uuid(),
  scale: z.number().min(1).max(4).optional().default(2),
  targetFps: z.number().min(16).max(60).optional().default(30),
});

/**
 * POST /api/processing/enhance
 * One-click HQ enhancement: upscale + frame interpolation via ffmpeg
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = enhanceSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { clipId, scale, targetFps } = parsed.data;

    // Fetch clip
    const clip = await prisma.clip.findUnique({
      where: { id: clipId },
      include: { project: true },
    });

    if (!clip) {
      return NextResponse.json({ success: false, error: 'Clip not found' }, { status: 404 });
    }

    if (!clip.filePath) {
      return NextResponse.json({ success: false, error: 'Clip has no video file' }, { status: 400 });
    }

    // Verify input file exists
    try {
      await stat(clip.filePath);
    } catch {
      return NextResponse.json({ success: false, error: 'Video file not found' }, { status: 404 });
    }

    // Get video info
    const probeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of json "${clip.filePath}"`;
    const probeResult = JSON.parse(execSync(probeCmd, { encoding: 'utf-8' }));
    const stream = probeResult.streams[0];
    const origWidth = stream.width;
    const origHeight = stream.height;
    const targetWidth = origWidth * scale;
    const targetHeight = origHeight * scale;

    // Prevent re-enhancing already enhanced files
    if (clip.fileName?.includes('_enhanced_')) {
      return NextResponse.json({ success: false, error: 'This clip has already been enhanced' }, { status: 400 });
    }

    // Build output path
    const enhancedDir = dirname(clip.filePath);
    const baseName = clip.fileName?.replace('.mp4', '') || 'clip';
    const enhancedFileName = `${baseName}_enhanced_${scale}x_${targetFps}fps.mp4`;
    const enhancedPath = join(enhancedDir, enhancedFileName);
    await mkdir(enhancedDir, { recursive: true });

    // Step 1: Upscale + Interpolate in a single ffmpeg pass
    const ffmpegCmd = [
      'ffmpeg', '-y',
      `-i "${clip.filePath}"`,
      `-vf "scale=${targetWidth}:${targetHeight}:flags=lanczos,minterpolate=fps=${targetFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"`,
      '-c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p',
      `"${enhancedPath}"`,
    ].join(' ');

    execSync(ffmpegCmd, { stdio: 'pipe', timeout: 600000 }); // 10 min timeout

    // Verify output
    try {
      await stat(enhancedPath);
    } catch {
      return NextResponse.json({ success: false, error: 'Enhancement failed - output not created' }, { status: 500 });
    }

    // Get enhanced video info
    const outProbe = `ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=width,height,nb_read_packets,r_frame_rate -show_entries format=duration,size -of json "${enhancedPath}"`;
    const outResult = JSON.parse(execSync(outProbe, { encoding: 'utf-8' }));
    const outStream = outResult.streams[0];
    const outFormat = outResult.format;

    // Update clip with enhanced file
    await prisma.clip.update({
      where: { id: clipId },
      data: {
        filePath: enhancedPath,
        fileName: enhancedFileName,
        frameCount: parseInt(outStream.nb_read_packets, 10) || clip.frameCount,
        durationSec: parseFloat(outFormat.duration) || clip.durationSec,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        clipId,
        originalResolution: `${origWidth}x${origHeight}`,
        enhancedResolution: `${outStream.width}x${outStream.height}`,
        fps: targetFps,
        duration: parseFloat(outFormat.duration).toFixed(1),
        size: (parseInt(outFormat.size, 10) / 1024 / 1024).toFixed(1) + ' MB',
        filePath: enhancedPath,
      },
    });

  } catch (error) {
    console.error('Enhance error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
