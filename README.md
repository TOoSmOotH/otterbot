# Smoothbot

An open-source multi-agent AI orchestration system with voice, 3D visualization, and local-first operation. Chat with a COO agent who manages teams of specialized workers — with every message visible in real-time.

Smoothbot is an alternative to [OpenClaw](https://github.com/openclaw/openclaw) that prioritizes **visibility**, **simplicity**, and **local-first operation**. Instead of opaque agent pipelines, every agent-to-agent message flows through a central bus that the UI observes directly. All data — including API keys, conversations, and settings — stays encrypted on your machine.

## How It Works

You (the **CEO**) chat with a single **COO** agent. The COO breaks your goals into projects, spawns **Team Leads**, who pull **Worker** agents from a registry of specialists. All communication between agents flows through a central message bus — and you can watch it all happen in real-time.

```
CEO (you)
 └── COO (always running)
      └── Team Lead (per project)
           ├── Coder
           ├── Researcher
           ├── Reviewer
           └── Browser Agent
```

The WebUI gives you multiple views into the system:

- **Chat Panel** — your conversation with the COO, with markdown, Mermaid diagrams, and optional voice (TTS/STT)
- **Agent Graph** — live React Flow hierarchy of all running agents
- **Message Stream** — real-time feed of every message on the bus
- **3D Live View** — Three.js visualization of agents with animated character models
- **Room Builder** — interactive 3D scene editor for customizing the live view
- **Settings** — provider configuration, search, TTS/STT, model management

## Quick Start

### Prerequisites

- Node.js >= 20
- pnpm >= 9 (`npm install -g pnpm`)

### Setup

```bash
# Clone and install
git clone https://github.com/TOoSmOotH/smoothbot.git
cd smoothbot
pnpm install

# Configure environment
cp .env.example .env
# Edit .env and set SMOOTHBOT_DB_KEY to a strong secret (used to encrypt the database)

# Push the database schema
pnpm db:push

# Start development servers (backend on :3000, frontend on :5173)
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). On first launch, the **Setup Wizard** will walk you through:

1. Choosing an LLM provider (Anthropic, OpenAI, Ollama, or OpenAI-compatible)
2. Entering your API key and selecting a model
3. Creating your user profile
4. Optionally configuring TTS voice and 3D character model
5. Customizing the COO agent
6. Setting a login passphrase

Once setup completes, you'll be chatting with the COO.

### Docker

```bash
# Build and run in a container
pnpm docker:build
pnpm docker:up

# Or start with the self-hosted SearXNG search engine
pnpm docker:up:search

# Or for development with hot-reload
pnpm docker:dev
```

The container runs Node 22 as a non-root user with Playwright/Chromium and GitHub CLI pre-installed. Data is persisted to `./docker/smoothbot/` (or `$SMOOTHBOT_DATA_DIR`).

## Architecture

### The Message Bus

The central design decision: **every message flows through one bus**. The bus does three things for each message:

1. **Persists** it to SQLite
2. **Routes** it to the target agent
3. **Broadcasts** it to the frontend via Socket.IO

This is why visibility works — the UI is just another consumer of the bus.

### Agent Hierarchy

| Role | Description |
|------|-------------|
| **CEO** | You. The only human in the system. Chats with the COO. |
| **COO** | Always running. Receives goals, spawns Team Leads, manages projects. Has a defined personality: direct, action-biased, no fluff. |
| **Team Lead** | Spawned per project. Queries the registry for workers, assigns tasks, reports to COO. |
| **Worker** | Spawned from registry templates. Executes specific tasks (coding, research, browsing, etc.) and reports back. |

### Agent Registry

The registry contains 10 pre-built agent templates:

| Agent | Capabilities | Tools |
|-------|-------------|-------|
| **COO** | management, delegation, coordination | *(manages other agents)* |
| **Team Lead** | management, planning, coordination | *(manages workers)* |
| **Coder** | code, typescript, python, debugging | file_read, file_write, shell_exec |
| **Researcher** | research, analysis, summarization | web_search, web_browse, file_read |
| **Reviewer** | code-review, testing, quality | file_read |
| **Writer** | writing, documentation, specs | file_read, file_write |
| **Planner** | planning, architecture, decomposition | file_read, file_write |
| **Security Reviewer** | security, code-review, vulnerability-analysis | file_read, shell_exec |
| **Tester** | testing, test-writing, qa, edge-cases | file_read, file_write, shell_exec |
| **Browser Agent** | browser, web-scraping, form-filling, web-interaction | web_browse, file_read, file_write |

Templates are fully customizable — edit the system prompt, model, provider, capabilities, and tools through the Settings UI or the REST API.

### LLM Provider Support

Smoothbot uses the [Vercel AI SDK](https://sdk.vercel.ai/) for multi-provider support. API keys and provider configuration are managed through the **Settings UI** (stored encrypted in the database).

| Provider | Use Case |
|----------|----------|
| **Anthropic** | Claude models (supports extended thinking on Sonnet 4.5+ / Opus 4+) |
| **OpenAI** | GPT models |
| **Ollama** | Local models (Llama, Mistral, etc.) |
| **OpenAI-Compatible** | Together, Groq, LM Studio, vLLM, etc. |

Each agent can use a different provider and model. Override at the template level or per-spawn.

### Workspace Isolation

Each project gets a sandboxed workspace with git worktree support for parallel code work:

```
/smoothbot/projects/<project-id>/
├── repo/                # Main git repository
├── worktrees/           # Per-worker git worktrees
│   ├── <worker-1>/      # Isolated branch for worker 1
│   └── <worker-2>/      # Isolated branch for worker 2
├── shared/              # All agents on this project can read/write
│   ├── specs/
│   ├── docs/
│   └── artifacts/
└── agents/
    ├── <agent-1>/       # Private to agent 1
    └── <agent-2>/       # Private to agent 2
```

Git worktrees allow multiple code workers to operate on the same repository simultaneously without conflicts. Team Leads can merge worker branches and sync changes between them.

## Voice (TTS & STT)

Smoothbot supports optional text-to-speech and speech-to-text, configurable in the Settings UI.

### Text-to-Speech

| Provider | Description |
|----------|-------------|
| **Kokoro** (local) | Runs entirely on-device via `kokoro-js` with ONNX runtime. 68 voices across 9 languages. No API key needed. |
| **OpenAI-compatible** | Any endpoint implementing `/v1/audio/speech` (OpenAI, local alternatives). |

### Speech-to-Text

| Provider | Description |
|----------|-------------|
| **Whisper** (local) | Runs on-device via HuggingFace Transformers. Multiple model sizes from tiny (~75MB) to small (~500MB). |
| **OpenAI-compatible** | Any endpoint implementing `/v1/audio/transcriptions`. |
| **Browser** | Client-side Web Speech API — no server processing. |

## 3D Live View

The Live View renders active agents as animated 3D characters using Three.js / React Three Fiber. Each agent is assigned a model pack (16 available character packs). The **Room Builder** lets you customize the 3D scene with drag-and-drop prop placement, transform controls, and scene persistence.

## Search Providers

Web search is available to agents via the `web_search` tool. Configure your preferred provider in Settings:

| Provider | Description |
|----------|-------------|
| **SearXNG** | Self-hosted, no API key required. Included as an optional Docker Compose profile. |
| **Brave Search** | Requires an API key from [brave.com](https://brave.com/search/api/). |
| **Tavily** | Requires an API key from [tavily.com](https://tavily.com). |

To start SearXNG alongside Smoothbot: `pnpm docker:up:search`

## Authentication & Setup

Smoothbot uses **passphrase-based authentication** with bcrypt hashing and secure session cookies (30-day expiry). On first launch, the Setup Wizard guides you through provider configuration, profile creation, and passphrase setup. All credentials are stored in the encrypted SQLite database (keyed by `SMOOTHBOT_DB_KEY`).

## Project Structure

```
smoothbot/
├── packages/
│   ├── shared/              # @smoothbot/shared — TypeScript types & event contracts
│   ├── server/              # @smoothbot/server — Fastify + Socket.IO backend
│   │   └── src/
│   │       ├── agents/      # COO, Team Lead, Worker + base class
│   │       │   └── prompts/ # System prompts
│   │       ├── auth/        # Passphrase auth & sessions
│   │       ├── bus/         # Central message bus
│   │       ├── db/          # Drizzle ORM schema + seed
│   │       ├── llm/         # Vercel AI SDK adapter (multi-provider)
│   │       ├── models3d/    # 3D model pack discovery
│   │       ├── packages/    # apt/npm package management
│   │       ├── registry/    # Agent template CRUD
│   │       ├── settings/    # Provider & feature settings
│   │       ├── socket/      # Socket.IO event handlers
│   │       ├── stt/         # Speech-to-text providers
│   │       ├── tools/       # Agent tools (file ops, shell, web)
│   │       │   └── search/  # Search provider implementations
│   │       ├── tts/         # Text-to-speech providers
│   │       └── workspace/   # Sandboxed file access + git worktrees
│   └── web/                 # @smoothbot/web — React + Vite frontend
│       └── src/
│           ├── components/
│           │   ├── auth/            # Login screen
│           │   ├── character-select/# 3D model pack picker
│           │   ├── chat/            # CEO ↔ COO chat panel
│           │   ├── graph/           # React Flow agent visualization
│           │   ├── live-view/       # Three.js 3D agent view
│           │   ├── registry/        # Agent template editor
│           │   ├── room-builder/    # 3D scene editor
│           │   ├── settings/        # Provider settings panels
│           │   ├── setup/           # First-run setup wizard
│           │   ├── stream/          # Live message bus feed
│           │   └── ui/              # Shared UI components (shadcn/ui)
│           ├── hooks/               # Socket.IO + utility hooks
│           ├── lib/                 # Utility libraries
│           ├── stores/              # Zustand state management
│           └── types/               # TypeScript types
├── assets/
│   ├── workers/             # 3D character model packs (GLTF)
│   ├── environments/        # 3D environment packs
│   └── scenes/              # Scene configuration files
├── Dockerfile               # Multi-stage production build (Node 22)
└── docker-compose.yml       # Container orchestration + optional SearXNG
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Monorepo | pnpm workspaces |
| Backend | Node.js + TypeScript + Fastify |
| Real-time | Socket.IO |
| Database | Encrypted SQLite via better-sqlite3-multiple-ciphers + Drizzle ORM |
| Frontend | Vite + React + TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Agent Graph | React Flow (@xyflow/react) |
| 3D Rendering | Three.js + React Three Fiber + Drei |
| Markdown | React Markdown + Mermaid diagrams |
| State | Zustand |
| LLM | Vercel AI SDK (Anthropic, OpenAI, Ollama, OpenAI-compatible) |
| TTS | Kokoro.js (local) + OpenAI-compatible |
| STT | HuggingFace Transformers / Whisper (local) + OpenAI-compatible + Browser Web Speech API |
| Browser Automation | Playwright (Chromium) |
| Testing | Vitest (unit) + Playwright (e2e) |

## Available Scripts

```bash
# Development
pnpm dev              # Start server (:3000) and web (:5173)
pnpm dev:server       # Server only
pnpm dev:web          # Frontend only

# Build
pnpm build            # Build all packages

# Test
pnpm test             # Run unit tests (Vitest)
pnpm test:watch       # Run tests in watch mode
pnpm test:e2e         # Run Playwright e2e tests

# Lint
pnpm lint             # Lint all packages

# Database
pnpm db:push          # Push schema to database
pnpm db:seed          # Seed registry with default agent templates

# Docker
pnpm docker:build     # Build container image
pnpm docker:up        # Start container (detached)
pnpm docker:down      # Stop container
pnpm docker:dev       # Start with hot-reload (dev mode)
pnpm docker:up:search # Start with SearXNG search engine
```

## Environment Variables

Create a `.env` file from the example:

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SMOOTHBOT_DB_KEY` | **Yes** | — | Encryption key for the SQLite database |
| `PORT` | | `3000` | Server port |
| `HOST` | | `0.0.0.0` | Server bind host |
| `DATABASE_URL` | | `file:./data/smoothbot.db` | SQLite database path |
| `WORKSPACE_ROOT` | | `./data` | Root directory for agent workspaces |
| `SMOOTHBOT_UID` | | `1000` | Docker container user ID |
| `SMOOTHBOT_GID` | | `1000` | Docker container group ID |
| `SMOOTHBOT_DATA_DIR` | | `./docker/smoothbot` | Docker host data directory |

> **Note:** LLM API keys, search provider keys, TTS/STT configuration, and model preferences are all managed through the **Settings UI** and stored in the encrypted database — not in environment variables.

## REST API

### Public Endpoints

```
# Setup
GET    /api/setup/status               # Check if setup is complete
POST   /api/setup/probe-models          # Probe LLM provider for available models
POST   /api/setup/tts-preview           # Preview a TTS voice
POST   /api/setup/complete              # Complete the setup wizard

# Auth
POST   /api/auth/login                  # Login with passphrase
POST   /api/auth/logout                 # Logout
GET    /api/auth/check                  # Check auth status

# Assets (public)
GET    /api/model-packs                 # List 3D character model packs
GET    /api/environment-packs           # List 3D environment packs
GET    /api/scenes                      # List scene configurations
```

### Protected Endpoints (require authentication)

```
# Registry
GET    /api/registry                    # List all agent templates
GET    /api/registry/:id                # Get a specific template
POST   /api/registry                    # Create a new template
POST   /api/registry/:id/clone          # Clone a template
PATCH  /api/registry/:id                # Update a template
DELETE /api/registry/:id                # Delete a template

# Messages & Agents
GET    /api/messages                    # Message history (?projectId=&agentId=&limit=)
GET    /api/conversations               # List conversations
GET    /api/agents                      # List active agents

# Packages
GET    /api/packages                    # List installed packages (apt/npm/repos)
POST   /api/packages                    # Install a package
DELETE /api/packages                    # Uninstall a package

# Scenes & Profile
PUT    /api/scenes/:id                  # Save a scene configuration
GET    /api/profile                     # Get user profile
PUT    /api/profile/model-pack          # Update user 3D model pack

# Settings — LLM Providers
GET    /api/settings                    # Get provider settings
PUT    /api/settings/provider/:id       # Update provider config
PUT    /api/settings/defaults           # Update tier defaults (COO/TL/Worker models)
POST   /api/settings/provider/:id/test  # Test a provider connection
GET    /api/settings/models/:id         # Fetch available models from a provider

# Settings — Search
GET    /api/settings/search                    # Get search settings
PUT    /api/settings/search/provider/:id       # Update search provider
PUT    /api/settings/search/active             # Set active search provider
POST   /api/settings/search/provider/:id/test  # Test search provider

# Settings — TTS
GET    /api/settings/tts                       # Get TTS settings
PUT    /api/settings/tts/enabled               # Enable/disable TTS
PUT    /api/settings/tts/active                # Set active TTS provider
PUT    /api/settings/tts/voice                 # Set voice
PUT    /api/settings/tts/speed                 # Set speed
PUT    /api/settings/tts/provider/:id          # Update TTS provider config
POST   /api/settings/tts/provider/:id/test     # Test TTS provider
POST   /api/settings/tts/preview               # Preview voice

# Settings — STT
GET    /api/settings/stt                       # Get STT settings
PUT    /api/settings/stt/enabled               # Enable/disable STT
PUT    /api/settings/stt/active                # Set active STT provider
PUT    /api/settings/stt/language              # Set language
PUT    /api/settings/stt/model                 # Set Whisper model
PUT    /api/settings/stt/provider/:id          # Update STT provider config
POST   /api/settings/stt/provider/:id/test     # Test STT provider

# Transcription
POST   /api/stt/transcribe                     # Transcribe audio
```

## Socket.IO Events

**Server to Client:**
- `agent:spawned` — new agent created
- `agent:status` — agent status change (idle/thinking/acting/done/error)
- `agent:destroyed` — agent removed
- `bus:message` — any message on the bus
- `coo:response` — COO's response to the CEO
- `coo:stream` — streaming token from COO
- `coo:thinking` — extended thinking token (Anthropic models)
- `coo:thinking-end` — extended thinking complete
- `coo:audio` — TTS audio for COO response
- `conversation:created` — new conversation started

**Client to Server:**
- `ceo:message` — send a message to the COO
- `ceo:new-chat` — start a new conversation
- `ceo:list-conversations` — request conversation list
- `ceo:load-conversation` — load a specific conversation
- `registry:list` — request registry entries
- `agent:inspect` — request details about a specific agent

## License

MIT — Copyright 2026 Mike Reeves
