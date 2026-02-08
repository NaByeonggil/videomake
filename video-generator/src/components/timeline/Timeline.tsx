/**
 * Timeline component for displaying and managing clips
 */

'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useClips, useDeleteClip, useReorderClips } from '@/hooks/useClips';
import { useProjectStore, Clip } from '@/stores/projectStore';
import { toStorageUrl } from '@/lib/fileNaming';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { ExportModal } from './ExportModal';
import { useQueryClient } from '@tanstack/react-query';

export function Timeline() {
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const { currentClipId, setCurrentClip, clips } = useProjectStore();

  const { isLoading, error } = useClips(currentProjectId);
  const deleteClip = useDeleteClip();
  const reorderClips = useReorderClips();

  const queryClient = useQueryClient();
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [enhancingClipId, setEnhancingClipId] = useState<string | null>(null);
  const [playingClip, setPlayingClip] = useState<Clip | null>(null);

  const handleEnhance = useCallback(async (clipId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEnhancingClipId(clipId);
    try {
      const res = await fetch('/api/processing/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId, scale: 2, targetFps: 30 }),
      });
      const json = await res.json();
      if (json.success) {
        queryClient.invalidateQueries({ queryKey: ['clips'] });
      } else {
        alert(`Enhancement failed: ${json.error}`);
      }
    } catch {
      alert('Enhancement request failed');
    } finally {
      setEnhancingClipId(null);
    }
  }, [queryClient]);

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
                isEnhancing={enhancingClipId === clip.id}
                onSelect={() => setCurrentClip(clip.id)}
                onPlay={(e) => { e.stopPropagation(); setPlayingClip(clip); }}
                onDelete={(e) => handleDeleteClip(clip.id, clip.clipName, e)}
                onEnhance={(e) => handleEnhance(clip.id, e)}
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

      {/* Video Player Modal */}
      {playingClip && (
        <VideoPlayerModal
          clip={playingClip}
          onClose={() => setPlayingClip(null)}
          onEnhance={(e) => handleEnhance(playingClip.id, e)}
          isEnhancing={enhancingClipId === playingClip.id}
          onDelete={(e) => {
            handleDeleteClip(playingClip.id, playingClip.clipName, e);
            setPlayingClip(null);
          }}
        />
      )}
    </div>
  );
}

interface ClipCardProps {
  clip: Clip;
  isSelected: boolean;
  isDragging: boolean;
  isEnhancing: boolean;
  onSelect: () => void;
  onPlay: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onEnhance: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function ClipCard({
  clip,
  isSelected,
  isDragging,
  isEnhancing,
  onSelect,
  onPlay,
  onDelete,
  onEnhance,
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

  // Simulated progress for HQ enhance (ffmpeg is synchronous, no real-time progress)
  const [enhanceProgress, setEnhanceProgress] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isEnhancing) {
      setEnhanceProgress(5);
      intervalRef.current = setInterval(() => {
        setEnhanceProgress((prev) => {
          if (prev >= 90) return prev + 0.5;
          if (prev >= 70) return prev + 1;
          if (prev >= 40) return prev + 2;
          return prev + 3;
        });
      }, 500);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (enhanceProgress > 0) {
        setEnhanceProgress(100);
        const t = setTimeout(() => setEnhanceProgress(0), 1500);
        return () => clearTimeout(t);
      }
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isEnhancing]);

  // Use video file for preview instead of thumbnail
  const videoUrl = clip.filePath ? toStorageUrl(clip.filePath) : null;

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

        {/* Play button overlay */}
        {videoUrl && clip.clipStatus === 'completed' && !isEnhancing && (
          <button
            onClick={onPlay}
            className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity z-[5]"
          >
            <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg hover:scale-110 transition-transform">
              <svg className="w-5 h-5 text-gray-900 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </button>
        )}

