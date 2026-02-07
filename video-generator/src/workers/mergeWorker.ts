/**
 * Merge Worker
 * BullMQ worker that processes video merge jobs
 */

import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { join } from 'path';
import Redis from 'ioredis';
import { mergeVideosWithTransition, concatenateVideos, getVideoInfo } from '../lib/ffmpegWrapper';
import { generateFileName, getStoragePathById } from '../lib/fileNaming';
import type { MergeJobData } from '../lib/jobQueue';

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
 * Process merge job
 */
async function processMergeJob(job: Job<MergeJobData>): Promise<void> {
  const { jobId, projectId, clipIds, transition = 'none', transitionDuration = 0.5 } = job.data;

  console.log(`[MergeWorker] Processing job ${jobId} for project ${projectId}`);

  try {
    // Update job status to processing
    await prisma.job.update({
      where: { id: jobId },
      data: {
        jobStatus: 'processing',
        startedAt: new Date(),
      },
    });

    await addJobLog(jobId, 'info', `Started merge job with ${clipIds.length} clips`);
    await publishProgress(jobId, { percent: 5, message: 'Starting merge...' });

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
      throw new Error('No completed clips found to merge');
    }

    if (clips.length !== clipIds.length) {
      await addJobLog(jobId, 'warn', `Some clips were not found or not completed. Found ${clips.length}/${clipIds.length}`);
    }

    await publishProgress(jobId, { percent: 10, message: 'Validating clips...' });
    await updateJobProgress(jobId, 10);

    // Get input paths and validate
    const inputPaths: string[] = [];
    for (const clip of clips) {
      if (!clip.filePath) {
        throw new Error(`Clip ${clip.id} has no file path`);
      }
      inputPaths.push(clip.filePath);
    }

    await publishProgress(jobId, { percent: 20, message: 'Preparing output...' });
    await updateJobProgress(jobId, 20);

    // Generate output filename
    const outputFileName = generateFileName(project.projectName, 'merged', 1, 'mp4');
    const outputPath = join(getStoragePathById(projectId, 'merged'), outputFileName);

    await addJobLog(jobId, 'info', `Output path: ${outputPath}`);
    await publishProgress(jobId, { percent: 30, message: 'Merging videos...' });

    // Merge videos
    const progressCallback = async (percent: number, message: string) => {
      const adjustedPercent = Math.floor(30 + (percent * 0.6)); // 30-90%
      await updateJobProgress(jobId, adjustedPercent);
      await publishProgress(jobId, { percent: adjustedPercent, message });
    };

    if (transition === 'none') {
      await concatenateVideos(inputPaths, outputPath, progressCallback);
    } else {
      await mergeVideosWithTransition(
        inputPaths,
        outputPath,
        { transition: transition as 'fade' | 'dissolve' | 'wipeleft' | 'wiperight' | 'slideup' | 'slidedown', transitionDuration },
        progressCallback
      );
    }

    await addJobLog(jobId, 'info', 'Videos merged successfully');
    await publishProgress(jobId, { percent: 90, message: 'Getting video info...' });

    // Get merged video info
    const videoInfo = await getVideoInfo(outputPath);

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
          duration: videoInfo.duration,
          frameCount: videoInfo.frameCount,
        },
      },
    });

    await addJobLog(jobId, 'info', `Merge completed. Duration: ${videoInfo.duration}s, Frames: ${videoInfo.frameCount}`);
    await publishProgress(jobId, { percent: 100, message: 'Merge completed!' });

    // Publish completion event
    await redis.publish(
      `job:${jobId}:progress`,
      JSON.stringify({
        type: 'completed',
        outputPath,
        duration: videoInfo.duration,
        frameCount: videoInfo.frameCount,
        timestamp: new Date().toISOString(),
      })
    );

    console.log(`[MergeWorker] Job ${jobId} completed successfully`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[MergeWorker] Job ${jobId} failed:`, errorMessage);

    // Update job as failed
    await prisma.job.update({
      where: { id: jobId },
      data: {
        jobStatus: 'failed',
        errorMessage,
        completedAt: new Date(),
      },
    });

    await addJobLog(jobId, 'error', `Merge failed: ${errorMessage}`);

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
const worker = new Worker<MergeJobData>(
  'mergeQueue',
  processMergeJob,
  {
    connection: redis,
    concurrency: 1,
  }
);

// Worker event handlers
worker.on('completed', (job) => {
  console.log(`[MergeWorker] Job ${job.id} completed`);
});

worker.on('failed', (job, error) => {
  console.error(`[MergeWorker] Job ${job?.id} failed:`, error.message);
});

worker.on('error', (error) => {
  console.error('[MergeWorker] Worker error:', error);
});

console.log('[MergeWorker] Worker started and listening for jobs...');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[MergeWorker] Shutting down...');
  await worker.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});

export default worker;
