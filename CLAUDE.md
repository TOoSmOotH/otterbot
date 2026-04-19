# CLAUDE.md

## Project Overview

Otterbot v2 — a minimal personal AI assistant with persistent cross-session learning (memory, skills, user profile), backed by a local LM Studio model.

## Architecture

- `packages/shared` — types (message, skill, memory, user-profile, agent-view)
- `packages/server` — Fastify + Socket.IO; SQLite+FTS5; agent loop using `ai` SDK + `@ai-sdk/openai-compatible` pointing at LM Studio
- `packages/web` — React + Zustand; chat UI + 2D/3D/Desktop visualization panes

## Learning Loop

On each turn the system prompt is composed of: persona + user profile + top-K FTS memory hits + top-K matching skills + date.

On session close (idle or `chat:close`), sequentially: summarize → extract facts → dialectic profile rebuild → optional `author_skill`.

Tools available to the agent: `save_memory`, `list_skills`, `author_skill`, `update_skill`, `update_user_profile`.

Interop: `/api/skills/import` (URL or raw markdown) and `/api/skills/:id/export` speak the agentskills.io frontmatter dialect.

## Environment

```
LMSTUDIO_BASE_URL=http://localhost:1234/v1     # default
LMSTUDIO_MODEL=<model id loaded in LM Studio>
ENABLE_DESKTOP=false|true
VNC_HOST=127.0.0.1
VNC_PORT=5901
```

## Dev

```bash
pnpm install
pnpm dev              # starts shared/server/web together
pnpm --filter @otterbot/server dev
pnpm --filter @otterbot/web dev
pnpm test:e2e         # playwright — requires LM Studio running
```

## CI/CD

Branch is `v2`, cut from `dev`. Standard promote-via-PR flow.
