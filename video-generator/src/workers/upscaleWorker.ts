/**
 * Upscale Worker
 * BullMQ worker that processes video upscaling jobs
 * Supports FFmpeg scaling and AI upscaling via ComfyUI
 */

import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { mkdir, rm } from 'fs/promises';
import { dirname, join } from 'path';
import Redis from 'ioredis';
import {
  scaleVideo,
  extractFrames,
  combineFrames,
  getVideoInfo,
} from '../lib/ffmpegWrapper';
import { ComfyUIClient } from '../lib/comfyuiClient';
import { generateFileName, getStoragePathById } from '../lib/fileNaming';
import type { UpscaleJobData } from '../lib/jobQueue';

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
 * Build Real-ESRGAN upscale workflow for ComfyUI
 */
function buildUpscaleWorkflow(imagePath: string, scale: number = 2): Record<string, unknown> {
  return {
    '1': {
      class_type: 'LoadImage',
      inputs: {
        image: imagePath,
        upload: 'image',
      },
    },
    '2': {
      class_type: 'UpscaleModelLoader',
      inputs: {
        model_name: scale >= 4 ? 'RealESRGAN_x4plus.pth' : 'RealESRGAN_x2plus.pth',
      },
    },
    '3': {
      class_type: 'ImageUpscaleWithModel',
      inputs: {
        upscale_model: ['2', 0],
        image: ['1', 0],
      },
    },
    '4': {
      class_type: 'SaveImage',
      inputs: {
        images: ['3', 0],
        filename_prefix: 'upscaled',
      },
    },
  };
}

/**
 * Upscale single frame using ComfyUI Real-ESRGAN
 */
async function upscaleFrameWithAI(
  framePath: string,
  scale: number,
  outputPath: string
): Promise<string> {
  const workflow = buildUpscaleWorkflow(framePath, scale);
  const result = await comfyui.executeWorkflow(workflow, undefined, 120000);

  // Get output image
  const outputs = result.outputs;
  for (const nodeId in outputs) {
    const nodeOutput = outputs[nodeId] as { images?: Array<{ filename: string; subfolder: string }> };
    if (nodeOutput.images && nodeOutput.images.length > 0) {
      const imageInfo = nodeOutput.images[0];
      const imageBuffer = await comfyui.getOutputFile(
        imageInfo.filename,
        imageInfo.subfolder,
        'output'
      );
      const { writeFile } = await import('fs/promises');
      await writeFile(outputPath, imageBuffer);
      return outputPath;
    }
  }

  throw new Error('No output image from upscale');
}

/**
 * Process upscale job
 */
