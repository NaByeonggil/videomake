import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import prisma from '@/lib/prismaClient';
import { exportQueue, ExportJobData } from '@/lib/jobQueue';

const exportSchema = z.object({
  projectId: z.string().uuid(),
  clipIds: z.array(z.string().uuid()).min(1, 'At least 1 clip required'),
  settings: z.object({
    merge: z.object({
      enabled: z.boolean(),
      transition: z.enum(['none', 'fade', 'dissolve', 'wipeleft', 'wiperight', 'slideup', 'slidedown']).optional(),
      transitionDuration: z.number().min(0.1).max(5).optional(),
    }),
    upscale: z.object({
      enabled: z.boolean(),
      scale: z.number().min(1).max(4).optional(),
      model: z.enum(['ffmpeg', 'realesrgan']).optional(),
    }),
    interpolate: z.object({
      enabled: z.boolean(),
      targetFps: z.number().min(8).max(120).optional(),
    }),
    encode: z.object({
      format: z.enum(['mp4', 'webm', 'mov']).optional().default('mp4'),
      quality: z.enum(['draft', 'standard', 'high']).optional().default('standard'),
    }),
  }),
});

/**
 * POST /api/processing/export
 * Start a full export pipeline job
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = exportSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { projectId, clipIds, settings } = parsed.data;

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

    // Verify all clips exist and are completed
    const clips = await prisma.clip.findMany({
      where: {
        id: { in: clipIds },
        projectId,
      },
      select: {
        id: true,
        clipStatus: true,
        orderIndex: true,
        filePath: true,
      },
    });

    if (clips.length !== clipIds.length) {
      const foundIds = clips.map(c => c.id);
      const missingIds = clipIds.filter(id => !foundIds.includes(id));
      return NextResponse.json(
        { error: 'Some clips not found', missingIds },
        { status: 404 }
      );
    }

    const incompleteClips = clips.filter(c => c.clipStatus !== 'completed');
    if (incompleteClips.length > 0) {
      return NextResponse.json(
        { error: 'Some clips are not completed', incompleteClipIds: incompleteClips.map(c => c.id) },
        { status: 400 }
      );
    }

    const clipsWithoutPath = clips.filter(c => !c.filePath);
    if (clipsWithoutPath.length > 0) {
      return NextResponse.json(
        { error: 'Some clips have no file path', clipIds: clipsWithoutPath.map(c => c.id) },
        { status: 400 }
      );
    }

    // Create job record
    const jobId = uuidv4();
    const job = await prisma.job.create({
      data: {
        id: jobId,
        projectId,
        jobType: 'export',
        jobStatus: 'pending',
        progressPercent: 0,
        inputClipIds: clipIds,
        jobSettings: settings,
      },
    });

    // Add to queue
    const jobData: ExportJobData = {
      jobId,
      projectId,
      clipIds,
      settings,
    };

    await exportQueue.add('exportJob', jobData, {
      jobId,
    });

    // Build summary of enabled steps
    const enabledSteps: string[] = [];
    if (settings.merge.enabled && clipIds.length > 1) enabledSteps.push('merge');
    if (settings.upscale.enabled) enabledSteps.push('upscale');
    if (settings.interpolate.enabled) enabledSteps.push('interpolate');
    enabledSteps.push('encode');

    return NextResponse.json({
      jobId: job.id,
      status: 'pending',
      message: 'Export job created',
      pipeline: enabledSteps,
      clipCount: clipIds.length,
      sseEndpoint: `/api/events/jobProgress/${job.id}`,
    }, { status: 201 });

  } catch (error) {
    console.error('Error creating export job:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
