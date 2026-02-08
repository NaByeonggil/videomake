/**
 * Long Video Worker
 * Orchestrates multi-segment video generation by chaining clips.
 * Each segment uses the last frame of the previous as the reference image.
 * After all segments: merge → optional HQ enhance (720p 30fps).
 */

import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import Redis from 'ioredis';
import { ComfyUIClient } from '../lib/comfyuiClient';
import {
  buildWan21I2VWorkflow,
  buildSD15TextToImageWorkflow,
  getOutputVideoFromResult,
} from '../lib/workflowBuilder';
import { generateFileName, getStoragePath } from '../lib/fileNaming';
import { concatenateVideos } from '../lib/ffmpegWrapper';
import type { LongVideoJobData } from '../lib/jobQueue';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const comfyui = new ComfyUIClient();
const COMFYUI_URL = process.env.COMFYUI_URL || 'http://localhost:8188';

async function publishProgress(
  jobId: string,
  progress: { percent: number; message: string; segment?: number; totalSegments?: number }
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

async function addJobLog(
  jobId: string,
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string
): Promise<void> {
  await prisma.jobLog.create({
    data: { jobId, logLevel: level, logMessage: message },
  });
}

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

async function freeVram(): Promise<void> {
  try {
    await fetch(`${COMFYUI_URL}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
  } catch { /* non-fatal */ }
}

async function extractLastFrame(videoPath: string, outputPath: string): Promise<void> {
  await ensureDir(outputPath);
  const cmd = `ffmpeg -y -sseof -0.1 -i "${videoPath}" -vframes 1 -q:v 2 "${outputPath}"`;
  execSync(cmd, { stdio: 'pipe' });
}

async function processLongVideo(job: Job<LongVideoJobData>): Promise<void> {
  const {
    jobId,
    projectId,
    prompt,
    negativePrompt,
    referenceImage,
    totalSegments,
    framesPerSegment,
    videoModel,
    denoise,
    hqEnhance,
    width: jobWidth,
    height: jobHeight,
  } = job.data;

  const genWidth = jobWidth || 640;
  const genHeight = jobHeight || 360;

  console.log(`[LongVideoWorker] Starting job ${jobId}: ${totalSegments} segments`);

  try {
    await prisma.job.update({
      where: { id: jobId },
      data: { jobStatus: 'processing', startedAt: new Date() },
    });
    await addJobLog(jobId, 'info', `Starting long video: ${totalSegments} segments, ${framesPerSegment} frames each`);

    // Check ComfyUI availability
    const isAvailable = await comfyui.isAvailable();
    if (!isAvailable) {
      throw new Error('ComfyUI server is not available');
    }

    // Fetch project
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { projectName: true, frameRate: true },
    });
    if (!project) throw new Error('Project not found');

    const projectName = project.projectName || 'default';
    const segmentPaths: string[] = [];
    const clipIds: string[] = [];
    let currentReferenceImage = referenceImage || null;

    // If no reference image, generate initial frame via SD 1.5 T2I
    if (!currentReferenceImage) {
      await publishProgress(jobId, {
        percent: 1,
        message: 'Generating initial reference frame (SD 1.5 T2I)...',
        segment: 0,
        totalSegments,
      });
      await freeVram();
      await addJobLog(jobId, 'info', 'Generating initial reference frame via SD 1.5 T2I');

      const t2iWorkflow = buildSD15TextToImageWorkflow({
        prompt,
        negativePrompt: negativePrompt || undefined,
        width: genWidth,
        height: genHeight,
        steps: 25,
        cfg: 7.5,
      });

      const t2iResult = await comfyui.executeWorkflow(t2iWorkflow, undefined, 300000);

      // Extract image from SaveImage output
      let initImageFilename: string | null = null;
      for (const nodeOutput of Object.values(t2iResult.outputs)) {
        const out = nodeOutput as { images?: Array<{ filename: string; subfolder: string; type: string }> };
        if (out.images && out.images.length > 0) {
          initImageFilename = out.images[0].filename;
          break;
        }
      }
      if (!initImageFilename) {
        throw new Error('Failed to generate initial reference frame');
      }

      // Download and re-upload to ensure it's in input folder
      const initBuffer = await comfyui.getOutputFile(initImageFilename, '', 'output');
      const uploadResult = await comfyui.uploadImage(initBuffer, 'longvideo_init_frame.jpg');
      currentReferenceImage = uploadResult.name;

      await addJobLog(jobId, 'info', `Initial frame generated and uploaded as ${currentReferenceImage}`);
    }

    // Generate ALL segments using I2V (Wan2.1 14B)
    for (let seg = 1; seg <= totalSegments; seg++) {
      const segPercent = Math.floor(((seg - 1) / totalSegments) * 85) + 3;
      await publishProgress(jobId, {
        percent: segPercent,
        message: `Generating segment ${seg}/${totalSegments} (I2V 14B)...`,
        segment: seg,
        totalSegments,
      });
      await prisma.job.update({
        where: { id: jobId },
        data: { progressPercent: segPercent },
      });

      // 1. Free VRAM before each segment
      await freeVram();
      await addJobLog(jobId, 'info', `Segment ${seg}/${totalSegments}: VRAM freed`);

      // 2. Build I2V workflow (always Wan2.1 14B)
      const seed = Math.floor(Math.random() * 2147483647);
      const workflow = buildWan21I2VWorkflow({
        prompt,
        negativePrompt: negativePrompt || undefined,
        width: genWidth,
        height: genHeight,
        steps: 25,
        cfg: 6.0,
        seed,
        frameCount: framesPerSegment,
        fps: 16,
        referenceImage: currentReferenceImage!,
        denoise: denoise ?? 0.7,
      });
      await addJobLog(jobId, 'info', `Segment ${seg}: I2V 14B workflow (ref: ${currentReferenceImage})`);

      // 3. Execute workflow
      const result = await comfyui.executeWorkflow(
        workflow,
        async (progress) => {
          if (progress.type === 'progress' && progress.max) {
            const stepPct = progress.value! / progress.max;
            const overallPct = Math.floor(((seg - 1 + stepPct) / totalSegments) * 85);
            await publishProgress(jobId, {
              percent: overallPct,
              message: `Segment ${seg}/${totalSegments}: step ${progress.value}/${progress.max}`,
              segment: seg,
              totalSegments,
            });
          }
        },
        1800000 // 30 min timeout per segment
      );

      // 4. Download output video
      const outputInfo = getOutputVideoFromResult(result.outputs);
      if (!outputInfo) {
        throw new Error(`Segment ${seg}/${totalSegments}: No output video in result`);
      }

      const videoBuffer = await comfyui.getOutputFile(
        outputInfo.filename,
        outputInfo.subfolder,
        'output'
      );

      // 5. Save segment clip to disk
      const segStoragePath = getStoragePath('clip', projectName);
      const segFileName = generateFileName(projectName, 'clip', 900 + seg, 'mp4');
      const segFilePath = join(segStoragePath, segFileName);
      await ensureDir(segFilePath);
      await writeFile(segFilePath, videoBuffer);
      segmentPaths.push(segFilePath);

      // 6. Create clip record in DB
      const clip = await prisma.clip.create({
        data: {
          projectId,
          clipName: `Long Video Seg ${seg}/${totalSegments}`,
          orderIndex: 900 + seg,
          prompt,
          negativePrompt: negativePrompt || '',
          seedValue: BigInt(seed),
          stepsCount: 25,
          cfgScale: 6.0,
          referenceImage: currentReferenceImage,
          fileName: segFileName,
          filePath: segFilePath,
          clipStatus: 'completed',
          frameCount: framesPerSegment,
          durationSec: framesPerSegment / 16,
        },
      });
      clipIds.push(clip.id);

      await addJobLog(jobId, 'info', `Segment ${seg}/${totalSegments} completed: ${segFilePath}`);

      // 7. Extract last frame for next segment
      if (seg < totalSegments) {
        const lastFramePath = join(segStoragePath, `longvideo_${jobId}_seg${seg}_lastframe.jpg`);
        await extractLastFrame(segFilePath, lastFramePath);

        // 8. Upload last frame to ComfyUI
        const frameBuffer = await readFile(lastFramePath);
        const uploadResult = await comfyui.uploadImage(
          frameBuffer,
          `longvideo_seg${seg}_lastframe.jpg`
        );
        currentReferenceImage = uploadResult.name;

        await addJobLog(jobId, 'info', `Segment ${seg}: last frame uploaded as ${currentReferenceImage}`);
      }
    }

    // All segments complete - merge
    await publishProgress(jobId, {
      percent: 87,
      message: `Merging ${totalSegments} clips...`,
      segment: totalSegments,
      totalSegments,
    });
    await addJobLog(jobId, 'info', `Merging ${totalSegments} segments`);

    const mergedStoragePath = getStoragePath('merged', projectName);
    const mergedFileName = generateFileName(projectName, 'merged', 0, 'mp4');
    const mergedPath = join(mergedStoragePath, mergedFileName);
    await ensureDir(mergedPath);

    await concatenateVideos(segmentPaths, mergedPath);
    await addJobLog(jobId, 'info', `Merged output: ${mergedPath}`);

    let finalPath = mergedPath;
    let finalFileName = mergedFileName;

    // HQ Enhance: scale 2x to 1280x720 + minterpolate to 30fps
    if (hqEnhance) {
      await publishProgress(jobId, {
        percent: 92,
        message: 'HQ Enhancing to 720p 30fps...',
        segment: totalSegments,
        totalSegments,
      });
      await addJobLog(jobId, 'info', 'Starting HQ enhancement (720p 30fps)');

      const hqFileName = generateFileName(projectName, 'final', 0, 'mp4');
      const hqStoragePath = getStoragePath('final', projectName);
      const hqPath = join(hqStoragePath, hqFileName);
      await ensureDir(hqPath);

      // Scale 2x + interpolate to 30fps
      const hqWidth = genWidth * 2;
      const hqHeight = genHeight * 2;
      const hqCmd = `ffmpeg -y -i "${mergedPath}" -vf "scale=${hqWidth}:${hqHeight}:flags=lanczos,minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1" -c:v libx264 -preset medium -crf 20 "${hqPath}"`;
      execSync(hqCmd, { stdio: 'pipe', maxBuffer: 200 * 1024 * 1024, timeout: 3600000 });

      finalPath = hqPath;
      finalFileName = hqFileName;
      await addJobLog(jobId, 'info', `HQ enhanced output: ${hqPath}`);
    }

    // Update job as completed
    await prisma.job.update({
      where: { id: jobId },
      data: {
        jobStatus: 'completed',
        progressPercent: 100,
        completedAt: new Date(),
        outputPath: finalPath,
        outputFileName: finalFileName,
        inputClipIds: clipIds,
      },
    });

    await publishProgress(jobId, {
      percent: 100,
      message: 'Long video completed!',
      segment: totalSegments,
      totalSegments,
    });

    // Publish completion event
    await redis.publish(
      `job:${jobId}:progress`,
      JSON.stringify({
        type: 'completed',
        outputPath: finalPath,
        totalSegments,
        clipIds,
        timestamp: new Date().toISOString(),
      })
    );

    await addJobLog(jobId, 'info', 'Long video generation completed successfully');
    console.log(`[LongVideoWorker] Job ${jobId} completed: ${finalPath}`);

    await freeVram();

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[LongVideoWorker] Job ${jobId} failed:`, errorMessage);

    await prisma.job.update({
      where: { id: jobId },
      data: {
        jobStatus: 'failed',
        errorMessage,
        completedAt: new Date(),
      },
    });

    await addJobLog(jobId, 'error', `Long video failed: ${errorMessage}`);

    await redis.publish(
      `job:${jobId}:progress`,
      JSON.stringify({
        type: 'error',
        message: errorMessage,
        timestamp: new Date().toISOString(),
      })
    );

    await freeVram();
    throw error;
  }
}

// Create and start the worker
const worker = new Worker<LongVideoJobData>(
  'longVideoQueue',
  processLongVideo,
  {
    connection: redis,
    concurrency: 1,
    lockDuration: 7200000, // 2 hour lock (long running job)
  }
);

worker.on('completed', (job) => {
  console.log(`[LongVideoWorker] Job ${job.id} completed`);
});

worker.on('failed', (job, error) => {
  console.error(`[LongVideoWorker] Job ${job?.id} failed:`, error.message);
});

worker.on('error', (error) => {
  console.error('[LongVideoWorker] Worker error:', error);
});

console.log('[LongVideoWorker] Worker started and listening for jobs...');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[LongVideoWorker] Shutting down...');
  await worker.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});

export default worker;
