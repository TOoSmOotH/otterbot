# Otterbot Phase 1: WebUI + Agent Orchestration

## Context

Otterbot is an alternative to OpenClaw — a multi-agent AI orchestration system. The key frustrations with OpenClaw are: unreliable agent communication, no real-time visibility into agent activity, confusing multi-agent setup, and too many options. Otterbot solves this with a clear CEO/COO hierarchy, a central message bus that makes ALL communication observable, and a simple WebUI.

**Phase 1 goal**: A working WebUI where the user (CEO) chats with the COO, who can spawn Team Leads, who pull Worker agents from a registry — with all communication visible in real-time.

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Monorepo | pnpm workspaces | Clean dependency management, native TypeScript support |
| Backend | Node.js + TypeScript + Fastify | Fast, typed, good WebSocket support |
| Real-time | Socket.IO | Broadcasting, rooms, reconnection built-in |
| Database | SQLite via Drizzle ORM | Local, zero-config, good enough for v1 |
| Frontend | Vite + React + TypeScript | Fast dev loop, no SSR overhead needed |
| UI | shadcn/ui + Tailwind CSS | Copy-not-install components, clean defaults |
| Agent graph | React Flow | Purpose-built for node/edge visualization |
| State | Zustand | Minimal, no boilerplate |
| LLM | Vercel AI SDK | Multi-provider support (Anthropic, OpenAI, Google, Ollama) |
| E2E Testing | Playwright | Cross-browser, reliable, great for WebSocket UIs |

---

## Project Structure

```
otterbot/
├── package.json              # Root workspace config
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── .env.example              # API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
├── packages/
│   ├── shared/               # @otterbot/shared — types, constants, schemas
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── agent.ts      # Agent, AgentRole, AgentStatus
│   │   │   │   ├── message.ts    # BusMessage, MessageType
│   │   │   │   ├── registry.ts   # RegistryEntry, AgentCapability
│   │   │   │   └── events.ts     # Socket.IO event types (server↔client)
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── server/               # @otterbot/server — backend
│   │   ├── src/
│   │   │   ├── index.ts          # Fastify + Socket.IO bootstrap
│   │   │   ├── db/
│   │   │   │   ├── schema.ts     # Drizzle schema
│   │   │   │   └── index.ts      # DB connection
│   │   │   ├── bus/
│   │   │   │   └── message-bus.ts # Central message bus
│   │   │   ├── agents/
│   │   │   │   ├── agent.ts       # Base Agent class
│   │   │   │   ├── coo.ts        # COO agent (always running)
│   │   │   │   ├── team-lead.ts  # Team Lead agent
│   │   │   │   ├── worker.ts     # Worker agent
│   │   │   │   └── prompts/
│   │   │   │       └── coo.ts    # COO personality / system prompt
│   │   │   ├── registry/
│   │   │   │   └── registry.ts   # Agent registry (CRUD + query)
│   │   │   ├── workspace/
│   │   │   │   └── workspace.ts  # Workspace manager (create, scope, enforce access)
│   │   │   ├── llm/
│   │   │   │   └── adapter.ts    # Vercel AI SDK wrapper
│   │   │   └── socket/
│   │   │       └── handlers.ts   # Socket.IO event handlers
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/                  # @otterbot/web — frontend
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx           # Three-panel layout
│       │   ├── stores/
│       │   │   ├── agent-store.ts    # Zustand: agent hierarchy state
│       │   │   └── message-store.ts  # Zustand: message stream state
│       │   ├── components/
│       │   │   ├── chat/
│       │   │   │   └── CeoChat.tsx       # CEO↔COO chat panel
│       │   │   ├── stream/
│       │   │   │   └── MessageStream.tsx # Live agent message feed
│       │   │   ├── graph/
│       │   │   │   ├── AgentGraph.tsx    # React Flow agent hierarchy
│       │   │   │   └── AgentNode.tsx     # Custom node component
│       │   │   └── ui/                   # shadcn components
│       │   ├── hooks/
│       │   │   └── use-socket.ts     # Socket.IO connection hook
│       │   └── lib/
│       │       └── socket.ts         # Socket.IO client singleton
│       ├── e2e/                  # Playwright tests
│       │   ├── chat.spec.ts
│       │   ├── stream.spec.ts
│       │   ├── graph.spec.ts
│       │   └── full-flow.spec.ts
│       ├── playwright.config.ts
│       ├── package.json
│       └── tsconfig.json
```

---

## Core Architecture

### The Message Bus (the heart of the system)