async function processUpscaleJob(job: Job<UpscaleJobData>): Promise<void> {
  const { jobId, projectId, inputPath, scale = 2, model = 'ffmpeg' } = job.data;

  console.log(`[UpscaleWorker] Processing job ${jobId} for project ${projectId}`);

  let tempDir: string | null = null;

  try {
    // Update job status to processing
    await prisma.job.update({
      where: { id: jobId },
      data: {
        jobStatus: 'processing',
        startedAt: new Date(),
      },
    });

    await addJobLog(jobId, 'info', `Started upscale job. Scale: ${scale}x, Model: ${model}`);
    await publishProgress(jobId, { percent: 5, message: 'Starting upscale...' });

    // Fetch project details
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Get input video info
    const inputInfo = await getVideoInfo(inputPath);
    const targetWidth = inputInfo.width * scale;
    const targetHeight = inputInfo.height * scale;

    await addJobLog(jobId, 'info', `Input: ${inputInfo.width}x${inputInfo.height}, Target: ${targetWidth}x${targetHeight}`);
    await publishProgress(jobId, { percent: 10, message: 'Analyzing video...' });
    await updateJobProgress(jobId, 10);

    // Generate output filename
    const outputFileName = generateFileName(project.projectName, 'upscaled', scale, 'mp4');
    const outputPath = join(getStoragePathById(projectId, 'upscaled'), outputFileName);
    await mkdir(dirname(outputPath), { recursive: true });

    if (model === 'ffmpeg') {
      // Use FFmpeg lanczos scaling
      await publishProgress(jobId, { percent: 20, message: 'Upscaling with FFmpeg...' });

      await scaleVideo(inputPath, outputPath, targetWidth, targetHeight, async (percent, message) => {
        const adjustedPercent = Math.floor(20 + (percent * 0.7));
        await updateJobProgress(jobId, adjustedPercent);
        await publishProgress(jobId, { percent: adjustedPercent, message });
      });

    } else if (model === 'realesrgan') {
      // Use Real-ESRGAN via ComfyUI (frame-by-frame)
      const isAvailable = await comfyui.isAvailable();
      if (!isAvailable) {
        throw new Error('ComfyUI server is not available for AI upscaling');
      }

      await publishProgress(jobId, { percent: 15, message: 'Extracting frames...' });

      // Create temp directory for frames
      tempDir = join(dirname(outputPath), `temp_upscale_${jobId}`);
      const inputFramesDir = join(tempDir, 'input');
      const outputFramesDir = join(tempDir, 'output');
      await mkdir(inputFramesDir, { recursive: true });
      await mkdir(outputFramesDir, { recursive: true });

      // Extract frames
      const frames = await extractFrames(inputPath, inputFramesDir, 'png', async (percent, message) => {
        const adjustedPercent = Math.floor(15 + (percent * 0.15));
        await updateJobProgress(jobId, adjustedPercent);
        await publishProgress(jobId, { percent: adjustedPercent, message });
      });

      await addJobLog(jobId, 'info', `Extracted ${frames.length} frames`);
      await publishProgress(jobId, { percent: 30, message: 'Upscaling frames with AI...' });

      // Upscale each frame
      for (let i = 0; i < frames.length; i++) {
        const framePath = frames[i];
        const outputFramePath = join(outputFramesDir, `frame_${String(i + 1).padStart(4, '0')}.png`);

        // Upload frame to ComfyUI
        const { readFile } = await import('fs/promises');
        const frameBuffer = await readFile(framePath);
        const uploadResult = await comfyui.uploadImage(frameBuffer, `frame_${i}.png`, 'upscale_input');

        await upscaleFrameWithAI(uploadResult.name, scale, outputFramePath);

        const percent = Math.floor(30 + ((i + 1) / frames.length) * 50);
        await updateJobProgress(jobId, percent);
        await publishProgress(jobId, {
          percent,
          message: `Upscaling frame ${i + 1}/${frames.length}`,
        });
      }

      await addJobLog(jobId, 'info', 'All frames upscaled');
      await publishProgress(jobId, { percent: 80, message: 'Combining frames...' });

      // Combine frames back to video
      await combineFrames(outputFramesDir, outputPath, inputInfo.fps, 'png', async (percent, message) => {
        const adjustedPercent = Math.floor(80 + (percent * 0.1));
        await updateJobProgress(jobId, adjustedPercent);
        await publishProgress(jobId, { percent: adjustedPercent, message });
      });
    } else {
      throw new Error(`Unknown upscale model: ${model}`);
    }

    await publishProgress(jobId, { percent: 90, message: 'Getting video info...' });

    // Get output video info
    const outputInfo = await getVideoInfo(outputPath);

    await publishProgress(jobId, { percent: 95, message: 'Updating database...' });

    // Update job with output info
    await prisma.job.update({
      where: { id: jobId },
      data: {
        jobStatus: 'completed',
        progressPercent: 100,
        completedAt: new Date(),
        jobSettings: {
          ...(await prisma.job.findUnique({ where: { id: jobId } }))?.jobSettings as object,
          outputPath,
          originalWidth: inputInfo.width,
          originalHeight: inputInfo.height,
          outputWidth: outputInfo.width,
          outputHeight: outputInfo.height,
          duration: outputInfo.duration,
        },
      },
    });

    await addJobLog(jobId, 'info', `Upscale completed. Output: ${outputInfo.width}x${outputInfo.height}`);
    await publishProgress(jobId, { percent: 100, message: 'Upscale completed!' });

    // Publish completion event
    await redis.publish(
      `job:${jobId}:progress`,
      JSON.stringify({
        type: 'completed',
        outputPath,
        width: outputInfo.width,
        height: outputInfo.height,
        duration: outputInfo.duration,
        timestamp: new Date().toISOString(),
      })
    );

    console.log(`[UpscaleWorker] Job ${jobId} completed successfully`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[UpscaleWorker] Job ${jobId} failed:`, errorMessage);

    // Update job as failed
    await prisma.job.update({
      where: { id: jobId },
      data: {
        jobStatus: 'failed',
        errorMessage,
        completedAt: new Date(),
      },
    });

    await addJobLog(jobId, 'error', `Upscale failed: ${errorMessage}`);

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
  } finally {
    // Clean up temp directory
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// Create and start the worker
const worker = new Worker<UpscaleJobData>(
  'upscaleQueue',
  processUpscaleJob,
  {
    connection: redis,
    concurrency: 1, // Process one job at a time (GPU limited)
  }
);

// Worker event handlers
worker.on('completed', (job) => {
  console.log(`[UpscaleWorker] Job ${job.id} completed`);
});

worker.on('failed', (job, error) => {
  console.error(`[UpscaleWorker] Job ${job?.id} failed:`, error.message);
});

worker.on('error', (error) => {
  console.error('[UpscaleWorker] Worker error:', error);
});

console.log('[UpscaleWorker] Worker started and listening for jobs...');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[UpscaleWorker] Shutting down...');
  await worker.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});

export default worker;
