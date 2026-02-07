/**
 * Project API hooks using React Query
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useProjectStore, Project } from '@/stores/projectStore';

const API_BASE = '/api';

// Fetch all projects
export function useProjects() {
  const setProjects = useProjectStore((state) => state.setProjects);

  return useQuery({
    queryKey: ['projects'],
    queryFn: async (): Promise<Project[]> => {
      const res = await fetch(`${API_BASE}/projects`);
      if (!res.ok) throw new Error('Failed to fetch projects');
      const json = await res.json();
      // API returns { success, data, pagination }
      const projects = json.data || json;
      setProjects(projects);
      return projects;
    },
  });
}

// Fetch single project
export function useProject(projectId: string | null) {
  return useQuery({
    queryKey: ['project', projectId],
    queryFn: async (): Promise<Project> => {
      if (!projectId) throw new Error('No project ID');
      const res = await fetch(`${API_BASE}/projects/${projectId}`);
      if (!res.ok) throw new Error('Failed to fetch project');
      const json = await res.json();
      return json.data || json;
    },
    enabled: !!projectId,
  });
}

// Create project
export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      displayName: string;
      description?: string;
      resolution?: string;
      frameRate?: number;
    }): Promise<Project> => {
      const res = await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create project');
      }
      const json = await res.json();
      return json.data || json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

// Update project
export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      data,
    }: {
      projectId: string;
      data: Partial<Project>;
    }): Promise<Project> => {
      const res = await fetch(`${API_BASE}/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update project');
      return res.json();
    },
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });
}

// Delete project
export function useDeleteProject() {
  const queryClient = useQueryClient();
  const { currentProjectId, setCurrentProject } = useProjectStore();

  return useMutation({
    mutationFn: async (projectId: string): Promise<void> => {
      const res = await fetch(`${API_BASE}/projects/${projectId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete project');
    },
    onSuccess: (_, projectId) => {
      if (currentProjectId === projectId) {
        setCurrentProject(null);
      }
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}