Every agent-to-agent message flows through the `MessageBus`. It does three things:
1. **Persists** the message to SQLite
2. **Routes** it to the target agent(s)
3. **Broadcasts** it to the frontend via Socket.IO

This single design decision solves the visibility and reliability problems. The frontend is just a consumer of the bus — it sees everything.

```
CEO (WebUI) → Socket.IO → MessageBus → COO Agent
                                ↓
                          SQLite (persist)
                                ↓
                          Socket.IO → WebUI (stream panel)
```

### Agent Hierarchy

```
CEO (user)
 └── COO (always running, singleton)
      └── Team Lead (spawned per project/task)
           ├── Worker Agent A (from registry)
           ├── Worker Agent B (from registry)
           └── Worker Agent C (from registry)
```

- **COO**: Receives high-level goals from CEO. Breaks them down, spawns Team Leads. Always running. Manages multiple projects concurrently — each gets its own Team Lead.
- **Team Lead**: Manages a specific project/task. Pulls workers from registry based on needs. Reports to COO.
- **Worker**: Executes specific capabilities (coding, research, writing, etc.). Reports to Team Lead.

### COO Personality

The COO has a defined personality baked into its system prompt. It should feel like a competent, no-nonsense executive who:
- Is direct and concise — doesn't waste the CEO's time with fluff
- Proactively reports status — doesn't wait to be asked
- Pushes back when a goal is unclear — asks clarifying questions before spinning up teams
- Manages multiple projects simultaneously and gives brief status summaries when asked
- Has a bias toward action — breaks goals down and starts work quickly
- Speaks in plain language, not corporate jargon

The COO's system prompt will be stored in `packages/server/src/agents/prompts/coo.ts` so it's easy to find and tweak.

### Multi-Project Support

The COO can manage multiple active projects at once. Each project gets:
- Its own Team Lead (and sub-tree of workers)
- Its own branch in the agent graph
- Filtered views in the message stream (filter by project)

The CEO can say "What's the status of all projects?" and the COO summarizes across all active work. The UI shows all project trees in the agent graph simultaneously, with the ability to focus on one.

### Docker-First Architecture (Container Isolation)

Otterbot runs inside a Docker container. This is a hard requirement, not optional. If the container gets compromised, only the container is affected — not the host system.

**Host layout (bind mount):**
```
/docker/otterbot/              # Bind-mounted into the container
├── config/
│   ├── otterbot.json          # User config (LLM keys, preferences, COO personality tweaks)
│   └── bootstrap.sh            # Runs on container start: installs extra packages, applies configs
├── data/
│   ├── otterbot.db            # SQLite database (persists across restarts)
│   └── registry/               # Custom registry entries (persists across restarts)
├── projects/
│   └── <project-id>/
│       ├── shared/             # Shared space — all agents on this project can read/write
│       │   ├── specs/
│       │   ├── docs/
│       │   └── artifacts/
│       └── agents/
│           ├── <agent-id-1>/   # Agent 1's private workspace
│           ├── <agent-id-2>/   # Agent 2's private workspace
│           └── <agent-id-3>/   # Agent 3's private workspace
└── logs/                       # Container logs (persists across restarts)
```

**Container behavior:**
- On start: runs `bootstrap.sh` if it exists (installs user-requested packages, applies custom configs)
- The container has NO access to the host filesystem beyond `/docker/otterbot/`
- Runs as a non-root user inside the container
- Network access is limited to outbound LLM API calls and the WebUI port

**Docker setup:**
- `Dockerfile` — Node.js base image, copies server + web build, runs Fastify
- `docker-compose.yml` — defines the service, bind mount, port mapping, environment variables
- `pnpm docker:build` — builds the image
- `pnpm docker:up` — starts the container
- `pnpm docker:dev` — starts with hot-reload (mounts source code for development)

### Agent Workspaces (Sandboxed within Container)

Within the container, each agent gets a scoped workspace. This is defense-in-depth — even inside the container, agents can't access each other's data.

**Rules:**
- Each agent can only read/write within its own `agents/<id>/` folder and the project's `shared/` folder
- Agents CANNOT access config, data, other projects, or other agents' private workspaces
- The Team Lead has read access to all its workers' workspaces (for review/coordination)
- The COO has read access to all project shared folders (for status reporting)
- File access is enforced at the server level, not by trusting the agent

### Agent Registry

The registry is a catalog of agent templates — not running instances, but blueprints:

```typescript
interface RegistryEntry {
  id: string;
  name: string;              // e.g. "Code Writer", "Researcher", "Reviewer"
  description: string;
  systemPrompt: string;
  capabilities: string[];    // e.g. ["code", "typescript", "testing"]
  defaultModel: string;      // e.g. "claude-sonnet-4-5-20250929"
  defaultProvider: string;   // e.g. "anthropic"
  tools: string[];           // available tool names
}
```

