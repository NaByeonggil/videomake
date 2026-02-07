/**
 * ComfyUI Workflow Builder
 * Generates workflow JSON for various video generation models
 */

export type VideoModel = 'animateDiff' | 'svd' | 'cogVideoX' | 'hunyuan';

export interface TextToVideoParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  frameCount?: number;
  fps?: number;
  checkpoint?: string;
  motionModule?: string;
  videoModel?: VideoModel;
}

export interface ImageToVideoParams extends TextToVideoParams {
  referenceImage: string; // filename in ComfyUI input folder
  ipAdapterWeight?: number;
  ipAdapterPreset?: 'STANDARD' | 'PLUS' | 'PLUS_FACE' | 'FULL_FACE';
  denoise?: number; // 0.0-1.0: lower = more original image preserved, higher = more prompt influence
}

// Model configuration and requirements
export const MODEL_CONFIG: Record<VideoModel, {
  name: string;
  minVram: number;
  installed: boolean;
  checkpoint?: string;
  supportsTxt2Vid: boolean;
  supportsImg2Vid: boolean;
}> = {
  animateDiff: {
    name: 'AnimateDiff (SD 1.5)',
    minVram: 8,
    installed: true,
    checkpoint: 'v1-5-pruned-emaonly.safetensors',
    supportsTxt2Vid: true,
    supportsImg2Vid: true,
  },
  svd: {
    name: 'Stable Video Diffusion',
    minVram: 12,
    installed: false, // Need to install
    checkpoint: 'svd_xt_1_1.safetensors',
    supportsTxt2Vid: false,
    supportsImg2Vid: true,
  },
  cogVideoX: {
    name: 'CogVideoX',
    minVram: 16,
    installed: false,
    supportsTxt2Vid: true,
    supportsImg2Vid: true,
  },
  hunyuan: {
    name: 'HunyuanVideo',
    minVram: 24,
    installed: false,
    supportsTxt2Vid: true,
    supportsImg2Vid: true,
  },
};

// Node ID counter for unique IDs
let nodeIdCounter = 1;
function getNodeId(): string {
  return String(nodeIdCounter++);
}

function resetNodeIds(): void {
  nodeIdCounter = 1;
}

/**
 * Build Text-to-Video workflow using AnimateDiff
 */
export function buildTextToVideoWorkflow(params: TextToVideoParams): Record<string, unknown> {
  resetNodeIds();

  const {
    prompt,
    negativePrompt = 'blurry, low quality, distorted, deformed',
    width = 512,
    height = 512,
    steps = 20,
    cfg = 7.5,
    seed = Math.floor(Math.random() * 2147483647),
    frameCount = 16,
    fps = 8,
    checkpoint = 'v1-5-pruned-emaonly.safetensors',
    motionModule = 'v3_sd15_mm.ckpt',
  } = params;

  const workflow: Record<string, unknown> = {};

  // 1. Load Checkpoint
  const checkpointNodeId = getNodeId();
  workflow[checkpointNodeId] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: checkpoint,
    },
  };

  // 2. AnimateDiff Loader (Gen1) - loads motion module and applies to model
  const animateDiffNodeId = getNodeId();
  workflow[animateDiffNodeId] = {
    class_type: 'ADE_AnimateDiffLoaderGen1',
    inputs: {
      model: [checkpointNodeId, 0],
      model_name: motionModule,
      beta_schedule: 'autoselect',
    },
  };

  // 3. CLIP Text Encode (Positive)
  const positiveClipNodeId = getNodeId();
  workflow[positiveClipNodeId] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: prompt,
      clip: [checkpointNodeId, 1],
    },
  };

  // 4. CLIP Text Encode (Negative)
  const negativeClipNodeId = getNodeId();
  workflow[negativeClipNodeId] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: negativePrompt,
      clip: [checkpointNodeId, 1],
    },
  };

  // 5. Empty Latent Image (batch for animation frames)
  const emptyLatentNodeId = getNodeId();
  workflow[emptyLatentNodeId] = {
    class_type: 'EmptyLatentImage',
    inputs: {
      width,
      height,
      batch_size: frameCount,
    },
  };

  // 6. KSampler
  const samplerNodeId = getNodeId();
  workflow[samplerNodeId] = {
    class_type: 'KSampler',
    inputs: {
      model: [animateDiffNodeId, 0],
      positive: [positiveClipNodeId, 0],
      negative: [negativeClipNodeId, 0],
      latent_image: [emptyLatentNodeId, 0],
      seed,
      steps,
      cfg,
      sampler_name: 'euler_ancestral',
      scheduler: 'normal',
      denoise: 1,
    },
  };

  // 7. VAE Decode
  const vaeDecodeNodeId = getNodeId();
  workflow[vaeDecodeNodeId] = {
    class_type: 'VAEDecode',
    inputs: {
      samples: [samplerNodeId, 0],
      vae: [checkpointNodeId, 2],
    },
  };

  // 8. Video Combine (VHS)
  const videoCombineNodeId = getNodeId();
  workflow[videoCombineNodeId] = {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: [vaeDecodeNodeId, 0],
      frame_rate: fps,
      loop_count: 0,
      filename_prefix: 'AnimateDiff',
      format: 'video/h264-mp4',
      pingpong: false,
      save_output: true,
    },
  };

  return workflow;
}

