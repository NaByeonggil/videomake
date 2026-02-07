/**
 * Export Worker
 * BullMQ worker that handles the full export pipeline
 * Combines merge, upscale, interpolate, and encode steps
 */

import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { mkdir, rm } from 'fs/promises';
import { dirname, join } from 'path';
import Redis from 'ioredis';
import {
  concatenateVideos,
  mergeVideosWithTransition,
  scaleVideo,
  changeFrameRate,
  encodeVideo,
  getVideoInfo,
  extractThumbnail,
} from '../lib/ffmpegWrapper';
import { getStoragePathById } from '../lib/fileNaming';
import type { ExportJobData } from '../lib/jobQueue';

// Initialize connections
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

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
 * Process export job
 */
async function processExportJob(job: Job<ExportJobData>): Promise<void> {
  const { jobId, projectId, clipIds, settings } = job.data;

  console.log(`[ExportWorker] Processing job ${jobId} for project ${projectId}`);

  let tempDir: string | null = null;
  const tempFiles: string[] = [];

  try {
    // Update job status to processing
    await prisma.job.update({
      where: { id: jobId },
      data: {
        jobStatus: 'processing',
        startedAt: new Date(),
      },
    });

    await addJobLog(jobId, 'info', 'Started export job');
    await publishProgress(jobId, { percent: 2, message: 'Starting export...' });

    // Fetch project details
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Fetch all clips in order
    const clips = await prisma.clip.findMany({
      where: {
        id: { in: clipIds },
        clipStatus: 'completed',
      },
      orderBy: { orderIndex: 'asc' },
    });

    if (clips.length === 0) {
      throw new Error('No completed clips found to export');
    }

    await addJobLog(jobId, 'info', `Found ${clips.length} clips for export`);
    await publishProgress(jobId, { percent: 5, message: 'Validating clips...' });
    await updateJobProgress(jobId, 5);

    // Get input paths
    const inputPaths: string[] = [];
    for (const clip of clips) {
      if (!clip.filePath) {
        throw new Error(`Clip ${clip.id} has no file path`);
      }
      inputPaths.push(clip.filePath);
    }

    // Create temp directory
    tempDir = join(getStoragePathById(projectId, 'exports'), `temp_export_${jobId}`);
    await mkdir(tempDir, { recursive: true });

    // Calculate progress weights based on enabled steps
    const steps = {
      merge: settings.merge.enabled,
      upscale: settings.upscale.enabled,
      interpolate: settings.interpolate.enabled,
      encode: true, // Always encode at the end
    };

    const enabledSteps = Object.values(steps).filter(Boolean).length;
    const stepWeight = 80 / enabledSteps; // 80% for processing, 20% for setup/finalization
    let currentProgress = 10;

    let currentPath = inputPaths[0]; // Start with first clip or merged result

    // Step 1: Merge clips if enabled
    if (settings.merge.enabled && inputPaths.length > 1) {
      await publishProgress(jobId, { percent: currentProgress, message: 'Merging clips...', step: 'merge' });
      await addJobLog(jobId, 'info', 'Starting merge step');

      const mergedPath = join(tempDir, 'merged.mp4');
      tempFiles.push(mergedPath);

      const transition = settings.merge.transition || 'none';
      const transitionDuration = settings.merge.transitionDuration || 0.5;

      const mergeProgress = async (percent: number, message: string) => {
        const adjusted = Math.floor(currentProgress + (percent / 100) * stepWeight);
        await updateJobProgress(jobId, adjusted);
        await publishProgress(jobId, { percent: adjusted, message, step: 'merge' });
      };

      if (transition === 'none') {
        await concatenateVideos(inputPaths, mergedPath, mergeProgress);
      } else {
        await mergeVideosWithTransition(
          inputPaths,
          mergedPath,
          {
            transition: transition as 'fade' | 'dissolve' | 'wipeleft' | 'wiperight' | 'slideup' | 'slidedown',
            transitionDuration,
          },
          mergeProgress
        );
      }

      currentPath = mergedPath;
      currentProgress += stepWeight;
      await addJobLog(jobId, 'info', 'Merge step completed');
    } else if (inputPaths.length > 1) {
      // Concatenate without transitions
      await publishProgress(jobId, { percent: currentProgress, message: 'Concatenating clips...' });
      const concatPath = join(tempDir, 'concat.mp4');
      tempFiles.push(concatPath);
      await concatenateVideos(inputPaths, concatPath);
      currentPath = concatPath;
    }

    // Step 2: Upscale if enabled
    if (settings.upscale.enabled) {
      await publishProgress(jobId, { percent: currentProgress, message: 'Upscaling video...', step: 'upscale' });
      await addJobLog(jobId, 'info', 'Starting upscale step');

      const videoInfo = await getVideoInfo(currentPath);
      const scale = settings.upscale.scale || 2;
      const targetWidth = videoInfo.width * scale;
      const targetHeight = videoInfo.height * scale;

      const upscaledPath = join(tempDir, 'upscaled.mp4');
      tempFiles.push(upscaledPath);

      await scaleVideo(currentPath, upscaledPath, targetWidth, targetHeight, async (percent, message) => {
        const adjusted = Math.floor(currentProgress + (percent / 100) * stepWeight);
        await updateJobProgress(jobId, adjusted);
        await publishProgress(jobId, { percent: adjusted, message, step: 'upscale' });
      });

      currentPath = upscaledPath;
      currentProgress += stepWeight;
      await addJobLog(jobId, 'info', `Upscale step completed. New resolution: ${targetWidth}x${targetHeight}`);
    }

    // Step 3: Interpolate if enabled
    if (settings.interpolate.enabled) {
      await publishProgress(jobId, { percent: currentProgress, message: 'Interpolating frames...', step: 'interpolate' });
      await addJobLog(jobId, 'info', 'Starting interpolate step');

      const targetFps = settings.interpolate.targetFps || 24;
      const interpolatedPath = join(tempDir, 'interpolated.mp4');
      tempFiles.push(interpolatedPath);

      await changeFrameRate(currentPath, interpolatedPath, targetFps, async (percent, message) => {
        const adjusted = Math.floor(currentProgress + (percent / 100) * stepWeight);
        await updateJobProgress(jobId, adjusted);
        await publishProgress(jobId, { percent: adjusted, message, step: 'interpolate' });
      });

      currentPath = interpolatedPath;
      currentProgress += stepWeight;
      await addJobLog(jobId, 'info', `Interpolate step completed. Target FPS: ${targetFps}`);
    }

    // Step 4: Final encode
    await publishProgress(jobId, { percent: currentProgress, message: 'Encoding final video...', step: 'encode' });
    await addJobLog(jobId, 'info', 'Starting final encode');

    // Generate output filename with timestamp
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const format = settings.encode.format || 'mp4';
    const outputFileName = `${project.projectName}_export_${timestamp}.${format}`;
    const outputPath = join(getStoragePathById(projectId, 'exports'), outputFileName);
    await mkdir(dirname(outputPath), { recursive: true });

    // Determine encode settings
    const qualityPresets: Record<string, { crf: number; preset: 'fast' | 'medium' | 'slow' }> = {
      draft: { crf: 28, preset: 'fast' },
      standard: { crf: 23, preset: 'medium' },
      high: { crf: 18, preset: 'slow' },
    };
    const qualitySetting = qualityPresets[settings.encode.quality || 'standard'];

    await encodeVideo(currentPath, outputPath, {
      codec: 'h264',
      crf: qualitySetting.crf,
      preset: qualitySetting.preset,
    }, async (percent, message) => {
      const adjusted = Math.floor(currentProgress + (percent / 100) * stepWeight);
      await updateJobProgress(jobId, adjusted);
      await publishProgress(jobId, { percent: adjusted, message, step: 'encode' });
    });

    await addJobLog(jobId, 'info', 'Final encode completed');
    await publishProgress(jobId, { percent: 92, message: 'Generating thumbnail...' });

    // Generate thumbnail
    const thumbnailPath = outputPath.replace(/\.[^.]+$/, '_thumb.jpg');
    try {
      await extractThumbnail(outputPath, thumbnailPath, '00:00:01');
    } catch {
      await addJobLog(jobId, 'warn', 'Failed to generate thumbnail');
    }

    await publishProgress(jobId, { percent: 95, message: 'Getting video info...' });

    // Get final video info
    const outputInfo = await getVideoInfo(outputPath);

    await publishProgress(jobId, { percent: 98, message: 'Updating database...' });

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
          thumbnailPath,
          width: outputInfo.width,
          height: outputInfo.height,
          duration: outputInfo.duration,
          fps: outputInfo.fps,
          frameCount: outputInfo.frameCount,
        },
      },
    });

    await addJobLog(jobId, 'info', `Export completed. Output: ${outputPath}`);
    await publishProgress(jobId, { percent: 100, message: 'Export completed!' });

    // Publish completion event
    await redis.publish(
      `job:${jobId}:progress`,
      JSON.stringify({
        type: 'completed',
        outputPath,
        thumbnailPath,
        width: outputInfo.width,
        height: outputInfo.height,
        duration: outputInfo.duration,
        fps: outputInfo.fps,
        frameCount: outputInfo.frameCount,
        timestamp: new Date().toISOString(),
      })
    );

    console.log(`[ExportWorker] Job ${jobId} completed successfully`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ExportWorker] Job ${jobId} failed:`, errorMessage);

    // Update job as failed
    await prisma.job.update({
      where: { id: jobId },
      data: {
        jobStatus: 'failed',
        errorMessage,
        completedAt: new Date(),
      },
    });

    await addJobLog(jobId, 'error', `Export failed: ${errorMessage}`);

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
const worker = new Worker<ExportJobData>(
  'exportQueue',
  processExportJob,
  {
    connection: redis,
    concurrency: 1, // Process one job at a time
  }
);

// Worker event handlers
worker.on('completed', (job) => {
  console.log(`[ExportWorker] Job ${job.id} completed`);
});

worker.on('failed', (job, error) => {
  console.error(`[ExportWorker] Job ${job?.id} failed:`, error.message);
});

worker.on('error', (error) => {
  console.error('[ExportWorker] Worker error:', error);
});

console.log('[ExportWorker] Worker started and listening for jobs...');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[ExportWorker] Shutting down...');
  await worker.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});

export default worker;
