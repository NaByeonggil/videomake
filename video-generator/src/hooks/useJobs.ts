/**
 * Job API hooks and SSE progress monitoring
 */

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useProjectStore } from '@/stores/projectStore';

const API_BASE = '/api';

interface JobProgress {
  type: 'connected' | 'progress' | 'completed' | 'error';
  percent?: number;
  message?: string;
  step?: string;
  clipId?: string;
  outputPath?: string;
}

// Hook to monitor job progress via SSE
export function useJobProgress(
  jobId: string | null,
  onProgress?: (progress: JobProgress) => void,
  onComplete?: (data: JobProgress) => void,
  onError?: (error: string) => void
) {
  const updateJob = useProjectStore((state) => state.updateJob);
  const removeJob = useProjectStore((state) => state.removeJob);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!jobId) return;

    const eventSource = new EventSource(`${API_BASE}/events/jobProgress/${jobId}`);

    eventSource.onmessage = (event) => {
      try {
        const data: JobProgress = JSON.parse(event.data);

        if (data.type === 'progress') {
          updateJob(jobId, {
            progressPercent: data.percent || 0,
            jobStatus: 'processing',
          });
          onProgress?.(data);
        } else if (data.type === 'completed') {
          updateJob(jobId, {
            progressPercent: 100,
            jobStatus: 'completed',
            completedAt: new Date().toISOString(),
          });
          onComplete?.(data);

          // Invalidate queries to refresh data
          queryClient.invalidateQueries({ queryKey: ['clips'] });

          // Remove from active jobs after a delay
          setTimeout(() => removeJob(jobId), 3000);

          eventSource.close();
        } else if (data.type === 'error') {
          updateJob(jobId, {
            jobStatus: 'failed',
            errorMessage: data.message,
            completedAt: new Date().toISOString(),
          });
          onError?.(data.message || 'Unknown error');
          eventSource.close();
        }
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [jobId, updateJob, removeJob, queryClient, onProgress, onComplete, onError]);
}

// Get job status
export function useJobStatus(jobId: string | null) {
  const jobs = useProjectStore((state) => state.activeJobs);
  return jobs.find((job) => job.id === jobId) || null;
}

// Cancel job
export function useCancelJob() {
  const removeJob = useProjectStore((state) => state.removeJob);

  return useMutation({
    mutationFn: async (jobId: string): Promise<void> => {
      const res = await fetch(`${API_BASE}/jobs/${jobId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to cancel job');
    },
    onSuccess: (_, jobId) => {
      removeJob(jobId);
    },
  });
}

// Merge clips
export function useMergeClips() {
  const addJob = useProjectStore((state) => state.addJob);

  return useMutation({
    mutationFn: async (data: {
      projectId: string;
      clipIds: string[];
      transition?: string;
      transitionDuration?: number;
    }): Promise<{ jobId: string }> => {
      const res = await fetch(`${API_BASE}/processing/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to start merge');
      }
      const result = await res.json();

      addJob({
        id: result.jobId,
        projectId: data.projectId,
        jobType: 'merge',
        jobStatus: 'pending',
        progressPercent: 0,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date().toISOString(),
      });

      return result;
    },
  });
}

// Upscale video
export function useUpscaleVideo() {
  const addJob = useProjectStore((state) => state.addJob);

  return useMutation({
    mutationFn: async (data: {
      projectId: string;
      inputPath: string;
      scale?: number;
      model?: 'ffmpeg' | 'realesrgan';
    }): Promise<{ jobId: string }> => {
      const res = await fetch(`${API_BASE}/processing/upscale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to start upscale');
      }
      const result = await res.json();

      addJob({
        id: result.jobId,
        projectId: data.projectId,
        jobType: 'upscale',
        jobStatus: 'pending',
        progressPercent: 0,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date().toISOString(),
      });

      return result;
    },
  });
}

// Interpolate video
export function useInterpolateVideo() {
  const addJob = useProjectStore((state) => state.addJob);

  return useMutation({
    mutationFn: async (data: {
      projectId: string;
      inputPath: string;
      targetFps?: number;
    }): Promise<{ jobId: string }> => {
      const res = await fetch(`${API_BASE}/processing/interpolate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to start interpolation');
      }
      const result = await res.json();

      addJob({
        id: result.jobId,
        projectId: data.projectId,
        jobType: 'interpolate',
        jobStatus: 'pending',
        progressPercent: 0,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date().toISOString(),
      });

      return result;
    },
  });
}

// Export video
export function useExportVideo() {
  const addJob = useProjectStore((state) => state.addJob);

  return useMutation({
    mutationFn: async (data: {
      projectId: string;
      clipIds: string[];
      settings: {
        merge: { enabled: boolean; transition?: string; transitionDuration?: number };
        upscale: { enabled: boolean; scale?: number; model?: string };
        interpolate: { enabled: boolean; targetFps?: number };
        encode: { format?: string; quality?: string };
      };
    }): Promise<{ jobId: string; pipeline: string[] }> => {
      const res = await fetch(`${API_BASE}/processing/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to start export');
      }
      const result = await res.json();

      addJob({
        id: result.jobId,
        projectId: data.projectId,
        jobType: 'export',
        jobStatus: 'pending',
        progressPercent: 0,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date().toISOString(),
      });

      return result;
    },
  });
}