Team Leads query the registry: "give me agents that can do X" → spawn workers from matching templates.

### Customizable Agent Configuration

Every agent's personality, model, and behavior is fully customizable at two levels:

**Registry level (templates)**: Edit the defaults for any agent type through the Registry UI. Change the system prompt, default model, default provider, capabilities, and tools. These changes apply to all future agents spawned from that template.

**Instance level (per-spawn overrides)**: When a Team Lead spawns a worker (or the COO spawns a Team Lead), the spawning agent can override the template defaults — different model, different provider, tweaked system prompt. The CEO can also request overrides: "Use GPT-4 for the code reviewer on this project."

**What's customizable per agent:**
- `systemPrompt` — the agent's personality, instructions, tone
- `model` — which LLM model to use (e.g. `claude-sonnet-4-5-20250929`, `gpt-4o`, `llama3`)
- `provider` — which provider/endpoint (anthropic, openai, ollama, or custom baseURL)
- `temperature` — creativity vs determinism
- `capabilities` — what the agent can do
- `tools` — which tools the agent has access to

### Socket.IO Event Protocol

**Server → Client:**
- `agent:spawned` — new agent created (updates graph)
- `agent:status` — agent status change (idle/thinking/acting/done/error)
- `agent:destroyed` — agent removed
- `bus:message` — any message on the bus (updates stream)
- `coo:response` — COO's response to the CEO (updates chat)
- `coo:stream` — streaming token from COO (for live typing in chat)

**Client → Server:**
- `ceo:message` — CEO sends a message to the COO
- `registry:list` — request registry entries
- `agent:inspect` — request details about a specific agent

### LLM Adapter

Use Vercel AI SDK (`ai` package) which provides a unified interface for multiple providers:
- `@ai-sdk/openai-compatible` — **Any OpenAI-compatible endpoint** (Together, Groq, Mistral, LM Studio, vLLM, etc.). This is the primary adapter — covers the widest range of providers with a single interface.
- `@ai-sdk/openai` — OpenAI/GPT models (uses the compatible adapter under the hood)
- `@ai-sdk/anthropic` — Claude models
- `ollama-ai-provider` — Local models via Ollama

Each agent has a `provider`, `model`, and optional `baseURL` field. The adapter resolves the right SDK provider at runtime. For OpenAI-compatible endpoints, the user just provides a base URL and API key.

---

## UI Layout

Three-panel layout, simple and focused:

```
┌──────────────────────────────────────────────────────────┐
│  Otterbot                                    [Settings] │
├────────────────┬─────────────────────┬───────────────────┤
│                │                     │                   │
│   CEO ↔ COO    │   Agent Graph       │  Message Stream   │
│   Chat Panel   │   (React Flow)      │  (all bus msgs)   │
│                │                     │                   │
│                │   [COO]             │  COO → TL: "..."  │
│  User: "Build  │    ├─[Team Lead]    │  TL → W1: "..."   │
│   project X"   │    │  ├─[Worker 1]  │  W1 → TL: "..."   │
│                │    │  └─[Worker 2]  │  TL → COO: "..."  │
│  COO: "I'll    │    │               │                   │
│   assign..."   │                     │                   │
│                │                     │                   │
│  [input______] │                     │                   │
└────────────────┴─────────────────────┴───────────────────┘
```

- **Left**: Chat with the COO (the only direct interaction point)
- **Center**: Live React Flow graph showing the agent hierarchy, nodes colored by status
- **Right**: Scrolling feed of ALL messages on the bus, filterable by agent

---

## Data Models (Drizzle/SQLite)

**agents** — running agent instances
- `id`, `registryEntryId`, `role` (coo/team_lead/worker), `parentId`, `status`, `model`, `provider`, `projectId`, `workspacePath`, `createdAt`

**messages** — every message on the bus
- `id`, `fromAgentId`, `toAgentId`, `type` (chat/directive/report/status), `content`, `metadata` (JSON), `timestamp`

**registry_entries** — agent blueprints
- `id`, `name`, `description`, `systemPrompt`, `capabilities` (JSON), `defaultModel`, `defaultProvider`, `tools` (JSON), `createdAt`

**projects** — high-level goals from the CEO
- `id`, `name`, `description`, `status`, `createdAt`

---

## Testing Strategy

**Backend (Vitest)**: Unit tests for core modules — message bus routing, workspace path enforcement, LLM adapter provider resolution, agent lifecycle state machine. Written alongside the code in steps 4-7.

