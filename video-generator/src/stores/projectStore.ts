/**
 * Project Store - Zustand state management
 */

import { create } from 'zustand';

export interface Project {
  id: string;
  projectName: string;
  displayName: string;
  description: string | null;
  resolution: string;
  frameRate: number;
  projectStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface Clip {
  id: string;
  projectId: string;
  clipName: string;
  orderIndex: number;
  prompt: string | null;
  negativePrompt: string | null;
  seedValue: string | null;
  stepsCount: number;
  cfgScale: number;
  referenceImage: string | null;
  ipAdapterWeight: number | null;
  filePath: string | null;
  fileName: string | null;
  thumbnailPath: string | null;
  thumbnailName: string | null;
  durationSec: number | null;
  frameCount: number | null;
  clipStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  projectId: string;
  jobType: string;
  jobStatus: string;
  progressPercent: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ContinueFromClipData {
  filename: string;
  preview: string;
  prompt: string | null;
  clipId: string;
}

interface ProjectState {
  // Current selections
  currentProjectId: string | null;
  currentClipId: string | null;

  // Data
  projects: Project[];
  clips: Clip[];
  activeJobs: Job[];

  // UI state
  isLoading: boolean;
  error: string | null;
  continueFromClip: ContinueFromClipData | null;

  // Actions
  setCurrentProject: (id: string | null) => void;
  setCurrentClip: (id: string | null) => void;
  setProjects: (projects: Project[]) => void;
  setClips: (clips: Clip[]) => void;
  addClip: (clip: Clip) => void;
  updateClip: (id: string, updates: Partial<Clip>) => void;
  removeClip: (id: string) => void;
  reorderClips: (clipIds: string[]) => void;
  addJob: (job: Job) => void;
  updateJob: (id: string, updates: Partial<Job>) => void;
  removeJob: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setContinueFromClip: (data: ContinueFromClipData | null) => void;
  reset: () => void;
}

const initialState = {
  currentProjectId: null,
  currentClipId: null,
  projects: [],
  clips: [],
  activeJobs: [],
  isLoading: false,
  error: null,
  continueFromClip: null,
};

export const useProjectStore = create<ProjectState>((set) => ({
  ...initialState,

  setCurrentProject: (id) => set({ currentProjectId: id, currentClipId: null, clips: [] }),

  setCurrentClip: (id) => set({ currentClipId: id }),

  setProjects: (projects) => set({ projects }),

  setClips: (clips) => set({ clips }),

  addClip: (clip) => set((state) => ({
    clips: [...state.clips, clip],
  })),

  updateClip: (id, updates) => set((state) => ({
    clips: state.clips.map((clip) =>
      clip.id === id ? { ...clip, ...updates } : clip
    ),
  })),

  removeClip: (id) => set((state) => ({
    clips: state.clips.filter((clip) => clip.id !== id),
    currentClipId: state.currentClipId === id ? null : state.currentClipId,
  })),

  reorderClips: (clipIds) => set((state) => {
    const clipMap = new Map(state.clips.map((c) => [c.id, c]));
    const reordered = clipIds
      .map((id, index) => {
        const clip = clipMap.get(id);
        return clip ? { ...clip, orderIndex: index } : null;
      })
      .filter((c): c is Clip => c !== null);
    return { clips: reordered };
  }),

  addJob: (job) => set((state) => ({
    activeJobs: [...state.activeJobs, job],
  })),

  updateJob: (id, updates) => set((state) => ({
    activeJobs: state.activeJobs.map((job) =>
      job.id === id ? { ...job, ...updates } : job
    ),
  })),

  removeJob: (id) => set((state) => ({
    activeJobs: state.activeJobs.filter((job) => job.id !== id),
  })),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  setContinueFromClip: (data) => set({ continueFromClip: data }),

  reset: () => set(initialState),
}));
