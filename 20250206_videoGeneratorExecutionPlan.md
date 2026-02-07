# 🚀 AI 동영상 생성 시스템 실행 계획

> **프로젝트명**: Video Generator System
> 
> **목표**: 로컬 RTX 3080 Ti 12GB 환경에서 웹 기반 AI 동영상 생성 시스템 구축
> 
> **기술 스택**: Next.js + MariaDB + ComfyUI + AnimateDiff
> 
> **예상 기간**: 6주

---

## 📋 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [전체 타임라인](#2-전체-타임라인)
3. [Phase 1: 환경 구축](#3-phase-1-환경-구축-1주차)
4. [Phase 2: 백엔드 기반](#4-phase-2-백엔드-기반-2주차)
5. [Phase 3: 클립 생성 기능](#5-phase-3-클립-생성-기능-3주차)
6. [Phase 4: 후처리 기능](#6-phase-4-후처리-기능-4주차)
7. [Phase 5: 프론트엔드 UI](#7-phase-5-프론트엔드-ui-5주차)
8. [Phase 6: 통합 및 테스트](#8-phase-6-통합-및-테스트-6주차)
9. [리스크 관리](#9-리스크-관리)
10. [체크리스트](#10-체크리스트)

---

## 1. 프로젝트 개요

### 1.1 목표 기능

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           핵심 기능 목록                                     │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
  │   클립 생성      │     │   클립 관리      │     │   후처리        │
  │                 │     │                 │     │                 │
  │ • Text-to-Video │     │ • 목록 조회      │     │ • 이어붙이기    │
  │ • Image-to-Video│     │ • 순서 변경      │     │ • 업스케일링    │
  │ • 파라미터 설정  │     │ • 삭제/재생성    │     │ • 프레임 보간   │
  └─────────────────┘     └─────────────────┘     └─────────────────┘
           │                      │                      │
           └──────────────────────┼──────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │      최종 출력           │
                    │                         │
                    │ • 전체 파이프라인 실행    │
                    │ • 진행률 실시간 표시     │
                    │ • 다운로드              │
                    └─────────────────────────┘
```

### 1.2 기술 스택 확정

| 레이어 | 기술 | 버전 |
|--------|------|------|
| Frontend | Next.js (App Router) | 14.x |
| Backend | Next.js API Routes | 14.x |
| Database | MariaDB | 10.x |
| ORM | Prisma | 5.x |
| Job Queue | BullMQ | 5.x |
| Cache/Broker | Redis | 7.x |
| AI Engine | ComfyUI | Latest |
| Container | Docker Compose | 2.x |

### 1.3 명명 규칙 확정

| 항목 | 규칙 | 예시 |
|------|------|------|
| 파일명 | {날짜}_{프로젝트명}_{타입}_{인덱스} | `20250205_myProject_clip_001.mp4` |
| DB 필드 | camelCase | `projectName`, `clipStatus` |
| API 경로 | camelCase | `/api/clips/generateClip` |
| 컴포넌트 | PascalCase | `ClipGenerator.tsx` |

---

## 2. 전체 타임라인

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           6주 개발 타임라인                                   │
└─────────────────────────────────────────────────────────────────────────────┘

Week 1          Week 2          Week 3          Week 4          Week 5          Week 6
│               │               │               │               │               │
▼               ▼               ▼               ▼               ▼               ▼
┌───────┐       ┌───────┐       ┌───────┐       ┌───────┐       ┌───────┐       ┌───────┐
│Phase 1│──────▶│Phase 2│──────▶│Phase 3│──────▶│Phase 4│──────▶│Phase 5│──────▶│Phase 6│
│       │       │       │       │       │       │       │       │       │       │       │
│ 환경  │       │백엔드 │       │ 클립  │       │후처리 │       │  UI   │       │ 통합  │
│ 구축  │       │ 기반  │       │ 생성  │       │ 기능  │       │ 개발  │       │테스트 │
└───────┘       └───────┘       └───────┘       └───────┘       └───────┘       └───────┘
   │               │               │               │               │               │
   ▼               ▼               ▼               ▼               ▼               ▼
┌───────┐       ┌───────┐       ┌───────┐       ┌───────┐       ┌───────┐       ┌───────┐
│Docker │       │Prisma │       │ComfyUI│       │FFmpeg │       │React  │       │E2E    │
│ComfyUI│       │API    │       │연동   │       │통합   │       │Pages  │       │Test   │
│MariaDB│       │BullMQ │       │Worker │       │Pipeline│      │Socket │       │Deploy │
└───────┘       └───────┘       └───────┘       └───────┘       └───────┘       └───────┘

마일스톤:
• Week 1 끝: ComfyUI 단독 영상 생성 가능
• Week 2 끝: API로 DB CRUD 가능
• Week 3 끝: 웹에서 클립 생성 가능
• Week 4 끝: 병합/업스케일 가능
• Week 5 끝: 전체 UI 완성
• Week 6 끝: 프로덕션 배포 가능
```

---

## 3. Phase 1: 환경 구축 (1주차)

### 3.1 일정

| 일차 | 태스크 | 예상 시간 | 산출물 |
|------|--------|----------|--------|
| Day 1 | ComfyUI 설치 및 테스트 | 4h | ComfyUI 실행 확인 |
| Day 2 | AnimateDiff 및 확장 노드 설치 | 4h | 영상 생성 테스트 |
| Day 3 | 모델 다운로드 및 설정 | 4h | 모델 파일 배치 완료 |
| Day 4 | Docker Compose 환경 구성 | 4h | docker-compose.yml |
| Day 5 | Next.js 프로젝트 초기화 | 4h | 프로젝트 구조 완성 |
| Day 6-7 | 통합 테스트 및 문서화 | 4h | 환경 구축 가이드 |

### 3.2 상세 태스크

#### Day 1: ComfyUI 설치

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 1.1: ComfyUI 기본 설치                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ □ Python 3.10+ 설치 확인                                                    │
│ □ Git 설치 확인                                                             │
│ □ CUDA 12.1 드라이버 확인 (nvidia-smi)                                      │
│ □ ComfyUI 저장소 클론                                                       │
│ □ 가상환경 생성 (venv)                                                      │
│ □ PyTorch CUDA 버전 설치                                                    │
│ □ ComfyUI 의존성 설치                                                       │
│ □ 기본 실행 테스트 (localhost:8188)                                         │
│                                                                             │
│ 완료 기준: 브라우저에서 ComfyUI 접속 가능                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 2: 확장 노드 설치

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 1.2: 확장 노드 설치                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ □ ComfyUI-Manager 설치                                                      │
│ □ ComfyUI-AnimateDiff-Evolved 설치                                          │
│ □ ComfyUI-VideoHelperSuite 설치                                             │
│ □ ComfyUI-IPAdapter-Plus 설치                                               │
│ □ ComfyUI-Frame-Interpolation 설치                                          │
│ □ Real-ESRGAN 업스케일 노드 설치                                            │
│ □ 노드 의존성 설치 (각 requirements.txt)                                    │
│ □ ComfyUI 재시작 및 노드 로드 확인                                          │
│                                                                             │
│ 완료 기준: 모든 커스텀 노드가 노드 목록에 표시됨                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 3: 모델 다운로드

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 1.3: 모델 파일 배치                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ 필수 모델:                                                                  │
│ □ SD 1.5 체크포인트 → models/checkpoints/                                   │
│ □ RealisticVision v5.1 → models/checkpoints/                                │
│ □ AnimateDiff v2 모션 모듈 → custom_nodes/.../models/                       │
│ □ VAE (vae-ft-mse) → models/vae/                                           │
│                                                                             │
│ IPAdapter 모델:                                                             │
│ □ ip-adapter_sd15.bin → models/ipadapter/                                   │
│ □ ip-adapter-plus_sd15.bin → models/ipadapter/                              │
│ □ CLIP Image Encoder → models/clip_vision/                                  │
│                                                                             │
│ 후처리 모델:                                                                │
│ □ RealESRGAN_x4plus.pth → models/upscale_models/                            │
│ □ RIFE v4.7 → custom_nodes/.../models/                                      │
│                                                                             │
│ 완료 기준: 테스트 워크플로우로 영상 생성 성공                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 4: Docker 환경 구성

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 1.4: Docker Compose 설정                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ 서비스 정의:                                                                │
│ □ mariadbServer (3306)                                                      │
│   - 볼륨 마운트 설정                                                        │
│   - 초기 DB 생성 스크립트                                                   │
│   - 캐릭터셋 utf8mb4 설정                                                   │
│                                                                             │
│ □ redisServer (6379)                                                        │
│   - 영속성 설정 (AOF)                                                       │
│   - 메모리 제한 설정                                                        │
│                                                                             │
│ □ nextjsApp (3000)                                                          │
│   - 환경 변수 설정                                                          │
│   - 볼륨 마운트 (storage)                                                   │
│                                                                             │
│ □ workerProcess                                                             │
│   - nextjsApp과 동일 이미지                                                 │
│   - 다른 시작 명령어                                                        │
│                                                                             │
│ 네트워크:                                                                   │
│ □ 내부 네트워크 구성                                                        │
│ □ ComfyUI 연결 설정 (host 네트워크 or 포트 포워딩)                          │
│                                                                             │
│ 완료 기준: docker-compose up으로 전체 스택 실행                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 5: Next.js 프로젝트 초기화

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 1.5: Next.js 프로젝트 구조                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ 프로젝트 생성:                                                              │
│ □ create-next-app 실행 (TypeScript, TailwindCSS, App Router)                │
│ □ ESLint, Prettier 설정                                                     │
│ □ 절대 경로 설정 (@/)                                                       │
│                                                                             │
│ 의존성 설치:                                                                │
│ □ prisma, @prisma/client                                                    │
│ □ bullmq, ioredis                                                           │
│ □ uuid                                                                      │
│ □ zod (유효성 검사)                                                         │
│                                                                             │
│ 디렉토리 구조:                                                              │
│ □ app/(pages)/ 생성                                                         │
│ □ app/api/ 생성                                                             │
│ □ components/ 생성                                                          │
│ □ lib/ 생성                                                                 │
│ □ types/ 생성                                                               │
│ □ workers/ 생성                                                             │
│                                                                             │
│ 완료 기준: npm run dev로 기본 페이지 표시                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Phase 1 완료 기준

| 항목 | 확인 방법 |
|------|----------|
| ComfyUI 실행 | localhost:8188 접속 |
| 영상 생성 | AnimateDiff로 테스트 영상 생성 |
| Docker 실행 | docker-compose up -d 성공 |
| MariaDB 연결 | 클라이언트로 접속 테스트 |
| Next.js 실행 | localhost:3000 접속 |

---

## 4. Phase 2: 백엔드 기반 (2주차)

### 4.1 일정

| 일차 | 태스크 | 예상 시간 | 산출물 |
|------|--------|----------|--------|
| Day 1 | Prisma 스키마 작성 | 4h | schema.prisma |
| Day 2 | DB 마이그레이션 및 시드 | 3h | 테이블 생성 완료 |
| Day 3 | 프로젝트 CRUD API | 4h | /api/projects/* |
| Day 4 | 클립 CRUD API | 4h | /api/clips/* |
| Day 5 | BullMQ 큐 설정 | 4h | 큐 구성 완료 |
| Day 6 | 파일 저장 유틸리티 | 3h | fileNaming.ts, storage.ts |
| Day 7 | API 테스트 및 문서화 | 4h | API 문서 |

### 4.2 상세 태스크

#### Day 1: Prisma 스키마

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 2.1: Prisma 스키마 작성                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ 모델 정의:                                                                  │
│ □ Project 모델                                                              │
│   - id, projectName, displayName, description                               │
│   - resolution, frameRate, projectStatus                                    │
│   - createdAt, updatedAt                                                    │
│   - clips 관계 (1:N)                                                        │
│   - jobs 관계 (1:N)                                                         │
│                                                                             │
│ □ Clip 모델                                                                 │
│   - id, projectId, clipName, orderIndex                                     │
│   - prompt, negativePrompt, seedValue, stepsCount, cfgScale                 │
│   - referenceImage, ipAdapterWeight                                         │
│   - filePath, fileName, thumbnailPath, thumbnailName                        │
│   - durationSec, frameCount, clipStatus                                     │
│   - createdAt, updatedAt                                                    │
│                                                                             │
│ □ Job 모델                                                                  │
│   - id, projectId, jobType, inputClipIds (Json)                            │
│   - jobSettings (Json), outputPath, outputFileName                          │
│   - progressPercent, jobStatus, errorMessage                                │
│   - startedAt, completedAt, createdAt                                       │
│                                                                             │
│ □ JobLog 모델                                                               │
│   - id, jobId, logLevel, logMessage, createdAt                             │
│                                                                             │
│ 설정:                                                                       │
│ □ MariaDB 프로바이더 설정                                                   │
│ □ UUID 기본값 설정                                                          │
│ □ 인덱스 정의                                                               │
│                                                                             │
│ 완료 기준: npx prisma validate 통과                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 3-4: API 라우트 구현

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 2.2: REST API 구현                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ 프로젝트 API:                                                               │
│ □ GET    /api/projects         - 목록 조회 (페이지네이션)                   │
│ □ POST   /api/projects         - 생성                                       │
│ □ GET    /api/projects/[id]    - 상세 조회                                  │
│ □ PATCH  /api/projects/[id]    - 수정                                       │
│ □ DELETE /api/projects/[id]    - 삭제 (cascade)                             │
│                                                                             │
│ 클립 API:                                                                   │
│ □ GET    /api/clips            - 목록 조회 (?projectId=)                    │
│ □ GET    /api/clips/[id]       - 상세 조회                                  │
│ □ PATCH  /api/clips/[id]       - 메타데이터 수정                            │
│ □ DELETE /api/clips/[id]       - 삭제                                       │
│ □ PATCH  /api/clips/reorderClips - 순서 변경                                │
│                                                                             │
│ 공통:                                                                       │
│ □ Zod 스키마로 요청 유효성 검사                                             │
│ □ 에러 핸들링 미들웨어                                                      │
│ □ 응답 형식 통일                                                            │
│                                                                             │
│ 완료 기준: Postman/curl로 전체 API 테스트 통과                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 5: BullMQ 설정

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 2.3: BullMQ 작업 큐 구성                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ 큐 정의:                                                                    │
│ □ generateQueue    - 클립 생성 작업                                         │
│ □ mergeQueue       - 영상 병합 작업                                         │
│ □ upscaleQueue     - 업스케일 작업                                          │
│ □ interpolateQueue - 프레임 보간 작업                                       │
│ □ exportQueue      - 최종 출력 작업                                         │
│                                                                             │
│ 설정:                                                                       │
│ □ Redis 연결 설정 (lib/redis.ts)                                            │
│ □ 큐 옵션 설정 (재시도, 타임아웃)                                           │
│ □ 이벤트 리스너 (completed, failed, progress)                               │
│                                                                             │
│ 워커 스캐폴딩:                                                              │
│ □ workers/generateWorker.ts 구조                                            │
│ □ workers/mergeWorker.ts 구조                                               │
│ □ workers/upscaleWorker.ts 구조                                             │
│ □ workers/interpolateWorker.ts 구조                                         │
│                                                                             │
│ 완료 기준: 테스트 작업 큐 등록 및 처리 확인                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 6: 파일 유틸리티

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 2.4: 파일 관리 유틸리티                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ lib/fileNaming.ts:                                                          │
│ □ generateFileName(projectName, type, index) 함수                           │
│   - 날짜 포맷팅 (YYYYMMDD)                                                  │
│   - 프로젝트명 카멜케이스 변환                                              │
│   - 타입 접미사 추가                                                        │
│   - 인덱스 패딩 (001, 002...)                                               │
│                                                                             │
│ □ getNextIndex(projectId, type) 함수                                        │
│   - DB에서 다음 인덱스 조회                                                 │
│                                                                             │
│ □ toCamelCase(str) 함수                                                     │
│   - 공백, 특수문자 처리                                                     │
│   - 한글 처리 (공백 제거)                                                   │
│                                                                             │
│ lib/storage.ts:                                                             │
│ □ getStoragePath(type, projectName) 함수                                    │
│ □ ensureDirectory(path) 함수                                                │
│ □ saveFile(buffer, path) 함수                                               │
│ □ deleteFile(path) 함수                                                     │
│ □ getPublicUrl(path) 함수                                                   │
│                                                                             │
│ 완료 기준: 유닛 테스트 통과                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Phase 2 완료 기준

| 항목 | 확인 방법 |
|------|----------|
| DB 테이블 | MariaDB에서 테이블 확인 |
| 프로젝트 API | CRUD 전체 동작 |
| 클립 API | CRUD + 순서 변경 동작 |
| BullMQ | 테스트 작업 처리 |
| 파일명 생성 | 규칙에 맞는 파일명 생성 |

---

## 5. Phase 3: 클립 생성 기능 (3주차)

### 5.1 일정

| 일차 | 태스크 | 예상 시간 | 산출물 |
|------|--------|----------|--------|
| Day 1 | ComfyUI API 클라이언트 | 4h | comfyuiClient.ts |
| Day 2 | 워크플로우 빌더 | 5h | workflowBuilder.ts |
| Day 3 | Generate Worker 구현 | 5h | generateWorker.ts |
| Day 4 | 클립 생성 API 완성 | 4h | /api/clips/generateClip |
| Day 5 | SSE 진행률 구현 | 4h | /api/events/jobProgress |
| Day 6-7 | 통합 테스트 | 4h | 웹에서 클립 생성 |

### 5.2 상세 태스크

#### Day 1: ComfyUI 클라이언트

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 3.1: ComfyUI API 클라이언트                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ lib/comfyuiClient.ts:                                                       │
│ □ 클래스 구조 설계                                                          │
│   - baseUrl, clientId 설정                                                  │
│                                                                             │
│ □ queuePrompt(workflow) 메서드                                              │
│   - POST /prompt                                                            │
│   - prompt_id 반환                                                          │
│                                                                             │
│ □ getHistory(promptId) 메서드                                               │
│   - GET /history/{prompt_id}                                                │
│   - 완료 여부, 출력 파일 정보                                               │
│                                                                             │
│ □ getProgress(promptId) 메서드                                              │
│   - WebSocket 연결                                                          │
│   - 진행률 이벤트 수신                                                      │
│                                                                             │
│ □ uploadImage(buffer, filename) 메서드                                      │
│   - POST /upload/image                                                      │
│   - 참조 이미지 업로드용                                                    │
│                                                                             │
│ □ getOutputFile(filename) 메서드                                            │
│   - 생성된 파일 다운로드                                                    │
│                                                                             │
│ 완료 기준: ComfyUI에 워크플로우 전송 및 결과 수신                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 2: 워크플로우 빌더

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 3.2: 워크플로우 JSON 빌더                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ lib/workflowBuilder.ts:                                                     │
│ □ buildTextToVideoWorkflow(params) 함수                                     │
│   - checkpoint 노드                                                         │
│   - CLIP 텍스트 인코딩 노드                                                 │
│   - AnimateDiff 로더 노드                                                   │
│   - KSampler 노드                                                           │
│   - VAE 디코드 노드                                                         │
│   - Video Combine 노드                                                      │
│                                                                             │
│ □ buildImageToVideoWorkflow(params) 함수                                    │
│   - 위 + IPAdapter 노드                                                     │
│   - 이미지 로드 노드                                                        │
│                                                                             │
│ □ 파라미터 매핑                                                             │
│   - prompt → CLIP positive                                                  │
│   - negativePrompt → CLIP negative                                          │
│   - seedValue → KSampler seed                                               │
│   - stepsCount → KSampler steps                                             │
│   - cfgScale → KSampler cfg                                                 │
│   - frameCount → AnimateDiff frames                                         │
│                                                                             │
│ 완료 기준: 생성된 JSON으로 ComfyUI 영상 생성 성공                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 3: Generate Worker

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 3.3: 클립 생성 워커                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ workers/generateWorker.ts:                                                  │
│ □ Worker 초기화                                                             │
│   - generateQueue 연결                                                      │
│   - 동시 처리 수 설정 (1 - GPU 제한)                                        │
│                                                                             │
│ □ 작업 처리 흐름                                                            │
│   1. Job 데이터에서 clipId 추출                                             │
│   2. DB에서 clip 정보 조회                                                  │
│   3. 워크플로우 JSON 생성                                                   │
│   4. ComfyUI에 전송                                                         │
│   5. 진행률 모니터링 → job.updateProgress()                                 │
│   6. 완료 시 파일 저장                                                      │
│   7. 썸네일 생성 (FFmpeg)                                                   │
│   8. DB 업데이트 (filePath, thumbnailPath, status)                          │
│                                                                             │
│ □ 에러 처리                                                                 │
│   - ComfyUI 연결 실패                                                       │
│   - 영상 생성 실패                                                          │
│   - 파일 저장 실패                                                          │
│   - 재시도 로직                                                             │
│                                                                             │
│ 완료 기준: 큐에 등록된 작업이 자동으로 처리됨                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 5: SSE 진행률

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 3.4: Server-Sent Events 진행률                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ app/api/events/jobProgress/[jobId]/route.ts:                                │
│ □ SSE 엔드포인트 구현                                                       │
│   - ReadableStream 반환                                                     │
│   - Content-Type: text/event-stream                                         │
│                                                                             │
│ □ Redis Pub/Sub 구독                                                        │
│   - 채널: job:{jobId}:progress                                              │
│   - 메시지 수신 시 클라이언트에 전송                                        │
│                                                                             │
│ □ 이벤트 타입                                                               │
│   - progress: { percent, message, step }                                    │
│   - completed: { outputUrl, duration }                                      │
│   - error: { message }                                                      │
│                                                                             │
│ □ 연결 관리                                                                 │
│   - 클라이언트 연결 해제 감지                                               │
│   - 리소스 정리                                                             │
│                                                                             │
│ 완료 기준: 클라이언트에서 실시간 진행률 수신                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Phase 3 완료 기준

| 항목 | 확인 방법 |
|------|----------|
| ComfyUI 연동 | API로 워크플로우 전송 |
| Text-to-Video | 프롬프트로 영상 생성 |
| Image-to-Video | 참조 이미지로 영상 생성 |
| 파일 저장 | 명명 규칙에 맞게 저장 |
| 진행률 | SSE로 실시간 확인 |

---

## 6. Phase 4: 후처리 기능 (4주차)

### 6.1 일정

| 일차 | 태스크 | 예상 시간 | 산출물 |
|------|--------|----------|--------|
| Day 1 | FFmpeg 래퍼 구현 | 4h | ffmpegWrapper.ts |
| Day 2 | Merge Worker 구현 | 4h | mergeWorker.ts |
| Day 3 | Upscale Worker 구현 | 4h | upscaleWorker.ts |
| Day 4 | Interpolate Worker 구현 | 4h | interpolateWorker.ts |
| Day 5 | Export Pipeline 구현 | 5h | exportWorker.ts |
| Day 6-7 | 후처리 API 완성 | 4h | /api/jobs/* |

### 6.2 상세 태스크

#### Day 1: FFmpeg 래퍼

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 4.1: FFmpeg 유틸리티                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ lib/ffmpegWrapper.ts:                                                       │
│ □ concatenateVideos(inputPaths, outputPath, options) 함수                   │
│   - 단순 이어붙이기 (-c copy)                                               │
│   - 트랜지션 포함 (xfade 필터)                                              │
│   - 진행률 콜백                                                             │
│                                                                             │
│ □ extractThumbnail(videoPath, outputPath, timestamp) 함수                   │
│   - 특정 시간의 프레임 추출                                                 │
│   - 리사이즈 옵션                                                           │
│                                                                             │
│ □ getVideoInfo(videoPath) 함수                                              │
│   - duration, fps, resolution 반환                                          │
│   - ffprobe 사용                                                            │
│                                                                             │
│ □ encodeVideo(inputPath, outputPath, options) 함수                          │
│   - H.264/H.265 인코딩                                                      │
│   - 비트레이트, 품질 설정                                                   │
│                                                                             │
│ 완료 기준: 영상 병합 및 인코딩 테스트 통과                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 2: Merge Worker

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 4.2: 영상 병합 워커                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ workers/mergeWorker.ts:                                                     │
│ □ 작업 처리 흐름                                                            │
│   1. Job 데이터에서 clipIds, settings 추출                                  │
│   2. DB에서 클립 파일 경로 조회 (orderIndex 순)                             │
│   3. 출력 파일명 생성 (20250205_project_merged_001.mp4)                     │
│   4. FFmpeg 병합 실행                                                       │
│   5. 진행률 업데이트                                                        │
│   6. DB 업데이트 (outputPath, status)                                       │
│                                                                             │
│ □ 트랜지션 옵션 처리                                                        │
│   - none: 단순 이어붙이기                                                   │
│   - fade: 크로스페이드                                                      │
│   - dissolve: 디졸브                                                        │
│   - wipe: 와이프                                                            │
│                                                                             │
│ 완료 기준: 여러 클립을 하나로 병합                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 3: Upscale Worker

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 4.3: 업스케일 워커                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ workers/upscaleWorker.ts:                                                   │
│ □ 방법 선택                                                                 │
│   - Option A: ComfyUI Real-ESRGAN 노드 사용                                 │
│   - Option B: 별도 Real-ESRGAN 스크립트 실행                                │
│                                                                             │
│ □ 작업 처리 흐름 (ComfyUI 방식)                                             │
│   1. 입력 영상을 프레임으로 분할 (FFmpeg)                                   │
│   2. 업스케일 워크플로우 생성                                               │
│   3. ComfyUI에 배치 처리 요청                                               │
│   4. 진행률 업데이트 (프레임별)                                             │
│   5. 프레임을 영상으로 재조합 (FFmpeg)                                      │
│   6. DB 업데이트                                                            │
│                                                                             │
│ □ 설정 옵션                                                                 │
│   - model: RealESRGAN_x4plus, anime_6B                                      │
│   - scale: 2, 4                                                             │
│                                                                             │
│ 완료 기준: 512x512 → 2048x2048 업스케일                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 4: Interpolate Worker

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 4.4: 프레임 보간 워커                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ workers/interpolateWorker.ts:                                               │
│ □ RIFE 프레임 보간                                                          │
│   - ComfyUI Frame Interpolation 노드 사용                                   │
│                                                                             │
│ □ 작업 처리 흐름                                                            │
│   1. 입력 영상 로드                                                         │
│   2. 보간 워크플로우 생성                                                   │
│      - multiplier: 2 (8fps→16fps), 3 (8fps→24fps), 4 (8fps→32fps)          │
│   3. ComfyUI 실행                                                           │
│   4. 진행률 업데이트                                                        │
│   5. 출력 영상 저장                                                         │
│   6. DB 업데이트                                                            │
│                                                                             │
│ □ 설정 옵션                                                                 │
│   - targetFps: 24, 30, 60                                                   │
│   - model: rife46, rife47                                                   │
│                                                                             │
│ 완료 기준: 8fps → 24fps 변환                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 5: Export Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 4.5: 최종 출력 파이프라인                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ workers/exportWorker.ts:                                                    │
│ □ 파이프라인 오케스트레이션                                                 │
│   1. 설정에 따라 단계 결정                                                  │
│   2. 각 단계를 순차 실행                                                    │
│   3. 단계별 진행률 계산 (전체 %)                                            │
│   4. 중간 파일 관리                                                         │
│   5. 최종 파일 저장                                                         │
│                                                                             │
│ □ 단계 구성                                                                 │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐            │
│   │ Merge   │────▶│ Upscale │────▶│Interpolate───▶│ Encode  │            │
│   │ (25%)   │     │ (25%)   │     │ (25%)   │     │ (25%)   │            │
│   └─────────┘     └─────────┘     └─────────┘     └─────────┘            │
│                                                                             │
│ □ 선택적 단계 스킵                                                          │
│   - merge.enabled: false → 단일 클립 처리                                   │
│   - upscale.enabled: false → 업스케일 스킵                                  │
│   - interpolate.enabled: false → 보간 스킵                                  │
│                                                                             │
│ 완료 기준: 전체 파이프라인 한 번에 실행                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Phase 4 완료 기준

| 항목 | 확인 방법 |
|------|----------|
| 영상 병합 | 3개 클립 이어붙이기 |
| 트랜지션 | 페이드 효과 적용 |
| 업스케일 | 4배 확대 |
| 프레임 보간 | 8fps → 24fps |
| 전체 파이프라인 | Export API 한 번 호출로 완료 |

---

## 7. Phase 5: 프론트엔드 UI (5주차)

### 7.1 일정

| 일차 | 태스크 | 예상 시간 | 산출물 |
|------|--------|----------|--------|
| Day 1 | 공통 컴포넌트 | 4h | Button, Input, Modal 등 |
| Day 2 | 프로젝트 목록/생성 페이지 | 4h | /projects |
| Day 3 | 클립 생성 페이지 | 5h | /projects/[id]/clips/new |
| Day 4 | 클립 관리 페이지 | 5h | /projects/[id]/clips |
| Day 5 | 편집/병합 페이지 | 4h | /projects/[id]/edit |
| Day 6 | 최종 출력 페이지 | 4h | /projects/[id]/export |
| Day 7 | 진행률 모달 및 폴리싱 | 4h | 전체 UI |

### 7.2 상세 태스크

#### Day 1: 공통 컴포넌트

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 5.1: 공통 UI 컴포넌트                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ components/ui/:                                                             │
│ □ Button.tsx - 버튼 (primary, secondary, danger)                            │
│ □ Input.tsx - 텍스트 입력                                                   │
│ □ Textarea.tsx - 다중 행 입력                                               │
│ □ Select.tsx - 드롭다운                                                     │
│ □ Slider.tsx - 슬라이더                                                     │
│ □ Modal.tsx - 모달 다이얼로그                                               │
│ □ Card.tsx - 카드 컨테이너                                                  │
│ □ Progress.tsx - 프로그레스 바                                              │
│ □ Spinner.tsx - 로딩 스피너                                                 │
│ □ Toast.tsx - 알림 토스트                                                   │
│                                                                             │
│ 훅:                                                                         │
│ □ useToast.ts - 토스트 관리                                                 │
│ □ useModal.ts - 모달 관리                                                   │
│                                                                             │
│ 완료 기준: Storybook 또는 테스트 페이지에서 확인                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 3: 클립 생성 페이지

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 5.2: 클립 생성 UI                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ app/(pages)/projects/[projectId]/clips/new/page.tsx:                        │
│ □ 생성 모드 선택                                                            │
│   - Text-to-Video 탭                                                        │
│   - Image-to-Video 탭                                                       │
│                                                                             │
│ □ 프롬프트 입력 영역                                                        │
│   - 긍정 프롬프트 (Textarea)                                                │
│   - 부정 프롬프트 (Textarea)                                                │
│                                                                             │
│ □ 이미지 업로드 (Image-to-Video)                                            │
│   - 드래그 앤 드롭                                                          │
│   - 미리보기                                                                │
│   - IP Adapter 가중치 슬라이더                                              │
│                                                                             │
│ □ 고급 설정 (접이식)                                                        │
│   - Steps 슬라이더 (10-50)                                                  │
│   - CFG Scale 슬라이더 (1-20)                                               │
│   - Frame Count 슬라이더 (16-32)                                            │
│   - Seed 입력 (랜덤 체크박스)                                               │
│                                                                             │
│ □ 생성 버튼                                                                 │
│   - 유효성 검사                                                             │
│   - API 호출                                                                │
│   - 진행률 모달 표시                                                        │
│                                                                             │
│ 완료 기준: 클립 생성 요청 및 진행률 확인                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 4: 클립 관리 페이지

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 5.3: 클립 관리 UI                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ app/(pages)/projects/[projectId]/clips/page.tsx:                            │
│ □ 클립 목록                                                                 │
│   - 그리드/리스트 뷰 전환                                                   │
│   - 썸네일 표시                                                             │
│   - 메타데이터 (이름, 길이, 상태)                                           │
│   - 생성 중 진행률 표시                                                     │
│                                                                             │
│ □ 드래그 앤 드롭 순서 변경                                                  │
│   - @dnd-kit 사용                                                           │
│   - 순서 변경 시 API 호출                                                   │
│   - 낙관적 업데이트                                                         │
│                                                                             │
│ □ 클립 액션                                                                 │
│   - 미리보기 (모달 비디오 플레이어)                                         │
│   - 삭제 (확인 다이얼로그)                                                  │
│   - 재생성                                                                  │
│                                                                             │
│ □ 선택 기능                                                                 │
│   - 다중 선택                                                               │
│   - 선택된 클립 병합 버튼                                                   │
│   - 선택된 클립 내보내기 버튼                                               │
│                                                                             │
│ 완료 기준: 클립 목록 조회, 순서 변경, 삭제                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 6: 최종 출력 페이지

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 5.4: 최종 출력 UI                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ app/(pages)/projects/[projectId]/export/page.tsx:                           │
│ □ 선택된 클립 요약                                                          │
│   - 클립 목록 (순서대로)                                                    │
│   - 총 예상 길이                                                            │
│                                                                             │
│ □ 병합 설정 섹션                                                            │
│   - 활성화 토글                                                             │
│   - 트랜지션 선택                                                           │
│   - 트랜지션 길이                                                           │
│                                                                             │
│ □ 업스케일 설정 섹션                                                        │
│   - 활성화 토글                                                             │
│   - 모델 선택                                                               │
│   - 배율 선택                                                               │
│   - 예상 출력 해상도 표시                                                   │
│                                                                             │
│ □ 프레임 보간 설정 섹션                                                     │
│   - 활성화 토글                                                             │
│   - 목표 FPS 선택                                                           │
│                                                                             │
│ □ 출력 설정 섹션                                                            │
│   - 포맷 선택 (MP4, WebM, GIF)                                              │
│   - 품질 선택                                                               │
│                                                                             │
│ □ 예상 결과 요약                                                            │
│   - 해상도, FPS, 길이, 예상 용량                                            │
│   - 예상 처리 시간                                                          │
│                                                                             │
│ □ 출력 시작 버튼                                                            │
│   - 진행률 모달 표시                                                        │
│   - 단계별 진행 상황                                                        │
│   - 완료 시 다운로드 링크                                                   │
│                                                                             │
│ 완료 기준: 전체 파이프라인 UI에서 실행                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Phase 5 완료 기준

| 항목 | 확인 방법 |
|------|----------|
| 프로젝트 페이지 | 생성, 목록, 삭제 |
| 클립 생성 | 두 가지 모드 동작 |
| 클립 관리 | 드래그 앤 드롭 순서 변경 |
| 진행률 | 실시간 업데이트 |
| 최종 출력 | 전체 UI 플로우 |

---

## 8. Phase 6: 통합 및 테스트 (6주차)

### 8.1 일정

| 일차 | 태스크 | 예상 시간 | 산출물 |
|------|--------|----------|--------|
| Day 1 | E2E 테스트 시나리오 작성 | 3h | 테스트 케이스 |
| Day 2 | 버그 수정 및 안정화 | 5h | 버그 픽스 |
| Day 3 | 성능 최적화 | 4h | 최적화 적용 |
| Day 4 | 에러 핸들링 강화 | 4h | 에러 처리 |
| Day 5 | 배포 환경 구성 | 4h | 프로덕션 설정 |
| Day 6 | 문서화 | 4h | README, 가이드 |
| Day 7 | 최종 테스트 및 릴리스 | 4h | v1.0 릴리스 |

### 8.2 상세 태스크

#### Day 1: E2E 테스트 시나리오

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 6.1: E2E 테스트 시나리오                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ 시나리오 1: 기본 플로우                                                     │
│ □ 프로젝트 생성                                                             │
│ □ Text-to-Video 클립 3개 생성                                               │
│ □ 클립 순서 변경                                                            │
│ □ 클립 병합                                                                 │
│ □ 결과 다운로드                                                             │
│                                                                             │
│ 시나리오 2: Image-to-Video                                                  │
│ □ 이미지 업로드                                                             │
│ □ 클립 생성                                                                 │
│ □ 결과 확인                                                                 │
│                                                                             │
│ 시나리오 3: 전체 파이프라인                                                 │
│ □ 클립 3개 생성                                                             │
│ □ 병합 + 업스케일 + 보간 + 인코딩                                           │
│ □ 진행률 확인                                                               │
│ □ 최종 출력 다운로드                                                        │
│                                                                             │
│ 시나리오 4: 에러 케이스                                                     │
│ □ ComfyUI 연결 실패                                                         │
│ □ 잘못된 프롬프트                                                           │
│ □ 파일 저장 실패                                                            │
│                                                                             │
│ 완료 기준: 모든 시나리오 통과                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Day 5: 배포 환경 구성

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task 6.2: 프로덕션 배포 설정                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ Docker 최적화:                                                              │
│ □ 멀티스테이지 빌드                                                         │
│ □ 이미지 크기 최적화                                                        │
│ □ 환경 변수 분리 (.env.production)                                          │
│                                                                             │
│ 보안 설정:                                                                  │
│ □ CORS 설정                                                                 │
│ □ Rate Limiting                                                             │
│ □ 입력 검증 강화                                                            │
│                                                                             │
│ 모니터링:                                                                   │
│ □ 로깅 설정                                                                 │
│ □ 헬스 체크 엔드포인트                                                      │
│ □ 에러 알림                                                                 │
│                                                                             │
│ 백업:                                                                       │
│ □ DB 백업 스크립트                                                          │
│ □ 파일 백업 전략                                                            │
│                                                                             │
│ 완료 기준: docker-compose -f docker-compose.prod.yml up 실행                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.3 Phase 6 완료 기준

| 항목 | 확인 방법 |
|------|----------|
| E2E 테스트 | 전체 시나리오 통과 |
| 성능 | 클립 생성 1분 이내 |
| 안정성 | 10회 연속 성공 |
| 문서화 | README 완성 |
| 배포 | 프로덕션 환경 동작 |

---

## 9. 리스크 관리

### 9.1 기술적 리스크

| 리스크 | 확률 | 영향 | 대응 방안 |
|--------|------|------|----------|
| ComfyUI API 불안정 | 중 | 높음 | 재시도 로직, 타임아웃 설정 |
| VRAM 부족 | 중 | 높음 | 배치 크기 조절, 순차 처리 |
| 영상 품질 저하 | 낮음 | 중 | 파라미터 튜닝, 모델 교체 |
| FFmpeg 호환성 | 낮음 | 중 | 버전 고정, 테스트 |

### 9.2 일정 리스크

| 리스크 | 확률 | 영향 | 대응 방안 |
|--------|------|------|----------|
| 모델 다운로드 지연 | 중 | 낮음 | 미리 다운로드, 미러 사용 |
| 복잡한 버그 | 중 | 중 | 버퍼 일정 확보 |
| 요구사항 변경 | 낮음 | 중 | MVP 먼저 완성 |

### 9.3 리스크 대응 버퍼

```
각 Phase에 1-2일 버퍼 확보:
• Phase 1: +1일
• Phase 2: +1일
• Phase 3: +2일 (핵심 기능)
• Phase 4: +2일 (핵심 기능)
• Phase 5: +1일
• Phase 6: +1일

총 버퍼: 8일 (약 1.5주)
```

---

## 10. 체크리스트

### 10.1 Phase 1 체크리스트

```
□ ComfyUI 설치 및 실행
□ AnimateDiff 노드 설치
□ VideoHelperSuite 설치
□ IPAdapter 노드 설치
□ 모든 모델 파일 다운로드
□ 테스트 영상 생성 성공
□ Docker Compose 파일 작성
□ MariaDB 컨테이너 실행
□ Redis 컨테이너 실행
□ Next.js 프로젝트 생성
□ 기본 의존성 설치
```

### 10.2 Phase 2 체크리스트

```
□ Prisma 스키마 작성
□ DB 마이그레이션 실행
□ projects API 완성
□ clips API 완성
□ BullMQ 큐 설정
□ Redis 연결 확인
□ 파일명 생성 유틸 완성
□ 스토리지 유틸 완성
□ API 테스트 통과
```

### 10.3 Phase 3 체크리스트

```
□ ComfyUI 클라이언트 완성
□ Text-to-Video 워크플로우 빌더
□ Image-to-Video 워크플로우 빌더
□ Generate Worker 구현
□ 클립 생성 API 완성
□ SSE 진행률 구현
□ 썸네일 생성 기능
□ 파일 저장 테스트
□ 통합 테스트 통과
```

### 10.4 Phase 4 체크리스트

```
□ FFmpeg 래퍼 완성
□ Merge Worker 구현
□ Upscale Worker 구현
□ Interpolate Worker 구현
□ Export Pipeline 구현
□ 병합 API 테스트
□ 업스케일 API 테스트
□ 프레임 보간 API 테스트
□ 전체 파이프라인 테스트
```

### 10.5 Phase 5 체크리스트

```
□ 공통 UI 컴포넌트 완성
□ 프로젝트 목록 페이지
□ 프로젝트 생성 페이지
□ 클립 생성 페이지
□ 클립 관리 페이지
□ 편집/병합 페이지
□ 최종 출력 페이지
□ 진행률 모달
□ 비디오 플레이어
□ 전체 UI 플로우 테스트
```

### 10.6 Phase 6 체크리스트

```
□ E2E 테스트 시나리오 작성
□ 모든 테스트 통과
□ 버그 수정 완료
□ 성능 최적화
□ 에러 핸들링 강화
□ 프로덕션 Docker 설정
□ 환경 변수 정리
□ README 작성
□ 설치 가이드 작성
□ v1.0 릴리스
```

---

## 📊 주간 마일스톤 요약

| 주차 | 마일스톤 | 주요 산출물 |
|------|---------|------------|
| **1주차** | 환경 구축 완료 | ComfyUI 동작, Docker 실행 |
| **2주차** | 백엔드 기반 완료 | API 동작, DB 연결 |
| **3주차** | 클립 생성 완료 | 웹에서 영상 생성 |
| **4주차** | 후처리 완료 | 병합/업스케일/보간 |
| **5주차** | UI 완성 | 전체 프론트엔드 |
| **6주차** | 릴리스 | v1.0 배포 |

---

## 📝 문서 정보

- **작성일**: 2025년 2월 6일
- **프로젝트명**: Video Generator System
- **예상 기간**: 6주
- **기술 스택**: Next.js + MariaDB + ComfyUI

---

> 💡 **팁**: 각 Phase 완료 후 반드시 체크리스트를 확인하고, 다음 Phase로 넘어가기 전에 모든 항목이 완료되었는지 검증하세요.