        {/* HQ Enhance progress overlay */}
        {isEnhancing && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-10">
            <div className="text-white text-[10px] font-bold mb-1">HQ 처리 중</div>
            <div className="w-3/4 h-1.5 bg-white/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-400 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(enhanceProgress, 100)}%` }}
              />
            </div>
            <div className="text-white text-[9px] mt-1">{Math.min(Math.round(enhanceProgress), 100)}%</div>
          </div>
        )}
        {enhanceProgress === 100 && !isEnhancing && (
          <div className="absolute inset-0 bg-green-500/60 flex items-center justify-center z-10 animate-pulse">
            <div className="text-white text-xs font-bold">HQ 완료!</div>
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

      {/* Info + HQ button */}
      <div className="p-2 bg-white">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-gray-900 truncate flex-1">
            {clip.clipName}
          </p>
          {clip.clipStatus === 'completed' && (
            <button
              onClick={onEnhance}
              disabled={isEnhancing}
              className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors disabled:opacity-50 flex items-center gap-0.5 flex-shrink-0"
              title="Upscale 2x + 30fps"
            >
              {isEnhancing ? (
                <div className="animate-spin rounded-full h-2.5 w-2.5 border-[1.5px] border-purple-600 border-t-transparent"></div>
              ) : (
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              )}
              HQ
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500">
          {clip.durationSec ? `${clip.durationSec.toFixed(1)}s` : clip.clipStatus}
        </p>
      </div>
    </div>
  );
}

/**
 * Video Player Modal - Full-screen video playback with controls
 */
interface VideoPlayerModalProps {
  clip: Clip;
  onClose: () => void;
  onEnhance: (e: React.MouseEvent) => void;
  isEnhancing: boolean;
  onDelete: (e: React.MouseEvent) => void;
}

function VideoPlayerModal({ clip, onClose, onEnhance, isEnhancing, onDelete }: VideoPlayerModalProps) {
  const videoUrl = clip.filePath ? toStorageUrl(clip.filePath) : null;

  return (
    <Modal isOpen={true} onClose={onClose} title={clip.clipName} size="lg">
      <div className="space-y-4">
        {/* Video Player */}
        {videoUrl ? (
          <div className="bg-black rounded-lg overflow-hidden">
            <video
              src={videoUrl}
              controls
              autoPlay
              loop
              playsInline
              className="w-full max-h-[50vh] object-contain"
            >
              Your browser does not support video playback.
            </video>
          </div>
        ) : (
          <div className="bg-gray-100 rounded-lg p-8 text-center text-gray-500">
            Video not available
          </div>
        )}

        {/* Clip Info */}
        <div className="bg-gray-50 rounded-lg p-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-gray-500">Prompt: </span>
            <span className="text-gray-900">{clip.prompt || 'N/A'}</span>
          </div>
          <div>
            <span className="text-gray-500">Frames: </span>
            <span className="text-gray-900">{clip.frameCount || 'N/A'}</span>
          </div>
          <div>
            <span className="text-gray-500">Steps: </span>
            <span className="text-gray-900">{clip.stepsCount}</span>
          </div>
          <div>
            <span className="text-gray-500">CFG: </span>
            <span className="text-gray-900">{clip.cfgScale}</span>
          </div>
          {clip.seedValue && (
            <div>
              <span className="text-gray-500">Seed: </span>
              <span className="text-gray-900 font-mono text-xs">{clip.seedValue}</span>
            </div>
          )}
          <div>
            <span className="text-gray-500">Created: </span>
            <span className="text-gray-900">{new Date(clip.createdAt).toLocaleString('ko-KR')}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onDelete}
            className="inline-flex items-center px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
          >
            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>

          <button
            onClick={onEnhance}
            disabled={isEnhancing}
            className="inline-flex items-center px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 text-sm"
          >
            {isEnhancing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-1.5"></div>
                HQ 처리 중...
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                HQ Enhance
              </>
            )}
          </button>

          {videoUrl && (
            <a
              href={videoUrl}
              download={clip.fileName || 'video.mp4'}
              className="inline-flex items-center px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm ml-auto"
            >
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </a>
          )}
        </div>
      </div>
    </Modal>
  );
}
