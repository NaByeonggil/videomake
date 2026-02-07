/**
 * ComfyUI API Client
 * Handles communication with ComfyUI server for video generation
 */

import { randomUUID } from 'crypto';
import WebSocket from 'ws';

export interface ComfyUIConfig {
  baseUrl: string;
  clientId?: string;
}

export interface QueuePromptResponse {
  prompt_id: string;
  number: number;
  node_errors: Record<string, unknown>;
}

export interface HistoryResponse {
  [promptId: string]: {
    prompt: unknown[];
    outputs: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
    status: {
      status_str: string;
      completed: boolean;
      messages: unknown[];
    };
  };
}

export interface ProgressCallback {
  (data: {
    type: 'progress' | 'executing' | 'executed' | 'error';
    value?: number;
    max?: number;
    node?: string;
    message?: string;
  }): void;
}

export class ComfyUIClient {
  private baseUrl: string;
  private clientId: string;

  constructor(config?: ComfyUIConfig) {
    this.baseUrl = config?.baseUrl || process.env.COMFYUI_URL || 'http://localhost:8188';
    this.clientId = config?.clientId || randomUUID();
  }

  /**
   * Queue a prompt/workflow for execution
   */
  async queuePrompt(workflow: Record<string, unknown>): Promise<QueuePromptResponse> {
    const response = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: workflow,
        client_id: this.clientId,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to queue prompt: ${error}`);
    }

    return response.json();
  }

  /**
   * Get execution history for a prompt
   */
  async getHistory(promptId: string): Promise<HistoryResponse> {
    const response = await fetch(`${this.baseUrl}/history/${promptId}`);

    if (!response.ok) {
      throw new Error(`Failed to get history: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Upload an image to ComfyUI
   */
  async uploadImage(
    imageBuffer: Buffer,
    filename: string,
    subfolder: string = '',
    overwrite: boolean = true
  ): Promise<{ name: string; subfolder: string; type: string }> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(imageBuffer)]);
    formData.append('image', blob, filename);
    formData.append('subfolder', subfolder);
    formData.append('overwrite', overwrite.toString());

    const response = await fetch(`${this.baseUrl}/upload/image`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload image: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get output file from ComfyUI
   */
  async getOutputFile(filename: string, subfolder: string = '', type: string = 'output'): Promise<Buffer> {
    const params = new URLSearchParams({
      filename,
      subfolder,
      type,
    });

    const response = await fetch(`${this.baseUrl}/view?${params}`);

    if (!response.ok) {
      throw new Error(`Failed to get output file: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Check if ComfyUI server is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/system_stats`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get system stats from ComfyUI
   */
  async getSystemStats(): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/system_stats`);

    if (!response.ok) {
      throw new Error(`Failed to get system stats: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Interrupt current execution
   */
  async interrupt(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/interrupt`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Failed to interrupt: ${response.statusText}`);
    }
  }

  /**
   * Monitor prompt execution via WebSocket
   * Returns a promise that resolves when execution completes
   */
  async monitorExecution(
    promptId: string,
    onProgress?: ProgressCallback,
    timeoutMs: number = 600000 // 10 minutes default
  ): Promise<HistoryResponse> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.baseUrl.replace('http', 'ws');
      const ws = new WebSocket(`${wsUrl}/ws?clientId=${this.clientId}`);

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Execution timeout'));
      }, timeoutMs);

      ws.on('open', () => {
        console.log('WebSocket connected to ComfyUI');
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'progress') {
            onProgress?.({
              type: 'progress',
              value: message.data.value,
              max: message.data.max,
              node: message.data.node,
            });
          } else if (message.type === 'executing') {
            if (message.data.node === null && message.data.prompt_id === promptId) {
              // Execution completed
              clearTimeout(timeout);
              ws.close();

              // Get final history
              const history = await this.getHistory(promptId);
              resolve(history);
            } else {
              onProgress?.({
                type: 'executing',
                node: message.data.node,
              });
            }
          } else if (message.type === 'executed') {
            onProgress?.({
              type: 'executed',
              node: message.data.node,
            });
          } else if (message.type === 'execution_error') {
            clearTimeout(timeout);
            ws.close();
            reject(new Error(message.data.exception_message || 'Execution error'));
          }
        } catch {
          // Binary data (preview images), ignore
        }
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      ws.on('close', () => {
        clearTimeout(timeout);
      });
    });
  }

  /**
   * Execute a workflow and wait for completion
   * Convenience method combining queuePrompt and monitorExecution
   */
  async executeWorkflow(
    workflow: Record<string, unknown>,
    onProgress?: ProgressCallback,
    timeoutMs?: number
  ): Promise<{
    promptId: string;
    history: HistoryResponse;
    outputs: Record<string, unknown>;
  }> {
    // Queue the prompt
    const { prompt_id } = await this.queuePrompt(workflow);

    // Monitor execution
    const history = await this.monitorExecution(prompt_id, onProgress, timeoutMs);

    // Extract outputs
    const outputs = history[prompt_id]?.outputs || {};

    return {
      promptId: prompt_id,
      history,
      outputs,
    };
  }
}

// Default singleton instance
let defaultClient: ComfyUIClient | null = null;

export function getComfyUIClient(): ComfyUIClient {
  if (!defaultClient) {
    defaultClient = new ComfyUIClient();
  }
  return defaultClient;
}

export default ComfyUIClient;