/**
 * Build Image-to-Video workflow using AnimateDiff + img2img approach
 * This preserves the original image while adding motion based on prompt
 *
 * Key changes from pure IPAdapter approach:
 * - Uses VAE Encode to convert reference image to latent
 * - Uses RepeatLatentBatch to create frame copies
 * - Uses lower denoise to preserve original image
 * - IPAdapter provides additional consistency
 */
export function buildImageToVideoWorkflow(params: ImageToVideoParams): Record<string, unknown> {
  resetNodeIds();

  const {
    prompt,
    negativePrompt = 'blurry, low quality, distorted, deformed',
    steps = 20,
    cfg = 7.5,
    seed = Math.floor(Math.random() * 2147483647),
    frameCount = 16,
    fps = 8,
    checkpoint = 'v1-5-pruned-emaonly.safetensors',
    motionModule = 'v3_sd15_mm.ckpt',
    referenceImage,
    ipAdapterWeight = 1.0,
    ipAdapterPreset = 'PLUS_FACE',
    denoise = 0.6, // Lower = more original preserved, higher = more prompt influence
  } = params;

  // Map preset names to ComfyUI preset strings
  const presetMap: Record<string, string> = {
    'STANDARD': 'STANDARD (medium strength)',
    'PLUS': 'PLUS (high strength)',
    'PLUS_FACE': 'PLUS FACE (portraits)',
    'FULL_FACE': 'FULL FACE - SD1.5 only (portraits stronger)',
  };
  const selectedPreset = presetMap[ipAdapterPreset] || presetMap['PLUS_FACE'];

  const workflow: Record<string, unknown> = {};

  // 1. Load Checkpoint
  const checkpointNodeId = getNodeId();
  workflow[checkpointNodeId] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: checkpoint,
    },
  };

  // 2. Load Reference Image
  const loadImageNodeId = getNodeId();
  workflow[loadImageNodeId] = {
    class_type: 'LoadImage',
    inputs: {
      image: referenceImage,
    },
  };

  // 3. VAE Encode - Convert reference image to latent space
  const vaeEncodeNodeId = getNodeId();
  workflow[vaeEncodeNodeId] = {
    class_type: 'VAEEncode',
    inputs: {
      pixels: [loadImageNodeId, 0],
      vae: [checkpointNodeId, 2],
    },
  };

  // 4. Repeat Latent Batch - Create copies for all frames
  const repeatLatentNodeId = getNodeId();
  workflow[repeatLatentNodeId] = {
    class_type: 'RepeatLatentBatch',
    inputs: {
      samples: [vaeEncodeNodeId, 0],
      amount: frameCount,
    },
  };

  // 5. IPAdapter Unified Loader
  const ipAdapterLoaderNodeId = getNodeId();
  workflow[ipAdapterLoaderNodeId] = {
    class_type: 'IPAdapterUnifiedLoader',
    inputs: {
      model: [checkpointNodeId, 0],
      preset: selectedPreset,
    },
  };

  // 6. Apply IPAdapter - Additional consistency
  const ipAdapterApplyNodeId = getNodeId();
  workflow[ipAdapterApplyNodeId] = {
    class_type: 'IPAdapter',
    inputs: {
      model: [ipAdapterLoaderNodeId, 0],
      ipadapter: [ipAdapterLoaderNodeId, 1],
      image: [loadImageNodeId, 0],
      weight: ipAdapterWeight,
      start_at: 0,
      end_at: 1,
      weight_type: 'standard',
    },
  };

  // 7. AnimateDiff Loader - Apply motion module
  const animateDiffNodeId = getNodeId();
  workflow[animateDiffNodeId] = {
    class_type: 'ADE_AnimateDiffLoaderGen1',
    inputs: {
      model: [ipAdapterApplyNodeId, 0],
      model_name: motionModule,
      beta_schedule: 'autoselect',
    },
  };

  // 8. CLIP Text Encode (Positive) - Prompt affects motion/details
  const positiveClipNodeId = getNodeId();
  workflow[positiveClipNodeId] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: prompt,
      clip: [checkpointNodeId, 1],
    },
  };

  // 9. CLIP Text Encode (Negative)
  const negativeClipNodeId = getNodeId();
  workflow[negativeClipNodeId] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: negativePrompt,
      clip: [checkpointNodeId, 1],
    },
  };

  // 10. KSampler - Use image latent as starting point with controlled denoise
  const samplerNodeId = getNodeId();
  workflow[samplerNodeId] = {
    class_type: 'KSampler',
    inputs: {
      model: [animateDiffNodeId, 0],
      positive: [positiveClipNodeId, 0],
      negative: [negativeClipNodeId, 0],
      latent_image: [repeatLatentNodeId, 0], // Use encoded image, not empty latent
      seed,
      steps,
      cfg,
      sampler_name: 'euler_ancestral',
      scheduler: 'normal',
      denoise, // Lower denoise preserves more of original image
    },
  };

  // 11. VAE Decode
  const vaeDecodeNodeId = getNodeId();
  workflow[vaeDecodeNodeId] = {
    class_type: 'VAEDecode',
    inputs: {
      samples: [samplerNodeId, 0],
      vae: [checkpointNodeId, 2],
    },
  };

  // 12. Video Combine
  const videoCombineNodeId = getNodeId();
  workflow[videoCombineNodeId] = {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: [vaeDecodeNodeId, 0],
      frame_rate: fps,
      loop_count: 0,
      filename_prefix: 'AnimateDiff_Img2Vid',
      format: 'video/h264-mp4',
      pingpong: false,
      save_output: true,
    },
  };

  return workflow;
}

