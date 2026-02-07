import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prismaClient';

// GET /api/jobs/[jobId] - Get job status and details
export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const job = await prisma.job.findUnique({
      where: { id: params.jobId },
      include: {
        project: {
          select: {
            id: true,
            projectName: true,
            displayName: true,
          },
        },
        logs: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!job) {
      return NextResponse.json(
        { success: false, error: 'Job not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: job,
    });
  } catch (error) {
    console.error('Error fetching job:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch job' },
      { status: 500 }
    );
  }
}

// DELETE /api/jobs/[jobId] - Cancel a job
export async function DELETE(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const job = await prisma.job.findUnique({
      where: { id: params.jobId },
    });

    if (!job) {
      return NextResponse.json(
        { success: false, error: 'Job not found' },
        { status: 404 }
      );
    }

    // Only allow cancellation of pending or processing jobs
    if (!['pending', 'processing'].includes(job.jobStatus)) {
      return NextResponse.json(
        { success: false, error: 'Job cannot be cancelled' },
        { status: 400 }
      );
    }

    // Update job status to cancelled
    await prisma.job.update({
      where: { id: params.jobId },
      data: { jobStatus: 'cancelled' },
    });

    // TODO: Also cancel the BullMQ job if it's processing

    return NextResponse.json({
      success: true,
      message: 'Job cancelled successfully',
    });
  } catch (error) {
    console.error('Error cancelling job:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to cancel job' },
      { status: 500 }
    );
  }
}
