# Specialist Agents

Otterbot's agent system includes **Specialist Agents** — agents with their own isolated knowledge store, data ingestion pipeline, config schema, and tools. They are the primary extension point for connecting Otterbot to external data sources.

## TL;DR

| | Standard Agents | Specialist Agents |
|---|---|---|
| **What they are** | Autonomous AI actors that reason, plan, and delegate | Agents with their own data store and ingestion pipeline |
| **Analogy** | Employees in a company | Subject-matter experts with their own filing system |
| **Data** | Conversation history, activity records | Isolated knowledge store (SQLite + FTS + vector search) |
| **LLM access** | Always (it's their core function) | Optional (agent can be enabled per specialist) |
| **Managed in** | Agent Workshop > Agents tab | Agent Workshop > Specialists tab |

## Agent Hierarchy

All agents form a hierarchy. Specialist agents sit alongside the COO:

```
CEO (you)
 └── COO (always running)
      ├── Team Lead (per project)
      │    ├── Worker A
      │    └── Worker B
      └── Specialist Agent (per enabled specialist)
           └── isolated knowledge store + tools
```

### Standard Roles

- **COO** — the always-running orchestrator, routes tasks and queries
- **Team Lead** — manages a project, delegates to workers
- **Worker** — executes tasks with tool access
- **Admin Assistant** / **Scheduler** — utility roles

### Specialist Agents

A specialist agent is an agent that brings its own:

- **Knowledge store** — isolated per-specialist SQLite database with full-text search
- **Data ingestion** — polling triggers, webhooks, or full-sync handlers
- **Config schema** — user-facing settings (API keys, repo names, etc.)
- **Custom tools** — structured access to the specialist's domain data
- **Migrations** — schema versioning for custom database tables

Specialists are defined using `defineSpecialist()` (alias for `defineModule()`):

```typescript
import { defineSpecialist } from "@otterbot/shared";

export default defineSpecialist({
  manifest: {
    id: "github-discussions",
    name: "GitHub Discussions",
    version: "0.2.0",
    description: "Monitors GitHub Discussions and indexes them for Q&A",
  },

  configSchema: {
    repo_owner: { type: "string", required: true, description: "..." },
    github_token: { type: "secret", required: false, description: "..." },
  },

  agent: {
    defaultName: "Discussions Agent",
    defaultPrompt: "You are a GitHub Discussions specialist...",
  },

  tools: [
    {
      name: "search_discussions",
      description: "Search structured discussions with filters",
      parameters: { /* JSON Schema */ },
      execute: async (args, ctx) => { /* ... */ },
    },
  ],

  triggers: [{ type: "poll", intervalMs: 300_000 }],
  migrations: [migration001],

  async onPoll(ctx) { /* fetch and index data */ },
  async onFullSync(ctx) { /* full re-index */ },
  async onQuery(query, ctx) { /* fallback query handler */ },
});
```

### Specialist Lifecycle

1. **Install** from git, npm, or local path
2. **Configure** via the Specialists tab (API keys, repo names, etc.)
3. **Enable** — the loader imports it, runs migrations, starts polling
4. If the specialist defines an `agent`, a specialist agent is spawned with its own LLM
5. **Query** — the COO routes questions to specialists via the `module_query` tool
6. **Disable/Uninstall** — stops polling, destroys the agent

### Knowledge Store

Every enabled specialist gets its own SQLite database at `/data/modules/{specialistId}/knowledge.db`. The store provides:

- `upsert(id, content, metadata)` — add or update a document
- `search(query, limit)` — full-text + vector search
- `delete(id)` / `get(id)` / `count()`
- Direct `db` access for custom SQL on specialist-specific tables

## How Specialists Connect to the Agent System

The bridge is the **`module_query` tool** on the COO. When a user asks a question that involves specialist data:

```
User: "What open discussions are there about auth?"
  │
  ▼
COO receives message, reasons, calls module_query tool
  │
  ▼
module_query checks: does the specialist have an active agent?
  │
  ├─ YES ──▶ Routes question to Specialist Agent via message bus
  │           Specialist Agent uses knowledge_search + custom tools
  │           Returns synthesized answer
  │
  └─ NO ───▶ Falls back to onQuery handler
              Or raw knowledge store search
  │
  ▼
COO incorporates answer into its response to the user
```

## UI: Agent Workshop

Specialists appear in two places in the Agent Workshop:

### Agents Tab

The Agents tab sidebar has a **Specialists** group that lists all installed specialist agents. Clicking one navigates to the Specialists tab for full management.

### Specialists Tab

The dedicated Specialists tab provides full management:

- **Sidebar**: installed specialists, grouped by enabled/disabled
- **Detail panel**: toggle, status, source info, document count
- **Actions**: Sync Now, Full Sync, Uninstall
- **Knowledge Store**: database table stats
- **Query box**: ask the specialist a question directly
- **Configuration**: dynamic form from config schema (API keys, agent model/provider/prompt)
- **Chat**: multi-specialist chat modal
- **Install**: add new specialists from git, npm, or local path

## When to Build a Specialist

Build a specialist when you want to:

- **Connect to an external data source** — APIs, RSS feeds, databases, SaaS platforms
- **Index and search documents** — build a queryable knowledge base from external content
- **Answer domain-specific questions** — enable the specialist's agent to reason over indexed data
- **React to external events** — webhooks, polling for changes, scheduled syncs
- **Provide specialized tools** — give the specialist agent structured access to external systems

### Example: Discord Help Channel Bot

Say you want Otterbot to auto-respond in a Discord help channel using past answers as context:

```
discord-help specialist
├── configSchema: server_id, channel_id, bot_token
├── triggers: [{ type: "poll", intervalMs: 60_000 }]
├── onPoll: fetch new messages, upsert into knowledge store
├── onWebhook: receive Discord gateway events in real time
├── agent:
│   ├── defaultName: "Discord Help Agent"
│   └── defaultPrompt: "You answer help questions using past channel history..."
├── tools:
│   └── search_resolved_threads: query past answered threads by topic
└── knowledge store: all indexed messages with metadata (author, thread, resolved status)
```

The specialist agent has full access to the indexed channel history. When someone asks a question, the COO routes it to this specialist, which searches past answers and synthesizes a response.

## Exporting Specialists

Specialists are exportable as packages — code, config schema, migrations, and tools. **No data is included** in the export. This lets users share specialists with others.

A specialist package is a directory:

```
my-specialist/
├── package.json          # name, version, dependencies
├── tsconfig.json
├── src/
│   ├── index.ts          # defineSpecialist({ ... })
│   └── migrations/
│       └── 001-initial.ts
└── README.md
```

## Key Types

```typescript
// packages/shared/src/types/module.ts

// Define a specialist (alias for defineModule)
export const defineSpecialist = defineModule;

// Type aliases for user-facing naming
export type SpecialistDefinition = ModuleDefinition;
export type SpecialistManifest = ModuleManifest;
export type SpecialistConfigSchema = ModuleConfigSchema;
export type SpecialistAgentConfig = ModuleAgentConfig;
export type InstalledSpecialist = InstalledModule;
```

```typescript
// packages/shared/src/types/agent.ts

enum AgentRole {
  COO = "coo",
  TeamLead = "team_lead",
  Worker = "worker",
  SpecialistAgent = "module_agent",  // specialist agents
  // ...
}
```

## File Locations

| Component | Path |
|-----------|------|
| Agent types | `packages/shared/src/types/agent.ts` |
| Specialist/Module types | `packages/shared/src/types/module.ts` |
| Agent implementations | `packages/server/src/agents/` |
| Module system (backend) | `packages/server/src/modules/` |
| COO's query tools | `packages/server/src/modules/module-tools.ts` |
| Built-in specialists | `modules/` |
| Specialists UI | `packages/web/src/components/settings/SpecialistsSubView.tsx` |
| Agent Workshop | `packages/web/src/components/settings/AgentWorkshopTab.tsx` |

## Terminology Note

Internally, the codebase uses "module" naming for backward compatibility — `ModuleDefinition`, `defineModule()`, `/api/modules/*` endpoints. The user-facing term is **Specialist Agent**. Type aliases (`SpecialistDefinition`, `defineSpecialist()`, etc.) are provided for new code. Both names refer to the same system.
