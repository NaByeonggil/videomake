/**
 * FFmpeg Wrapper
 * Utilities for video processing: merge, upscale, interpolate, encode
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdir, writeFile, unlink, readdir } from 'fs/promises';
import { dirname, join } from 'path';

const execAsync = promisify(exec);

export interface VideoInfo {
  duration: number;
  fps: number;
  width: number;
  height: number;
  codec: string;
  bitrate: number;
  frameCount: number;
}

export interface MergeOptions {
  transition?: 'none' | 'fade' | 'dissolve' | 'wipeleft' | 'wiperight' | 'slideup' | 'slidedown';
  transitionDuration?: number; // seconds
}

export interface EncodeOptions {
  codec?: 'h264' | 'h265' | 'vp9';
  crf?: number; // 0-51, lower is better quality
  preset?: 'ultrafast' | 'fast' | 'medium' | 'slow' | 'veryslow';
  fps?: number;
  width?: number;
  height?: number;
  audioBitrate?: string;
}

export type ProgressCallback = (percent: number, message: string) => void | Promise<void>;

/**
 * Ensure directory exists
 */
async function ensureDir(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
}

/**
 * Get video information using ffprobe
 */
export async function getVideoInfo(videoPath: string): Promise<VideoInfo> {
  const command = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name,r_frame_rate,bit_rate,duration,nb_frames -of json "${videoPath}"`;

  const { stdout } = await execAsync(command);
  const data = JSON.parse(stdout);
  const stream = data.streams[0];

  // Parse frame rate (e.g., "24/1" or "30000/1001")
  const [fpsNum, fpsDen] = stream.r_frame_rate.split('/').map(Number);
  const fps = fpsNum / fpsDen;

  return {
    duration: parseFloat(stream.duration) || 0,
    fps,
    width: stream.width,
    height: stream.height,
    codec: stream.codec_name,
    bitrate: parseInt(stream.bit_rate) || 0,
    frameCount: parseInt(stream.nb_frames) || Math.ceil(fps * parseFloat(stream.duration)),
  };
}

/**
 * Extract thumbnail from video
 */
export async function extractThumbnail(
  videoPath: string,
  outputPath: string,
  timestamp: string = '00:00:00.500',
  size?: { width: number; height: number }
): Promise<void> {
  await ensureDir(outputPath);

  let scaleFilter = '';
  if (size) {
    scaleFilter = `-vf "scale=${size.width}:${size.height}"`;
  }

  const command = `ffmpeg -y -i "${videoPath}" -ss ${timestamp} -vframes 1 ${scaleFilter} -q:v 2 "${outputPath}"`;
  await execAsync(command);
}

/**
 * Concatenate videos (simple cut, no re-encoding)
 */
export async function concatenateVideos(
  inputPaths: string[],
  outputPath: string,
  onProgress?: ProgressCallback
): Promise<void> {
  await ensureDir(outputPath);

  // Create concat file list
  const listPath = outputPath.replace(/\.[^.]+$/, '_list.txt');
  const listContent = inputPaths.map(p => `file '${p}'`).join('\n');
  await writeFile(listPath, listContent);

  try {
    await onProgress?.(10, 'Preparing concatenation...');

    const command = `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`;
    await execAsync(command);

    await onProgress?.(100, 'Concatenation complete');
  } finally {
    // Clean up list file
    await unlink(listPath).catch(() => {});
  }
}

/**
 * Merge videos with transition effects
 */
export async function mergeVideosWithTransition(
  inputPaths: string[],
  outputPath: string,
  options: MergeOptions = {},
  onProgress?: ProgressCallback
): Promise<void> {
  const { transition = 'fade', transitionDuration = 0.5 } = options;

  if (inputPaths.length < 2 || transition === 'none') {
    return concatenateVideos(inputPaths, outputPath, onProgress);
  }

  await ensureDir(outputPath);
  await onProgress?.(5, 'Analyzing videos...');

  // Get durations of all videos
  const durations: number[] = [];
  for (const path of inputPaths) {
    const info = await getVideoInfo(path);
    durations.push(info.duration);
  }

  await onProgress?.(15, 'Building filter graph...');

  // Build complex filter for xfade transitions
  let filterComplex = '';
  let currentStream = '[0:v]';

  for (let i = 1; i < inputPaths.length; i++) {
    const offset = durations.slice(0, i).reduce((a, b) => a + b, 0) - (transitionDuration * i);
    const outputStream = i === inputPaths.length - 1 ? '[outv]' : `[v${i}]`;

    filterComplex += `${currentStream}[${i}:v]xfade=transition=${transition}:duration=${transitionDuration}:offset=${offset}${outputStream}`;

    if (i < inputPaths.length - 1) {
      filterComplex += ';';
      currentStream = `[v${i}]`;
    }
  }

  await onProgress?.(30, 'Merging videos...');

  // Build input arguments
  const inputArgs = inputPaths.map(p => `-i "${p}"`).join(' ');

  const command = `ffmpeg -y ${inputArgs} -filter_complex "${filterComplex}" -map "[outv]" -c:v libx264 -preset medium -crf 23 "${outputPath}"`;

  await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });
  await onProgress?.(100, 'Merge complete');
}

/**
 * Extract all frames from video as images
 */
export async function extractFrames(
  videoPath: string,
  outputDir: string,
  format: string = 'png',
  onProgress?: ProgressCallback
): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });
  await onProgress?.(10, 'Extracting frames...');

  const outputPattern = join(outputDir, `frame_%04d.${format}`);
  const command = `ffmpeg -y -i "${videoPath}" "${outputPattern}"`;

  await execAsync(command);

  // Get list of extracted frames
  const files = await readdir(outputDir);
  const frames = files
    .filter(f => f.startsWith('frame_') && f.endsWith(`.${format}`))
    .sort()
    .map(f => join(outputDir, f));

  await onProgress?.(100, `Extracted ${frames.length} frames`);
  return frames;
}

/**
 * Combine frames back into video
 */
export async function combineFrames(
  framesDir: string,
  outputPath: string,
  fps: number = 8,
  format: string = 'png',
  onProgress?: ProgressCallback
): Promise<void> {
  await ensureDir(outputPath);
  await onProgress?.(10, 'Combining frames...');

  const inputPattern = join(framesDir, `frame_%04d.${format}`);
  const command = `ffmpeg -y -framerate ${fps} -i "${inputPattern}" -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p "${outputPath}"`;

  await execAsync(command);
  await onProgress?.(100, 'Frames combined');
}

/**
 * Encode/transcode video with specific settings
 */
export async function encodeVideo(
  inputPath: string,
  outputPath: string,
  options: EncodeOptions = {},
  onProgress?: ProgressCallback
): Promise<void> {
  const {
    codec = 'h264',
    crf = 23,
    preset = 'medium',
    fps,
    width,
    height,
    audioBitrate = '128k',
  } = options;

  await ensureDir(outputPath);
  await onProgress?.(10, 'Encoding video...');

  // Build video codec settings
  let codecArgs = '';
  switch (codec) {
    case 'h264':
      codecArgs = `-c:v libx264 -preset ${preset} -crf ${crf}`;
      break;
    case 'h265':
      codecArgs = `-c:v libx265 -preset ${preset} -crf ${crf}`;
      break;
    case 'vp9':
      codecArgs = `-c:v libvpx-vp9 -crf ${crf} -b:v 0`;
      break;
  }

  // Build filter arguments
  const filters: string[] = [];
  if (fps) filters.push(`fps=${fps}`);
  if (width && height) filters.push(`scale=${width}:${height}`);

  const filterArgs = filters.length > 0 ? `-vf "${filters.join(',')}"` : '';

  const command = `ffmpeg -y -i "${inputPath}" ${codecArgs} ${filterArgs} -c:a aac -b:a ${audioBitrate} "${outputPath}"`;

  await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });
  await onProgress?.(100, 'Encoding complete');
}

/**
 * Change video frame rate (with frame interpolation using motion interpolation filter)
 */
export async function changeFrameRate(
  inputPath: string,
  outputPath: string,
  targetFps: number,
  onProgress?: ProgressCallback
): Promise<void> {
  await ensureDir(outputPath);
  await onProgress?.(10, `Changing frame rate to ${targetFps}fps...`);

  // Using minterpolate filter for smoother frame rate conversion
  const command = `ffmpeg -y -i "${inputPath}" -vf "minterpolate=fps=${targetFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1" -c:v libx264 -preset medium -crf 23 "${outputPath}"`;

  await execAsync(command, { maxBuffer: 100 * 1024 * 1024, timeout: 600000 });
  await onProgress?.(100, 'Frame rate change complete');
}

/**
 * Scale video to different resolution
 */
export async function scaleVideo(
  inputPath: string,
  outputPath: string,
  width: number,
  height: number,
  onProgress?: ProgressCallback
): Promise<void> {
  await ensureDir(outputPath);
  await onProgress?.(10, `Scaling to ${width}x${height}...`);

  // Use lanczos for high quality scaling
  const command = `ffmpeg -y -i "${inputPath}" -vf "scale=${width}:${height}:flags=lanczos" -c:v libx264 -preset medium -crf 23 "${outputPath}"`;

  await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });
  await onProgress?.(100, 'Scaling complete');
}

/**
 * Get total duration of multiple videos
 */
export async function getTotalDuration(videoPaths: string[]): Promise<number> {
  let total = 0;
  for (const path of videoPaths) {
    const info = await getVideoInfo(path);
    total += info.duration;
  }
  return total;
}

/**
 * Check if FFmpeg is available
 */
export async function isFFmpegAvailable(): Promise<boolean> {
  try {
    await execAsync('ffmpeg -version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if FFprobe is available
 */
export async function isFFprobeAvailable(): Promise<boolean> {
  try {
    await execAsync('ffprobe -version');
    return true;
  } catch {
    return false;
  }
}
