# Video Generator

AI-powered video generation system using ComfyUI + AnimateDiff.

## Requirements

- Node.js 18+
- Docker & Docker Compose
- FFmpeg (`sudo apt install ffmpeg`)
- NVIDIA GPU with CUDA support (RTX 3080 Ti 12GB recommended)

## Quick Start

### 1. Start Docker Services

```bash
cd /home/n1/Desktop/videomake
docker compose up -d
```

### 2. Start ComfyUI

```bash
cd /home/n1/Desktop/videomake/ComfyUI
source venv/bin/activate
python main.py --highvram --fp16
```

### 3. Start Workers (in a new terminal)

```bash
cd /home/n1/Desktop/videomake/video-generator
npm run workers:all
```

### 4. Start Next.js (in a new terminal)

```bash
cd /home/n1/Desktop/videomake/video-generator
npm run dev
```

### 5. Open Browser

Navigate to `http://localhost:3000`

## Scripts

```bash
# Development
npm run dev              # Start Next.js dev server
npm run build            # Build for production
npm run start            # Start production server

# Workers
npm run worker           # Generate worker only
npm run worker:merge     # Merge worker only
npm run worker:upscale   # Upscale worker only
npm run worker:interpolate # Interpolate worker only
npm run worker:export    # Export worker only
npm run workers:all      # Run all workers

# Testing
npm run test:health      # Check all services
npm run test:api         # Run API tests

# Database
npm run db:reset         # Reset database
```

## API Endpoints

### Projects
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create project
- `GET /api/projects/[id]` - Get project
- `PATCH /api/projects/[id]` - Update project
- `DELETE /api/projects/[id]` - Delete project

### Clips
- `GET /api/clips?projectId=` - List clips
- `POST /api/clips/generateClip` - Generate new clip
- `PATCH /api/clips/reorderClips` - Reorder clips
- `GET /api/clips/[id]` - Get clip
- `PATCH /api/clips/[id]` - Update clip
- `DELETE /api/clips/[id]` - Delete clip

### Jobs
- `GET /api/jobs/[id]` - Get job status
- `DELETE /api/jobs/[id]` - Cancel job
- `GET /api/events/jobProgress/[id]` - SSE progress stream

### Processing
- `POST /api/processing/merge` - Merge clips
- `POST /api/processing/upscale` - Upscale video
- `POST /api/processing/interpolate` - Interpolate frames
- `POST /api/processing/export` - Full export pipeline

## Project Structure

```
video-generator/
├── src/
│   ├── app/
│   │   ├── api/           # API routes
│   │   ├── page.tsx       # Main page
│   │   └── layout.tsx     # Root layout
│   ├── components/
│   │   ├── projects/      # Project components
│   │   ├── clips/         # Clip components
│   │   ├── timeline/      # Timeline components
│   │   └── common/        # Shared components
│   ├── hooks/             # React Query hooks
│   ├── stores/            # Zustand stores
│   ├── lib/               # Utilities
│   │   ├── prismaClient.ts
│   │   ├── comfyuiClient.ts
│   │   ├── workflowBuilder.ts
│   │   ├── ffmpegWrapper.ts
│   │   ├── fileNaming.ts
│   │   └── jobQueue.ts
│   └── workers/           # BullMQ workers
├── prisma/
│   └── schema.prisma      # Database schema
├── scripts/               # Test scripts
└── public/                # Static files
```

## Environment Variables

Create `.env` file:

```env
DATABASE_URL="mysql://videogen:videogen123@localhost:3306/videoGeneratorDb"
REDIS_URL="redis://localhost:6379"
COMFYUI_URL="http://localhost:8188"
STORAGE_PATH="./public/storage"
```

## Tech Stack

- **Frontend**: Next.js 14, React 18, Tailwind CSS, Zustand
- **Backend**: Next.js API Routes, Prisma, BullMQ
- **Database**: MariaDB
- **Queue**: Redis + BullMQ
- **AI**: ComfyUI + AnimateDiff
- **Video**: FFmpeg
