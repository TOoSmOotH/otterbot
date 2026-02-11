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

## License

MIT — Copyright 2026 Mike Reeves
