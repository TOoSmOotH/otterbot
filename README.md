# Smoothbot

An open-source multi-agent AI orchestration system. Chat with a COO agent who manages teams of specialized workers — with every message visible in real-time.

Smoothbot is an alternative to [OpenClaw](https://github.com/openclaw/openclaw) that prioritizes **visibility**, **simplicity**, and **local-first operation**. Instead of opaque agent pipelines, every agent-to-agent message flows through a central bus that the UI observes directly.

## How It Works

You (the **CEO**) chat with a single **COO** agent. The COO breaks your goals into projects, spawns **Team Leads**, who pull **Worker** agents from a registry of specialists. All communication between agents flows through a central message bus — and you can watch it all happen in real-time.

```
CEO (you)
 └── COO (always running)
      └── Team Lead (per project)
           ├── Coder
           ├── Researcher
           └── Reviewer
```

The three-panel WebUI shows everything at once:

```
┌────────────────┬─────────────────────┬───────────────────┐
│   CEO ↔ COO    │   Agent Graph       │  Message Stream   │
│   Chat Panel   │   (live hierarchy)  │  (all bus msgs)   │
│                │                     │                   │
│  You: "Build   │   [COO]             │  COO → TL: "..."  │
│   project X"   │    └─[Team Lead]    │  TL → W1: "..."   │
│                │       ├─[Coder]     │  W1 → TL: "done"  │
│  COO: "On it.  │       └─[Reviewer]  │  TL → COO: "..."  │
│   Spawning..."  │                     │                   │
│                │                     │                   │
│  [input______] │                     │                   │
└────────────────┴─────────────────────┴───────────────────┘
```

## Quick Start

### Prerequisites

- Node.js >= 20
- pnpm >= 9 (`npm install -g pnpm`)
- At least one LLM API key (Anthropic, OpenAI, or a local Ollama instance)

### Setup

```bash
# Clone and install
git clone https://github.com/TOoSmOotH/smoothbot.git
cd smoothbot
pnpm install

# Configure your API key(s)
cp .env.example .env
# Edit .env and add at least one: ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.

# Initialize the database and seed agent templates
pnpm db:seed

# Start development servers (backend on :3000, frontend on :5173)
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) and start chatting with the COO.

### Docker

```bash
# Build and run in a container
pnpm docker:build
pnpm docker:up

# Or for development with hot-reload
pnpm docker:dev
```

The container runs as a non-root user with data persisted to `./docker/smoothbot/` (or `$SMOOTHBOT_DATA_DIR`).

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
| **Worker** | Spawned from registry templates. Executes specific tasks (coding, research, review, etc.) and reports back. |

### Agent Registry

The registry contains 7 pre-built agent templates:

| Agent | Capabilities | Tools |
|-------|-------------|-------|
| **Coder** | code, typescript, python, debugging | file_read, file_write, shell_exec |
| **Researcher** | research, analysis, summarization | web_search, file_read |
| **Reviewer** | code-review, testing, quality | file_read |
| **Writer** | writing, documentation, specs | file_read, file_write |
| **Planner** | planning, architecture, decomposition | file_read, file_write |
| **Security Reviewer** | security, code-review, vulnerability-analysis | file_read, shell_exec |
| **Tester** | testing, test-writing, qa, edge-cases | file_read, file_write, shell_exec |

Templates are fully customizable — edit the system prompt, model, provider, capabilities, and tools through the Settings UI or the REST API.

### LLM Provider Support

Smoothbot uses the [Vercel AI SDK](https://sdk.vercel.ai/) for multi-provider support:

| Provider | Config | Use Case |
|----------|--------|----------|
| **Anthropic** | `ANTHROPIC_API_KEY` | Claude models (default) |
| **OpenAI** | `OPENAI_API_KEY` | GPT models |
| **Ollama** | `OLLAMA_BASE_URL` | Local models (Llama, Mistral, etc.) |
| **OpenAI-Compatible** | `OPENAI_COMPATIBLE_BASE_URL` + `_API_KEY` | Together, Groq, LM Studio, vLLM, etc. |

Each agent can use a different provider and model. Override at the template level or per-spawn.

### Workspace Isolation

Each agent gets a sandboxed workspace within the container:

```
/smoothbot/projects/<project-id>/
├── shared/           # All agents on this project can read/write
│   ├── specs/
│   ├── docs/
│   └── artifacts/
└── agents/
    ├── <agent-1>/    # Private to agent 1
    └── <agent-2>/    # Private to agent 2
```

Access rules are enforced at the server level:
- Workers can access their own folder + shared
- Team Leads can also read their workers' folders
- Directory traversal is blocked

## Project Structure

```
smoothbot/
├── packages/
│   ├── shared/          # @smoothbot/shared — TypeScript types & event contracts
│   ├── server/          # @smoothbot/server — Fastify + Socket.IO backend
│   │   └── src/
│   │       ├── agents/  # COO, Team Lead, Worker + base class
│   │       ├── bus/     # Central message bus
│   │       ├── db/      # Drizzle ORM schema + migrations
│   │       ├── llm/     # Vercel AI SDK adapter
│   │       ├── registry/# Agent template CRUD
│   │       ├── socket/  # Socket.IO event handlers
│   │       └── workspace/# Sandboxed file access
│   └── web/             # @smoothbot/web — React + Vite frontend
│       └── src/
│           ├── components/
│           │   ├── chat/     # CEO ↔ COO chat panel
│           │   ├── graph/    # React Flow agent visualization
│           │   ├── stream/   # Live message bus feed
│           │   └── registry/ # Agent template editor
│           ├── stores/       # Zustand state management
│           └── hooks/        # Socket.IO connection hook
├── docs/PLAN.md         # Full implementation plan
├── Dockerfile           # Multi-stage production build
└── docker-compose.yml   # Container orchestration
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Monorepo | pnpm workspaces |
| Backend | Node.js + TypeScript + Fastify |
| Real-time | Socket.IO |
| Database | SQLite via Drizzle ORM |
| Frontend | Vite + React + TypeScript |
| Styling | Tailwind CSS |
| Agent Graph | React Flow |
| State | Zustand |
| LLM | Vercel AI SDK |
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

# Database
pnpm db:seed          # Seed registry with default agent templates

# Docker
pnpm docker:build     # Build container image
pnpm docker:up        # Start container (detached)
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
| `ANTHROPIC_API_KEY` | At least one LLM key | — | Anthropic API key for Claude models |
| `OPENAI_API_KEY` | | — | OpenAI API key for GPT models |
| `OLLAMA_BASE_URL` | | `http://localhost:11434` | Ollama server URL |
| `OPENAI_COMPATIBLE_BASE_URL` | | — | Any OpenAI-compatible endpoint |
| `OPENAI_COMPATIBLE_API_KEY` | | — | API key for compatible endpoint |
| `PORT` | | `3000` | Server port |
| `HOST` | | `0.0.0.0` | Server host |
| `DATABASE_URL` | | `file:./data/smoothbot.db` | SQLite database path |
| `WORKSPACE_ROOT` | | `./data` | Root directory for agent workspaces |

## REST API

The server exposes a REST API for registry management:

```
GET    /api/registry          # List all agent templates
GET    /api/registry/:id      # Get a specific template
POST   /api/registry          # Create a new template
PATCH  /api/registry/:id      # Update a template
DELETE /api/registry/:id      # Delete a template

GET    /api/messages           # Message history (?projectId=&agentId=&limit=)
GET    /api/agents             # List all running agents
```

## Socket.IO Events

**Server to Client:**
- `agent:spawned` — new agent created
- `agent:status` — agent status change (idle/thinking/acting/done/error)
- `agent:destroyed` — agent removed
- `bus:message` — any message on the bus
- `coo:response` — COO's response to the CEO
- `coo:stream` — streaming token from COO

**Client to Server:**
- `ceo:message` — send a message to the COO
- `registry:list` — request registry entries
- `agent:inspect` — request details about a specific agent

## License

MIT — Copyright 2026 Mike Reeves
