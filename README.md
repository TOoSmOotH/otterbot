# Otterbot

Otterbot is a local-first multi-agent workspace built around **agent profiles**.
Each agent has its own personality, model configuration, memory, skills,
credentials, scheduled tasks, and visual identity. You can chat with any agent
directly, let trusted agents spawn focused subagents, and watch agent-to-agent
communication as it happens.

This branch is a major product rewrite of the older single-COO/project pipeline.
The app now starts from a roster of independent agents instead of a project
dashboard. The COO still exists, but it is just the default coordinating profile:
you can create additional agents, tune them individually, and give each one its
own tools and context.

## What You Can Do

- Create and manage agents from the left-side roster.
- Chat with any agent in its own persistent conversation space.
- Edit an agent's identity, persona, avatar, model, transport, credentials,
  skills, schedule, and memory in Agent Studio.
- Store credentials per agent in the encrypted control database.
- Give different agents different chat and embedding models.
- Install or author markdown skills for individual agents.
- Add and curate long-term memories per agent.
- Schedule cron prompts for an agent to run later.
- Allow selected agents to spawn temporary subagents for focused research or
  delegated work.
- Watch live bus messages and subagent task results in the Activity view.
- View the active roster as a shared 3D scene using bundled character packs.

## How It Works

Otterbot runs one runtime per agent profile. Each profile is an isolated
directory under `data/profiles/<id>/`:

```text
profile.json   # identity, role, models, transport, avatar, limits
SOUL.md        # persona / system-prompt identity block
agent.db       # conversations, messages, memories, skills, vectors
skills/        # per-agent markdown skills
```

Shared app state lives in `data/control.db`, including the agent registry,
agent-to-agent bus messages, subagent task records, scheduled tasks, encrypted
agent secrets, and app settings.

Every agent can have:

| Part | Description |
|------|-------------|
| Identity | Display name, role, email, avatar/model pack, and transport |
| Persona | The `SOUL.md` prompt that defines the agent's behavior |
| Models | Separate chat and embedding model references |
| Credentials | API keys and local endpoints scoped to that agent |
| Skills | Markdown instruction packs loaded into that agent's prompt |
| Memory | Long-term facts and observations searchable by that agent |
| Schedule | Cron prompts that run against that agent |
| Subagents | Optional delegated workers with inherited model/secrets |

## The UI

The current app is intentionally compact:

- **Agent roster**: left rail with the COO pinned first, all other agents below,
  live status dots, model labels, and a New Agent action.
- **Chat**: per-agent chat with streaming responses and persistent memory across
  sessions.
- **Agent Studio**: full editor for identity, persona, models, skills,
  schedules, memory, and credentials.
- **Activity**: live feed of bus messages plus a subagent task list.
- **3D**: shared scene that renders every agent as a character with a status
  ring.
- **Onboarding**: first-run wizard for configuring the COO's provider, model,
  credentials, and personality.

## Model Providers

Otterbot uses the Vercel AI SDK for model access. The current profile system
supports:

| Provider | Notes |
|----------|-------|
| Anthropic | Cloud chat models; API key stored per agent |
| OpenAI | Cloud chat and embedding models; API key or ChatGPT OAuth flow |
| LM Studio | Local OpenAI-compatible endpoint, defaulting to `http://localhost:1234/v1` |
| Ollama | Local OpenAI-compatible endpoint, defaulting to `http://localhost:11434/v1` |

Each agent stores its own credential set. Local provider URLs can be set per
agent in Agent Studio, with `.env` values used as development defaults.

## Quick Start From Source

Requirements:

- Node.js 20 or newer, Node 22 recommended
- pnpm 9 or newer
- A model provider: Anthropic, OpenAI, LM Studio, or Ollama

```bash
git clone https://github.com/TOoSmOotH/otterbot.git
cd otterbot
pnpm install
pnpm dev
```

The dev command starts the backend and frontend:

- Backend API and Socket.IO server: `http://localhost:3001`
- Vite web app: `http://localhost:5173`

