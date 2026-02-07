/**
 * Interpolate Worker
 * BullMQ worker that processes frame interpolation jobs
 * Supports FFmpeg minterpolate and AI interpolation via ComfyUI RIFE
 */

import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import Redis from 'ioredis';
import {
  changeFrameRate,
  extractFrames,
  combineFrames,
  getVideoInfo,
} from '../lib/ffmpegWrapper';
import { ComfyUIClient } from '../lib/comfyuiClient';
import { generateFileName, getStoragePathById } from '../lib/fileNaming';
import type { InterpolateJobData } from '../lib/jobQueue';

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
 * Build RIFE interpolation workflow for ComfyUI
 */
function buildRifeWorkflow(
  frame1Path: string,
  frame2Path: string,
  multiplier: number = 2
): Record<string, unknown> {
  return {
    '1': {
      class_type: 'LoadImage',
      inputs: {
        image: frame1Path,
        upload: 'image',
      },
    },
    '2': {
      class_type: 'LoadImage',
      inputs: {
        image: frame2Path,
        upload: 'image',
      },
    },
    '3': {
      class_type: 'RIFE VFI',
      inputs: {
        ckpt_name: 'rife47.pth',
        clear_cache_after_n_frames: 10,
        multiplier,
        fast_mode: true,
        ensemble: false,
        scale_factor: 1.0,
        frames: ['1', 0],
        optional_interpolation_states: null,
      },
    },
    '4': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        frame_rate: 8,
        loop_count: 0,
        filename_prefix: 'interpolated',
        format: 'image/png',
        pingpong: false,
        save_output: true,
        images: ['3', 0],
      },
    },
  };
}

/**
 * Interpolate frames using RIFE via ComfyUI
 */
async function interpolateWithRife(
  inputFramesDir: string,
  outputFramesDir: string,
  frames: string[],
  multiplier: number,
  onProgress?: (percent: number, message: string) => Promise<void>
): Promise<string[]> {
  const outputFrames: string[] = [];
  const totalPairs = frames.length - 1;

  for (let i = 0; i < totalPairs; i++) {
    const frame1Path = frames[i];
    const frame2Path = frames[i + 1];

    // Upload frames to ComfyUI
    const frame1Buffer = await readFile(frame1Path);
    const frame2Buffer = await readFile(frame2Path);

    const upload1 = await comfyui.uploadImage(frame1Buffer, `frame1_${i}.png`, 'rife_input');
    const upload2 = await comfyui.uploadImage(frame2Buffer, `frame2_${i}.png`, 'rife_input');

    // Build and execute RIFE workflow
    const workflow = buildRifeWorkflow(upload1.name, upload2.name, multiplier);
    const result = await comfyui.executeWorkflow(workflow, undefined, 60000);

    // Get interpolated frames
    const outputs = result.outputs;
    for (const nodeId in outputs) {
      const nodeOutput = outputs[nodeId] as { images?: Array<{ filename: string; subfolder: string }> };
      if (nodeOutput.images) {
        for (let j = 0; j < nodeOutput.images.length; j++) {
          const imageInfo = nodeOutput.images[j];
          const imageBuffer = await comfyui.getOutputFile(
            imageInfo.filename,
            imageInfo.subfolder,
            'output'
          );
          const frameIndex = outputFrames.length;
          const outputPath = join(outputFramesDir, `frame_${String(frameIndex + 1).padStart(5, '0')}.png`);
          await writeFile(outputPath, imageBuffer);
          outputFrames.push(outputPath);
        }
      }
    }

    const percent = Math.floor(((i + 1) / totalPairs) * 100);
    await onProgress?.(percent, `Interpolating pair ${i + 1}/${totalPairs}`);
  }

  return outputFrames;
}

/**
 * Process interpolate job
 */
