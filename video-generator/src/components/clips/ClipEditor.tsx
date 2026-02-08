/**
 * Clip Editor component for generating new clips
 */

'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useGenerateClip } from '@/hooks/useClips';
import { useJobProgress } from '@/hooks/useJobs';
import { useProjectStore } from '@/stores/projectStore';
import { useSystemStatus } from '@/hooks/useSystemStatus';
import { Button } from '../common/Button';

/**
 * Calculate actual rendering resolution based on model, project resolution, and frame count.
 * Mirrors the VRAM protection logic in generateWorker.ts
 */
function getActualResolution(
  videoModel: string,
  projectResolution: string,
  frameCount: number,
  generationType: string = 'textToVideo'
): { width: number; height: number; scaled: boolean; originalWidth: number; originalHeight: number } {
  const match = projectResolution.match(/(\d+)x(\d+)/);
  const originalWidth = match ? parseInt(match[1], 10) : 512;
  const originalHeight = match ? parseInt(match[2], 10) : 512;

  if (videoModel === 'wan21') {
    return { width: 480, height: 320, scaled: true, originalWidth, originalHeight };
  }
  if (videoModel === 'svd') {
    return { width: 768, height: 512, scaled: originalWidth !== 768 || originalHeight !== 512, originalWidth, originalHeight };
  }

  // AnimateDiff: apply VRAM limit
  // I2V uses more VRAM (IPAdapter + VAE Encode overhead)
  let w = originalWidth;
  let h = originalHeight;
  const totalPixels = w * h * frameCount;
  const maxPixels = generationType === 'imageToVideo' ? 512 * 512 * 16 : 512 * 512 * 24;
  const scaled = totalPixels > maxPixels;
  if (scaled) {
    const scale = Math.sqrt(maxPixels / totalPixels);
    w = Math.floor((w * scale) / 8) * 8;
    h = Math.floor((h * scale) / 8) * 8;
  }
  return { width: w, height: h, scaled, originalWidth, originalHeight };
}

const API_BASE = '/api';

