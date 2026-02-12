# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Smoothbot is a personal AI assistant — an open-source alternative to [OpenClaw](https://github.com/openclaw/openclaw). Like OpenClaw, it aims to be an autonomous AI agent that connects to messaging platforms (WhatsApp, Telegram, Slack, Discord, etc.) and performs tasks on the user's behalf, with data kept local and private.

## Current State

This project is in early initialization. The codebase is being built from scratch.

## Architecture Goals

The project draws inspiration from OpenClaw's gateway-centric architecture:
- A central WebSocket control plane manages sessions, channels, tools, and events
- Channel integrations connect to messaging platforms through dedicated adapters
- Skills/tools provide the agent's capabilities (calendar, email, browser automation, etc.)
- Configuration is file-based and local to the user's machine

## Environment

`pnpm` is not on the default PATH. Always invoke it via `npx pnpm` (e.g. `npx pnpm test`, `npx pnpm build`, `npx pnpm dev`).

## Development Commands

```bash
# Run all tests (vitest, from repo root)
npx pnpm test

# Run tests in watch mode
npx pnpm test:watch

# Type-check individual packages (no emit)
npx tsc --noEmit -p packages/server/tsconfig.json
npx tsc --noEmit -p packages/web/tsconfig.json
npx tsc --noEmit -p packages/shared/tsconfig.json

# Build all packages
npx pnpm build

# Dev mode (server + web)
npx pnpm dev
```

**Note:** `packages/server` has a pre-existing type error in `src/tts/tts.ts` for the `kokoro-js` module — this is expected and can be ignored when type-checking.

## License

MIT — Copyright 2026 Mike Reeves