/**
 * Parse resolution string to width/height
 */
export function parseResolution(resolution: string): { width: number; height: number } {
  const match = resolution.match(/(\d+)x(\d+)/);
  if (match) {
    return {
      width: parseInt(match[1], 10),
      height: parseInt(match[2], 10),
    };
  }
  return { width: 512, height: 512 };
}

/**
 * Get output video filename from workflow result
 */
export function getOutputVideoFromResult(
  outputs: Record<string, unknown>
): { filename: string; subfolder: string } | null {
  for (const nodeOutput of Object.values(outputs)) {
    const output = nodeOutput as { gifs?: Array<{ filename: string; subfolder: string }> };
    if (output.gifs && output.gifs.length > 0) {
      return {
        filename: output.gifs[0].filename,
        subfolder: output.gifs[0].subfolder || '',
      };
    }
  }
  return null;
}

/**
 * Build SVD (Stable Video Diffusion) Image-to-Video workflow
 * Note: Requires svd_xt_1_1.safetensors model
 */
export function buildSVDWorkflow(params: ImageToVideoParams): Record<string, unknown> {
  resetNodeIds();

  const {
    referenceImage,
    width = 1024,
    height = 576,
    steps = 25,
    cfg = 2.5, // SVD uses lower CFG
    seed = Math.floor(Math.random() * 2147483647),
    frameCount = 25, // SVD default is 14 or 25 frames
    fps = 8,
  } = params;

  const workflow: Record<string, unknown> = {};

  // 1. Load SVD Checkpoint (Image Only)
  const checkpointNodeId = getNodeId();
  workflow[checkpointNodeId] = {
    class_type: 'ImageOnlyCheckpointLoader',
    inputs: {
      ckpt_name: 'svd_xt_1_1.safetensors',
    },
  };

  // 2. Load Reference Image
  const loadImageNodeId = getNodeId();
  workflow[loadImageNodeId] = {
    class_type: 'LoadImage',
    inputs: {
      image: referenceImage,
    },
  };

  // 3. SVD Conditioning
  const svdCondNodeId = getNodeId();
  workflow[svdCondNodeId] = {
    class_type: 'SVD_img2vid_Conditioning',
    inputs: {
      clip_vision: [checkpointNodeId, 1],
      init_image: [loadImageNodeId, 0],
      vae: [checkpointNodeId, 2],
      width,
      height,
      video_frames: frameCount,
      motion_bucket_id: 127, // Controls motion amount (1-255)
      fps: 6,
      augmentation_level: 0,
    },
  };

  // 4. KSampler
  const samplerNodeId = getNodeId();
  workflow[samplerNodeId] = {
    class_type: 'KSampler',
    inputs: {
      model: [checkpointNodeId, 0],
      positive: [svdCondNodeId, 0],
      negative: [svdCondNodeId, 1],
      latent_image: [svdCondNodeId, 2],
      seed,
      steps,
      cfg,
      sampler_name: 'euler',
      scheduler: 'karras',
      denoise: 1,
    },
  };

  // 5. VAE Decode
  const vaeDecodeNodeId = getNodeId();
  workflow[vaeDecodeNodeId] = {
    class_type: 'VAEDecode',
    inputs: {
      samples: [samplerNodeId, 0],
      vae: [checkpointNodeId, 2],
    },
  };

  // 6. Video Combine
  const videoCombineNodeId = getNodeId();
  workflow[videoCombineNodeId] = {
    class_type: 'VHS_VideoCombine',
    inputs: {
      images: [vaeDecodeNodeId, 0],
      frame_rate: fps,
      loop_count: 0,
      filename_prefix: 'SVD_output',
      format: 'video/h264-mp4',
      pingpong: false,
      save_output: true,
    },
  };

  return workflow;
}

