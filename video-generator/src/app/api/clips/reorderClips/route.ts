import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prismaClient';
import { z } from 'zod';

// Validation schema for reordering clips
const reorderClipsSchema = z.object({
  projectId: z.string().uuid(),
  clipIds: z.array(z.string().uuid()),
});

// PATCH /api/clips/reorderClips - Reorder clips within a project
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = reorderClipsSchema.parse(body);

    // Update each clip's orderIndex in a transaction
    await prisma.$transaction(
      validated.clipIds.map((clipId, index) =>
        prisma.clip.update({
          where: { id: clipId },
          data: { orderIndex: index + 1 },
        })
      )
    );

    // Fetch updated clips
    const clips = await prisma.clip.findMany({
      where: { projectId: validated.projectId },
      orderBy: { orderIndex: 'asc' },
    });

    return NextResponse.json({
      success: true,
      data: clips,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Error reordering clips:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to reorder clips' },
      { status: 500 }
    );
  }
}
