/**
 * Video Gallery - Display generated videos
 */

'use client';

import { useState } from 'react';
import { useProjectStore, Clip } from '@/stores/projectStore';
import { useClips, useDeleteClip } from '@/hooks/useClips';
import { toStorageUrl } from '@/lib/fileNaming';
import { Modal } from '@/components/common/Modal';

interface VideoPlayerModalProps {
  clip: Clip;
  onClose: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}

function VideoPlayerModal({ clip, onClose, onDelete, isDeleting }: VideoPlayerModalProps) {
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

        {/* Action Buttons */}
        <div className="flex justify-between">
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="inline-flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
          {videoUrl && (
            <a
              href={videoUrl}
              download={clip.fileName || 'video.mp4'}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
  const { isLoading } = useClips(currentProjectId);
  const deleteClip = useDeleteClip();
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);

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
                    onMouseEnter={(e) => e.currentTarget.play()}
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

                {/* Play overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                    <svg className="w-6 h-6 text-gray-900 ml-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>

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
                <h3 className="font-medium text-gray-900 truncate">{clip.clipName}</h3>
                <p className="text-xs text-gray-500 truncate mt-1">
                  {clip.prompt || 'No prompt'}
                </p>
                <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
                  <span>{clip.frameCount || '?'} frames</span>
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
          onClose={() => setSelectedClip(null)}
          onDelete={() => handleDelete(selectedClip)}
          isDeleting={deleteClip.isPending}
        />
      )}
    </div>
  );
}
