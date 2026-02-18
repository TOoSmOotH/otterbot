import { getDb, migrateDb, schema } from "./index.js";
import { COO_SYSTEM_PROMPT } from "../agents/prompts/coo.js";
import { TEAM_LEAD_PROMPT } from "../agents/prompts/team-lead.js";

const SEED_ENTRIES = [
  {
    id: "builtin-coo",
    name: "COO",
    description:
      "Chief Operating Officer. Receives goals from the CEO and delegates to Team Leads.",
    systemPrompt: COO_SYSTEM_PROMPT,
    capabilities: [] as string[],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: [] as string[],
    builtIn: true,
    role: "coo" as const,
  },
  {
    id: "builtin-team-lead",
    name: "Team Lead",
    description:
      "Manages a team of workers for a project. Breaks directives into tasks and assigns them.",
    systemPrompt: TEAM_LEAD_PROMPT,
    capabilities: [] as string[],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: [] as string[],
    builtIn: true,
    role: "team_lead" as const,
  },
  {
    id: "builtin-coder",
    name: "Coder",
    description:
      "Writes and edits code. Proficient in multiple languages with a focus on clean, well-structured implementations.",
    systemPrompt: "See assigned skills for instructions.",
    capabilities: [] as string[],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: [] as string[],
    builtIn: true,
    role: "worker" as const,
  },
  {
    id: "builtin-researcher",
    name: "Researcher",
    description:
      "Gathers information, analyzes options, and provides well-structured findings and recommendations.",
    systemPrompt: "See assigned skills for instructions.",
    capabilities: [] as string[],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: [] as string[],
    builtIn: true,
    role: "worker" as const,
  },
  {
    id: "builtin-reviewer",
    name: "Reviewer",
    description:
      "Reviews code and plans for quality, correctness, and potential issues.",
    systemPrompt: "See assigned skills for instructions.",
    capabilities: [] as string[],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: [] as string[],
    builtIn: true,
    role: "worker" as const,
  },
  {
    id: "builtin-writer",
    name: "Writer",
    description:
      "Writes documentation, specifications, and prose. Clear, well-structured technical writing.",
    systemPrompt: "See assigned skills for instructions.",
    capabilities: [] as string[],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: [] as string[],
    builtIn: true,
    role: "worker" as const,
  },
  {
    id: "builtin-planner",
    name: "Planner",
    description:
      "Breaks down goals into tasks and milestones. Designs project architecture and task dependencies.",
    systemPrompt: "See assigned skills for instructions.",
    capabilities: [] as string[],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: [] as string[],
    builtIn: true,
    role: "worker" as const,
  },
  {
    id: "builtin-security-reviewer",
    name: "Security Reviewer",
    description:
      "Audits code for vulnerabilities, OWASP top 10 issues, and dependency risks.",
    systemPrompt: "See assigned skills for instructions.",
    capabilities: [] as string[],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: [] as string[],
    builtIn: true,
    role: "worker" as const,
  },
  {
    id: "builtin-tester",
    name: "Tester",
    description:
      "Writes and runs tests, identifies edge cases, and validates behavior against specifications.",
    systemPrompt: "See assigned skills for instructions.",
    capabilities: [] as string[],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: [] as string[],
    builtIn: true,
    role: "worker" as const,
  },
  {
    id: "builtin-opencode-coder",
    name: "OpenCode Coder",
    description:
      "Delegates complex coding tasks to OpenCode, an autonomous AI coding agent. " +
      "Ideal for multi-file implementations, refactoring, and large code changes.",
    systemPrompt: "See assigned skills for instructions.",
    capabilities: [] as string[],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: [] as string[],
    builtIn: true,
    role: "worker" as const,
  },
  {
    id: "builtin-browser-agent",
    name: "Browser Agent",
    description:
      "Interacts with web pages using a headless browser. Can navigate, fill forms, click buttons, extract text, and evaluate JavaScript.",
    systemPrompt: "See assigned skills for instructions.",
    capabilities: [] as string[],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: [] as string[],
    builtIn: true,
    role: "worker" as const,
  },
  {
    id: "builtin-tool-builder",
    name: "Tool Builder",
    description:
      "Creates custom JavaScript tools that extend agent capabilities. Can design, implement, and test new tools.",
    systemPrompt: "See assigned skills for instructions.",
    capabilities: [] as string[],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: [] as string[],
    builtIn: true,
    role: "worker" as const,
  },
];

/** Upsert all built-in registry entries. Safe to call on every startup. */
export function seedBuiltIns() {
  const db = getDb();

  for (const entry of SEED_ENTRIES) {
    db.insert(schema.registryEntries)
      .values({
        ...entry,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: schema.registryEntries.id,
        set: {
          name: entry.name,
          description: entry.description,
          systemPrompt: entry.systemPrompt,
          capabilities: entry.capabilities,
          defaultModel: entry.defaultModel,
          defaultProvider: entry.defaultProvider,
          tools: entry.tools,
          builtIn: entry.builtIn,
          role: entry.role,
        },
      })
      .run();
  }
}

/** Standalone entrypoint for `npm run db:seed` */
async function seed() {
  await migrateDb();
  seedBuiltIns();
  console.log(`Seeded ${SEED_ENTRIES.length} built-in registry entries.`);
}

// Only run standalone when executed directly (not imported)
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/seed.ts") ||
    process.argv[1].endsWith("/seed.js"));

if (isDirectRun) {
  seed().catch(console.error);
}
