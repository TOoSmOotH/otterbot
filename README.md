# Otterbot

An open-source multi-agent AI orchestration system with voice, 3D visualization, coding agent integrations, desktop automation, and local-first operation. Chat with a COO agent who manages teams of specialized workers — with every message visible in real-time.

Otterbot is an alternative to [OpenClaw](https://github.com/openclaw/openclaw) that prioritizes **visibility**, **simplicity**, and **local-first operation**. Instead of opaque agent pipelines, every agent-to-agent message flows through a central bus that the UI observes directly. All data — including API keys, conversations, and settings — stays encrypted on your machine.

## How It Works

You (the **CEO**) chat with a single **COO** agent. The COO breaks your goals into projects, spawns **Team Leads**, who pull **Worker** agents from a registry of 14 specialists. An **Admin Assistant** handles personal productivity (todos, email, calendar). All communication flows through a central message bus — and you can watch it all happen in real-time.

```
CEO (you)
 ├── COO (always running)
 │    └── Team Lead (per project)
 │         ├── Coder
 │         ├── Researcher
 │         ├── OpenCode Coder
 │         ├── Claude Code Coder
 │         └── Browser Agent
 └── Admin Assistant (personal productivity)
```

The WebUI is a three-panel layout:

- **Left Panel** — project list, conversation history, and navigation
- **Center Panel** — switches between 15+ views: Dashboard, Chat, Kanban board, Calendar, Inbox, Todos, Code (coding agent terminals), Desktop (virtual XFCE), Agent Graph, Message Stream, 3D Live View, Room Builder, Files, Usage analytics, and Settings
- **Right Panel** — agent inspector, activity feed, and context-sensitive details

The chat panel supports markdown, Mermaid diagrams, and optional voice (TTS/STT).

## Quick Start

The fastest way to get Otterbot running. The install script handles Docker detection, generates config files, and starts the container.

### Linux / macOS

```bash
curl -fsSL https://otterbot.ai/install.sh | sh
```

### Windows (PowerShell)

```powershell
irm https://otterbot.ai/install.ps1 | iex
```

This will:
1. Check for Docker (and offer to install it if missing)
2. Create `~/otterbot/` with a `docker-compose.yml` and `.env` (auto-generated DB encryption key)
3. Pull the latest image and start the container
4. Print the URL: **https://localhost:62626**

On first launch, the **Setup Wizard** walks you through choosing an LLM provider, entering your API key, creating your profile, and setting a login passphrase.

**Flags:** `--beta` (use beta channel), `--dir <path>` (custom install directory), `--no-start` (generate files only)

### Docker (manual)

If you prefer to set things up yourself:

```bash
docker run -d -p 62626:62626 --name otterbot \
  -e OTTERBOT_DB_KEY=$(openssl rand -hex 16) \
  -v ~/otterbot:/otterbot \
  --shm-size 256m \
  ghcr.io/toosmooth/otterbot:latest
```

The container runs Node 22 as a non-root user with a full development environment pre-installed:

- **Languages**: Go, Rust, Python, Java, Ruby
- **Desktop**: XFCE + Xvfb + x11vnc + noVNC (virtual desktop viewable in the web UI)
- **Browser**: Playwright with Chromium (headed mode when desktop is enabled)
- **CLI tools**: GitHub CLI, coding agent CLIs (OpenCode, Claude Code, Codex)

### Container Images

Pre-built images are published to GitHub Container Registry:

```bash
# Stable release
docker pull ghcr.io/toosmooth/otterbot:latest

# Beta / pre-release
docker pull ghcr.io/toosmooth/otterbot:beta

# Specific version (e.g. v0.4.0)
docker pull ghcr.io/toosmooth/otterbot:v0.4.0
```

### From Source (development)

```bash
git clone https://github.com/TOoSmOotH/otterbot.git
cd otterbot
pnpm install
cp .env.example .env   # edit .env and set OTTERBOT_DB_KEY
pnpm db:push
pnpm dev               # backend on :62626, frontend on :5173
```

## Contributing

### Branching Strategy

Otterbot uses a three-branch promotion model:

```
dev → beta → main
```

| Branch | Purpose | Protection | Container Tag |
|--------|---------|------------|---------------|
| `dev` | Integration / daily work | None (push freely) | — |
| `beta` | Pre-release testing | PRs required, CI must pass | `:beta`, `:vX.Y.Z-beta.N` |
| `main` | Stable releases | PRs required, CI must pass | `:latest`, `:vX.Y.Z` |

### Development Workflow

1. **Push your changes to `dev`** — CI runs tests and build automatically.
2. **Open a PR from `dev` → `beta`** — once CI passes, merge it. Release-please will create a release PR with a changelog and pre-release version bump.
3. **Merge the release PR on `beta`** — this publishes a `:beta` container image to GHCR.
4. **Open a PR from `beta` → `main`** — once CI passes, merge it. Release-please will create a release PR with a stable version bump.
5. **Merge the release PR on `main`** — this publishes the `:latest` container image to GHCR.

### Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/) for automated versioning:

- `fix: ...` → patch bump (0.1.0 → 0.1.1)
- `feat: ...` → minor bump (0.1.0 → 0.2.0)
- `feat!: ...` or `BREAKING CHANGE:` → major bump (0.1.0 → 1.0.0)

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
| **Admin Assistant** | Always running. Handles personal productivity — todos, reminders, email (Gmail), and calendar. Operates outside of projects. |
| **Team Lead** | Spawned per project. Queries the registry for workers, assigns tasks, reports to COO. |
| **Worker** | Spawned from registry templates. Executes specific tasks (coding, research, browsing, etc.) and reports back. |

### Agent Registry

The registry contains 14 pre-built agent templates:

| Agent | Description |
|-------|-------------|
| **COO** | Receives goals from the CEO and delegates to Team Leads |
| **Team Lead** | Manages a team of workers for a project, breaks directives into tasks |
| **Coder** | Writes and edits code, proficient in multiple languages |
| **Researcher** | Gathers information, analyzes options, provides findings |
| **Reviewer** | Reviews code and plans for quality and correctness |
| **Writer** | Writes documentation, specifications, and prose |
| **Planner** | Breaks down goals into tasks, designs project architecture |
| **Security Reviewer** | Audits code for vulnerabilities and dependency risks |
| **Tester** | Writes and runs tests, identifies edge cases |
| **OpenCode Coder** | Delegates complex coding tasks to OpenCode (autonomous AI coding agent) |
| **Claude Code Coder** | Delegates coding tasks to Claude Code (Anthropic's coding agent) |
| **Codex Coder** | Delegates coding tasks to Codex CLI (OpenAI's coding agent) |
| **Browser Agent** | Interacts with web pages — navigate, fill forms, click, extract text |
| **Tool Builder** | Creates custom JavaScript tools that extend agent capabilities |

Templates are fully customizable — edit the system prompt, model, provider, capabilities, and tools through the Settings UI or the REST API.

### LLM Provider Support

Otterbot uses the [Vercel AI SDK](https://sdk.vercel.ai/) for multi-provider support. API keys and provider configuration are managed through the **Settings UI** (stored encrypted in the database).

| Provider | Use Case |
|----------|----------|
| **Anthropic** | Claude models (supports extended thinking on Sonnet 4.5+ / Opus 4+) |
| **OpenAI** | GPT models (GPT-4o, o3, etc.) |
| **Google Gemini** | Gemini models (Gemini 2.5, 2.0, etc.) |
| **Ollama** | Local models (Llama, Mistral, Codellama, Qwen, etc.) |
| **OpenRouter** | Aggregated access to 200+ models from multiple providers |
| **GitHub Copilot** | Access Claude and OpenAI models via GitHub Copilot API |
| **Hugging Face** | Access models hosted on Hugging Face Inference API (Llama, Mistral, Phi, Qwen) |
| **NVIDIA** | Access models via NVIDIA API (Llama, Mistral) |
| **OpenAI-Compatible** | Any OpenAI-compatible endpoint — Together, Groq, LM Studio, vLLM, etc. |

Each agent can use a different provider and model. Override at the template level or per-spawn.

### Chat Provider Support

Otterbot bridges conversations from external messaging platforms to the COO. Configure providers in the **Settings UI**, pair users, and route messages seamlessly.

| Provider | Description |
|----------|-------------|
| **Discord** | Bridge via Discord bot — pair users, route messages to/from the COO |
| **Slack** | Bridge via Slack app (Bolt SDK) — thread support, user pairing |
| **Matrix** | Federated chat bridge via matrix-js-sdk — supports end-to-end encryption (E2EE) |
| **IRC** | Bridge to IRC networks via irc-framework — TLS support, multi-channel |
| **Microsoft Teams** | Bridge via Bot Framework SDK — tenant-based configuration, user pairing |

### Workspace Isolation

Each project gets a sandboxed workspace:

```
/otterbot/projects/<project-id>/
├── repo/                # Project repository — all code workers write here directly
├── shared/              # All agents on this project can read/write
│   ├── specs/
│   ├── docs/
│   └── artifacts/
└── agents/
    ├── <agent-1>/       # Private to agent 1
    └── <agent-2>/       # Private to agent 2
```

All code workers operate directly in the `repo/` directory. The Team Lead coordinates task ordering to avoid conflicts.

## Voice (TTS & STT)

Otterbot supports optional text-to-speech and speech-to-text, configurable in the Settings UI.

### Text-to-Speech

| Provider | Description |
|----------|-------------|
| **Kokoro** (local) | Runs entirely on-device via `kokoro-js` with ONNX runtime. 68 voices across 9 languages. No API key needed. |
| **Edge TTS** (cloud) | Microsoft neural TTS — free, no API key needed. High-quality voices with rate control. |
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
| **DuckDuckGo** | Free, no API key required. Good default for getting started. |
| **SearXNG** | Self-hosted, no API key required. Use `pnpm docker:up:search` to start alongside Otterbot. |
| **Brave Search** | Requires an API key from [brave.com](https://brave.com/search/api/). |
| **Tavily** | Requires an API key from [tavily.com](https://tavily.com). |

## Integrations

### Google Calendar & Gmail

Connect your Google account via OAuth in Settings. Once connected:

- **Calendar panel** — view and manage events from Google Calendar
- **Inbox panel** — browse, read, send, reply to, and archive Gmail messages
- **Agent tools** — the Admin Assistant (and workers with the right skills) can read/send email, create/update calendar events, and manage labels

### Chat Bridges (Discord, Slack, Matrix, IRC, Teams)

Bridge conversations from external messaging platforms to the COO:

- **Discord** — configure your bot token, approve pairing requests, route messages to/from the COO
- **Slack** — connect via Slack app with bot token and signing secret, supports threaded conversations
- **Matrix** — connect to any Matrix homeserver with optional end-to-end encryption (E2EE)
- **IRC** — connect to IRC networks with TLS support and multi-channel routing
- **Microsoft Teams** — connect via Bot Framework with app ID/password and tenant configuration

Each bridge supports user pairing — only approved users can interact with the COO through the platform.

### GitHub

Projects can be linked to GitHub repositories. Configure your Personal Access Token (PAT) and optional SSH key in the **Settings UI** under the GitHub tab.

#### Authentication

| Method | Description |
|--------|-------------|
| **Personal Access Token (PAT)** | HTTPS-based authentication. Required scopes: `repo`, `read:org`, `workflow`. Username is auto-detected from the token. |
| **SSH Key** | Generate an Ed25519 or RSA key pair directly in Settings, or import an existing private key. Stored at `~/.ssh/otterbot_github`. |
| **Commit Signing** | When an SSH key is configured, git commits are automatically signed using SSH-based GPG signing. |

Authentication is tried in order: HTTPS+PAT first, then SSH fallback.

#### Project Linking

When creating a project, you can link it to a GitHub repository:

- **Repository** — `owner/repo` format (e.g. `TOoSmOotH/otterbot`)
- **Target branch** — the branch agents push to and open PRs against (auto-detected from the repo default branch if not specified)
- **Fork mode** — if the authenticated user lacks push access to the repo, Otterbot automatically creates a fork and uses cross-fork PRs (`forkowner:branch` format)

#### Issue Monitoring

Enable per-project to automatically poll for new GitHub issues:

- Polls every 5 minutes for issues assigned to the configured GitHub username
- Creates kanban tasks in the project's backlog for each new assigned issue
- Posts an acknowledgement comment on the GitHub issue
- Syncs task state when issues are closed (completed → done, not planned → removed)

#### Pipeline (Automated Triage & Implementation)

When the pipeline is enabled for a project, issue monitoring gains additional automation:

| Stage | Description |
|-------|-------------|
| **Triage** | LLM-based classification of new issues (bug, feature, enhancement, user-error, duplicate, question, documentation). Posts a triage comment and applies labels. Re-triages when new non-bot comments appear. |
| **Coder** | Creates a feature branch, implements the solution, and commits changes. |
| **Security Reviewer** | Audits the implementation for vulnerabilities and security risks. Can kick back to the Coder. |
| **Tester** | Writes and runs tests to validate the implementation. |
| **Code Reviewer** | Reviews code quality and correctness, then creates the pull request. |

Each stage can be independently enabled/disabled and assigned a specific agent template.

#### PR Monitoring

Open pull requests linked to kanban tasks are automatically monitored:

- **Review feedback** — when a reviewer requests changes, the task is moved back to in-progress and a worker is spawned to address the feedback on the existing branch
- **CI failure detection** — when CI checks fail on a PR's HEAD commit, a worker is spawned to investigate and fix the failures
- **Auto-merge queue** — when a PR receives an approval review, it is automatically enqueued for merge. The merge queue rebases branches, waits for CI, and merges (squash by default).

#### Merge Queue

The merge queue processes approved PRs in FIFO order:

- Rebases each PR branch onto the target branch before merging
- Waits for CI checks to pass after rebase
- Merges via the GitHub API (squash merge by default)
- Moves the kanban task to done on successful merge

#### Agent Tools

Agents with GitHub skills have access to the following tools:

| Tool | Description |
|------|-------------|
| `github_get_issue` | Fetch an issue by number, including all comments |
| `github_list_issues` | List issues with filters (state, labels, assignee) |
| `github_get_pr` | Fetch a pull request by number, including comments |
| `github_list_prs` | List pull requests with filters (state) |
| `github_comment` | Post a comment on an issue or pull request |
| `github_create_pr` | Create a pull request (target branch is determined by project config) |

#### REST API & Settings

```
# GitHub settings
GET    /api/settings/github                  # Get GitHub settings (enabled, token status, username, SSH key info)
PUT    /api/settings/github                  # Update GitHub settings (enable/disable, set token)
POST   /api/settings/github/test             # Test GitHub PAT connection

# SSH key management
POST   /api/settings/github/ssh/generate     # Generate a new SSH key pair (Ed25519 or RSA)
POST   /api/settings/github/ssh/import       # Import an existing SSH private key
GET    /api/settings/github/ssh/public-key   # Get the public key (for adding to GitHub)
DELETE /api/settings/github/ssh              # Remove the SSH key pair
POST   /api/settings/github/ssh/test         # Test SSH connection to GitHub
```

## Coding Agents

Otterbot integrates with external AI coding agents that run in PTY terminals:

| Agent | Description |
|-------|-------------|
| **OpenCode** | Open-source coding agent — multi-file implementations, refactoring |
| **Claude Code** | Anthropic's coding agent — complex implementations, code review |
| **Codex CLI** | OpenAI's coding agent — code generation, implementation tasks |

When a coding agent worker is spawned, it opens a PTY terminal session. The **Code panel** in the UI shows real-time terminal output, supports interactive input, and displays file diffs when sessions complete. Coding agents are pre-installed in the Docker image.

## Desktop Environment

The Docker container includes a virtual XFCE desktop accessible via noVNC:

- **XFCE + Xvfb + x11vnc** — full desktop environment running headlessly
- **noVNC** — view the desktop directly in Otterbot's **Desktop panel** (or pop it out to a separate window)
- **Headed Playwright** — when the desktop is enabled, the Browser Agent runs Chromium in visible mode so you can watch it browse

Enable with `ENABLE_DESKTOP=true` in `.env`. Configure resolution with `DESKTOP_RESOLUTION` (default: `1280x720x24`).

## Skills & Memory

### Skills

Skills are markdown-based system prompt fragments that define specialized behaviors for agents:

- Each skill specifies a name, description, required tools, and a markdown body with instructions
- Skills are assigned to agent registry entries — when an agent spawns, its skills' tools and prompts are merged in
- Create, edit, import/export, and clone skills through the Settings UI or REST API

### Memory

Agents can store and retrieve memories for long-term context:

- **Episodic memory** — save observations, decisions, and lessons learned with semantic categories
- **Semantic search** — retrieve relevant memories by natural language query
- **Scoped access** — memories can be global, scoped to an agent type, or scoped to a project

### Soul Documents

Soul documents define agent personality and behavioral guidelines:

- Assign personality documents to specific agent roles or individual registry entries
- The system can suggest soul document improvements based on conversation patterns

## Custom Tools

The **Tool Builder** agent can create custom JavaScript tools at runtime:

- Define tool name, description, parameters, and async JavaScript code
- Tools are stored in the database and available to all agents
- Test tools interactively before deploying them
- Create tools via the Tool Builder agent, the REST API, or the Settings UI

## Authentication & Setup

Otterbot uses **passphrase-based authentication** with scrypt hashing and secure session cookies (7-day expiry). On first launch, the Setup Wizard guides you through provider configuration, profile creation, and passphrase setup. All credentials are stored in the encrypted SQLite database (keyed by `OTTERBOT_DB_KEY`).

## Project Structure

```
otterbot/
├── packages/
│   ├── shared/              # @otterbot/shared — TypeScript types & event contracts
│   ├── server/              # @otterbot/server — Fastify + Socket.IO backend
│   │   └── src/
│   │       ├── agents/      # COO, Admin Assistant, Team Lead, Worker + base class
│   │       │   └── prompts/ # System prompts
│   │       ├── auth/        # Passphrase auth & sessions
│   │       ├── backup/      # Database backup/restore
│   │       ├── bus/         # Central message bus
│   │       ├── calendar/    # Calendar integration
│   │       ├── coding-agents/ # Coding agent PTY management
│   │       ├── db/          # Drizzle ORM schema + seed
│   │       ├── desktop/     # Virtual desktop (XFCE/noVNC)
│   │       ├── chat/         # Chat provider interface & registry
│   │       ├── discord/     # Discord bot integration
│   │       ├── github/      # GitHub API + issue monitoring
│   │       ├── google/      # Google OAuth + Gmail/Calendar APIs
│   │       ├── irc/         # IRC bridge integration
│   │       ├── matrix/      # Matrix bridge integration
│   │       ├── llm/         # Vercel AI SDK adapter (multi-provider)
│   │       ├── memory/      # Episodic memory + semantic search
│   │       ├── models3d/    # 3D model pack discovery
│   │       ├── modules/     # Module system (installable extensions)
│   │       ├── opencode/    # OpenCode agent integration
│   │       ├── packages/    # apt/npm package management
│   │       ├── registry/    # Agent template CRUD
│   │       ├── reminders/   # Todo reminder scheduler
│   │       ├── schedulers/  # Scheduled task runners
│   │       ├── settings/    # Provider & feature settings
│   │       ├── slack/       # Slack bridge integration
│   │       ├── skills/      # Skill management
│   │       ├── socket/      # Socket.IO event handlers
│   │       ├── stt/         # Speech-to-text providers
│   │       ├── teams/       # Microsoft Teams bridge integration
│   │       ├── todos/       # Todo management
│   │       ├── tools/       # Agent tools (35+ built-in)
│   │       │   └── search/  # Search provider implementations
│   │       ├── tts/         # Text-to-speech providers
│   │       ├── utils/       # Shared utilities
│   │       └── workspace/   # Sandboxed file access
│   └── web/                 # @otterbot/web — React + Vite frontend
│       └── src/
│           ├── components/
│           │   ├── auth/            # Login screen
│           │   ├── calendar/        # Google Calendar panel
│           │   ├── character-select/# 3D model pack picker
│           │   ├── chat/            # CEO ↔ COO chat panel
│           │   ├── code/            # Coding agent terminal view
│           │   ├── dashboard/       # Project dashboard
│           │   ├── desktop/         # Virtual desktop (noVNC)
│           │   ├── graph/           # React Flow agent visualization
│           │   ├── inbox/           # Gmail inbox panel
│           │   ├── kanban/          # Kanban board (project tasks)
│           │   ├── live-view/       # Three.js 3D agent view
│           │   ├── project/         # Project management
│           │   ├── registry/        # Agent template editor
│           │   ├── room-builder/    # 3D scene editor
│           │   ├── settings/        # Provider settings panels
│           │   ├── setup/           # First-run setup wizard
│           │   ├── stream/          # Live message bus feed
│           │   ├── todos/           # Todo list panel
│           │   └── usage/           # Usage analytics panel
│           ├── hooks/               # Socket.IO + utility hooks
│           ├── lib/                 # Utility libraries
│           ├── stores/              # Zustand state management
│           └── types/               # TypeScript types
├── modules/                 # Installable extension modules
├── assets/
│   ├── workers/             # 3D character model packs (GLTF)
│   ├── environments/        # 3D environment packs
│   └── scenes/              # Scene configuration files
├── Dockerfile               # Multi-stage production build (Node 22)
└── docker-compose.yml       # Container orchestration
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
| LLM | Vercel AI SDK (Anthropic, OpenAI, Google Gemini, Ollama, OpenRouter, GitHub Copilot, Hugging Face, NVIDIA, OpenAI-compatible) |
| Chat Bridges | Discord, Slack, Matrix, IRC, Microsoft Teams |
| TTS | Kokoro.js (local) + Edge TTS + OpenAI-compatible |
| STT | HuggingFace Transformers / Whisper (local) + OpenAI-compatible + Browser Web Speech API |
| Browser Automation | Playwright (Chromium — headed or headless) |
| Coding Agents | OpenCode, Claude Code, Codex CLI via node-pty |
| Desktop | XFCE + Xvfb + x11vnc + noVNC |
| Modules | Installable extension system |
| Testing | Vitest (unit) + Playwright (e2e) |

## Available Scripts

```bash
# Development
pnpm dev              # Start server (:62626) and web (:5173)
pnpm dev:server       # Server only
pnpm dev:web          # Frontend only

# Build
pnpm build            # Build all packages

# Test
pnpm test             # Run unit tests (Vitest)
pnpm test:watch       # Run tests in watch mode
pnpm test:e2e         # Run Playwright e2e tests
pnpm test:e2e:docker  # Run e2e tests in Docker (build + run + teardown)

# Lint
pnpm lint             # Lint all packages

# Database
pnpm db:push          # Push schema to database
pnpm db:seed          # Seed registry with default agent templates

# Docker
pnpm docker:build     # Build container image
pnpm docker:up        # Start container (detached)
pnpm docker:up:search # Start container + SearXNG search engine
pnpm docker:down      # Stop container
pnpm docker:dev       # Start with hot-reload (dev mode)
```

## Environment Variables

Create a `.env` file from the example:

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OTTERBOT_DB_KEY` | **Yes** | — | Encryption key for the SQLite database |
| `PORT` | | `62626` | Server port |
| `HOST` | | `0.0.0.0` | Server bind host |
| `DATABASE_URL` | | `file:./data/otterbot.db` | SQLite database path |
| `WORKSPACE_ROOT` | | `./data` | Root directory for agent workspaces |
| `ENABLE_DESKTOP` | | `true` | Enable the virtual XFCE desktop |
| `DESKTOP_RESOLUTION` | | `1280x720x24` | Virtual desktop resolution |
| `SUDO_MODE` | | `restricted` | `restricted` or `full` (unrestricted sudo) |
| `OTTERBOT_ALLOWED_ORIGIN` | | *(same-origin)* | Comma-separated CORS origins |
| `OTTERBOT_UID` | | `1000` | Docker container user ID |
| `OTTERBOT_GID` | | `1000` | Docker container group ID |
| `OTTERBOT_DATA_DIR` | | `./docker/otterbot` | Docker host data directory |

> **Note:** LLM API keys, search provider keys, TTS/STT configuration, and model preferences are all managed through the **Settings UI** and stored in the encrypted database — not in environment variables.

> **Persistent home directory:** The container's HOME is set to `/otterbot/home` (inside the bind mount). Place SSH keys at `$OTTERBOT_DATA_DIR/home/.ssh/`, Git config at `home/.gitconfig`, etc.

> **Bootstrap script:** Create `$OTTERBOT_DATA_DIR/config/bootstrap.sh` to install OS packages or tools at container startup. The script runs as root on every start — `apt-get` and `npm install -g` both work.

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

# Projects
POST   /api/projects                    # Create a project manually

# Packages
GET    /api/packages                    # List installed packages (apt/npm/repos)
POST   /api/packages                    # Install a package
DELETE /api/packages                    # Uninstall a package

# Todos
GET    /api/todos                       # List all todos
POST   /api/todos                       # Create a todo
PUT    /api/todos/:id                   # Update a todo
DELETE /api/todos/:id                   # Delete a todo

# Custom Tools
GET    /api/tools                       # List custom tools
GET    /api/tools/:id                   # Get a specific tool
GET    /api/tools/available             # List all available tool names
GET    /api/tools/examples              # Get tool examples
POST   /api/tools                       # Create a custom tool
POST   /api/tools/ai-generate           # AI-generate a tool
POST   /api/tools/:id                   # Execute a tool
PATCH  /api/tools/:id                   # Update a custom tool
DELETE /api/tools/:id                   # Delete a custom tool

# Skills
GET    /api/skills                      # List all skills
GET    /api/skills/:id                  # Get a specific skill
GET    /api/skills/:id/export           # Export a skill
POST   /api/skills                      # Create a skill
POST   /api/skills/:id/clone            # Clone a skill
POST   /api/skills/import               # Import a skill
POST   /api/skills/scan                 # Scan for skills
PUT    /api/skills/:id                  # Update a skill
DELETE /api/skills/:id                  # Delete a skill

# Usage Analytics
GET    /api/usage/summary               # Usage summary
GET    /api/usage/recent                # Recent usage
GET    /api/usage/by-model              # Usage by model
GET    /api/usage/by-agent              # Usage by agent

# Scenes & Profile
PUT    /api/scenes/:id                  # Save a scene configuration
GET    /api/profile                     # Get user profile
PUT    /api/profile/model-pack          # Update user 3D model pack

# Desktop
GET    /api/desktop/status              # Desktop environment status

# Google (Calendar & Gmail)
GET    /api/settings/google             # Get Google settings
PUT    /api/settings/google             # Update Google settings
POST   /api/settings/google/oauth/begin # Start OAuth flow
POST   /api/settings/google/disconnect  # Disconnect Google account
GET    /api/calendar/events             # List calendar events
POST   /api/calendar/events             # Create a calendar event
PUT    /api/calendar/events/:id         # Update a calendar event
DELETE /api/calendar/events/:id         # Delete a calendar event
GET    /api/gmail/labels                # List Gmail labels
GET    /api/gmail/messages              # List Gmail messages
GET    /api/gmail/messages/:id          # Read a Gmail message
POST   /api/gmail/send                  # Send an email
POST   /api/gmail/messages/:id/archive  # Archive a message

# Discord
GET    /api/settings/discord                  # Get Discord settings
PUT    /api/settings/discord                  # Update Discord settings
POST   /api/settings/discord/test             # Test Discord connection
POST   /api/settings/discord/pair/approve     # Approve pairing request
POST   /api/settings/discord/pair/reject      # Reject pairing request
DELETE /api/settings/discord/pair/:userId      # Remove a paired user

# Settings — LLM Providers
GET    /api/settings                    # Get provider settings
GET    /api/settings/providers          # List all providers
POST   /api/settings/providers          # Add a provider
PUT    /api/settings/providers/:id      # Update provider config
DELETE /api/settings/providers/:id      # Delete a provider
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

# Settings — Scheduled Tasks
GET    /api/settings/custom-tasks              # List scheduled tasks
POST   /api/settings/custom-tasks              # Create a scheduled task
PUT    /api/settings/custom-tasks/:id          # Update a scheduled task
DELETE /api/settings/custom-tasks/:id          # Delete a scheduled task

# Settings — Model Pricing
GET    /api/settings/pricing                   # Get model pricing config
PUT    /api/settings/pricing/:model            # Update pricing for a model

# Settings — Backup
GET    /api/settings/backup                    # Download database backup
POST   /api/settings/restore                   # Restore from backup

# Modules
GET    /api/modules                            # List installed modules
POST   /api/modules/install                    # Install a module
POST   /api/modules/:id/toggle                 # Enable/disable a module
DELETE /api/modules/:id                        # Remove a module
POST   /api/modules/:moduleId/webhook          # Module webhook endpoint

# Transcription
POST   /api/stt/transcribe                     # Transcribe audio
```

### Updating User Email Settings

Otterbot is a single-user system. To update the user's email configuration (IMAP/SMTP), use the `PUT /api/settings/email` endpoint. After updating, you can verify the connection with `POST /api/settings/email/test`.

#### Authentication

All protected endpoints require a session cookie (`sb_session`) obtained by logging in first:

```bash
# Step 1: Log in and capture the session cookie
curl -k -c cookies.txt -X POST https://localhost:62626/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"passphrase": "your-passphrase"}'
```

#### Update Email Settings

| Detail      | Value                             |
|-------------|-----------------------------------|
| **Method**  | `PUT`                             |
| **URL**     | `/api/settings/email`             |
| **Auth**    | Session cookie (`sb_session`)     |
| **Content** | `application/json`                |

**Request body parameters:**

| Parameter    | Type    | Required | Description                        |
|--------------|---------|----------|------------------------------------|
| `enabled`    | boolean | No       | Enable or disable email integration |
| `imapServer` | string  | No       | IMAP server hostname               |
| `imapPort`   | number  | No       | IMAP server port (e.g. `993`)      |
| `imapTls`    | boolean | No       | Use TLS for IMAP                   |
| `smtpServer` | string  | No       | SMTP server hostname               |
| `smtpPort`   | number  | No       | SMTP server port (e.g. `587`)      |
| `smtpTls`    | boolean | No       | Use TLS for SMTP                   |
| `username`   | string  | No       | Email account username/address     |
| `password`   | string  | No       | Email account password or app password |
| `fromName`   | string  | No       | Display name for outgoing emails   |

**Example — update the email address and IMAP/SMTP settings:**

```bash
curl -k -b cookies.txt -X PUT https://localhost:62626/api/settings/email \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "username": "newuser@example.com",
    "password": "app-password-here",
    "imapServer": "imap.example.com",
    "imapPort": 993,
    "imapTls": true,
    "smtpServer": "smtp.example.com",
    "smtpPort": 587,
    "smtpTls": true,
    "fromName": "My Name"
  }'
```

**Response:** Returns the updated email settings object.

#### Test Email Connection

After updating, verify that the IMAP and SMTP connections work:

```bash
curl -k -b cookies.txt -X POST https://localhost:62626/api/settings/email/test
```

**Response:**

```json
{ "imap": "ok", "smtp": "ok" }
```

If a connection fails, the corresponding field will contain an error message instead of `"ok"`.

## Socket.IO Events

### Server to Client

**Agent lifecycle:**
- `agent:spawned` — new agent created
- `agent:status` — agent status change (idle/thinking/acting/done/error)
- `agent:destroyed` — agent removed
- `agent:stream` — streaming token from a worker agent
- `agent:thinking` — extended thinking token from a worker
- `agent:thinking-end` — extended thinking complete for a worker
- `agent:tool-call` — agent invoked a tool
- `agent:move` — agent moved between 3D world zones

**COO:**
- `coo:response` — COO's response to the CEO
- `coo:stream` — streaming token from COO
- `coo:thinking` — extended thinking token (Anthropic models)
- `coo:thinking-end` — extended thinking complete
- `coo:audio` — TTS audio for COO response

**Admin Assistant:**
- `admin-assistant:stream` — streaming token from Admin Assistant
- `admin-assistant:thinking` — extended thinking token
- `admin-assistant:thinking-end` — extended thinking complete

**Bus:**
- `bus:message` — any message on the bus

**Conversations & Projects:**
- `conversation:created` — new conversation started
- `project:created` — new project created
- `project:updated` — project metadata changed
- `project:deleted` — project deleted

**Kanban:**
- `kanban:task-created` — new kanban task
- `kanban:task-updated` — kanban task changed
- `kanban:task-deleted` — kanban task removed

**Todos:**
- `todo:created` — new todo item
- `todo:updated` — todo changed
- `todo:deleted` — todo removed
- `reminder:fired` — todo reminder triggered

**Coding Agents:**
- `codeagent:session-start` — coding agent session started
- `codeagent:session-end` — session ended (includes file diffs)
- `codeagent:event` — generic coding agent event
- `codeagent:message` — message from coding agent
- `codeagent:part-delta` — streaming part delta (text/tool output)
- `codeagent:awaiting-input` — coding agent waiting for user input
- `codeagent:permission-request` — coding agent requesting tool permission

**Terminals:**
- `terminal:data` — terminal output data
- `terminal:replay` — terminal replay buffer (on subscribe)

**3D World:**
- `world:zone-added` — new zone added to 3D scene
- `world:zone-removed` — zone removed from 3D scene

**Discord:**
- `discord:pairing-request` — Discord user requesting to pair
- `discord:status` — Discord bot connection status

### Client to Server

**Chat:**
- `ceo:message` — send a message to the COO
- `ceo:new-chat` — start a new conversation
- `ceo:list-conversations` — request conversation list
- `ceo:load-conversation` — load a specific conversation

**Projects:**
- `project:list` — list all projects
- `project:get` — get a single project
- `project:enter` — enter a project (returns conversations + kanban tasks)
- `project:delete` — delete a project
- `project:recover` — recover a deleted project
- `project:conversations` — list conversations for a project
- `project:create-manual` — create a project manually (with GitHub repo, issue monitoring, etc.)
- `project:get-agent-assignments` — get agent type assignments for a project
- `project:set-agent-assignments` — set agent type assignments for a project

**Agents:**
- `registry:list` — request registry entries
- `agent:inspect` — request details about a specific agent
- `agent:activity` — get messages and activity for an agent
- `agent:stop` — stop a running agent

**Coding Agents:**
- `codeagent:respond` — send input to a coding agent session
- `codeagent:permission-respond` — respond to a permission request (once/always/reject)

**Terminals:**
- `terminal:input` — send input to a PTY terminal
- `terminal:resize` — resize a terminal
- `terminal:subscribe` — subscribe to terminal output
- `terminal:end` — end a terminal session

**Soul Documents:**
- `soul:list` — list all soul documents
- `soul:get` — get a soul document by role
- `soul:save` — create or update a soul document
- `soul:delete` — delete a soul document
- `soul:suggest` — get AI-generated soul document suggestions

**Memory:**
- `memory:list` — list memories (with optional filters)
- `memory:save` — save a memory
- `memory:delete` — delete a memory
- `memory:search` — semantic search over memories

## License

MIT — Copyright 2026 Mike Reeves
