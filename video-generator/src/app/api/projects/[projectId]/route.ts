import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prismaClient';
import { toCamelCase } from '@/lib/fileNaming';
import { z } from 'zod';

// Validation schema for updating a project
const updateProjectSchema = z.object({
  displayName: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  resolution: z.string().optional(),
  frameRate: z.number().int().positive().optional(),
  projectStatus: z.enum(['draft', 'active', 'archived']).optional(),
});

// GET /api/projects/[projectId] - Get project details
export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      include: {
        clips: {
          orderBy: { orderIndex: 'asc' },
        },
        jobs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!project) {
      return NextResponse.json(
        { success: false, error: 'Project not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: project,
    });
  } catch (error) {
    console.error('Error fetching project:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch project' },
      { status: 500 }
    );
  }
}

// PATCH /api/projects/[projectId] - Update project
export async function PATCH(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const body = await request.json();
    const validated = updateProjectSchema.parse(body);

    // If displayName is updated, also update projectName
    const updateData: Record<string, unknown> = { ...validated };
    if (validated.displayName) {
      updateData.projectName = toCamelCase(validated.displayName);
    }

    const project = await prisma.project.update({
      where: { id: params.projectId },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      data: project,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Error updating project:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update project' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[projectId] - Delete project
export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    await prisma.project.delete({
      where: { id: params.projectId },
    });

    return NextResponse.json({
      success: true,
      message: 'Project deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting project:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete project' },
      { status: 500 }
    );
  }
}
