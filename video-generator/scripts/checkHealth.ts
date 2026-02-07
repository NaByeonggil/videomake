/**
 * Health Check Script
 * Verifies all services required for Video Generator are running
 *
 * Usage: npx tsx scripts/checkHealth.ts
 */

import Redis from 'ioredis';

interface ServiceStatus {
  name: string;
  status: 'ok' | 'error';
  message?: string;
}

const results: ServiceStatus[] = [];

async function checkService(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, status: 'ok' });
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, status: 'error', message });
    console.log(`✗ ${name}: ${message}`);
  }
}

async function checkHealth(): Promise<void> {
  console.log('\n=== Video Generator Health Check ===\n');

  // Check MariaDB
  await checkService('MariaDB', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } finally {
      await prisma.$disconnect();
    }
  });

  // Check Redis
  await checkService('Redis', async () => {
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    try {
      const pong = await redis.ping();
      if (pong !== 'PONG') throw new Error('Unexpected response');
    } finally {
      await redis.quit();
    }
  });

  // Check ComfyUI
  await checkService('ComfyUI', async () => {
    const url = process.env.COMFYUI_URL || 'http://localhost:8188';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${url}/system_stats`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } finally {
      clearTimeout(timeoutId);
    }
  });

  // Check Next.js API
  await checkService('Next.js API', async () => {
    const url = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${url}/api/projects`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } finally {
      clearTimeout(timeoutId);
    }
  });

  // Check FFmpeg
  await checkService('FFmpeg', async () => {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const { stdout } = await execAsync('ffmpeg -version');
    if (!stdout.includes('ffmpeg version')) {
      throw new Error('FFmpeg not found');
    }
  });

  // Check FFprobe
  await checkService('FFprobe', async () => {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const { stdout } = await execAsync('ffprobe -version');
    if (!stdout.includes('ffprobe version')) {
      throw new Error('FFprobe not found');
    }
  });

  // Summary
  console.log('\n=== Health Summary ===');
  const ok = results.filter(r => r.status === 'ok').length;
  const error = results.filter(r => r.status === 'error').length;
  console.log(`Healthy: ${ok}/${results.length}`);
  console.log(`Unhealthy: ${error}/${results.length}`);

  if (error > 0) {
    console.log('\nUnhealthy services:');
    results.filter(r => r.status === 'error').forEach(r => {
      console.log(`  - ${r.name}: ${r.message}`);
    });

    console.log('\nTo fix:');
    results.filter(r => r.status === 'error').forEach(r => {
      switch (r.name) {
        case 'MariaDB':
        case 'Redis':
          console.log(`  - Run: docker compose up -d`);
          break;
        case 'ComfyUI':
          console.log(`  - Start ComfyUI: cd ComfyUI && source venv/bin/activate && python main.py --highvram --fp16`);
          break;
        case 'Next.js API':
          console.log(`  - Start Next.js: npm run dev`);
          break;
        case 'FFmpeg':
        case 'FFprobe':
          console.log(`  - Install FFmpeg: sudo apt install ffmpeg`);
          break;
      }
    });
  }

  console.log('');

  // Exit with error if any service is unhealthy
  if (error > 0) {
    process.exit(1);
  }
}

checkHealth().catch(error => {
  console.error('Health check error:', error);
  process.exit(1);
});
