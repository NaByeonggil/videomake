import { NextResponse } from 'next/server';
import { MODEL_CONFIG, getModelRequirements } from '@/lib/workflowBuilder';

// GET /api/models - Get available video models and their status
export async function GET() {
  const models = Object.entries(MODEL_CONFIG).map(([id, config]) => ({
    id,
    name: config.name,
    installed: config.installed,
    minVram: config.minVram,
    supportsTxt2Vid: config.supportsTxt2Vid,
    supportsImg2Vid: config.supportsImg2Vid,
    requirements: getModelRequirements(id as keyof typeof MODEL_CONFIG),
  }));

  return NextResponse.json({
    success: true,
    data: models,
  });
}
