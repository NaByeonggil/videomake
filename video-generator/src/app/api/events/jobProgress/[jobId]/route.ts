import { NextRequest } from 'next/server';
import Redis from 'ioredis';

/**
 * SSE endpoint for job progress updates
 * GET /api/events/jobProgress/[jobId]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const { jobId } = params;

  // Create a new Redis connection for this subscriber
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  const channel = `job:${jobId}:progress`;

  // Set up SSE response
  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection message
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'connected', jobId })}\n\n`)
      );

      // Subscribe to job progress channel
      await redis.subscribe(channel);

      // Handle messages
      redis.on('message', (ch, message) => {
        if (ch === channel && !isClosed) {
          try {
            controller.enqueue(encoder.encode(`data: ${message}\n\n`));

            // Check if this is a completion or error message
            const data = JSON.parse(message);
            if (data.type === 'completed' || data.type === 'error') {
              // Close the stream after sending final message
              setTimeout(() => {
                if (!isClosed) {
                  isClosed = true;
                  controller.close();
                  redis.unsubscribe(channel);
                  redis.quit();
                }
              }, 100);
            }
          } catch {
            // Ignore parse errors
          }
        }
      });

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        if (!isClosed) {
          isClosed = true;
          redis.unsubscribe(channel);
          redis.quit();
          controller.close();
        }
      });
    },

    cancel() {
      if (!isClosed) {
        isClosed = true;
        redis.unsubscribe(channel);
        redis.quit();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// Disable caching for this route
export const dynamic = 'force-dynamic';