async function processInterpolateJob(job: Job<InterpolateJobData>): Promise<void> {
  const { jobId, projectId, inputPath, targetFps = 24 } = job.data;

  console.log(`[InterpolateWorker] Processing job ${jobId} for project ${projectId}`);

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

    await addJobLog(jobId, 'info', `Started interpolate job. Target FPS: ${targetFps}`);
    await publishProgress(jobId, { percent: 5, message: 'Starting interpolation...' });

    // Fetch project details
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Get input video info
    const inputInfo = await getVideoInfo(inputPath);
    const sourceFps = inputInfo.fps;

    await addJobLog(jobId, 'info', `Source FPS: ${sourceFps}, Target FPS: ${targetFps}`);
    await publishProgress(jobId, { percent: 10, message: 'Analyzing video...' });
    await updateJobProgress(jobId, 10);

    if (targetFps <= sourceFps) {
      await addJobLog(jobId, 'warn', `Target FPS (${targetFps}) is not higher than source (${sourceFps}). Using simple fps filter.`);
    }

    // Generate output filename
    const outputFileName = generateFileName(project.projectName, 'interpolated', targetFps, 'mp4');
    const outputPath = join(getStoragePathById(projectId, 'interpolated'), outputFileName);
    await mkdir(dirname(outputPath), { recursive: true });

    // Determine interpolation method
    const multiplier = Math.ceil(targetFps / sourceFps);
    const useAI = multiplier > 2 || (await comfyui.isAvailable());

    if (!useAI || multiplier <= 2) {
      // Use FFmpeg minterpolate for simple cases
      await publishProgress(jobId, { percent: 20, message: 'Interpolating with FFmpeg...' });

      await changeFrameRate(inputPath, outputPath, targetFps, async (percent, message) => {
        const adjustedPercent = Math.floor(20 + (percent * 0.7));
        await updateJobProgress(jobId, adjustedPercent);
        await publishProgress(jobId, { percent: adjustedPercent, message });
      });

    } else {
      // Use RIFE via ComfyUI for higher quality interpolation
      const isAvailable = await comfyui.isAvailable();
      if (!isAvailable) {
        // Fall back to FFmpeg
        await addJobLog(jobId, 'warn', 'ComfyUI not available, falling back to FFmpeg');
        await changeFrameRate(inputPath, outputPath, targetFps, async (percent, message) => {
          const adjustedPercent = Math.floor(20 + (percent * 0.7));
          await updateJobProgress(jobId, adjustedPercent);
          await publishProgress(jobId, { percent: adjustedPercent, message });
        });
      } else {
        await publishProgress(jobId, { percent: 15, message: 'Extracting frames...' });

        // Create temp directory for frames
        tempDir = join(dirname(outputPath), `temp_interpolate_${jobId}`);
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
        await publishProgress(jobId, { percent: 30, message: 'Interpolating frames with RIFE...' });

        // Interpolate using RIFE
        await interpolateWithRife(
          inputFramesDir,
          outputFramesDir,
          frames,
          multiplier,
          async (percent, message) => {
            const adjustedPercent = Math.floor(30 + (percent * 0.5));
            await updateJobProgress(jobId, adjustedPercent);
            await publishProgress(jobId, { percent: adjustedPercent, message });
          }
        );

        await publishProgress(jobId, { percent: 80, message: 'Combining frames...' });

        // Combine frames back to video
        await combineFrames(outputFramesDir, outputPath, targetFps, 'png', async (percent, message) => {
          const adjustedPercent = Math.floor(80 + (percent * 0.1));
          await updateJobProgress(jobId, adjustedPercent);
          await publishProgress(jobId, { percent: adjustedPercent, message });
        });
      }
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
          sourceFps,
          targetFps: outputInfo.fps,
          sourceFrameCount: inputInfo.frameCount,
          outputFrameCount: outputInfo.frameCount,
          duration: outputInfo.duration,
        },
      },
    });

    await addJobLog(jobId, 'info', `Interpolation completed. FPS: ${sourceFps} -> ${outputInfo.fps}, Frames: ${inputInfo.frameCount} -> ${outputInfo.frameCount}`);
    await publishProgress(jobId, { percent: 100, message: 'Interpolation completed!' });

    // Publish completion event
    await redis.publish(
      `job:${jobId}:progress`,
      JSON.stringify({
        type: 'completed',
        outputPath,
        sourceFps,
        targetFps: outputInfo.fps,
        frameCount: outputInfo.frameCount,
        duration: outputInfo.duration,
        timestamp: new Date().toISOString(),
      })
    );

    console.log(`[InterpolateWorker] Job ${jobId} completed successfully`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[InterpolateWorker] Job ${jobId} failed:`, errorMessage);

    // Update job as failed
    await prisma.job.update({
      where: { id: jobId },
      data: {
        jobStatus: 'failed',
        errorMessage,
        completedAt: new Date(),
      },
    });

    await addJobLog(jobId, 'error', `Interpolation failed: ${errorMessage}`);

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
const worker = new Worker<InterpolateJobData>(
  'interpolateQueue',
  processInterpolateJob,
  {
    connection: redis,
    concurrency: 1, // Process one job at a time (GPU limited)
  }
);

// Worker event handlers
worker.on('completed', (job) => {
  console.log(`[InterpolateWorker] Job ${job.id} completed`);
});

worker.on('failed', (job, error) => {
  console.error(`[InterpolateWorker] Job ${job?.id} failed:`, error.message);
});

worker.on('error', (error) => {
  console.error('[InterpolateWorker] Worker error:', error);
});

console.log('[InterpolateWorker] Worker started and listening for jobs...');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[InterpolateWorker] Shutting down...');
  await worker.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});

export default worker;