/**
 * Check if a video model is available
 */
export function isModelAvailable(model: VideoModel): boolean {
  return MODEL_CONFIG[model]?.installed ?? false;
}

/**
 * Get model requirements message
 */
export function getModelRequirements(model: VideoModel): string {
  const config = MODEL_CONFIG[model];
  if (!config) return 'Unknown model';

  if (config.installed) {
    return `${config.name} is ready to use`;
  }

  switch (model) {
    case 'svd':
      return `${config.name} requires:\n` +
        '1. Download svd_xt_1_1.safetensors from HuggingFace\n' +
        '2. Place in ComfyUI/models/checkpoints/\n' +
        '3. Requires 12GB+ VRAM';
    case 'cogVideoX':
      return `${config.name} requires:\n` +
        '1. Install ComfyUI-CogVideoX custom node\n' +
        '2. Download CogVideoX-5b model\n' +
        '3. Requires 16GB+ VRAM';
    case 'hunyuan':
      return `${config.name} requires:\n` +
        '1. Install ComfyUI-HunyuanVideo custom node\n' +
        '2. Download HunyuanVideo model\n' +
        '3. Requires 24GB+ VRAM (or quantized version for 12GB)';
    default:
      return `${config.name} - Min VRAM: ${config.minVram}GB`;
  }
}
