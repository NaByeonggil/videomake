/**
 * Project List component
 */

'use client';

import React, { useState } from 'react';
import { useProjects, useCreateProject, useDeleteProject } from '@/hooks/useProjects';
import { useProjectStore, Project } from '@/stores/projectStore';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';

export function ProjectList() {
  const { data: projects, isLoading, error } = useProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const { currentProjectId, setCurrentProject } = useProjectStore();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectResolution, setNewProjectResolution] = useState('512x512');
  const [newProjectFrameRate, setNewProjectFrameRate] = useState(8);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    try {
      const project = await createProject.mutateAsync({
        displayName: newProjectName,
        resolution: newProjectResolution,
        frameRate: newProjectFrameRate,
      });
      setCurrentProject(project.id);
      setIsCreateModalOpen(false);
      setNewProjectName('');
    } catch {
      // Error handled by mutation
    }
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this project?')) return;
    await deleteProject.mutateAsync(projectId);
  };

  if (isLoading) {
    return (
      <div className="p-4">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-200 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-red-600">
        Failed to load projects: {error.message}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Projects</h2>
          <Button size="sm" onClick={() => setIsCreateModalOpen(true)}>
            + New
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {projects?.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No projects yet. Create one to get started.
          </div>
        ) : (
          projects?.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isSelected={currentProjectId === project.id}
              onSelect={() => setCurrentProject(project.id)}
              onDelete={(e) => handleDeleteProject(project.id, e)}
            />
          ))
        )}
      </div>

      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Project"
      >
        <form onSubmit={handleCreateProject} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project Name
            </label>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="My Video Project"
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Resolution
            </label>
            <select
              value={newProjectResolution}
              onChange={(e) => setNewProjectResolution(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="512x512">512x512 (Square)</option>
              <option value="768x512">768x512 (Landscape)</option>
              <option value="512x768">512x768 (Portrait)</option>
              <option value="1024x576">1024x576 (16:9)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Frame Rate
            </label>
            <select
              value={newProjectFrameRate}
              onChange={(e) => setNewProjectFrameRate(Number(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={8}>8 FPS</option>
              <option value={12}>12 FPS</option>
              <option value={16}>16 FPS</option>
              <option value={24}>24 FPS</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsCreateModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={createProject.isPending}
              disabled={!newProjectName.trim()}
            >
              Create Project
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

interface ProjectCardProps {
  project: Project;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

function ProjectCard({ project, isSelected, onSelect, onDelete }: ProjectCardProps) {
  return (
    <div
      onClick={onSelect}
      className={`p-3 rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? 'bg-blue-50 border-2 border-blue-500'
          : 'bg-white border border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 truncate">
            {project.displayName}
          </h3>
          <p className="text-sm text-gray-500">
            {project.resolution} @ {project.frameRate}fps
          </p>
        </div>
        <button
          onClick={onDelete}
          className="p-1 text-gray-400 hover:text-red-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}
