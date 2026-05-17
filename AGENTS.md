# Repository Guidelines

## Project Overview

Otterbot is a local-first multi-agent AI orchestration app. The user chats with a COO agent that can coordinate team leads and workers; all agent-to-agent traffic flows through a central message bus that is persisted and streamed to the UI.

This is a pnpm monorepo using Node 22+ and TypeScript.

## Repository Layout

- `packages/shared` - shared TypeScript types and contracts for messages, agents, skills, memory, profiles, and spawn/task data.
- `packages/server` - Fastify + Socket.IO backend; SQLite/Drizzle persistence; encrypted control and per-agent databases; providers, runtime, orchestration, bus, scheduler, and integrations.
- `packages/web` - React/Vite frontend with Zustand state, Tailwind styles, Socket.IO client, and Three.js/react-three-fiber views.
- `packages/cli` - Ink-based terminal client.
- `assets/` - templates, environment assets, scenes, workers, and bundled app/office/game scaffolds.
- `docs/` - project documentation.

## Development Commands

Run commands from the repo root unless a package path is explicitly needed.

```bash
pnpm install
pnpm dev
pnpm build
pnpm --filter @otterbot/server build
pnpm --filter @otterbot/server test
pnpm --filter @otterbot/web build
pnpm --filter @otterbot/web test:e2e
pnpm --filter @otterbot/cli build
```

`pnpm dev` builds and watches `@otterbot/shared`, starts the server, and starts the Vite web app. The backend defaults to port `3001`; the frontend defaults to Vite's port `5173`.

`pnpm dev` runs `scripts/ensure-env.mjs` first. That script creates `.env` from `.env.example` with a generated `OTTERBOT_DB_KEY` only when `.env` is missing; it must not overwrite an existing `.env`.

For production-style single-port serving, run `pnpm build` and then `pnpm --filter @otterbot/server start`. The backend serves the built frontend from `WEB_DIST_DIR` when `index.html` exists there.

Server tests use a fake model by default. To exercise a real OpenAI-compatible endpoint, set `OTTER_TEST_MODEL_URL` and `OTTER_TEST_MODEL`.

## Configuration And Data

- Copy `.env.example` to `.env` for local development.
- `OTTERBOT_DB_KEY` controls SQLite encryption. Unset databases are acceptable only for dev.
- Credentials and provider secrets should be managed through app storage, not committed to source. Do not add plaintext API keys, tokens, SMTP credentials, or model endpoints.
- Agent profiles live under `data/profiles/<id>/` at runtime. Treat runtime `data/` contents as local state rather than source.

## Architecture Notes

- Every user, agent, and worker message should go through the bus so it can be persisted and broadcast to the frontend.
- `data/control.db` is the shared control plane for agent registry, bus messages, subagent tasks, scheduled tasks, agent secrets, and app settings.
- Each agent has its own encrypted SQLite database because vector memory dimensions may differ by embedding model.
- Provider resolution is centralized in `packages/server/src/providers/registry.ts`; avoid scattering provider-specific logic through runtime code.

## Coding Conventions

- Prefer existing package boundaries and shared types from `@otterbot/shared`.
- Keep server APIs and Socket.IO events aligned with frontend consumers.
- Use structured validation with existing schemas/patterns where present.
- For frontend work, follow the existing React/Zustand/Tailwind patterns and keep tool-like interfaces dense, readable, and responsive.
- Do not introduce new frameworks or large abstractions unless they fit an established local pattern.

## Verification

For narrow TypeScript changes, run the relevant package build/test. For shared contract changes, build all affected packages. For UI changes, run `pnpm --filter @otterbot/web build`; use Playwright or a browser smoke check when behavior/layout changes are user-facing.

Before handing off, check `git status --short` and mention any tests or builds that could not be run.
