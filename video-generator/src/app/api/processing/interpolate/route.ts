import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { stat } from 'fs/promises';
import prisma from '@/lib/prismaClient';
import { interpolateQueue, InterpolateJobData } from '@/lib/jobQueue';

const interpolateSchema = z.object({
  projectId: z.string().uuid(),
  inputPath: z.string().min(1),
  targetFps: z.number().min(8).max(120).optional().default(24),
});

/**
 * POST /api/processing/interpolate
 * Start a frame interpolation job
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = interpolateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { projectId, inputPath, targetFps } = parsed.data;

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
        jobType: 'interpolate',
        jobStatus: 'pending',
        progressPercent: 0,
        jobSettings: {
          inputPath,
          targetFps,
        },
      },
    });

    // Add to queue
    const jobData: InterpolateJobData = {
      jobId,
      projectId,
      inputPath,
      targetFps,
    };

    await interpolateQueue.add('interpolateJob', jobData, {
      jobId,
    });

    return NextResponse.json({
      jobId: job.id,
      status: 'pending',
      message: 'Interpolate job created',
      settings: { targetFps },
      sseEndpoint: `/api/events/jobProgress/${job.id}`,
    }, { status: 201 });

  } catch (error) {
    console.error('Error creating interpolate job:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
