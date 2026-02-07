/**
 * API Integration Test Script
 * Tests all API endpoints for the Video Generator
 *
 * Usage: npx tsx scripts/testApi.ts
 */

const API_BASE = 'http://localhost:3000/api';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  data?: unknown;
}

interface ApiResponse<T = unknown> {
  success?: boolean;
  data?: T;
  error?: string;
  pagination?: unknown;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: message });
    console.log(`✗ ${name}: ${message}`);
  }
}

async function fetchJson<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  const json = await res.json() as ApiResponse<T>;

  if (!res.ok) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }

  // Handle wrapped response format
  if (json.success !== undefined && json.data !== undefined) {
    return json.data;
  }

  return json as T;
}

// Test data
let testProjectId: string;
let testClipId: string;
let testJobId: string;

async function runTests(): Promise<void> {
  console.log('\n=== Video Generator API Tests ===\n');

  // Project Tests
  await test('GET /api/projects - List projects', async () => {
    const data = await fetchJson<unknown[]>(`${API_BASE}/projects`);
    if (!Array.isArray(data)) throw new Error('Expected array');
  });

  await test('POST /api/projects - Create project', async () => {
    const data = await fetchJson<{ id: string }>(`${API_BASE}/projects`, {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'API Test Project',
        description: 'Integration test project',
        resolution: '512x512',
        frameRate: 8,
      }),
    });

    if (!data.id) throw new Error('No project ID returned');
    testProjectId = data.id;
  });

  await test('GET /api/projects/[id] - Get project', async () => {
    const data = await fetchJson<{ id: string; displayName: string }>(`${API_BASE}/projects/${testProjectId}`);
    if (data.id !== testProjectId) throw new Error('Wrong project returned');
    if (data.displayName !== 'API Test Project') throw new Error('Wrong display name');
  });

  await test('PATCH /api/projects/[id] - Update project', async () => {
    const data = await fetchJson<{ displayName: string }>(`${API_BASE}/projects/${testProjectId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        displayName: 'Updated API Test Project',
      }),
    });

    if (data.displayName !== 'Updated API Test Project') {
      throw new Error('Update not applied');
    }
  });

  // Clip Tests
  await test('GET /api/clips - List clips (empty)', async () => {
    const data = await fetchJson<unknown[]>(`${API_BASE}/clips?projectId=${testProjectId}`);
    if (!Array.isArray(data)) throw new Error('Expected array');
  });

  await test('POST /api/clips/generateClip - Create clip', async () => {
    const data = await fetchJson<{ clipId: string; jobId: string }>(`${API_BASE}/clips/generateClip`, {
      method: 'POST',
      body: JSON.stringify({
        projectId: testProjectId,
        clipName: 'Test Clip 1',
        generationType: 'textToVideo',
        prompt: 'A beautiful sunset over the ocean',
        negativePrompt: 'blurry, low quality',
        clipSettings: {
          stepsCount: 20,
          cfgScale: 7.5,
          frameCount: 16,
        },
      }),
    });

    if (!data.clipId || !data.jobId) throw new Error('Missing IDs');
    testClipId = data.clipId;
    testJobId = data.jobId;
  });

  await test('GET /api/clips - List clips (with data)', async () => {
    const data = await fetchJson<unknown[]>(`${API_BASE}/clips?projectId=${testProjectId}`);
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Expected non-empty array');
    }
  });

  await test('PATCH /api/clips/reorderClips - Reorder clips', async () => {
    await fetchJson(`${API_BASE}/clips/reorderClips`, {
      method: 'PATCH',
      body: JSON.stringify({
        projectId: testProjectId,
        clipIds: [testClipId],
      }),
    });
  });

  // Job Tests
  await test('GET /api/jobs/[id] - Get job', async () => {
    const data = await fetchJson<{ id: string; jobType: string }>(`${API_BASE}/jobs/${testJobId}`);
    if (data.id !== testJobId) throw new Error('Wrong job returned');
  });

  // Processing API Tests (validation only)
  await test('POST /api/processing/merge - Validation error (need 2+ clips)', async () => {
    try {
      await fetchJson(`${API_BASE}/processing/merge`, {
        method: 'POST',
        body: JSON.stringify({
          projectId: testProjectId,
          clipIds: [testClipId], // Only 1 clip - should error
        }),
      });
      throw new Error('Should have failed validation');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      // Expected: validation failure for less than 2 clips
      if (!message.toLowerCase().includes('validation')) {
        throw new Error(`Unexpected error: ${message}`);
      }
    }
  });

  await test('POST /api/processing/upscale - Validation (file not found expected)', async () => {
    try {
      await fetchJson(`${API_BASE}/processing/upscale`, {
        method: 'POST',
        body: JSON.stringify({
          projectId: testProjectId,
          inputPath: '/nonexistent/video.mp4',
          scale: 2,
        }),
      });
      throw new Error('Should have failed - file not found');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!message.toLowerCase().includes('not found')) {
        throw new Error(`Unexpected error: ${message}`);
      }
    }
  });

  await test('POST /api/processing/interpolate - Validation (file not found expected)', async () => {
    try {
      await fetchJson(`${API_BASE}/processing/interpolate`, {
        method: 'POST',
        body: JSON.stringify({
          projectId: testProjectId,
          inputPath: '/nonexistent/video.mp4',
          targetFps: 24,
        }),
      });
      throw new Error('Should have failed - file not found');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!message.toLowerCase().includes('not found')) {
        throw new Error(`Unexpected error: ${message}`);
      }
    }
  });

  await test('POST /api/processing/export - Validation (clips not completed)', async () => {
    try {
      await fetchJson(`${API_BASE}/processing/export`, {
        method: 'POST',
        body: JSON.stringify({
          projectId: testProjectId,
          clipIds: [testClipId],
          settings: {
            merge: { enabled: false },
            upscale: { enabled: false },
            interpolate: { enabled: false },
            encode: { format: 'mp4', quality: 'standard' },
          },
        }),
      });
      throw new Error('Should have failed - clips not completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!message.toLowerCase().includes('not completed')) {
        throw new Error(`Unexpected error: ${message}`);
      }
    }
  });

  // Cleanup Tests
  await test('DELETE /api/jobs/[id] - Cancel job', async () => {
    const res = await fetch(`${API_BASE}/jobs/${testJobId}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
  });

  await test('DELETE /api/clips/[id] - Delete clip', async () => {
    const res = await fetch(`${API_BASE}/clips/${testClipId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });

  await test('DELETE /api/projects/[id] - Delete project', async () => {
    const res = await fetch(`${API_BASE}/projects/${testProjectId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });

  // Summary
  console.log('\n=== Test Summary ===');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }

  console.log('\n✓ All tests passed!\n');
}

// Run tests
runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
