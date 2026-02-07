/**
 * Export Modal component
 */

'use client';

import React, { useState, useCallback } from 'react';
import { useExportVideo, useJobProgress } from '@/hooks/useJobs';
import { useProjectStore, Clip } from '@/stores/projectStore';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { ProgressBar } from '../common/ProgressBar';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  clips: Clip[];
}

export function ExportModal({ isOpen, onClose, clips }: ExportModalProps) {
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const exportVideo = useExportVideo();

  // Export settings
  const [mergeEnabled, setMergeEnabled] = useState(true);
  const [transition, setTransition] = useState('fade');
  const [transitionDuration, setTransitionDuration] = useState(0.5);
  const [upscaleEnabled, setUpscaleEnabled] = useState(false);
  const [upscaleScale, setUpscaleScale] = useState(2);
  const [interpolateEnabled, setInterpolateEnabled] = useState(false);
  const [targetFps, setTargetFps] = useState(24);
  const [quality, setQuality] = useState('standard');

  // Progress state
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [currentStep, setCurrentStep] = useState('');

  const handleProgress = useCallback((data: { percent?: number; message?: string; step?: string }) => {
    if (data.percent !== undefined) setProgress(data.percent);
    if (data.message) setProgressMessage(data.message);
    if (data.step) setCurrentStep(data.step);
  }, []);

  const handleComplete = useCallback(() => {
    setProgressMessage('Export completed!');
    setTimeout(() => {
      setActiveJobId(null);
      setProgress(0);
      setProgressMessage('');
      setCurrentStep('');
      onClose();
    }, 2000);
  }, [onClose]);

  const handleError = useCallback((error: string) => {
    alert(`Export failed: ${error}`);
    setActiveJobId(null);
    setProgress(0);
    setProgressMessage('');
    setCurrentStep('');
  }, []);

  useJobProgress(activeJobId, handleProgress, handleComplete, handleError);

  const handleExport = async () => {
    if (!currentProjectId || clips.length === 0) return;

    try {
      const result = await exportVideo.mutateAsync({
        projectId: currentProjectId,
        clipIds: clips.map((c) => c.id),
        settings: {
          merge: {
            enabled: mergeEnabled && clips.length > 1,
            transition: transition as 'fade' | 'dissolve' | 'none',
            transitionDuration,
          },
          upscale: {
            enabled: upscaleEnabled,
            scale: upscaleScale,
            model: 'ffmpeg',
          },
          interpolate: {
            enabled: interpolateEnabled,
            targetFps,
          },
          encode: {
            format: 'mp4',
            quality,
          },
        },
      });
      setActiveJobId(result.jobId);
      setProgressMessage('Starting export...');
    } catch {
      // Error handled by mutation
    }
  };

  const stepLabels: Record<string, string> = {
    merge: 'Merging clips',
    upscale: 'Upscaling video',
    interpolate: 'Interpolating frames',
    encode: 'Encoding final video',
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={activeJobId ? () => {} : onClose}
      title="Export Video"
      size="lg"
    >
      {activeJobId ? (
        <div className="space-y-4 py-4">
          <div className="text-center">
            <div className="text-sm text-gray-500 mb-2">
              {currentStep && stepLabels[currentStep] ? stepLabels[currentStep] : 'Processing'}
            </div>
          </div>
          <ProgressBar
            progress={progress}
            message={progressMessage}
            variant={progress === 100 ? 'success' : 'default'}
            size="lg"
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Clip summary */}
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-600">
              Exporting <span className="font-medium">{clips.length}</span> clips
            </p>
            <p className="text-sm text-gray-500">
              Total duration: {clips.reduce((sum, c) => sum + (c.durationSec || 0), 0).toFixed(1)}s
            </p>
          </div>

          {/* Merge settings */}
          {clips.length > 1 && (
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={mergeEnabled}
                  onChange={(e) => setMergeEnabled(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span className="font-medium">Merge clips with transitions</span>
              </label>

              {mergeEnabled && (
                <div className="ml-6 space-y-3">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Transition</label>
                    <select
                      value={transition}
                      onChange={(e) => setTransition(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="none">None (Cut)</option>
                      <option value="fade">Fade</option>
                      <option value="dissolve">Dissolve</option>
                      <option value="wipeleft">Wipe Left</option>
                      <option value="wiperight">Wipe Right</option>
                    </select>
                  </div>

                  {transition !== 'none' && (
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">
                        Duration: {transitionDuration}s
                      </label>
                      <input
                        type="range"
                        min={0.1}
                        max={2}
                        step={0.1}
                        value={transitionDuration}
                        onChange={(e) => setTransitionDuration(Number(e.target.value))}
                        className="w-full"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Upscale settings */}
          <div className="space-y-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={upscaleEnabled}
                onChange={(e) => setUpscaleEnabled(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="font-medium">Upscale resolution</span>
            </label>

            {upscaleEnabled && (
              <div className="ml-6">
                <label className="block text-sm text-gray-600 mb-1">Scale factor</label>
                <select
                  value={upscaleScale}
                  onChange={(e) => setUpscaleScale(Number(e.target.value))}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value={2}>2x</option>
                  <option value={3}>3x</option>
                  <option value={4}>4x</option>
                </select>
              </div>
            )}
          </div>

          {/* Interpolate settings */}
          <div className="space-y-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={interpolateEnabled}
                onChange={(e) => setInterpolateEnabled(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="font-medium">Increase frame rate</span>
            </label>

            {interpolateEnabled && (
              <div className="ml-6">
                <label className="block text-sm text-gray-600 mb-1">Target FPS</label>
                <select
                  value={targetFps}
                  onChange={(e) => setTargetFps(Number(e.target.value))}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value={24}>24 FPS</option>
                  <option value={30}>30 FPS</option>
                  <option value={60}>60 FPS</option>
                </select>
              </div>
            )}
          </div>

          {/* Quality settings */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Output Quality
            </label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="draft">Draft (Fast)</option>
              <option value="standard">Standard</option>
              <option value="high">High Quality (Slow)</option>
            </select>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleExport}
              isLoading={exportVideo.isPending}
            >
              Start Export
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
