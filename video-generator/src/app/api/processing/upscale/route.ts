import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { stat } from 'fs/promises';
import prisma from '@/lib/prismaClient';
import { upscaleQueue, UpscaleJobData } from '@/lib/jobQueue';

const upscaleSchema = z.object({
  projectId: z.string().uuid(),
  inputPath: z.string().min(1),
  scale: z.number().min(1).max(4).optional().default(2),
  model: z.enum(['ffmpeg', 'realesrgan']).optional().default('ffmpeg'),
});

/**
 * POST /api/processing/upscale
 * Start a video upscale job
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = upscaleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { projectId, inputPath, scale, model } = parsed.data;

    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Verify input file exists
    try {
      await stat(inputPath);
    } catch {
      return NextResponse.json(
        { error: 'Input file not found', path: inputPath },
        { status: 404 }
      );
    }

    // Create job record
    const jobId = uuidv4();
    const job = await prisma.job.create({
      data: {
        id: jobId,
        projectId,
        jobType: 'upscale',
        jobStatus: 'pending',
        progressPercent: 0,
        jobSettings: {
          inputPath,
          scale,
          model,
        },
      },
    });

    // Add to queue
    const jobData: UpscaleJobData = {
      jobId,
      projectId,
      inputPath,
      scale,
      model,
    };

    await upscaleQueue.add('upscaleJob', jobData, {
      jobId,
    });

    return NextResponse.json({
      jobId: job.id,
      status: 'pending',
      message: 'Upscale job created',
      settings: { scale, model },
      sseEndpoint: `/api/events/jobProgress/${job.id}`,
    }, { status: 201 });

  } catch (error) {
    console.error('Error creating upscale job:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
