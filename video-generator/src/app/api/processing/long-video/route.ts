import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prismaClient';
import { longVideoQueue, type LongVideoJobData } from '@/lib/jobQueue';
import { getStoragePath, generateFileName } from '@/lib/fileNaming';
import { z } from 'zod';

const SECONDS_PER_SEGMENT = 5.0625; // 81 frames at 16fps

const longVideoSchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().min(1),
  negativePrompt: z.string().optional(),
  referenceImage: z.string().optional(),
  targetDuration: z.number().min(10).max(300).optional(), // seconds
  totalSegments: z.number().int().min(2).max(60).optional(),
  framesPerSegment: z.number().int().default(81),
  videoModel: z.enum(['wan21']).default('wan21'),
  denoise: z.number().min(0).max(1).optional(),
  hqEnhance: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = longVideoSchema.parse(body);

    // Calculate segments from targetDuration or use explicit totalSegments
    const totalSegments = validated.totalSegments
      ?? Math.ceil((validated.targetDuration || 90) / SECONDS_PER_SEGMENT);

    // Fetch project
    const project = await prisma.project.findUnique({
      where: { id: validated.projectId },
      select: { projectName: true },
    });

    if (!project) {
      return NextResponse.json(
        { success: false, error: 'Project not found' },
        { status: 404 }
      );
    }

    const projectName = project.projectName || 'default';
    const storagePath = getStoragePath('merged', projectName);
    const fileName = generateFileName(projectName, 'merged', 0, 'mp4');
    const outputPath = `${storagePath}/${fileName}`;

    // Create parent job record
    const job = await prisma.job.create({
      data: {
        projectId: validated.projectId,
        jobType: 'longVideo',
        jobSettings: {
          prompt: validated.prompt,
          negativePrompt: validated.negativePrompt,
          referenceImage: validated.referenceImage,
          totalSegments,
          framesPerSegment: validated.framesPerSegment,
          videoModel: validated.videoModel,
          denoise: validated.denoise ?? 0.7,
          hqEnhance: validated.hqEnhance,
          targetDuration: totalSegments * SECONDS_PER_SEGMENT,
        },
        outputPath,
        outputFileName: fileName,
        jobStatus: 'pending',
      },
    });

    // Queue the long video job
    const jobData: LongVideoJobData = {
      jobId: job.id,
      projectId: validated.projectId,
      prompt: validated.prompt,
      negativePrompt: validated.negativePrompt,
      referenceImage: validated.referenceImage,
      totalSegments,
      framesPerSegment: validated.framesPerSegment,
      videoModel: validated.videoModel,
      denoise: validated.denoise ?? 0.7,
      hqEnhance: validated.hqEnhance,
    };

    await longVideoQueue.add('longVideo', jobData, {
      jobId: job.id,
    });

    const estimatedMinutes = Math.round(totalSegments * 9);

    return NextResponse.json({
      success: true,
      data: {
        jobId: job.id,
        totalSegments,
        estimatedDuration: `${(totalSegments * SECONDS_PER_SEGMENT).toFixed(0)}s`,
        estimatedTime: `~${estimatedMinutes} min`,
        jobStatus: 'pending',
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Error creating long video job:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create long video job' },
      { status: 500 }
    );
  }
}