export function ClipEditor() {
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const projects = useProjectStore((state) => state.projects);
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const generateClip = useGenerateClip();

  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [steps, setSteps] = useState(20);
  const [cfgScale, setCfgScale] = useState(7.5);
  const [seed, setSeed] = useState<string>('');
  const [frameCount, setFrameCount] = useState(16);
  const [generationType, setGenerationType] = useState<'textToVideo' | 'imageToVideo'>('textToVideo');
  const [videoModel, setVideoModel] = useState<'animateDiff' | 'svd' | 'cogVideoX' | 'hunyuan' | 'wan21'>('animateDiff');

  // Image upload state
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [ipAdapterWeight, setIpAdapterWeight] = useState(1.0);
  const [denoise, setDenoise] = useState(0.5); // Lower = more original preserved
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Calculate actual rendering resolution
  const resolution = useMemo(
    () => getActualResolution(videoModel, currentProject?.resolution || '512x512', frameCount, generationType),
    [videoModel, currentProject?.resolution, frameCount, generationType]
  );

  // Korean translation helper
  const containsKorean = (text: string): boolean => /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text);

  const translateToEnglish = async (text: string): Promise<string> => {
    try {
      const res = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ko|en`
      );
      const data = await res.json();
      if (data.responseStatus === 200 && data.responseData?.translatedText) {
        return data.responseData.translatedText;
      }
      return text;
    } catch {
      return text;
    }
  };

  // Translation state
  const [isTranslating, setIsTranslating] = useState(false);

  const handleTranslate = async () => {
    if (!prompt.trim() || isTranslating) return;
    setIsTranslating(true);
    try {
      const translated = await translateToEnglish(prompt);
      setPrompt(translated);
      if (negativePrompt && containsKorean(negativePrompt)) {
        const translatedNeg = await translateToEnglish(negativePrompt);
        setNegativePrompt(translatedNeg);
      }
    } finally {
      setIsTranslating(false);
    }
  };

  // VRAM free state
  const { data: systemStatus } = useSystemStatus();
  const [isFreeing, setIsFreeing] = useState(false);

  const handleFreeVram = async () => {
    setIsFreeing(true);
    try {
      await fetch('/api/system/free-vram', { method: 'POST' });
    } catch {
      // ignore
    } finally {
      setIsFreeing(false);
    }
  };

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');

  const handleProgress = useCallback((data: { percent?: number; message?: string }) => {
    if (data.percent !== undefined) setProgress(data.percent);
    if (data.message) setProgressMessage(data.message);
  }, []);

  const handleComplete = useCallback(() => {
    setActiveJobId(null);
    setProgress(100);
    setProgressMessage('Complete!');
    setTimeout(() => {
      setIsGenerating(false);
      setProgress(0);
      setProgressMessage('');
      setPrompt('');
      setReferenceImage(null);
      setImagePreview(null);
    }, 2000);
  }, []);

  // Polling fallback for progress updates
  useEffect(() => {
    if (!activeJobId) return;

    let isFirstPoll = true;

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/jobs/${activeJobId}`);
        if (res.ok) {
          const json = await res.json();
          const job = json.data || json;

          // Update progress
          if (job.progressPercent !== undefined) {
            setProgress(job.progressPercent);
          }

          // Handle different statuses
          if (job.jobStatus === 'pending') {
            setProgressMessage('Waiting in queue...');
          } else if (job.jobStatus === 'processing') {
            setProgressMessage(`Processing... ${job.progressPercent}%`);
          } else if (job.jobStatus === 'completed') {
            // Skip if this is the first poll and job is already completed
            // (might be an old completed job)
            if (isFirstPoll && job.progressPercent === 100) {
              // Wait for next poll to confirm
              isFirstPoll = false;
              return;
            }
            handleComplete();
            clearInterval(pollInterval);
          } else if (job.jobStatus === 'failed') {
            setProgressMessage(`Failed: ${job.errorMessage || 'Unknown error'}`);
            setTimeout(() => {
              setActiveJobId(null);
              setIsGenerating(false);
              setProgress(0);
              setProgressMessage('');
            }, 3000);
            clearInterval(pollInterval);
          }

          isFirstPoll = false;
        }
      } catch {
        // Ignore polling errors
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [activeJobId, handleComplete]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show preview
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImagePreview(ev.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload to server
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const json = await res.json();
      if (json.success) {
        setReferenceImage(json.data.filename);
      } else {
        alert(`Upload failed: ${json.error}`);
        setImagePreview(null);
      }
    } catch {
      alert('Failed to upload image');
      setImagePreview(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveImage = () => {
    setReferenceImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleError = useCallback((error: string) => {
    alert(`Generation failed: ${error}`);
    setActiveJobId(null);
    setIsGenerating(false);
    setProgress(0);
    setProgressMessage('');
  }, []);

  useJobProgress(activeJobId, handleProgress, handleComplete, handleError);

  const handleCancel = async () => {
    if (!activeJobId) return;
    try {
      const res = await fetch(`${API_BASE}/jobs/${activeJobId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setActiveJobId(null);
        setIsGenerating(false);
        setProgress(0);
        setProgressMessage('');
      } else {
        alert(`Cancel failed: ${json.error}`);
      }
    } catch {
      alert('Failed to cancel job');
    }
  };

  const handleGenerate = async () => {
    if (!currentProjectId || !prompt.trim()) return;

    // For imageToVideo, require a reference image
    if (generationType === 'imageToVideo' && !referenceImage) {
      alert('Please upload a reference image for Image to Video generation');
      return;
    }

    // Show progress immediately
    setIsGenerating(true);
    setProgress(0);
    setProgressMessage('Preparing...');

    // Auto-translate Korean to English
    let finalPrompt = prompt.trim();
    let finalNegativePrompt = negativePrompt.trim();

    if (containsKorean(finalPrompt)) {
      setProgressMessage('Translating prompt...');
      finalPrompt = await translateToEnglish(finalPrompt);
      setPrompt(finalPrompt);
    }

    if (finalNegativePrompt && containsKorean(finalNegativePrompt)) {
      finalNegativePrompt = await translateToEnglish(finalNegativePrompt);
      setNegativePrompt(finalNegativePrompt);
    }

    setProgressMessage('Sending request...');

    try {
      const result = await generateClip.mutateAsync({
        projectId: currentProjectId,
        prompt: finalPrompt,
        negativePrompt: finalNegativePrompt || undefined,
        stepsCount: steps,
        cfgScale,
        seedValue: seed ? parseInt(seed, 10) : undefined,
        frameCount,
        generationType,
        videoModel,
        referenceImage: generationType === 'imageToVideo' ? referenceImage || undefined : undefined,
        ipAdapterWeight: generationType === 'imageToVideo' ? ipAdapterWeight : undefined,
        denoise: generationType === 'imageToVideo' ? denoise : undefined,
      });
      setActiveJobId(result.jobId);
      setProgress(5);
      setProgressMessage('Job queued, starting generation...');
    } catch {
      setIsGenerating(false);
      setProgress(0);
      setProgressMessage('');
      // Error handled by mutation
    }
  };

  if (!currentProjectId) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        Select a project to start generating clips
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Generate Clip</h2>

        {/* GPU VRAM Bar */}
        {systemStatus?.gpu && (() => {
          const gpu = systemStatus.gpu;
          const usedGB = (gpu.memoryUsed / 1024).toFixed(1);
          const totalGB = (gpu.memoryTotal / 1024).toFixed(1);
          const pct = gpu.memoryPercent;
          const barColor = pct >= 80 ? 'bg-red-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-green-500';
          return (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600 font-medium">VRAM {usedGB} / {totalGB} GB</span>
                <div className="flex items-center gap-2 text-gray-500">
                  <span>{gpu.temperature}°C</span>
                  <span>{Math.round(gpu.powerDraw)}W</span>
                  <button
                    type="button"
                    onClick={handleFreeVram}
                    disabled={isFreeing}
                    className="px-2 py-0.5 text-xs bg-gray-100 hover:bg-red-100 text-gray-600 hover:text-red-700 rounded border border-gray-200 hover:border-red-300 transition-colors disabled:opacity-50"
                  >
                    {isFreeing ? 'Freeing...' : 'Free VRAM'}
                  </button>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div
                  className={`${barColor} h-2 rounded-full transition-all duration-500`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })()}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Generation Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Generation Type
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setGenerationType('textToVideo')}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                generationType === 'textToVideo'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Text to Video
            </button>
            <button
              type="button"
              onClick={() => setGenerationType('imageToVideo')}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                generationType === 'imageToVideo'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Image to Video
            </button>
          </div>
        </div>

        {/* Video Model Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Video Model
          </label>
          <select
            value={videoModel}
            onChange={(e) => {
              const model = e.target.value as typeof videoModel;
              setVideoModel(model);
              if (model === 'wan21') {
                setFrameCount(81);
                setCfgScale(6.0);
              } else {
                if (frameCount > 32) setFrameCount(16);
                setCfgScale(7.5);
              }
            }}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="animateDiff">AnimateDiff (SD 1.5) - 빠름, 안정적</option>
            <option value="svd">Stable Video Diffusion - 고품질 이미지→영상</option>
            <option value="cogVideoX">CogVideoX - 텍스트→영상 특화</option>
            <option value="hunyuan">HunyuanVideo - 고품질 (VRAM 많이 필요)</option>
            <option value="wan21">Wan2.1 (1.3B) - 긴 영상 (~5초, 81프레임)</option>
          </select>
          {/* Actual rendering resolution info */}
          <div className={`mt-2 px-3 py-2 rounded-lg text-xs ${resolution.scaled ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
            <div className="flex items-center justify-between">
              <span className={resolution.scaled ? 'text-amber-700 font-medium' : 'text-green-700 font-medium'}>
                렌더링 해상도: {resolution.width}x{resolution.height}
              </span>
              <span className="text-gray-500">
                {frameCount}프레임 / {currentProject?.frameRate || 8}fps
                {' '}= {(frameCount / (currentProject?.frameRate || 8)).toFixed(1)}초
              </span>
            </div>
            {resolution.scaled && resolution.originalWidth !== resolution.width && (
              <p className="text-amber-600 mt-1">
                VRAM 제한으로 {resolution.originalWidth}x{resolution.originalHeight} → {resolution.width}x{resolution.height} 축소 적용
              </p>
            )}
          </div>
        </div>

        {/* Reference Image Upload (for Image to Video) */}
        {generationType === 'imageToVideo' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Reference Image
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              onChange={handleImageUpload}
              className="hidden"
            />

            {imagePreview ? (
              <div className="relative">
                <img
                  src={imagePreview}
                  alt="Reference"
                  className="w-full h-48 object-contain bg-gray-100 rounded-lg border"
                />
                {isUploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                {referenceImage && (
                  <div className="absolute bottom-2 left-2 px-2 py-1 bg-green-500 text-white text-xs rounded">
                    Uploaded
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-48 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
              >
                <svg className="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm font-medium">Click to upload image</span>
                <span className="text-xs mt-1">PNG, JPEG, WebP (max 10MB)</span>
              </button>
            )}

            {/* Denoise - How much to change from original */}
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Motion Strength: {(denoise * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.1}
                value={denoise}
                onChange={(e) => setDenoise(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>원본 유지 (적은 움직임)</span>
                <span>많은 변화 (큰 움직임)</span>
              </div>
            </div>

            {/* IP Adapter Weight */}
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Image Consistency: {ipAdapterWeight.toFixed(1)}
              </label>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.1}
                value={ipAdapterWeight}
                onChange={(e) => setIpAdapterWeight(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>약한 일관성</span>
                <span>강한 일관성</span>
              </div>
            </div>
          </div>
        )}

        {/* Prompt */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700">
              Prompt
            </label>
            {containsKorean(prompt) && (
              <button
                type="button"
                onClick={handleTranslate}
                disabled={isTranslating}
                className="px-2 py-0.5 text-xs bg-blue-50 text-blue-600 rounded border border-blue-200 hover:bg-blue-100 disabled:opacity-50 transition-colors"
              >
                {isTranslating ? 'Translating...' : '한→영 번역'}
              </button>
            )}
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="한글 또는 영어로 입력 (한글은 자동 번역됨)"
            rows={3}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {/* Negative Prompt */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Negative Prompt
          </label>
          <textarea
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            placeholder="blurry, low quality, distorted"
            rows={2}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {/* Parameters */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Steps: {steps}
            </label>
            <input
              type="range"
              min={10}
              max={50}
              value={steps}
              onChange={(e) => setSteps(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              CFG Scale: {cfgScale}
            </label>
            <input
              type="range"
              min={1}
              max={20}
              step={0.5}
              value={cfgScale}
              onChange={(e) => setCfgScale(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Frames: {frameCount}
            </label>
            <input
              type="range"
              min={8}
              max={videoModel === 'wan21' ? 128 : 32}
              step={videoModel === 'wan21' ? 16 : 4}
              value={frameCount}
              onChange={(e) => setFrameCount(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Seed (optional)
            </label>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="Random"
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

      </div>

      {/* Fixed bottom area - Progress & Button */}
      <div className="p-4 border-t bg-white flex-shrink-0">
        {/* Progress */}
        {isGenerating && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200 shadow-sm mb-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-600 border-t-transparent"></div>
              <span className="font-semibold text-blue-800 text-lg">Generating Video...</span>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-4 overflow-hidden">
              <div
                className="bg-blue-600 h-4 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <div className="mt-2 flex justify-between text-sm">
              <span className="text-blue-700">{progressMessage || 'Preparing...'}</span>
              <span className="font-medium text-blue-800">{progress}%</span>
            </div>
          </div>
        )}

        {isGenerating ? (
          <Button
            type="button"
            onClick={handleCancel}
            className="w-full bg-red-600 hover:bg-red-700"
            size="lg"
          >
            Cancel Generation
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleGenerate}
            className="w-full"
            size="lg"
            isLoading={generateClip.isPending}
            disabled={!prompt.trim()}
          >
            Generate Clip
          </Button>
        )}
      </div>
    </div>
  );
}
