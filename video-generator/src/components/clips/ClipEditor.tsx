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
    return { width: 640, height: 360, scaled: true, originalWidth, originalHeight };
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

// Model-specific resolution presets (16:9)
const MODEL_RESOLUTIONS: Record<string, Array<{ label: string; width: number; height: number; desc: string }>> = {
  wan21: [
    { label: '1024', width: 1024, height: 576, desc: '고화질 (느림, VRAM 많음)' },
    { label: '720', width: 720, height: 400, desc: '중간 품질' },
    { label: '640', width: 640, height: 360, desc: '기본 (권장)' },
    { label: '480', width: 480, height: 272, desc: '빠른 생성 (저화질)' },
  ],
  animateDiff: [
    { label: '512', width: 512, height: 512, desc: '기본 정방형' },
    { label: '768', width: 768, height: 432, desc: '와이드 (느림)' },
    { label: '384', width: 384, height: 384, desc: '빠른 생성' },
  ],
  svd: [
    { label: '1024', width: 1024, height: 576, desc: '기본 SVD' },
    { label: '768', width: 768, height: 512, desc: '중간' },
    { label: '512', width: 512, height: 288, desc: '빠른 생성' },
  ],
  cogVideoX: [
    { label: '720', width: 720, height: 480, desc: '기본 CogVideo' },
    { label: '480', width: 480, height: 320, desc: '빠른 생성' },
  ],
  hunyuan: [
    { label: '848', width: 848, height: 480, desc: '기본 Hunyuan' },
    { label: '640', width: 640, height: 360, desc: '빠른 생성' },
  ],
};

const API_BASE = '/api';

