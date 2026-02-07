import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prismaClient';

// GET /api/clips - List clips (optionally filtered by projectId)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const status = searchParams.get('status');

    const where: Record<string, unknown> = {};
    if (projectId) where.projectId = projectId;
    if (status) where.clipStatus = status;

    const clips = await prisma.clip.findMany({
      where,
      orderBy: { orderIndex: 'asc' },
      include: {
        project: {
          select: {
            id: true,
            projectName: true,
            displayName: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: clips,
    });
  } catch (error) {
    console.error('Error fetching clips:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch clips' },
      { status: 500 }
    );
  }
}
