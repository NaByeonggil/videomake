import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import prisma from '@/lib/prismaClient';
import { mergeQueue, MergeJobData } from '@/lib/jobQueue';

const mergeSchema = z.object({
  projectId: z.string().uuid(),
  clipIds: z.array(z.string().uuid()).min(2, 'At least 2 clips required for merging'),
  transition: z.enum(['none', 'fade', 'dissolve', 'wipeleft', 'wiperight', 'slideup', 'slidedown']).optional().default('none'),
  transitionDuration: z.number().min(0.1).max(5).optional().default(0.5),
});

/**
 * POST /api/processing/merge
 * Start a video merge job
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = mergeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { projectId, clipIds, transition, transitionDuration } = parsed.data;

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

    // Create job record
    const jobId = uuidv4();
    const job = await prisma.job.create({
      data: {
        id: jobId,
        projectId,
        jobType: 'merge',
        jobStatus: 'pending',
        progressPercent: 0,
        inputClipIds: clipIds,
        jobSettings: {
          transition,
          transitionDuration,
        },
      },
    });

    // Add to queue
    const jobData: MergeJobData = {
      jobId,
      projectId,
      clipIds,
      transition,
      transitionDuration,
    };

    await mergeQueue.add('mergeJob', jobData, {
      jobId,
    });

    return NextResponse.json({
      jobId: job.id,
      status: 'pending',
      message: 'Merge job created',
      sseEndpoint: `/api/events/jobProgress/${job.id}`,
    }, { status: 201 });

  } catch (error) {
    console.error('Error creating merge job:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
