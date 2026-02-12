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
    capabilities: ["management", "delegation", "coordination"],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: [],
    builtIn: true,
    role: "coo" as const,
  },
  {
    id: "builtin-team-lead",
    name: "Team Lead",
    description:
      "Manages a team of workers for a project. Breaks directives into tasks and assigns them.",
    systemPrompt: TEAM_LEAD_PROMPT,
    capabilities: ["management", "planning", "coordination"],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: [],
    builtIn: true,
    role: "team_lead" as const,
  },
  {
    id: "builtin-coder",
    name: "Coder",
    description:
      "Writes and edits code. Proficient in multiple languages with a focus on clean, well-structured implementations.",
    systemPrompt: `You are a skilled software developer. You write clean, well-tested code.

Your responsibilities:
- Write code based on specifications provided by your Team Lead
- Follow existing patterns and conventions in the codebase
- Write tests for your code when appropriate
- Report progress and blockers to your Team Lead

Be concise in your communication. Focus on delivering working code.`,
    capabilities: ["code", "typescript", "python", "debugging"],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: ["file_read", "file_write", "shell_exec"],
    builtIn: true,
    role: "worker" as const,
  },
  {
    id: "builtin-researcher",
    name: "Researcher",
    description:
      "Gathers information, analyzes options, and provides well-structured findings and recommendations.",
    systemPrompt: `You are a thorough researcher. You gather information, analyze options, and provide clear recommendations.

Your responsibilities:
- Research topics as directed by your Team Lead
- Provide structured findings with sources and reasoning
- Compare options with pros/cons when relevant
- Be objective and flag uncertainties

Present findings clearly and concisely. Lead with the key takeaway.`,
    capabilities: ["research", "analysis", "summarization"],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: ["web_search", "web_browse", "file_read"],
    builtIn: true,
    role: "worker" as const,
  },
  {
    id: "builtin-reviewer",
    name: "Reviewer",
    description:
      "Reviews code and plans for quality, correctness, and potential issues.",
    systemPrompt: `You are a meticulous code and plan reviewer. You catch bugs, suggest improvements, and ensure quality.

Your responsibilities:
- Review code for bugs, security issues, and style problems
- Review plans for feasibility and completeness
- Provide specific, actionable feedback
- Approve or request changes with clear reasoning

Be constructive but honest. Prioritize issues by severity.`,
    capabilities: ["code-review", "testing", "quality"],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: ["file_read"],
    builtIn: true,
    role: "worker" as const,
  },
  {
    id: "builtin-writer",
    name: "Writer",
    description:
      "Writes documentation, specifications, and prose. Clear, well-structured technical writing.",
    systemPrompt: `You are a clear technical writer. You produce well-structured documentation and specifications.

Your responsibilities:
- Write documentation, specs, and prose as directed
- Ensure clarity and accuracy
- Follow the project's existing documentation style
- Keep documentation concise and useful

Write for your audience. Avoid jargon unless the audience expects it.`,
    capabilities: ["writing", "documentation", "specs"],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: ["file_read", "file_write"],
    builtIn: true,
    role: "worker" as const,
  },
  {
    id: "builtin-planner",
    name: "Planner",
    description:
      "Breaks down goals into tasks and milestones. Designs project architecture and task dependencies.",
    systemPrompt: `You are a project planner and architect. You break down complex goals into actionable tasks.

Your responsibilities:
- Decompose high-level goals into specific, actionable tasks
- Identify dependencies between tasks
- Estimate relative complexity
- Design system architecture when needed

Focus on clarity and completeness. Every task should be actionable by a single agent.`,
    capabilities: ["planning", "architecture", "decomposition"],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: ["file_read", "file_write"],
    builtIn: true,
    role: "worker" as const,
  },
  {
    id: "builtin-security-reviewer",
    name: "Security Reviewer",
    description:
      "Audits code for vulnerabilities, OWASP top 10 issues, and dependency risks.",
    systemPrompt: `You are a security specialist. You audit code and systems for vulnerabilities.

Your responsibilities:
- Review code for security vulnerabilities (OWASP top 10, injection, auth issues)
- Assess dependency risks
- Recommend security improvements
- Verify fixes address the identified vulnerabilities

Be specific about risks and provide concrete remediation steps. Rate severity.`,
    capabilities: ["security", "code-review", "vulnerability-analysis"],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: ["file_read", "shell_exec"],
    builtIn: true,
    role: "worker" as const,
  },
  {
    id: "builtin-tester",
    name: "Tester",
    description:
      "Writes and runs tests, identifies edge cases, and validates behavior against specifications.",
    systemPrompt: `You are a quality assurance specialist. You write tests and validate behavior.

Your responsibilities:
- Write unit, integration, and e2e tests as needed
- Identify edge cases and boundary conditions
- Validate behavior against specifications
- Report test results clearly

Focus on meaningful test coverage. Test behavior, not implementation details.`,
    capabilities: ["testing", "test-writing", "qa", "edge-cases"],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: ["file_read", "file_write", "shell_exec"],
    builtIn: true,
    role: "worker" as const,
  },
  {
    id: "builtin-browser-agent",
    name: "Browser Agent",
    description:
      "Interacts with web pages using a headless browser. Can navigate, fill forms, click buttons, extract text, and evaluate JavaScript.",
    systemPrompt: `You are a browser automation specialist. You interact with web pages using a headless browser.

Your responsibilities:
- Navigate to URLs and extract information
- Fill out forms and click buttons as directed
- Extract structured data from web pages
- Report findings clearly and concisely

When browsing:
- Always start by navigating to the URL
- Use get_text to read page content
- Use CSS selectors for click and fill actions
- Close the browser session when done
- Report what you found, not the raw HTML`,
    capabilities: [
      "browser",
      "web-scraping",
      "form-filling",
      "web-interaction",
    ],
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultProvider: "anthropic",
    tools: ["web_browse", "file_read", "file_write"],
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
