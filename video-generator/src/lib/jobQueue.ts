import { Queue } from 'bullmq';
import redis from './redis';

// Queue configuration
const queueOptions = {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential' as const,
      delay: 1000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 60 * 60, // 24 hours
    },
    removeOnFail: {
      count: 50,
    },
  },
};

// Generate queue - for clip generation
export const generateQueue = new Queue('generateQueue', queueOptions);

// Merge queue - for video concatenation
export const mergeQueue = new Queue('mergeQueue', queueOptions);

// Upscale queue - for video upscaling
export const upscaleQueue = new Queue('upscaleQueue', queueOptions);

// Interpolate queue - for frame interpolation
export const interpolateQueue = new Queue('interpolateQueue', queueOptions);

// Export queue - for final export pipeline
export const exportQueue = new Queue('exportQueue', queueOptions);

// Long video queue - for automated multi-segment video generation
export const longVideoQueue = new Queue('longVideoQueue', {
  ...queueOptions,
  defaultJobOptions: {
    ...queueOptions.defaultJobOptions,
    attempts: 1, // No auto-retry for long jobs (segments are preserved)
    removeOnComplete: {
      count: 20,
      age: 48 * 60 * 60, // 48 hours
    },
  },
});

// Helper to get queue by name
export function getQueue(queueName: string): Queue | null {
  const queues: Record<string, Queue> = {
    generateQueue,
    mergeQueue,
    upscaleQueue,
    interpolateQueue,
    exportQueue,
    longVideoQueue,
  };
  return queues[queueName] || null;
}

// Job types
export interface GenerateJobData {
  clipId: string;
  projectId: string;
}

export interface MergeJobData {
  jobId: string;
  projectId: string;
  clipIds: string[];
  transition?: string;
  transitionDuration?: number;
}

export interface UpscaleJobData {
  jobId: string;
  projectId: string;
  inputPath: string;
  scale?: number;
  model?: string;
}

export interface InterpolateJobData {
  jobId: string;
  projectId: string;
  inputPath: string;
  targetFps?: number;
}

export interface ExportJobData {
  jobId: string;
  projectId: string;
  clipIds: string[];
  settings: {
    merge: { enabled: boolean; transition?: string; transitionDuration?: number };
    upscale: { enabled: boolean; scale?: number; model?: string };
    interpolate: { enabled: boolean; targetFps?: number };
    encode: { format?: string; quality?: string };
  };
}

export interface LongVideoJobData {
  jobId: string;
  projectId: string;
  prompt: string;
  negativePrompt?: string;
  referenceImage?: string; // optional first frame reference
  totalSegments: number;
  framesPerSegment: number; // default 81
  videoModel: string; // wan21
  denoise?: number; // 0.7 default for I2V
  hqEnhance: boolean; // auto-apply HQ after merge
  width?: number; // generation width (default 640)
  height?: number; // generation height (default 360)
}