On first launch, `pnpm dev` creates `.env` from `.env.example` if needed and
generates a local `OTTERBOT_DB_KEY`. The onboarding wizard then configures the
COO profile. You can skip setup and configure agents later in Agent Studio.

## Configuration

For development, `pnpm dev` creates `.env` from `.env.example` when `.env` is
missing. To create or reset it manually:

```bash
cp .env.example .env
```

Important variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `OTTERBOT_DB_KEY` | unset | Encrypts `control.db` and all per-agent databases. If unset, local dev databases are unencrypted. |
| `PORT` | `3001` | Backend HTTP and Socket.IO port |
| `HOST` | `0.0.0.0` | Backend bind host |
| `DATA_DIR` | `./data` | Runtime data directory |
| `ASSETS_DIR` | `./assets` | Static 3D assets directory |
| `WEB_DIST_DIR` | `./packages/web/dist` | Built frontend served by the backend for single-port mode |
| `SKILLS_DIR` | `./data/skills` | Legacy/global skills directory used when bootstrapping the COO |
| `LMSTUDIO_BASE_URL` | `http://localhost:1234/v1` | Default LM Studio/OpenAI-compatible endpoint |
| `LMSTUDIO_MODEL` | `local-model` | Initial COO chat model fallback |
| `ENABLE_EMBEDDINGS` | `false` | Enables embedding initialization for semantic memory |
| `AGENT_TRANSPORT` | `local` | Agent bus transport: `local` or `discord` |
| `DISCORD_BOT_TOKEN` | unset | Required only for Discord agent transport |
| `DISCORD_CHANNEL_ID` | unset | Required only for Discord agent transport |
| `ENABLE_DESKTOP` | `false` | Enables the noVNC desktop proxy if a VNC server is available |
| `VNC_HOST` | `127.0.0.1` | VNC host used by the desktop proxy |
| `VNC_PORT` | `5901` | VNC port used by the desktop proxy |
| `LOG_LEVEL` | `info` | Fastify logger level |

Credentials such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`LMSTUDIO_BASE_URL`, and `OLLAMA_BASE_URL` should normally be saved per agent in
Agent Studio. `OTTERBOT_DB_KEY` is the one secret expected in `.env`.

## Development Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm dev:server
pnpm dev:web
pnpm dev:cli
pnpm cli
pnpm --filter @otterbot/server test
pnpm --filter @otterbot/web test:e2e
```

Package scripts:

| Command | Description |
|---------|-------------|
| `pnpm dev` | Builds/watches shared types, starts server, starts Vite |
| `pnpm build` | Builds every package |
| `pnpm dev:server` | Starts only the Fastify/Socket.IO server |
| `pnpm dev:web` | Starts only the Vite frontend |
| `pnpm dev:cli` | Starts the Ink terminal client in dev mode |
| `pnpm cli` | Runs the built CLI |
| `pnpm --filter @otterbot/server test` | Runs server Vitest tests |
| `pnpm --filter @otterbot/web test:e2e` | Runs Playwright e2e tests |

For a single-port production-style run, build the web package first, then start
the server. The backend serves `WEB_DIST_DIR` from the same port as the API and
Socket.IO:

```bash
pnpm build
pnpm start
```

Server tests use a fake OpenAI-compatible model by default. To test against a
real local endpoint:

```bash
OTTER_TEST_MODEL_URL=http://localhost:1234/v1 OTTER_TEST_MODEL=some-model \
  pnpm --filter @otterbot/server test
```

## Architecture

```text
packages/
  shared/   TypeScript contracts for agents, messages, memory, skills, views
  server/   Fastify API, Socket.IO, orchestration, profile storage, SQLite
  web/      React/Vite UI, Zustand stores, Three.js agent scene
  cli/      Ink terminal client
assets/
  workers/       3D character/model packs
  environments/  3D environment packs
  scenes/        scene configurations
