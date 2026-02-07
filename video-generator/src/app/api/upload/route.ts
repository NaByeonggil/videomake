/**
 * Image Upload API
 * Uploads images to ComfyUI input folder for image-to-video generation
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

// ComfyUI input folder path
const COMFYUI_INPUT_PATH = process.env.COMFYUI_INPUT_PATH || '/home/n1/Desktop/videomake/ComfyUI/input';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: 'Invalid file type. Allowed: PNG, JPEG, WebP' },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, error: 'File too large. Max size: 10MB' },
        { status: 400 }
      );
    }

    // Ensure input directory exists
    if (!existsSync(COMFYUI_INPUT_PATH)) {
      await mkdir(COMFYUI_INPUT_PATH, { recursive: true });
    }

    // Generate unique filename
    const ext = path.extname(file.name) || '.png';
    const uniqueFilename = `upload_${randomUUID()}${ext}`;
    const filePath = path.join(COMFYUI_INPUT_PATH, uniqueFilename);

    // Convert file to buffer and save
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    return NextResponse.json({
      success: true,
      data: {
        filename: uniqueFilename,
        originalName: file.name,
        size: file.size,
        type: file.type,
      },
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to upload file' },
      { status: 500 }
    );
  }
}