export function ClipEditor() {
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const projects = useProjectStore((state) => state.projects);
  const continueFromClip = useProjectStore((state) => state.continueFromClip);
  const setContinueFromClip = useProjectStore((state) => state.setContinueFromClip);
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
  const [genWidth, setGenWidth] = useState(640);
  const [genHeight, setGenHeight] = useState(360);

  // Model options per generation type
  const t2vModels = [
    { value: 'animateDiff', label: 'AnimateDiff (SD 1.5)', desc: '빠름, 안정적' },
    { value: 'cogVideoX', label: 'CogVideoX 2B', desc: '텍스트→영상' },
    { value: 'hunyuan', label: 'HunyuanVideo', desc: '고품질 T2V (GGUF)' },
    { value: 'wan21', label: 'Wan2.1 1.3B', desc: '빠른 T2V, ~5초' },
  ] as const;

  const i2vModels = [
    { value: 'animateDiff', label: 'AnimateDiff + IPAdapter', desc: '빠름, SD 1.5 기반' },
    { value: 'svd', label: 'SVD XT', desc: '고품질 I2V, 24fps' },
    { value: 'cogVideoX', label: 'CogVideoX 5B I2V', desc: '고품질 I2V (GGUF)' },
    { value: 'wan21', label: 'Wan2.1 14B I2V', desc: '최고 품질, ~5초 (GGUF)' },
  ] as const;

  const currentModels = generationType === 'textToVideo' ? t2vModels : i2vModels;

  // Apply model defaults (including default resolution)
  const applyModelDefaults = (model: string, genType: string) => {
    // Set default resolution for model
    const resOptions = MODEL_RESOLUTIONS[model] || MODEL_RESOLUTIONS['animateDiff'];
    const defaultRes = resOptions.find(r => r.label === '640') || resOptions[Math.floor(resOptions.length / 2)] || resOptions[0];
    setGenWidth(defaultRes.width);
    setGenHeight(defaultRes.height);

    if (model === 'wan21') {
      setFrameCount(81);
      setCfgScale(6.0);
      setSteps(genType === 'imageToVideo' ? 25 : 20);
    } else if (model === 'svd') {
      setFrameCount(16);
      setCfgScale(2.5);
      setSteps(25);
    } else if (model === 'cogVideoX') {
      setFrameCount(genType === 'imageToVideo' ? 49 : 16);
      setCfgScale(6.0);
      setSteps(20);
    } else if (model === 'hunyuan') {
      if (frameCount > 32) setFrameCount(16);
      setCfgScale(1.0);
      setSteps(20);
    } else {
      if (frameCount > 32) setFrameCount(16);
      setCfgScale(7.5);
      setSteps(20);
    }
  };

  // Handle generation type switch with model auto-selection
  const handleGenerationTypeChange = (newType: 'textToVideo' | 'imageToVideo') => {
    setGenerationType(newType);
    const validModels = newType === 'textToVideo' ? t2vModels : i2vModels;
    const isCurrentValid = validModels.some(m => m.value === videoModel);
    if (!isCurrentValid) {
      // Switch to best default: wan21 for I2V, animateDiff for T2V
      const newModel = newType === 'imageToVideo' ? 'wan21' : 'animateDiff';
      setVideoModel(newModel);
      applyModelDefaults(newModel, newType);
    }
  };

  // Image upload state
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [ipAdapterWeight, setIpAdapterWeight] = useState(1.0);
  const [denoise, setDenoise] = useState(0.5); // Lower = more original preserved
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Consume "Continue from Clip" data from store
  useEffect(() => {
    if (!continueFromClip) return;

    // Switch to I2V mode
    setGenerationType('imageToVideo');
    // Set Wan2.1 14B as the I2V model
    setVideoModel('wan21');
    applyModelDefaults('wan21', 'imageToVideo');
    // Set the extracted frame as reference image
    setReferenceImage(continueFromClip.filename);
    setImagePreview(continueFromClip.preview);
    // Pre-fill prompt from original clip
    if (continueFromClip.prompt) {
      setPrompt(continueFromClip.prompt);
    }
    // Clear store so it doesn't re-trigger
    setContinueFromClip(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continueFromClip, setContinueFromClip]);

  // Resolution options for current model
  const resolutionOptions = MODEL_RESOLUTIONS[videoModel] || MODEL_RESOLUTIONS['animateDiff'];

  // Calculate actual rendering resolution (use user-selected for wan21/svd/cogVideoX/hunyuan, auto for animateDiff)
  const resolution = useMemo(
    () => {
      if (videoModel === 'wan21' || videoModel === 'svd' || videoModel === 'cogVideoX' || videoModel === 'hunyuan') {
        return { width: genWidth, height: genHeight, scaled: false, originalWidth: genWidth, originalHeight: genHeight };
      }
      return getActualResolution(videoModel, currentProject?.resolution || '512x512', frameCount, generationType);
    },
    [videoModel, genWidth, genHeight, currentProject?.resolution, frameCount, generationType]
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
  const [restartState, setRestartState] = useState<string | null>(null); // null | 'comfyui' | 'workers' | 'all-comfyui' | 'all-workers' | 'done-comfyui' | 'done-workers' | 'done-all' | 'failed'

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

  const handleRestartComfyUI = async () => {
    setRestartState('comfyui');
    try {
      const res = await fetch('/api/system/restart-comfyui', { method: 'POST' });
      const json = await res.json();
      setRestartState(json.success ? 'done-comfyui' : 'failed');
    } catch {
      setRestartState('failed');
    }
  };

  const handleRestartWorkers = async () => {
    setRestartState('workers');
    try {
      const res = await fetch('/api/system/restart-workers', { method: 'POST' });
      const json = await res.json();
      setRestartState(json.success ? 'done-workers' : 'failed');
    } catch {
      setRestartState('failed');
    }
  };

  // Restart All: ComfyUI first → wait ready → then Workers
  const handleRestartAll = async () => {
    setRestartState('all-comfyui');
    try {
      const comfyRes = await fetch('/api/system/restart-comfyui', { method: 'POST' });
      const comfyJson = await comfyRes.json();
      if (!comfyJson.success) {
        setRestartState('failed');
        return;
      }

      setRestartState('all-workers');
      const workerRes = await fetch('/api/system/restart-workers', { method: 'POST' });
      const workerJson = await workerRes.json();
      setRestartState(workerJson.success ? 'done-all' : 'failed');
    } catch {
      setRestartState('failed');
    }
  };

  // Long video state
  const [showLongVideo, setShowLongVideo] = useState(false);
  const [longVideoDuration, setLongVideoDuration] = useState(90); // seconds
  const [longVideoHqEnhance, setLongVideoHqEnhance] = useState(true);
  const [isLongVideoGenerating, setIsLongVideoGenerating] = useState(false);
  const [longVideoJobId, setLongVideoJobId] = useState<string | null>(null);
  const [longVideoProgress, setLongVideoProgress] = useState(0);
  const [longVideoMessage, setLongVideoMessage] = useState('');
  const [longVideoSegment, setLongVideoSegment] = useState<{ current: number; total: number } | null>(null);
  const [longVideoStartTime, setLongVideoStartTime] = useState<number | null>(null);
  const [longVideoSegTimestamps, setLongVideoSegTimestamps] = useState<number[]>([]); // timestamps when each segment completed

  const SECONDS_PER_SEGMENT = 5.0625;
  const longVideoSegments = Math.ceil(longVideoDuration / SECONDS_PER_SEGMENT);
  const longVideoEstimatedMinutes = Math.round(longVideoSegments * 9);

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

  // Long video progress polling
  useEffect(() => {
    if (!longVideoJobId) return;

    let lastCompletedSeg = 0;

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/jobs/${longVideoJobId}`);
        if (res.ok) {
          const json = await res.json();
          const job = json.data || json;

          if (job.progressPercent !== undefined) {
            setLongVideoProgress(job.progressPercent);
          }

          // Parse logs to find completed segments and current segment
          const logs: Array<{ logMessage: string }> = job.logs || [];
          const settings = job.jobSettings || {};
          const total = settings.totalSegments || 6;

          // Count completed segments from logs
          let completedSegs = 0;
          let currentSeg = 0;
          for (const log of logs) {
            const completedMatch = log.logMessage.match(/Segment (\d+)\/\d+ completed/);
            if (completedMatch) {
              completedSegs = Math.max(completedSegs, parseInt(completedMatch[1]));
            }
            const i2vMatch = log.logMessage.match(/Segment (\d+): I2V/);
            if (i2vMatch) {
              currentSeg = Math.max(currentSeg, parseInt(i2vMatch[1]));
            }
          }

          if (currentSeg > 0) {
            setLongVideoSegment({ current: currentSeg, total });
          }

          // Track segment completion timestamps for ETA
          if (completedSegs > lastCompletedSeg) {
            lastCompletedSeg = completedSegs;
            setLongVideoSegTimestamps(prev => {
              const updated = [...prev];
              while (updated.length < completedSegs) {
                updated.push(Date.now());
              }
              return updated;
            });
          }

          if (job.jobStatus === 'processing') {
            // Build progress message with segment info
            const phase = logs[0]?.logMessage || '';
            if (phase.includes('Merging')) {
              setLongVideoMessage(`Merging ${total} clips...`);
            } else if (phase.includes('HQ')) {
              setLongVideoMessage('HQ Enhancing to 720p 30fps...');
            } else if (phase.includes('Initial frame')) {
              setLongVideoMessage('Generating initial reference frame...');
            } else {
              setLongVideoMessage(`Segment ${currentSeg}/${total} generating...`);
            }
          } else if (job.jobStatus === 'completed') {
            setLongVideoMessage('Long video completed!');
            setLongVideoProgress(100);
            setTimeout(() => {
              setIsLongVideoGenerating(false);
              setLongVideoJobId(null);
              setLongVideoProgress(0);
              setLongVideoMessage('');
              setLongVideoSegment(null);
              setLongVideoStartTime(null);
              setLongVideoSegTimestamps([]);
              setShowLongVideo(false);
            }, 3000);
            clearInterval(pollInterval);
          } else if (job.jobStatus === 'failed') {
            setLongVideoMessage(`Failed: ${job.errorMessage || 'Unknown error'}`);
            setTimeout(() => {
              setIsLongVideoGenerating(false);
              setLongVideoJobId(null);
              setLongVideoProgress(0);
              setLongVideoMessage('');
              setLongVideoSegment(null);
              setLongVideoStartTime(null);
              setLongVideoSegTimestamps([]);
            }, 5000);
            clearInterval(pollInterval);
          }
        }
      } catch { /* ignore */ }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [longVideoJobId]);

  // Long video progress SSE (segment-level updates from Redis)
  useEffect(() => {
    if (!longVideoJobId) return;

    const evtSource = new EventSource(`${API_BASE}/jobs/${longVideoJobId}/progress`);
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.percent !== undefined) setLongVideoProgress(data.percent);
        if (data.message) setLongVideoMessage(data.message);
        if (data.segment && data.totalSegments) {
          setLongVideoSegment({ current: data.segment, total: data.totalSegments });
        }
        if (data.type === 'completed') {
          setLongVideoMessage('Long video completed!');
          setLongVideoProgress(100);
          setTimeout(() => {
            setIsLongVideoGenerating(false);
            setLongVideoJobId(null);
            setLongVideoProgress(0);
            setLongVideoMessage('');
            setLongVideoSegment(null);
            setShowLongVideo(false);
          }, 3000);
          evtSource.close();
        }
        if (data.type === 'error') {
          setLongVideoMessage(`Failed: ${data.message}`);
          setTimeout(() => {
            setIsLongVideoGenerating(false);
            setLongVideoJobId(null);
            setLongVideoProgress(0);
            setLongVideoMessage('');
            setLongVideoSegment(null);
          }, 5000);
          evtSource.close();
        }
      } catch { /* ignore */ }
    };
    evtSource.onerror = () => {
      // SSE failed, rely on polling fallback
      evtSource.close();
    };
    return () => evtSource.close();
  }, [longVideoJobId]);

  const handleLongVideoGenerate = async () => {
    if (!currentProjectId || !prompt.trim()) return;

    setIsLongVideoGenerating(true);
    setLongVideoProgress(0);
    setLongVideoMessage('Preparing long video...');
    setLongVideoStartTime(Date.now());
    setLongVideoSegTimestamps([]);

    // Auto-translate Korean
    let finalPrompt = prompt.trim();
    let finalNegativePrompt = negativePrompt.trim();

    if (containsKorean(finalPrompt)) {
      setLongVideoMessage('Translating prompt...');
      finalPrompt = await translateToEnglish(finalPrompt);
      setPrompt(finalPrompt);
    }
    if (finalNegativePrompt && containsKorean(finalNegativePrompt)) {
      finalNegativePrompt = await translateToEnglish(finalNegativePrompt);
      setNegativePrompt(finalNegativePrompt);
    }

    try {
      const res = await fetch(`${API_BASE}/processing/long-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: currentProjectId,
          prompt: finalPrompt,
          negativePrompt: finalNegativePrompt || undefined,
          referenceImage: generationType === 'imageToVideo' ? referenceImage || undefined : undefined,
          targetDuration: longVideoDuration,
          framesPerSegment: 81,
          videoModel: 'wan21',
          denoise: 0.7,
          hqEnhance: longVideoHqEnhance,
          width: genWidth,
          height: genHeight,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setLongVideoJobId(json.data.jobId);
        setLongVideoSegment({ current: 0, total: longVideoSegments });
        setLongVideoMessage(`Queued: ${json.data.totalSegments} segments, ${json.data.estimatedTime}`);
      } else {
        setLongVideoMessage(`Error: ${json.error}`);
        setTimeout(() => {
          setIsLongVideoGenerating(false);
          setLongVideoMessage('');
        }, 3000);
      }
    } catch {
      setLongVideoMessage('Failed to start long video');
      setTimeout(() => {
        setIsLongVideoGenerating(false);
        setLongVideoMessage('');
      }, 3000);
    }
  };

  const handleCancelLongVideo = async () => {
    if (!longVideoJobId) return;
    try {
      await fetch(`${API_BASE}/jobs/${longVideoJobId}`, { method: 'DELETE' });
      setIsLongVideoGenerating(false);
      setLongVideoJobId(null);
      setLongVideoProgress(0);
      setLongVideoMessage('');
      setLongVideoSegment(null);
    } catch { /* ignore */ }
  };

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
        width: genWidth,
        height: genHeight,
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
                    disabled={isFreeing || !!restartState}
                    className="px-2 py-0.5 text-xs bg-gray-100 hover:bg-red-100 text-gray-600 hover:text-red-700 rounded border border-gray-200 hover:border-red-300 transition-colors disabled:opacity-50"
                  >
                    {isFreeing ? '...' : 'Free'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRestartComfyUI}
                    disabled={!!restartState && restartState !== 'done-comfyui'}
                    className={`px-2 py-0.5 text-xs rounded border transition-colors disabled:opacity-50 ${
                      restartState === 'done-comfyui'
                        ? 'bg-green-100 text-green-700 border-green-300'
                        : 'bg-gray-100 hover:bg-blue-100 text-gray-600 hover:text-blue-700 border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    {restartState === 'comfyui' ? 'Restarting...' : restartState === 'done-comfyui' ? 'ComfyUI Done' : 'ComfyUI'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRestartWorkers}
                    disabled={!!restartState && restartState !== 'done-workers'}
                    className={`px-2 py-0.5 text-xs rounded border transition-colors disabled:opacity-50 ${
                      restartState === 'done-workers'
                        ? 'bg-green-100 text-green-700 border-green-300'
                        : 'bg-gray-100 hover:bg-orange-100 text-gray-600 hover:text-orange-700 border-gray-200 hover:border-orange-300'
                    }`}
                  >
                    {restartState === 'workers' ? 'Restarting...' : restartState === 'done-workers' ? 'Workers Done' : 'Workers'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRestartAll}
                    disabled={!!restartState && !restartState.startsWith('done') && restartState !== 'failed'}
                    className={`px-2 py-0.5 text-xs rounded border transition-colors disabled:opacity-50 ${
                      restartState === 'done-all'
                        ? 'bg-green-100 text-green-700 border-green-300'
                        : restartState === 'failed'
                          ? 'bg-red-100 text-red-700 border-red-300'
                          : 'bg-gray-100 hover:bg-green-100 text-gray-600 hover:text-green-700 border-gray-200 hover:border-green-300'
                    }`}
                  >
                    {restartState === 'all-comfyui' ? 'ComfyUI...'
                      : restartState === 'all-workers' ? 'Workers...'
                      : restartState === 'done-all' ? 'All Done'
                      : restartState === 'failed' ? 'Failed'
                      : 'Restart All'}
                  </button>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div
                  className={`${barColor} h-2 rounded-full transition-all duration-500`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {/* Restart status banner */}
              {restartState && (
                <div className={`mt-1.5 px-3 py-2 rounded-lg text-sm font-medium text-center transition-all ${
                  restartState === 'done-comfyui' || restartState === 'done-workers' || restartState === 'done-all'
                    ? 'bg-green-100 text-green-800 border border-green-300'
                    : restartState === 'failed'
                      ? 'bg-red-100 text-red-800 border border-red-300'
                      : 'bg-yellow-50 text-yellow-800 border border-yellow-300'
                }`}>
                  {restartState === 'comfyui' && 'ComfyUI 재시작 중... (최대 3분 소요)'}
                  {restartState === 'workers' && 'Workers 재시작 중...'}
                  {restartState === 'all-comfyui' && 'Restart All: ComfyUI 재시작 중... (최대 3분 소요)'}
                  {restartState === 'all-workers' && 'Restart All: ComfyUI 완료 → Workers 재시작 중...'}
                  {restartState === 'done-comfyui' && 'ComfyUI 재시작 완료!'}
                  {restartState === 'done-workers' && 'Workers 재시작 완료!'}
                  {restartState === 'done-all' && 'ComfyUI + Workers 모두 재시작 완료!'}
                  {restartState === 'failed' && '재시작 실패!'}
                </div>
              )}
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
              onClick={() => handleGenerationTypeChange('textToVideo')}
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
              onClick={() => handleGenerationTypeChange('imageToVideo')}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                generationType === 'imageToVideo'
                  ? 'bg-purple-600 text-white'
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
            {generationType === 'textToVideo' ? 'T2V 모델' : 'I2V 모델'}
          </label>
          <div className="space-y-1.5">
            {currentModels.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => {
                  setVideoModel(m.value as typeof videoModel);
                  applyModelDefaults(m.value, generationType);
                }}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                  videoModel === m.value
                    ? generationType === 'imageToVideo'
                      ? 'bg-purple-50 border-purple-400 ring-1 ring-purple-300'
                      : 'bg-blue-50 border-blue-400 ring-1 ring-blue-300'
                    : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${videoModel === m.value ? (generationType === 'imageToVideo' ? 'text-purple-800' : 'text-blue-800') : 'text-gray-800'}`}>
                    {m.label}
                  </span>
                  <span className={`text-xs ${videoModel === m.value ? (generationType === 'imageToVideo' ? 'text-purple-600' : 'text-blue-600') : 'text-gray-400'}`}>
                    {m.desc}
                  </span>
                </div>
              </button>
            ))}
          </div>
          {/* Resolution selector */}
          <div className="mt-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">해상도</label>
            <div className="flex gap-1.5">
              {resolutionOptions.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => { setGenWidth(r.width); setGenHeight(r.height); }}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                    genWidth === r.width && genHeight === r.height
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-green-300'
                  }`}
                  title={r.desc}
                >
                  <div className="font-medium">{r.width}x{r.height}</div>
                </button>
              ))}
            </div>
          </div>
          {/* Rendering resolution info */}
          <div className="mt-1.5 px-3 py-1.5 rounded-lg text-xs bg-green-50 border border-green-200">
            <div className="flex items-center justify-between">
              <span className="text-green-700 font-medium">
                {resolution.width}x{resolution.height}
              </span>
              <span className="text-gray-500">
                {frameCount}프레임 / {videoModel === 'wan21' ? 16 : (currentProject?.frameRate || 8)}fps
                {' '}= {(frameCount / (videoModel === 'wan21' ? 16 : (currentProject?.frameRate || 8))).toFixed(1)}초
              </span>
            </div>
          </div>
          {/* Model detail info */}
          {videoModel === 'wan21' && generationType === 'imageToVideo' && (
            <div className="mt-2 px-3 py-2 rounded-lg text-xs bg-purple-50 border border-purple-200">
              <p className="text-purple-700 font-medium">
                14B Q3_K_M GGUF - CLIP Vision + 네이티브 이미지 컨디셔닝
              </p>
            </div>
          )}
          {videoModel === 'cogVideoX' && generationType === 'imageToVideo' && (
            <div className="mt-2 px-3 py-2 rounded-lg text-xs bg-purple-50 border border-purple-200">
              <p className="text-purple-700 font-medium">
                5B Q4_0 GGUF - image_cond_latents 기반 I2V
              </p>
            </div>
          )}
        </div>

        {/* Hidden file input - always mounted to prevent ref issues */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleImageUpload}
          className="hidden"
        />

        {/* Reference Image Upload (for Image to Video) */}
        {generationType === 'imageToVideo' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Reference Image
            </label>

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

            {/* Wan2.1 I2V / SVD - no denoise or IPAdapter controls needed */}
            {videoModel === 'wan21' ? (
              <div className="mt-3 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg">
                <p className="text-xs text-purple-700">
                  Wan2.1 I2V는 CLIP Vision과 네이티브 이미지 컨디셔닝을 사용합니다. 프롬프트로 동작을 제어하세요.
                </p>
              </div>
            ) : videoModel === 'svd' ? (
              <div className="mt-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-700">
                  SVD는 이미지 기반 자동 모션 생성입니다. 프롬프트 영향 없음.
                </p>
              </div>
            ) : (
              <>
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
              </>
            )}
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
            {videoModel === 'wan21' ? (
              <select
                value={frameCount}
                onChange={(e) => setFrameCount(Number(e.target.value))}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
              >
                <option value={33}>33 (~2초)</option>
                <option value={49}>49 (~3초)</option>
                <option value={65}>65 (~4초)</option>
                <option value={81}>81 (~5초)</option>
                <option value={97}>97 (~6초)</option>
                <option value={113}>113 (~7초)</option>
              </select>
            ) : (
              <input
                type="range"
                min={8}
                max={32}
                step={4}
                value={frameCount}
                onChange={(e) => setFrameCount(Number(e.target.value))}
                className="w-full"
              />
            )}
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

      {/* Fixed bottom area - Progress & Buttons */}
      <div className="p-4 border-t bg-white flex-shrink-0 space-y-3">

        {/* Long Video Progress (always visible when generating) */}
        {isLongVideoGenerating && (() => {
          const seg = longVideoSegment;
          const completedSegs = longVideoSegTimestamps.length;
          const totalSegs = seg?.total || longVideoSegments;

          let etaText = '';
          if (longVideoStartTime && completedSegs > 0) {
            const elapsed = (Date.now() - longVideoStartTime) / 1000;
            const avgPerSeg = elapsed / completedSegs;
            const remaining = (totalSegs - completedSegs) * avgPerSeg;
            if (remaining > 3600) {
              etaText = `~${(remaining / 3600).toFixed(1)}h left`;
            } else if (remaining > 60) {
              etaText = `~${Math.round(remaining / 60)}m left`;
            } else {
              etaText = `~${Math.round(remaining)}s left`;
            }
          } else if (longVideoStartTime) {
            const estTotal = totalSegs * 10 * 60;
            const elapsed = (Date.now() - longVideoStartTime) / 1000;
            const remaining = Math.max(0, estTotal - elapsed);
            etaText = `~${Math.round(remaining / 60)}m left (est.)`;
          }

          let elapsedText = '';
          if (longVideoStartTime) {
            const elapsed = Math.floor((Date.now() - longVideoStartTime) / 1000);
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            elapsedText = `${mins}:${String(secs).padStart(2, '0')}`;
          }

          return (
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg p-3 border border-indigo-200 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-indigo-600 border-t-transparent"></div>
                  <span className="font-semibold text-indigo-800 text-sm">
                    {seg ? `Long Video: Segment ${seg.current}/${seg.total}` : 'Long Video: Initializing...'}
                  </span>
                </div>
                {etaText && <span className="text-xs text-indigo-600 font-medium">{etaText}</span>}
              </div>

              {/* Per-segment progress blocks */}
              {seg && (
                <div className="flex gap-1">
                  {Array.from({ length: totalSegs }, (_, i) => {
                    const segNum = i + 1;
                    const isCompleted = segNum <= completedSegs;
                    const isCurrent = segNum === seg.current;
                    return (
                      <div
                        key={i}
                        className={`h-3 flex-1 rounded transition-all duration-500 relative ${
                          isCompleted
                            ? 'bg-indigo-600'
                            : isCurrent
                              ? 'bg-indigo-400 animate-pulse'
                              : 'bg-indigo-200'
                        }`}
                        title={`Seg ${segNum}${isCompleted ? ' (done)' : isCurrent ? ' (generating)' : ' (pending)'}`}
                      >
                        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-white">
                          {isCompleted ? '\u2713' : segNum}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Overall progress bar */}
              <div className="w-full bg-indigo-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${longVideoProgress}%` }}
                ></div>
              </div>

              <div className="flex justify-between text-xs">
                <span className="text-indigo-700 truncate max-w-[60%]">{longVideoMessage}</span>
                <div className="flex gap-2 text-indigo-600">
                  {completedSegs > 0 && longVideoStartTime && (
                    <span>{completedSegs}/{totalSegs} done (avg {Math.round((Date.now() - longVideoStartTime) / 1000 / completedSegs / 60)}m)</span>
                  )}
                  {elapsedText && <span>{elapsedText}</span>}
                  <span className="font-medium">{longVideoProgress}%</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCancelLongVideo}
                className="w-full py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors"
              >
                Cancel Long Video
              </button>
            </div>
          );
        })()}

        {/* Single clip progress */}
        {isGenerating && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200 shadow-sm">
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

        {/* Action buttons */}
        <div className="flex gap-2">
          {/* Long Video button */}
          {!isGenerating && !isLongVideoGenerating && (
            <button
              type="button"
              onClick={() => setShowLongVideo(!showLongVideo)}
              className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-colors border ${
                showLongVideo
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-gradient-to-r from-indigo-50 to-purple-50 text-indigo-700 border-indigo-200 hover:border-indigo-400'
              }`}
            >
              Long
            </button>
          )}

          {isGenerating ? (
            <Button
              type="button"
              onClick={handleCancel}
              className="flex-1 bg-red-600 hover:bg-red-700"
              size="lg"
            >
              Cancel Generation
            </Button>
          ) : isLongVideoGenerating ? (
            <div className="flex-1" />
          ) : (
            <Button
              type="button"
              onClick={handleGenerate}
              className="flex-1"
              size="lg"
              isLoading={generateClip.isPending}
              disabled={!prompt.trim()}
            >
              Generate Clip
            </Button>
          )}
        </div>

        {/* Long Video settings panel (expandable) */}
        {showLongVideo && !isLongVideoGenerating && !isGenerating && (
          <div className="space-y-3 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg p-3 border border-indigo-200">
            {/* Duration selector */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Target Duration
              </label>
              <div className="flex gap-1.5">
                {[30, 60, 90, 120].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setLongVideoDuration(d)}
                    className={`flex-1 py-1.5 text-sm rounded-lg border transition-colors ${
                      longVideoDuration === d
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-300'
                    }`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>

            {/* Segment info */}
            <div className="px-2 py-1.5 bg-white/60 rounded text-xs">
              <div className="flex justify-between text-indigo-700">
                <span className="font-medium">{longVideoSegments} segments x 5s = {(longVideoSegments * SECONDS_PER_SEGMENT).toFixed(0)}s</span>
                <span>~{longVideoEstimatedMinutes >= 60 ? `${(longVideoEstimatedMinutes / 60).toFixed(1)}h` : `${longVideoEstimatedMinutes}m`}</span>
              </div>
              <p className="text-indigo-500 mt-0.5">SD1.5 T2I → Wan2.1 I2V 14B (all segs) / {genWidth}x{genHeight} → {genWidth * 2}x{genHeight * 2}</p>
            </div>

            {/* HQ Enhance toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={longVideoHqEnhance}
                onChange={(e) => setLongVideoHqEnhance(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs text-gray-700">HQ Enhance (720p 30fps)</span>
            </label>

            {/* Start button */}
            <button
              type="button"
              onClick={handleLongVideoGenerate}
              disabled={!prompt.trim()}
              className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start Long Video ({longVideoSegments} segments, ~{longVideoEstimatedMinutes >= 60 ? `${(longVideoEstimatedMinutes / 60).toFixed(1)}h` : `${longVideoEstimatedMinutes}m`})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
