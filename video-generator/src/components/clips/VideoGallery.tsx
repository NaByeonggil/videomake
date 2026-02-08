/**
 * Video Gallery - Display generated videos
 */

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useProjectStore, Clip } from '@/stores/projectStore';
import { useClips, useDeleteClip } from '@/hooks/useClips';
import { toStorageUrl } from '@/lib/fileNaming';
import { Modal } from '@/components/common/Modal';
import { useQueryClient } from '@tanstack/react-query';

const ContinueIcon = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
  </svg>
);

interface VideoPlayerModalProps {
  clip: Clip;
  onClose: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  onEnhance: (clipId: string) => void;
  isEnhancing: boolean;
  enhanceResult: EnhanceResult | null;
  onContinue: (clip: Clip) => void;
  isContinuing: boolean;
}

interface EnhanceResult {
  originalResolution: string;
  enhancedResolution: string;
  fps: number;
  duration: string;
  size: string;
}

function VideoPlayerModal({ clip, onClose, onDelete, isDeleting, onEnhance, isEnhancing, enhanceResult, onContinue, isContinuing }: VideoPlayerModalProps) {
  const videoUrl = clip.filePath
    ? toStorageUrl(clip.filePath)
    : null;

  return (
    <Modal isOpen={true} onClose={onClose} title={clip.clipName}>
      <div className="space-y-4">
        {videoUrl ? (
          <div className="bg-black rounded-lg overflow-hidden">
            <video
              src={videoUrl}
              controls
              autoPlay
              muted
              loop
              playsInline
              className="w-full max-h-[60vh] object-contain"
            >
              Your browser does not support video playback.
            </video>
          </div>
        ) : (
          <div className="bg-gray-100 rounded-lg p-8 text-center text-gray-500">
            Video not available
          </div>
        )}

        {/* Clip Details */}
        <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Prompt:</span>
            <span className="text-gray-900 text-right max-w-xs truncate">
              {clip.prompt || 'N/A'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Status:</span>
            <span className={`font-medium ${
              clip.clipStatus === 'completed' ? 'text-green-600' :
              clip.clipStatus === 'failed' ? 'text-red-600' : 'text-yellow-600'
            }`}>
              {clip.clipStatus}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Frames:</span>
            <span className="text-gray-900">{clip.frameCount || 'N/A'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Steps:</span>
            <span className="text-gray-900">{clip.stepsCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">CFG Scale:</span>
            <span className="text-gray-900">{clip.cfgScale}</span>
          </div>
          {clip.seedValue && (
            <div className="flex justify-between">
              <span className="text-gray-500">Seed:</span>
              <span className="text-gray-900 font-mono text-xs">{clip.seedValue}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-500">Created:</span>
            <span className="text-gray-900">
              {new Date(clip.createdAt).toLocaleString('ko-KR')}
            </span>
          </div>
        </div>

        {/* Enhance Result */}
        {enhanceResult && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
            <p className="font-medium text-green-800 mb-1">HQ Enhancement 완료!</p>
            <div className="grid grid-cols-2 gap-1 text-xs text-green-700">
              <span>해상도: {enhanceResult.originalResolution} → {enhanceResult.enhancedResolution}</span>
              <span>FPS: {enhanceResult.fps}fps</span>
              <span>길이: {enhanceResult.duration}초</span>
              <span>크기: {enhanceResult.size}</span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onDelete}
            disabled={isDeleting || isEnhancing}
            className="inline-flex items-center px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {isDeleting ? '...' : 'Delete'}
          </button>

          <button
            onClick={() => onEnhance(clip.id)}
            disabled={isEnhancing || isDeleting || isContinuing}
            className="inline-flex items-center px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {isEnhancing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-1.5"></div>
                처리 중...
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

          <button
            onClick={() => onContinue(clip)}
            disabled={isContinuing || isEnhancing || isDeleting}
            className="inline-flex items-center px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {isContinuing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-1.5"></div>
                추출 중...
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
                이어서 생성
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

export function VideoGallery() {
  const { currentProjectId, clips } = useProjectStore();
  const setContinueFromClip = useProjectStore((s) => s.setContinueFromClip);
  const { isLoading } = useClips(currentProjectId);
  const deleteClip = useDeleteClip();
  const queryClient = useQueryClient();
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [enhanceResult, setEnhanceResult] = useState<EnhanceResult | null>(null);
  const [enhancingCardId, setEnhancingCardId] = useState<string | null>(null);
  const [continuingClipId, setContinuingClipId] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [enhanceProgress, setEnhanceProgress] = useState(0);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (enhancingCardId) {
      setEnhanceProgress(5);
      progressIntervalRef.current = setInterval(() => {
        setEnhanceProgress((prev) => {
          if (prev >= 90) return prev + 0.5;
          if (prev >= 70) return prev + 1;
          if (prev >= 40) return prev + 2;
          return prev + 3;
        });
      }, 500);
    } else {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      if (enhanceProgress > 0) {
        setEnhanceProgress(100);
        const t = setTimeout(() => setEnhanceProgress(0), 1500);
        return () => clearTimeout(t);
      }
    }
    return () => { if (progressIntervalRef.current) clearInterval(progressIntervalRef.current); };
  }, [enhancingCardId]);

  const handleEnhance = useCallback(async (clipId: string) => {
    setIsEnhancing(true);
    setEnhanceResult(null);
    setEnhancingCardId(clipId);
    try {
      const res = await fetch('/api/processing/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId, scale: 2, targetFps: 30 }),
      });
      const json = await res.json();
      if (json.success) {
        setEnhanceResult(json.data);
        // Refetch clips to get updated file path
        queryClient.invalidateQueries({ queryKey: ['clips'] });
      } else {
        alert(`Enhancement failed: ${json.error}`);
      }
    } catch {
      alert('Enhancement request failed');
    } finally {
      setIsEnhancing(false);
      setEnhancingCardId(null);
    }
  }, [queryClient]);

  const handleDelete = async (clip: Clip, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    if (!currentProjectId) return;
    if (!confirm(`Delete "${clip.clipName}"? This will also delete the video file.`)) return;

    try {
      await deleteClip.mutateAsync({ clipId: clip.id, projectId: currentProjectId });
      setSelectedClip(null);
    } catch (error) {
      console.error('Failed to delete clip:', error);
      alert('Failed to delete clip');
    }
  };

  const handleContinueFromClip = useCallback(async (clip: Clip, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (continuingClipId) return;

    setContinuingClipId(clip.id);
    try {
      const res = await fetch(`/api/clips/${clip.id}/extract-frame`, {
        method: 'POST',
      });
      const json = await res.json();
      if (json.success) {
        setContinueFromClip({
          filename: json.data.filename,
          preview: json.data.preview,
          prompt: json.data.sourcePrompt,
          clipId: clip.id,
        });
        setSelectedClip(null);
      } else {
        alert(`Frame extraction failed: ${json.error}`);
      }
    } catch {
      alert('Failed to extract frame from clip');
    } finally {
      setContinuingClipId(null);
    }
  }, [continuingClipId, setContinueFromClip]);

  // Filter clips that have video files
  const completedClips = clips.filter(
    (clip) => clip.clipStatus === 'completed' && clip.filePath
  );

  if (!currentProjectId) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-500">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="text-lg font-medium">Select a project</p>
          <p className="text-sm">Choose a project from the sidebar to view videos</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (completedClips.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-500">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
          </svg>
          <p className="text-lg font-medium">No videos yet</p>
          <p className="text-sm">Generated videos will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {completedClips.map((clip) => {
          const videoUrl = clip.filePath ? toStorageUrl(clip.filePath) : null;

          return (
            <div
              key={clip.id}
              className="bg-white rounded-lg shadow-sm border overflow-hidden hover:shadow-md transition-shadow cursor-pointer group"
              onClick={() => setSelectedClip(clip)}
            >
              {/* Video Preview / Thumbnail */}
              <div className="relative aspect-video bg-gray-900">
                {videoUrl ? (
                  <video
                    src={videoUrl}
                    className="w-full h-full object-cover"
                    muted
                    loop
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget;
                      if (v.videoWidth && v.videoHeight) {
                        setResolutions((prev) => ({ ...prev, [clip.id]: `${v.videoWidth}x${v.videoHeight}` }));
                      }
                    }}
                    onMouseEnter={(e) => { e.currentTarget.play().catch(() => {}); }}
                    onMouseLeave={(e) => {
                      e.currentTarget.pause();
                      e.currentTarget.currentTime = 0;
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-500">
                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}

                {/* HQ Enhance progress overlay */}
                {enhancingCardId === clip.id && (
                  <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-10">
                    <div className="animate-spin rounded-full h-8 w-8 border-3 border-purple-400 border-t-transparent mb-2"></div>
                    <div className="text-white text-xs font-bold mb-1">HQ 처리 중</div>
                    <div className="w-3/4 h-2 bg-white/30 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-400 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(enhanceProgress, 100)}%` }}
                      />
                    </div>
                    <div className="text-white text-xs mt-1">{Math.min(Math.round(enhanceProgress), 100)}%</div>
                  </div>
                )}

                {/* Play overlay */}
                {enhancingCardId !== clip.id && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                    <svg className="w-6 h-6 text-gray-900 ml-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
                )}

                {/* Resolution badge */}
                {resolutions[clip.id] && (
                  <div className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-black/70 rounded text-[10px] font-mono text-white z-[2]">
                    {resolutions[clip.id]}
                  </div>
                )}

                {/* Delete button on card */}
                <button
                  onClick={(e) => handleDelete(clip, e)}
                  className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                  title="Delete clip"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>

              {/* Clip Info */}
              <div className="p-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-gray-900 truncate flex-1">{clip.clipName}</h3>
                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                    <button
                      onClick={(e) => handleContinueFromClip(clip, e)}
                      disabled={!!continuingClipId}
                      className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-md hover:bg-green-200 transition-colors disabled:opacity-50 flex items-center gap-1"
                      title="이어서 생성 (Continue from last frame)"
                    >
                      {continuingClipId === clip.id ? (
                        <div className="animate-spin rounded-full h-3 w-3 border-2 border-green-600 border-t-transparent"></div>
                      ) : (
                        <ContinueIcon />
                      )}
                      이어서
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEnhance(clip.id);
                      }}
                      disabled={isEnhancing}
                      className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded-md hover:bg-purple-200 transition-colors disabled:opacity-50 flex items-center gap-1"
                      title="Upscale 2x + 30fps"
                    >
                      {enhancingCardId === clip.id ? (
                        <div className="animate-spin rounded-full h-3 w-3 border-2 border-purple-600 border-t-transparent"></div>
                      ) : (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      )}
                      HQ
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-500 truncate mt-1">
                  {clip.prompt || 'No prompt'}
                </p>
                <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
                  <span>{clip.durationSec ? `${clip.durationSec.toFixed(1)}s` : '?'}</span>
                  <span>{resolutions[clip.id] || ''}</span>
                  <span>{new Date(clip.createdAt).toLocaleDateString('ko-KR')}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Video Player Modal */}
      {selectedClip && (
        <VideoPlayerModal
          clip={selectedClip}
          onClose={() => { setSelectedClip(null); setEnhanceResult(null); }}
          onDelete={() => handleDelete(selectedClip)}
          isDeleting={deleteClip.isPending}
          onEnhance={handleEnhance}
          isEnhancing={isEnhancing}
          enhanceResult={enhanceResult}
          onContinue={(clip) => handleContinueFromClip(clip)}
          isContinuing={!!continuingClipId}
        />
      )}
    </div>
  );
}
