import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prismaClient';
import { generateQueue, type GenerateJobData } from '@/lib/jobQueue';
import { generateFileName, getStoragePath } from '@/lib/fileNaming';
import { z } from 'zod';

// Validation schema for clip generation (flexible format)
const generateClipSchema = z.object({
  projectId: z.string().uuid(),
  clipName: z.string().min(1).max(255).optional(),
  generationType: z.enum(['textToVideo', 'imageToVideo']).default('textToVideo'),
  videoModel: z.enum(['animateDiff', 'svd', 'cogVideoX', 'hunyuan', 'wan21']).default('animateDiff'),
  prompt: z.string().min(1),
  negativePrompt: z.string().optional(),
  // Support both flat and nested formats
  clipSettings: z.object({
    stepsCount: z.number().int().min(10).max(50).default(20),
    cfgScale: z.number().min(1).max(20).default(7.5),
    seedValue: z.number().int().optional(),
    frameCount: z.number().int().min(8).max(128).default(16),
  }).optional(),
  // Flat format (from frontend)
  stepsCount: z.number().int().min(10).max(50).optional(),
  cfgScale: z.number().min(1).max(20).optional(),
  seedValue: z.number().int().optional(),
  frameCount: z.number().int().min(8).max(128).optional(),
  referenceImage: z.string().optional(),
  ipAdapterWeight: z.number().min(0).max(2).optional(),
  denoise: z.number().min(0).max(1).optional(), // 0=keep original, 1=full regeneration
});

// POST /api/clips/generateClip - Create and queue clip generation
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = generateClipSchema.parse(body);

    // Merge flat and nested settings (flat takes priority)
    const settings = {
      stepsCount: validated.stepsCount ?? validated.clipSettings?.stepsCount ?? 20,
      cfgScale: validated.cfgScale ?? validated.clipSettings?.cfgScale ?? 7.5,
      seedValue: validated.seedValue ?? validated.clipSettings?.seedValue,
      frameCount: validated.frameCount ?? validated.clipSettings?.frameCount ?? 16,
    };

    // Fetch project to get projectName
    const project = await prisma.project.findUnique({
      where: { id: validated.projectId },
      select: { projectName: true, displayName: true },
    });

    if (!project) {
      return NextResponse.json(
        { success: false, error: 'Project not found' },
        { status: 404 }
      );
    }

    // Get next clip index (use max orderIndex to avoid duplicates after deletion)
    const maxClip = await prisma.clip.findFirst({
      where: { projectId: validated.projectId },
      orderBy: { orderIndex: 'desc' },
      select: { orderIndex: true },
    });
    const nextIndex = (maxClip?.orderIndex ?? 0) + 1;

    // Auto-generate clipName if not provided
    const clipName = validated.clipName || `Clip ${nextIndex}`;

    // Generate file name
    const projectName = project.projectName || 'default';
    const fileName = generateFileName(projectName, 'clip', nextIndex, 'mp4');
    const storagePath = getStoragePath('clip', projectName);
    const filePath = `${storagePath}/${fileName}`;

    // Generate thumbnail file name
    const thumbnailName = generateFileName(projectName, 'thumb', nextIndex, 'jpg');
    const thumbnailStoragePath = getStoragePath('thumb', projectName);
    const thumbnailPath = `${thumbnailStoragePath}/${thumbnailName}`;

    // Create clip record in database
    const clip = await prisma.clip.create({
      data: {
        projectId: validated.projectId,
        clipName,
        orderIndex: nextIndex,
        prompt: validated.prompt,
        negativePrompt: validated.negativePrompt || '',
        seedValue: settings.seedValue ? BigInt(settings.seedValue) : null,
        stepsCount: settings.stepsCount,
        cfgScale: settings.cfgScale,
        referenceImage: validated.referenceImage,
        ipAdapterWeight: validated.ipAdapterWeight,
        fileName,
        filePath,
        thumbnailName,
        thumbnailPath,
        clipStatus: 'pending',
      },
    });

    // Create job record
    const job = await prisma.job.create({
      data: {
        projectId: validated.projectId,
        jobType: 'generate',
        inputClipIds: [clip.id],
        jobSettings: {
          generationType: validated.generationType,
          videoModel: validated.videoModel,
          stepsCount: settings.stepsCount,
          cfgScale: settings.cfgScale,
          seedValue: settings.seedValue,
          frameCount: settings.frameCount,
          referenceImage: validated.referenceImage,
          ipAdapterWeight: validated.ipAdapterWeight,
          denoise: validated.denoise,
        },
        outputPath: filePath,
        outputFileName: fileName,
        jobStatus: 'pending',
      },
    });

    // Queue the generation job
    const jobData: GenerateJobData = {
      clipId: clip.id,
      projectId: validated.projectId,
    };

    await generateQueue.add('generateClip', jobData, {
      jobId: job.id,
    });

    return NextResponse.json({
      success: true,
      data: {
        clipId: clip.id,
        jobId: job.id,
        fileName,
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
    console.error('Error creating clip:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create clip' },
      { status: 500 }
    );
  }
}
