/**
 * Timeline component for displaying and managing clips
 */

'use client';

import React, { useState, useCallback } from 'react';
import { useClips, useDeleteClip, useReorderClips } from '@/hooks/useClips';
import { useProjectStore, Clip } from '@/stores/projectStore';
import { Button } from '../common/Button';
import { ExportModal } from './ExportModal';

export function Timeline() {
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const { currentClipId, setCurrentClip, clips } = useProjectStore();

  const { isLoading, error } = useClips(currentProjectId);
  const deleteClip = useDeleteClip();
  const reorderClips = useReorderClips();

  const [draggedClipId, setDraggedClipId] = useState<string | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const sortedClips = [...clips].sort((a, b) => a.orderIndex - b.orderIndex);
  const completedClips = sortedClips.filter((c) => c.clipStatus === 'completed');

  const handleDragStart = (e: React.DragEvent, clipId: string) => {
    setDraggedClipId(clipId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = useCallback((e: React.DragEvent, targetClipId: string) => {
    e.preventDefault();
    if (!draggedClipId || draggedClipId === targetClipId || !currentProjectId) return;

    const clipIds = sortedClips.map((c) => c.id);
    const draggedIndex = clipIds.indexOf(draggedClipId);
    const targetIndex = clipIds.indexOf(targetClipId);

    clipIds.splice(draggedIndex, 1);
    clipIds.splice(targetIndex, 0, draggedClipId);

    reorderClips.mutate({ projectId: currentProjectId, clipIds });
    setDraggedClipId(null);
  }, [draggedClipId, sortedClips, currentProjectId, reorderClips]);

  const handleDeleteClip = async (clipId: string, clipName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentProjectId) return;
    if (!confirm(`"${clipName}" 클립을 삭제하시겠습니까? 비디오 파일도 함께 삭제됩니다.`)) return;
    try {
      await deleteClip.mutateAsync({ clipId, projectId: currentProjectId });
    } catch (error) {
      console.error('Failed to delete clip:', error);
      alert('클립 삭제에 실패했습니다.');
    }
  };

  if (!currentProjectId) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        Select a project to view timeline
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full p-4">
        <div className="animate-pulse flex gap-2 overflow-x-auto">
          {[1, 2, 3].map((i) => (
            <div key={i} className="w-32 h-24 bg-gray-200 rounded-lg flex-shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full p-4 text-red-600">
        Failed to load clips: {error.message}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          Timeline ({sortedClips.length} clips)
        </h2>
        {completedClips.length > 0 && (
          <Button size="sm" onClick={() => setIsExportModalOpen(true)}>
            Export Video
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-x-auto p-4">
        {sortedClips.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500">
            No clips yet. Generate some clips to see them here.
          </div>
        ) : (
          <div className="flex gap-3 min-h-[120px]">
            {sortedClips.map((clip) => (
              <ClipCard
                key={clip.id}
                clip={clip}
                isSelected={currentClipId === clip.id}
                isDragging={draggedClipId === clip.id}
                onSelect={() => setCurrentClip(clip.id)}
                onDelete={(e) => handleDeleteClip(clip.id, clip.clipName, e)}
                onDragStart={(e) => handleDragStart(e, clip.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, clip.id)}
              />
            ))}
          </div>
        )}
      </div>

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        clips={completedClips}
      />
    </div>
  );
}

interface ClipCardProps {
  clip: Clip;
  isSelected: boolean;
  isDragging: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function ClipCard({
  clip,
  isSelected,
  isDragging,
  onSelect,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
}: ClipCardProps) {
  const statusColors = {
    pending: 'bg-gray-400',
    processing: 'bg-yellow-400 animate-pulse',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
  };

  // Use video file for preview instead of thumbnail
  const videoUrl = clip.filePath ? encodeURI(clip.filePath.replace('./public', '')) : null;

  return (
    <div
      draggable={clip.clipStatus === 'completed'}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onSelect}
      className={`relative w-36 flex-shrink-0 rounded-lg overflow-hidden cursor-pointer transition-all ${
        isSelected ? 'ring-2 ring-blue-500 ring-offset-2' : ''
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      {/* Video Preview */}
      <div className="aspect-video bg-gray-800 relative group">
        {videoUrl && clip.clipStatus === 'completed' ? (
          <video
            src={videoUrl}
            className="w-full h-full object-cover"
            muted
            loop
            playsInline
            onMouseEnter={(e) => e.currentTarget.play()}
            onMouseLeave={(e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0;
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            {clip.clipStatus === 'processing' ? (
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-400 border-t-transparent"></div>
            ) : (
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
          </div>
        )}

        {/* Status indicator */}
        <div
          className={`absolute top-1 right-1 w-2 h-2 rounded-full ${
            statusColors[clip.clipStatus as keyof typeof statusColors]
          }`}
        />

        {/* Delete button - available for all clips */}
        <button
          onClick={onDelete}
          className="absolute top-1 left-1 p-1.5 bg-black/60 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
          title="Delete clip"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Info */}
      <div className="p-2 bg-white">
        <p className="text-xs font-medium text-gray-900 truncate">
          {clip.clipName}
        </p>
        <p className="text-xs text-gray-500">
          {clip.durationSec ? `${clip.durationSec.toFixed(1)}s` : clip.clipStatus}
        </p>
      </div>
    </div>
  );
}
