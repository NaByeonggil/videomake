import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prismaClient';
import { z } from 'zod';
import { unlink } from 'fs/promises';
import path from 'path';

// Validation schema for updating a clip
const updateClipSchema = z.object({
  clipName: z.string().min(1).max(255).optional(),
  prompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  orderIndex: z.number().int().optional(),
});

// GET /api/clips/[clipId] - Get clip details
export async function GET(
  request: NextRequest,
  { params }: { params: { clipId: string } }
) {
  try {
    const clip = await prisma.clip.findUnique({
      where: { id: params.clipId },
      include: {
        project: {
          select: {
            id: true,
            projectName: true,
            displayName: true,
            resolution: true,
            frameRate: true,
          },
        },
      },
    });

    if (!clip) {
      return NextResponse.json(
        { success: false, error: 'Clip not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: clip,
    });
  } catch (error) {
    console.error('Error fetching clip:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch clip' },
      { status: 500 }
    );
  }
}

// PATCH /api/clips/[clipId] - Update clip metadata
export async function PATCH(
  request: NextRequest,
  { params }: { params: { clipId: string } }
) {
  try {
    const body = await request.json();
    const validated = updateClipSchema.parse(body);

    const clip = await prisma.clip.update({
      where: { id: params.clipId },
      data: validated,
    });

    return NextResponse.json({
      success: true,
      data: clip,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Error updating clip:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update clip' },
      { status: 500 }
    );
  }
}

// DELETE /api/clips/[clipId] - Delete clip and associated files
export async function DELETE(
  request: NextRequest,
  { params }: { params: { clipId: string } }
) {
  try {
    // Get clip info first to find file paths
    const clip = await prisma.clip.findUnique({
      where: { id: params.clipId },
      select: { filePath: true, thumbnailPath: true },
    });

    if (!clip) {
      return NextResponse.json(
        { success: false, error: 'Clip not found' },
        { status: 404 }
      );
    }

    // Delete from database
    await prisma.clip.delete({
      where: { id: params.clipId },
    });

    // Delete video file if exists
    if (clip.filePath) {
      try {
        const videoPath = clip.filePath.startsWith('./')
          ? path.join(process.cwd(), clip.filePath)
          : clip.filePath;
        await unlink(videoPath);
        console.log(`Deleted video file: ${videoPath}`);
      } catch (fileError) {
        // File might not exist, log but don't fail
        console.warn(`Could not delete video file: ${clip.filePath}`, fileError);
      }
    }

    // Delete thumbnail if exists
    if (clip.thumbnailPath) {
      try {
        const thumbPath = clip.thumbnailPath.startsWith('./')
          ? path.join(process.cwd(), clip.thumbnailPath)
          : clip.thumbnailPath;
        await unlink(thumbPath);
        console.log(`Deleted thumbnail: ${thumbPath}`);
      } catch (fileError) {
        console.warn(`Could not delete thumbnail: ${clip.thumbnailPath}`, fileError);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Clip and files deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting clip:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete clip' },
      { status: 500 }
    );
  }
}
