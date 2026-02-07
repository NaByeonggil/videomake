/**
 * Generate Worker
 * BullMQ worker that processes clip generation jobs
 */

import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { execSync } from 'child_process';
import Redis from 'ioredis';
import { ComfyUIClient } from '../lib/comfyuiClient';
import {
  buildTextToVideoWorkflow,
  buildImageToVideoWorkflow,
  buildSVDWorkflow,
  parseResolution,
  getOutputVideoFromResult,
  MODEL_CONFIG,
  type VideoModel,
} from '../lib/workflowBuilder';
import type { GenerateJobData } from '../lib/jobQueue';

// Initialize connections
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const comfyui = new ComfyUIClient();

/**
 * Publish progress update to Redis for SSE clients
 */
async function publishProgress(
  jobId: string,
  progress: {
    percent: number;
    message: string;
    step?: string;
  }
): Promise<void> {
  await redis.publish(
    `job:${jobId}:progress`,
    JSON.stringify({
      type: 'progress',
      ...progress,
      timestamp: new Date().toISOString(),
    })
  );
}

/**
 * Update job progress in database
 */
async function updateJobProgress(jobId: string, percent: number): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { progressPercent: percent },
  });
}

/**
 * Add log entry for job
 */
async function addJobLog(
  jobId: string,
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string
): Promise<void> {
  await prisma.jobLog.create({
    data: {
      jobId,
      logLevel: level,
      logMessage: message,
    },
  });
}

/**
 * Ensure directory exists
 */
async function ensureDir(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
}

/**
 * Generate thumbnail from video using FFmpeg
 */
async function generateThumbnail(
  videoPath: string,
  thumbnailPath: string,
  timestamp: string = '00:00:00.500'
): Promise<void> {
  await ensureDir(thumbnailPath);

  const command = `ffmpeg -y -i "${videoPath}" -ss ${timestamp} -vframes 1 -q:v 2 "${thumbnailPath}"`;
  execSync(command, { stdio: 'pipe' });
}

/**
 * Process generate job
 */
