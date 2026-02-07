import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prismaClient';
import { toCamelCase } from '@/lib/fileNaming';
import { z } from 'zod';

// Validation schema for creating a project
const createProjectSchema = z.object({
  displayName: z.string().min(1).max(255),
  description: z.string().optional(),
  resolution: z.string().default('512x512'),
  frameRate: z.number().int().positive().default(8),
});

// GET /api/projects - List all projects
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const status = searchParams.get('status');

    const where = status ? { projectStatus: status } : {};

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { clips: true, jobs: true },
          },
        },
      }),
      prisma.project.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: projects,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

// POST /api/projects - Create a new project
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = createProjectSchema.parse(body);

    const projectName = toCamelCase(validated.displayName);

    const project = await prisma.project.create({
      data: {
        projectName,
        displayName: validated.displayName,
        description: validated.description,
        resolution: validated.resolution,
        frameRate: validated.frameRate,
        projectStatus: 'draft',
      },
    });

    return NextResponse.json({
      success: true,
      data: project,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Error creating project:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create project' },
      { status: 500 }
    );
  }
}