```

Key backend modules:

| Module | Responsibility |
|--------|----------------|
| `profiles/profile-store.ts` | Creates, loads, saves, and deletes profile directories |
| `orchestrator/orchestrator.ts` | Owns agent lifecycles, runtimes, bus, scheduler, secrets, and subagent spawning |
| `runtime/agent-runtime.ts` | Runs one conversational loop for one agent |
| `runtime/agent-context.ts` | Bundles profile, DB, memory, skills, secrets, and embeddings |
| `bus/bus.ts` | Persists and routes agent-to-agent messages |
| `scheduler/scheduler.ts` | Runs cron prompts against agents |
| `secrets/secrets-store.ts` | Stores per-agent credentials in the encrypted control DB |
| `providers/registry.ts` | Resolves model references into Vercel AI SDK models |
| `skills/*` | Loads, scans, imports, installs, and exports markdown skills |
| `memory/*` | Summarizes, extracts, stores, and searches agent memories |

## Agent-To-Agent Bus

The message bus is the visibility layer. When an agent sends a request,
response, broadcast, spawn notice, report, status update, tool event, or error,
the bus:

1. Persists it to `control.db`.
2. Delivers it to the target runtime or broadcasts it.
3. Emits it to the frontend over Socket.IO.

The Activity view is a live observer of this bus. It also shows subagent task
records, including goals, status, and result summaries.

## Skills

Skills are markdown instruction packs scoped to a single agent. They can be
created manually, imported as raw markdown, installed from the built-in catalog,
and exported. Skill files are loaded from the agent's `skills/` directory and
merged into that agent's prompt when relevant.

Imported catalog skills are fetched from GitHub and scanned before being stored.

## Memory

Each agent has its own database for conversations, memories, and vectors.
Agents can search memory during a turn and save new memories through tools. The
user can also add or delete memories from Agent Studio.

Per-agent databases are intentionally isolated because different agents may use
different embedding models and vector dimensions.

## API Surface

Primary endpoints:

```text
GET    /api/setup-state
POST   /api/setup-state/complete

GET    /api/providers
POST   /api/provider-models
POST   /api/test-model

GET    /api/agents
POST   /api/agents
GET    /api/agents/:id
PATCH  /api/agents/:id
DELETE /api/agents/:id

GET    /api/agents/:id/memories
POST   /api/agents/:id/memories
DELETE /api/agents/:id/memories/:memId

GET    /api/agents/:id/skills
POST   /api/agents/:id/skills
POST   /api/agents/:id/skills/install
DELETE /api/agents/:id/skills/:skillId

POST   /api/agents/:id/credentials

GET    /api/agents/:id/scheduled-tasks
POST   /api/agents/:id/scheduled-tasks
DELETE /api/scheduled-tasks/:taskId

GET    /api/bus/messages
GET    /api/subagent-tasks

GET    /api/model-packs
GET    /api/scenes
GET    /api/environment-packs

GET    /api/auth/openai/status
POST   /api/auth/openai/login
POST   /api/auth/openai/signout
```

Socket.IO events:

```text
chat:join
chat:joined
chat:message
chat:stream
chat:done
chat:close
agent:status
bus:message
```

## Security And Local Data

- Keep `OTTERBOT_DB_KEY` safe. Losing it means encrypted databases cannot be
  opened.
- Do not commit `data/`, local profile databases, generated credentials, or
  plaintext secrets.
- Per-agent credentials are migrated out of legacy profile `.env` files into the
  encrypted secrets store at boot.
- The COO profile cannot be deleted through the API.

## Contributing

Use Conventional Commits for changes intended to be released:

- `fix: ...` for patch-level fixes
- `feat: ...` for user-facing additions
- `feat!: ...` or `BREAKING CHANGE:` for breaking changes

Before opening a PR, run the narrowest useful verification for the code you
changed. For shared contracts, build all affected packages. For UI behavior,
include a browser or Playwright smoke check when practical.

## License

MIT — Copyright 2026 Mike Reeves
