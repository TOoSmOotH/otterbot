# CLAUDE.md

## Project Overview

Otterbot — a **multi-agent** personal AI system. The user creates independent
agents, each modeled on a Hermes-style "profile": its own personality, memory,
skills, scheduled tasks, credentials, model, and chat services. A **COO** agent
coordinates the others; agents communicate over a pluggable bus and can spawn
subagents. (Branch `feat/multi-agent-profiles` — rewrite of the former
single-agent otterbot.)

## Architecture

- `packages/shared` — types: message, skill, memory, user-profile, agent-view,
  **agent**, **agent-message**, **spawn**.
- `packages/server` — Fastify + Socket.IO; SQLite + Drizzle + FTS5 + sqlite-vec.
- `packages/web` — React + Zustand; agent roster, per-agent chat, activity view,
  3D agent scene.

### Agent profiles

Each agent is an isolated directory under `data/profiles/<id>/`:

```
profile.json   identity, role, model refs, allowedModels, transport, artwork
SOUL.md        the agent's persona (system-prompt persona block)
.env           per-agent secrets (provider keys, GitHub token, SMTP creds)
agent.db       isolated SQLite — conversations, memories, skills, vectors
skills/        per-agent markdown skill files
```

`data/control.db` is the shared control plane: the agent registry, the
agent-to-agent `bus_messages` log, `subagent_tasks`, and `scheduled_tasks`.

Per-agent isolated databases are required because `sqlite-vec`'s `vec_memories`
table has a fixed embedding dimension — different agents can use different
embedding models.

### Server layout (`packages/server/src`)

- `profiles/profile-store.ts` — scaffold/load/save profile directories.
- `db/agent-db.ts`, `db/control-db.ts` — `openAgentDb` / `openControlDb`.
- `providers/registry.ts` — resolve a `ModelRef` to a model. Providers:
  `anthropic`, `openai`, `lmstudio`, `ollama`.
- `runtime/agent-context.ts` — bundles one agent's profile + db + services.
- `runtime/agent-runtime.ts` — `AgentRuntime`, one per agent; the chat loop +
  inbound bus-message handling.
- `orchestrator/orchestrator.ts` — owns every runtime; create/update/delete,
  subagent spawning, the bus and scheduler.
- `bus/bus.ts` + `bus/transports/*` — the message bus; `local` and `discord`
  transports, chosen via `AGENT_TRANSPORT`.
- `scheduler/scheduler.ts` — cron (`croner`) scheduled prompts.
- `integrations/{email,github}.ts` — per-agent SMTP and GitHub.

### Memory / learning loop

Per-agent: hybrid FTS5 + sqlite-vec search; on session close the agent
summarizes → extracts facts → rebuilds its user profile → optionally authors a
skill, all into its own database.

## Dev

```bash
pnpm install
pnpm dev                              # server + web
pnpm --filter @otterbot/server build  # tsc
pnpm --filter @otterbot/server test   # vitest
pnpm --filter @otterbot/web build     # vite
```

Config: see `.env.example`. Global model fallback via `LMSTUDIO_BASE_URL` /
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`; per-agent overrides live in each
profile's `.env`.

## API

- `GET/POST /api/agents`, `GET/PATCH/DELETE /api/agents/:id`
- `GET /api/agents/:id/{memories,skills,scheduled-tasks}`, `POST .../credentials`
- `POST/DELETE` scheduled tasks; `GET /api/bus/messages`, `/api/subagent-tasks`
- `GET /api/providers`, `/api/model-packs`
- Socket: `chat:join|message|close` (carry `agentId`), `chat:stream|done`,
  `agent:status`, `bus:message`.