**Frontend E2E (Playwright)**: Tests the actual UI in a real browser with a running server. Written at key milestones:
- After Step 10 (Chat panel): CEO can send a message and receive a streaming COO response
- After Step 11 (Message Stream): Messages from the bus appear in the stream panel in real-time
- After Step 12 (Agent Graph): Spawned agents appear as nodes, status changes update node colors
- After Step 13 (Registry UI): Can view, add, and edit registry entries
- After Step 14 (E2E): Full flow — send goal → agents spawn → communication visible → completion

Playwright config lives in `packages/web/playwright.config.ts`. Tests in `packages/web/e2e/`.

**Test commands:**
- `pnpm test` — runs Vitest unit tests across all packages
- `pnpm test:e2e` — runs Playwright tests (starts server automatically)

---

## Implementation Order

### Step 0: Save this plan to the repo
- Write this plan to `docs/PLAN.md` in the repo root so it can be referenced throughout development

### Step 1: Monorepo scaffolding + Docker
- Root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- Three package stubs with their own `package.json` and `tsconfig.json`
- `.gitignore`, `.env.example`
- `Dockerfile` (Node.js 22 base, non-root user, copies build output, runs Fastify)
- `docker-compose.yml` (bind mount `/docker/otterbot`, port mapping, env vars)
- `.dockerignore`
- `pnpm docker:build`, `pnpm docker:up`, `pnpm docker:dev` scripts

### Step 2: Shared types
- All TypeScript interfaces: Agent, Message, RegistryEntry, Project
- Socket.IO event type maps (server-to-client, client-to-server)
- Enums: AgentRole, AgentStatus, MessageType

### Step 3: Database + schema
- Drizzle ORM setup with SQLite
- Schema for agents, messages, registry_entries, projects
- Seed script to populate registry with 7 starter templates

### Step 4: Workspace Manager
- `WorkspaceManager` class: creates project directory structure
- Creates private agent directories and shared project space
- Enforces path scoping: agents can only access their own folder + shared
- Team Leads get read access to their workers' folders
- Path validation to prevent directory traversal attacks
- Vitest unit tests

### Step 5: Message Bus
- `MessageBus` class: persist, route, broadcast
- Vitest unit tests: message routing, persistence, broadcast callbacks

### Step 6: LLM adapter
- Vercel AI SDK wrapper that resolves provider from agent config
- Support streaming responses

### Step 7: Agent system
- Base `Agent` class with message handling, status lifecycle, LLM integration
- `COO` agent: always-on, receives CEO input, spawns Team Leads via tool calling
- `TeamLead` agent: receives directives, queries registry, spawns Workers
- `Worker` agent: executes tasks, reports back

### Step 8: Server bootstrap
- Fastify server with Socket.IO
- Wire up event handlers
- REST endpoints for registry CRUD
- Start COO on server boot

### Step 9: Frontend shell + Playwright setup
- Vite + React + Tailwind + shadcn/ui setup
- Three-panel layout component
- Socket.IO connection hook
- Zustand stores
- Playwright config + first smoke test

### Step 10: CEO Chat panel
- Chat UI with streaming COO responses
- Message history from SQLite on load
- Playwright test

### Step 11: Message Stream panel
- Live feed of all bus messages
- Agent name/role badges, timestamps
- Auto-scroll with scroll-lock
- Playwright test

### Step 12: Agent Graph panel
- React Flow with custom AgentNode components
- Nodes colored by status
- Animated edges when messages flow
- Auto-layout when agents spawn/despawn
- Playwright test

### Step 13: Registry UI
- List/grid of available agent templates in settings
- Add/edit registry entries
- Inline editing of agent personalities
- Playwright test

### Step 14: End-to-end integration test
- Full Playwright E2E test

---

## Commit & Push Strategy

| After Step | Commit Message |
|------------|---------------|
| Step 1 | `chore: scaffold monorepo with pnpm workspaces and Docker` |
| Step 2 | `feat: add shared types and event definitions` |
| Step 3 | `feat: add database schema and seed registry` |
| Steps 4-5 | `feat: add workspace manager and message bus` |
| Step 6 | `feat: add LLM adapter with multi-provider support` |
| Step 7 | `feat: add agent system (COO, Team Lead, Worker)` |
| Step 8 | `feat: add server with Socket.IO and REST endpoints` |
| Steps 9-12 | `feat: add WebUI with chat, graph, and stream panels` |
| Steps 13-14 | `feat: add registry UI and end-to-end integration` |
