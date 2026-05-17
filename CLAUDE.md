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
agent.db       isolated SQLite — conversations, memories, skills, vectors
skills/        per-agent markdown skill files
```

`data/control.db` is the shared control plane: the agent registry, the
agent-to-agent `bus_messages` log, `subagent_tasks`, `scheduled_tasks`,
`agent_secrets` (per-agent credentials), and `app_settings`.

**Credentials** are never on disk in plaintext — API keys, GitHub tokens, SMTP
creds and model endpoints live in `agent_secrets` and are managed via the Agent
Studio. All SQLite databases are encrypted with `OTTERBOT_DB_KEY` from `.env`
(the only secret in `.env`); unset = unencrypted (dev only).

Per-agent isolated databases are required because `sqlite-vec`'s `vec_memories`
table has a fixed embedding dimension — different agents can use different
embedding models.

On first run an onboarding wizard walks the user through configuring their
first agent (the COO): provider, model, credentials, persona.

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
pnpm --filter @otterbot/server test   # vitest — fake model by default
pnpm --filter @otterbot/web build     # vite
pnpm --filter @otterbot/web test:e2e  # playwright — self-contained fake model
```

Server tests run against a fake OpenAI-compatible server. To run them against
a real model instead, set `OTTER_TEST_MODEL_URL` and `OTTER_TEST_MODEL`:

```bash
OTTER_TEST_MODEL_URL=http://host:1234/v1 OTTER_TEST_MODEL=some-model \
  pnpm --filter @otterbot/server test
```

Config: see `.env.example`. Global model fallback via `LMSTUDIO_BASE_URL` /
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`; per-agent overrides live in each
profile's `.env`.

## API

- `GET/POST /api/agents`, `GET/PATCH/DELETE /api/agents/:id`
- `GET /api/agents/:id/{memories,skills,scheduled-tasks}`, `POST .../credentials`
- `POST/DELETE /api/agents/:id/memories[/:memId]` — curate an agent's memory
- `GET /api/skill-catalog` (built-in Hermes skills), `POST /api/agents/:id/skills/install`
- `POST/DELETE` scheduled tasks; `GET /api/bus/messages`, `/api/subagent-tasks`
- `GET /api/providers`, `/api/model-packs`
- `POST /api/test-model` (verify a model), `/api/provider-models` (list a
  provider's served models)
- `GET /api/auth/openai/status`, `POST /api/auth/openai/{login,signout}` —
  ChatGPT subscription OAuth (instance-wide; see `auth/openai-auth-store.ts`)
- Socket: `chat:join|message|close` (carry `agentId`), `chat:stream|done`,
  `agent:status`, `bus:message`.
