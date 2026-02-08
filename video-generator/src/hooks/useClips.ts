/**
 * Clip API hooks using React Query
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useProjectStore, Clip } from '@/stores/projectStore';

const API_BASE = '/api';

// Fetch clips for a project
export function useClips(projectId: string | null) {
  const setClips = useProjectStore((state) => state.setClips);

  return useQuery({
    queryKey: ['clips', projectId],
    queryFn: async (): Promise<Clip[]> => {
      if (!projectId) throw new Error('No project ID');
      const res = await fetch(`${API_BASE}/clips?projectId=${projectId}`);
      if (!res.ok) throw new Error('Failed to fetch clips');
      const json = await res.json();
      // API returns { success, data } or array
      const clips = json.data || json;
      setClips(clips);
      return clips;
    },
    enabled: !!projectId,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

// Generate new clip
export function useGenerateClip() {
  const queryClient = useQueryClient();
  const addJob = useProjectStore((state) => state.addJob);

  return useMutation({
    mutationFn: async (data: {
      projectId: string;
      prompt: string;
      negativePrompt?: string;
      seedValue?: number;
      stepsCount?: number;
      cfgScale?: number;
      referenceImage?: string;
      ipAdapterWeight?: number;
      denoise?: number;
      generationType?: 'textToVideo' | 'imageToVideo';
      videoModel?: 'animateDiff' | 'svd' | 'cogVideoX' | 'hunyuan' | 'wan21';
      frameCount?: number;
      width?: number;
      height?: number;
    }): Promise<{ clipId: string; jobId: string }> => {
      const res = await fetch(`${API_BASE}/clips/generateClip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to generate clip');
      }
      const json = await res.json();
      const result = json.data || json;

      // Add job to store for tracking
      addJob({
        id: result.jobId,
        projectId: data.projectId,
        jobType: 'generate',
        jobStatus: 'pending',
        progressPercent: 0,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date().toISOString(),
      });

      return result;
    },
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['clips', projectId] });
    },
  });
}

// Update clip
export function useUpdateClip() {
  const queryClient = useQueryClient();
  const updateClipStore = useProjectStore((state) => state.updateClip);

  return useMutation({
    mutationFn: async ({
      clipId,
      data,
    }: {
      clipId: string;
      data: Partial<Clip>;
    }): Promise<Clip> => {
      const res = await fetch(`${API_BASE}/clips/${clipId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update clip');
      return res.json();
    },
    onSuccess: (updatedClip) => {
      updateClipStore(updatedClip.id, updatedClip);
      queryClient.invalidateQueries({ queryKey: ['clips', updatedClip.projectId] });
    },
  });
}

// Delete clip
export function useDeleteClip() {
  const queryClient = useQueryClient();
  const { currentClipId, setCurrentClip, removeClip } = useProjectStore();

  return useMutation({
    mutationFn: async ({
      clipId,
    }: {
      clipId: string;
      projectId: string;
    }): Promise<void> => {
      const res = await fetch(`${API_BASE}/clips/${clipId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete clip');
    },
    onSuccess: (_, { clipId }) => {
      if (currentClipId === clipId) {
        setCurrentClip(null);
      }
      removeClip(clipId);
      queryClient.invalidateQueries({ queryKey: ['clips'] });
    },
  });
}

// Reorder clips
export function useReorderClips() {
  const queryClient = useQueryClient();
  const reorderClipsStore = useProjectStore((state) => state.reorderClips);

  return useMutation({
    mutationFn: async ({
      projectId,
      clipIds,
    }: {
      projectId: string;
      clipIds: string[];
    }): Promise<void> => {
      const res = await fetch(`${API_BASE}/clips/reorderClips`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, clipIds }),
      });
      if (!res.ok) throw new Error('Failed to reorder clips');
    },
    onMutate: ({ clipIds }) => {
      // Optimistic update
      reorderClipsStore(clipIds);
    },
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['clips', projectId] });
    },
  });
}
