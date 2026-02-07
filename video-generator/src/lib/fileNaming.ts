/**
 * File naming utilities for Video Generator System
 * Format: {YYYYMMDD}_{projectName}_{type}_{index}.{ext}
 */

/**
 * Convert string to camelCase
 * Handles spaces, special characters, and Korean text
 */
export function toCamelCase(str: string): string {
  // Remove special characters except Korean
  const cleaned = str.replace(/[^a-zA-Z0-9가-힣\s]/g, '');

  // Split by spaces
  const words = cleaned.split(/\s+/).filter(Boolean);

  if (words.length === 0) return 'untitled';

  // Check if contains Korean
  const hasKorean = /[가-힣]/.test(cleaned);

  if (hasKorean) {
    // For Korean, just remove spaces
    return words.join('');
  }

  // For English, apply camelCase
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

/**
 * Get current date in YYYYMMDD format
 */
export function getDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Pad index with leading zeros
 */
export function padIndex(index: number, length: number = 3): string {
  return String(index).padStart(length, '0');
}

export type FileType = 'clip' | 'thumb' | 'ref' | 'merged' | 'upscaled' | 'interpolated' | 'final';

/**
 * Generate file name according to naming convention
 */
export function generateFileName(
  projectName: string,
  type: FileType,
  index: number,
  extension: string = 'mp4'
): string {
  const date = getDateString();
  const camelName = toCamelCase(projectName);
  const paddedIndex = padIndex(index);

  return `${date}_${camelName}_${type}_${paddedIndex}.${extension}`;
}

/**
 * Get storage path for file type
 */
export function getStoragePath(type: FileType, projectName: string): string {
  const basePath = process.env.STORAGE_PATH || './public/storage';
  const camelName = toCamelCase(projectName);

  const typeToFolder: Record<FileType, string> = {
    clip: 'clips',
    thumb: 'thumbnails',
    ref: 'referenceImages',
    merged: 'processing',
    upscaled: 'processing',
    interpolated: 'processing',
    final: 'exports',
  };

  return `${basePath}/${typeToFolder[type]}/${camelName}`;
}

/**
 * Get full file path
 */
export function getFullFilePath(
  projectName: string,
  type: FileType,
  index: number,
  extension: string = 'mp4'
): string {
  const storagePath = getStoragePath(type, projectName);
  const fileName = generateFileName(projectName, type, index, extension);
  return `${storagePath}/${fileName}`;
}

/**
 * Get storage path by project ID and subfolder
 */
export function getStoragePathById(projectId: string, subfolder: string): string {
  const basePath = process.env.STORAGE_PATH || './public/storage';
  return `${basePath}/${subfolder}/${projectId}`;
}

/**
 * Parse file name to extract components
 */
export function parseFileName(fileName: string): {
  date: string;
  projectName: string;
  type: FileType;
  index: number;
  extension: string;
} | null {
  const match = fileName.match(/^(\d{8})_(.+?)_(clip|thumb|ref|merged|upscaled|interpolated|final)_(\d+)\.(\w+)$/);

  if (!match) return null;

  return {
    date: match[1],
    projectName: match[2],
    type: match[3] as FileType,
    index: parseInt(match[4], 10),
    extension: match[5],
  };
}