async function processGenerateJob(job: Job<GenerateJobData>): Promise<void> {
  const { clipId } = job.data;
  const jobId = job.id as string;

  console.log(`[GenerateWorker] Processing job ${jobId} for clip ${clipId}`);

  try {
    // Update job status to processing
    await prisma.job.update({
      where: { id: jobId },
      data: {
        jobStatus: 'processing',
        startedAt: new Date(),
      },
    });

    // Update clip status
    await prisma.clip.update({
      where: { id: clipId },
      data: { clipStatus: 'processing' },
    });

    await addJobLog(jobId, 'info', 'Started clip generation');
    await publishProgress(jobId, { percent: 5, message: 'Starting generation...' });

    // Fetch clip and project details
    const clip = await prisma.clip.findUnique({
      where: { id: clipId },
      include: {
        project: true,
      },
    });

    if (!clip) {
      throw new Error('Clip not found');
    }

    // Fetch job settings
    const jobRecord = await prisma.job.findUnique({
      where: { id: jobId },
    });

    const settings = jobRecord?.jobSettings as Record<string, unknown> || {};
    const { width, height } = parseResolution(clip.project.resolution);

    await publishProgress(jobId, { percent: 10, message: 'Building workflow...' });

    // Get video model from settings
    const videoModel = (settings.videoModel as VideoModel) || 'animateDiff';
    const modelConfig = MODEL_CONFIG[videoModel];

    // Check if model is installed
    if (!modelConfig.installed && videoModel !== 'animateDiff') {
      throw new Error(
        `${modelConfig.name} is not installed. Please install the required model and custom nodes first.`
      );
    }

    // Build workflow based on video model and generation type
    let workflow: Record<string, unknown>;

    if (videoModel === 'svd' && clip.referenceImage) {
      // Stable Video Diffusion (Image to Video only)
      workflow = buildSVDWorkflow({
        prompt: clip.prompt || '',
        referenceImage: clip.referenceImage,
        width: 1024,
        height: 576,
        steps: clip.stepsCount || 25,
        cfg: 2.5, // SVD uses lower CFG
        seed: clip.seedValue ? Number(clip.seedValue) : undefined,
        frameCount: (settings.frameCount as number) || 25,
        fps: clip.project.frameRate,
      });
    } else if (settings.generationType === 'imageToVideo' && clip.referenceImage) {
      // AnimateDiff Image to Video
      workflow = buildImageToVideoWorkflow({
        prompt: clip.prompt || '',
        negativePrompt: clip.negativePrompt || undefined,
        width,
        height,
        steps: clip.stepsCount,
        cfg: clip.cfgScale,
        seed: clip.seedValue ? Number(clip.seedValue) : undefined,
        frameCount: (settings.frameCount as number) || 16,
        fps: clip.project.frameRate,
        referenceImage: clip.referenceImage,
        ipAdapterWeight: clip.ipAdapterWeight || 1.0,
        denoise: (settings.denoise as number) ?? 0.5,
      });
    } else {
      // AnimateDiff Text to Video (default)
      workflow = buildTextToVideoWorkflow({
        prompt: clip.prompt || '',
        negativePrompt: clip.negativePrompt || undefined,
        width,
        height,
        steps: clip.stepsCount,
        cfg: clip.cfgScale,
        seed: clip.seedValue ? Number(clip.seedValue) : undefined,
        frameCount: (settings.frameCount as number) || 16,
        fps: clip.project.frameRate,
      });
    }

    await addJobLog(jobId, 'info', `Workflow built for ${modelConfig.name}, sending to ComfyUI`);
    await publishProgress(jobId, { percent: 15, message: 'Sending to ComfyUI...' });

    // Check if ComfyUI is available
    const isAvailable = await comfyui.isAvailable();
    if (!isAvailable) {
      throw new Error('ComfyUI server is not available');
    }

    // Execute workflow with progress monitoring
    const result = await comfyui.executeWorkflow(
      workflow,
      async (progress) => {
        if (progress.type === 'progress' && progress.max) {
          const percent = Math.floor(15 + (progress.value! / progress.max) * 70);
          await updateJobProgress(jobId, percent);
          await publishProgress(jobId, {
            percent,
            message: `Processing step ${progress.value}/${progress.max}`,
            step: progress.node,
          });
        } else if (progress.type === 'executing' && progress.node) {
          await publishProgress(jobId, {
            percent: 50,
            message: `Executing node: ${progress.node}`,
            step: progress.node,
          });
        }
      },
      600000 // 10 minute timeout
    );

    await addJobLog(jobId, 'info', 'ComfyUI execution completed');
    await publishProgress(jobId, { percent: 85, message: 'Downloading output...' });

    // Get output video from result
    const outputInfo = getOutputVideoFromResult(result.outputs);
    if (!outputInfo) {
      throw new Error('No output video found in result');
    }

    // Download the generated video
    const videoBuffer = await comfyui.getOutputFile(
      outputInfo.filename,
      outputInfo.subfolder,
      'output'
    );

    // Save video to storage
    await ensureDir(clip.filePath!);
    await writeFile(clip.filePath!, videoBuffer);

    await addJobLog(jobId, 'info', `Video saved to ${clip.filePath}`);
    await publishProgress(jobId, { percent: 90, message: 'Generating thumbnail...' });

    // Generate thumbnail
    try {
      await generateThumbnail(clip.filePath!, clip.thumbnailPath!);
      await addJobLog(jobId, 'info', 'Thumbnail generated');
    } catch (thumbError) {
      await addJobLog(jobId, 'warn', `Failed to generate thumbnail: ${thumbError}`);
    }

    await publishProgress(jobId, { percent: 95, message: 'Updating database...' });

    // Get video info (duration, frame count)
    let durationSec = 2; // Default
    let frameCount = 16; // Default
    try {
      const probeCommand = `ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets,duration -of csv=p=0 "${clip.filePath}"`;
      const probeOutput = execSync(probeCommand, { encoding: 'utf-8' });
      const [packets, duration] = probeOutput.trim().split(',');
      frameCount = parseInt(packets, 10) || 16;
      durationSec = parseFloat(duration) || 2;
    } catch {
      // Use defaults
    }

    // Update clip with final data
    await prisma.clip.update({
      where: { id: clipId },
      data: {
        clipStatus: 'completed',
        durationSec,
        frameCount,
      },
    });

    // Update job as completed
    await prisma.job.update({
      where: { id: jobId },
      data: {
        jobStatus: 'completed',
        progressPercent: 100,
        completedAt: new Date(),
      },
    });

    await addJobLog(jobId, 'info', 'Clip generation completed successfully');
    await publishProgress(jobId, { percent: 100, message: 'Completed!' });

    // Publish completion event
    await redis.publish(
      `job:${jobId}:progress`,
      JSON.stringify({
        type: 'completed',
        clipId,
        filePath: clip.filePath,
        thumbnailPath: clip.thumbnailPath,
        durationSec,
        frameCount,
        timestamp: new Date().toISOString(),
      })
    );

    console.log(`[GenerateWorker] Job ${jobId} completed successfully`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[GenerateWorker] Job ${jobId} failed:`, errorMessage);

    // Update job as failed
    await prisma.job.update({
      where: { id: jobId },
      data: {
        jobStatus: 'failed',
        errorMessage,
        completedAt: new Date(),
      },
    });

    // Update clip status
    await prisma.clip.update({
      where: { id: clipId },
      data: { clipStatus: 'failed' },
    });

    await addJobLog(jobId, 'error', `Generation failed: ${errorMessage}`);

    // Publish error event
    await redis.publish(
      `job:${jobId}:progress`,
      JSON.stringify({
        type: 'error',
        message: errorMessage,
        timestamp: new Date().toISOString(),
      })
    );

    throw error;
  }
}

// Create and start the worker
const worker = new Worker<GenerateJobData>(
  'generateQueue',
  processGenerateJob,
  {
    connection: redis,
    concurrency: 1, // Process one job at a time (GPU limited)
    limiter: {
      max: 1,
      duration: 1000,
    },
  }
);

// Worker event handlers
worker.on('completed', (job) => {
  console.log(`[GenerateWorker] Job ${job.id} completed`);
});

worker.on('failed', (job, error) => {
  console.error(`[GenerateWorker] Job ${job?.id} failed:`, error.message);
});

worker.on('error', (error) => {
  console.error('[GenerateWorker] Worker error:', error);
});

console.log('[GenerateWorker] Worker started and listening for jobs...');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[GenerateWorker] Shutting down...');
  await worker.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});

export default worker;
