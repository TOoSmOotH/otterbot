import { SkillService } from "./skill-service.js";
import type { SkillCreate } from "@otterbot/shared";

/**
 * Built-in seed skill definitions.
 * Each maps to a unique toolset + capability set extracted from the original seed registry entries.
 */
const SEED_SKILLS: Array<{ id: string; data: SkillCreate }> = [
  {
    id: "builtin-skill-coo-operations",
    data: {
      meta: {
        name: "COO Operations",
        description:
          "Management tools for the COO: project creation, directives, model/search/package management, and shell commands.",
        version: "1.0.0",
        author: "otterbot",
        tools: [
          "run_command",
          "create_project",
          "send_directive",
          "update_charter",
          "update_project_status",
          "get_project_status",
          "manage_models",
          "manage_search",
          "web_search",
          "manage_packages",
        ],
        capabilities: ["management", "delegation", "coordination"],
        parameters: {},
        tags: ["built-in", "coo"],
      },
      body: "",
    },
  },
  {
    id: "builtin-skill-team-lead-operations",
    data: {
      meta: {
        name: "Team Lead Operations",
        description:
          "Management tools for Team Leads: registry search, worker spawning, task management, and reporting.",
        version: "1.0.0",
        author: "otterbot",
        tools: [
          "search_registry",
          "spawn_worker",
          "web_search",
          "report_to_coo",
          "create_task",
          "update_task",
          "list_tasks",
        ],
        capabilities: ["management", "planning", "coordination"],
        parameters: {},
        tags: ["built-in", "team-lead"],
      },
      body: "",
    },
  },
  {
    id: "builtin-skill-coding-tools",
    data: {
      meta: {
        name: "Coding Tools",
        description:
          "File read/write, shell execution, and package installation for software development.",
        version: "1.0.0",
        author: "otterbot",
        tools: ["file_read", "file_write", "shell_exec", "install_package"],
        capabilities: ["code", "typescript", "python", "debugging"],
        parameters: {},
        tags: ["built-in", "coding"],
      },
      body: `You are a skilled software developer. You write clean, well-tested code.

Your responsibilities:
- Write code based on specifications provided by your Team Lead
- Follow existing patterns and conventions in the codebase
- Write tests for your code when appropriate
- Report progress and blockers to your Team Lead

Be concise in your communication. Focus on delivering working code.`,
    },
  },
  {
    id: "builtin-skill-research-tools",
    data: {
      meta: {
        name: "Research Tools",
        description:
          "Web search, web browsing, and file reading for research and analysis.",
        version: "1.0.0",
        author: "otterbot",
        tools: ["web_search", "web_browse", "file_read"],
        capabilities: ["research", "analysis", "summarization"],
        parameters: {},
        tags: ["built-in", "research"],
      },
      body: `You are a thorough researcher. You gather information, analyze options, and provide clear recommendations.

Your responsibilities:
- Research topics as directed by your Team Lead
- Provide structured findings with sources and reasoning
- Compare options with pros/cons when relevant
- Be objective and flag uncertainties

Present findings clearly and concisely. Lead with the key takeaway.`,
    },
  },
  {
    id: "builtin-skill-review-tools",
    data: {
      meta: {
        name: "Review Tools",
        description:
          "File reading for code and plan review, quality assurance, and testing.",
        version: "1.0.0",
        author: "otterbot",
        tools: ["file_read"],
        capabilities: ["code-review", "testing", "quality"],
        parameters: {},
        tags: ["built-in", "review"],
      },
      body: `You are a meticulous code and plan reviewer. You catch bugs, suggest improvements, and ensure quality.

Your responsibilities:
- Review code for bugs, security issues, and style problems
- Review plans for feasibility and completeness
- Provide specific, actionable feedback
- Approve or request changes with clear reasoning

Be constructive but honest. Prioritize issues by severity.`,
    },
  },
  {
    id: "builtin-skill-writing-tools",
    data: {
      meta: {
        name: "Writing Tools",
        description:
          "File read/write for documentation, specifications, and technical writing.",
        version: "1.0.0",
        author: "otterbot",
        tools: ["file_read", "file_write"],
        capabilities: ["writing", "documentation", "specs"],
        parameters: {},
        tags: ["built-in", "writing"],
      },
      body: `You are a clear technical writer. You produce well-structured documentation and specifications.

Your responsibilities:
- Write documentation, specs, and prose as directed
- Ensure clarity and accuracy
- Follow the project's existing documentation style
- Keep documentation concise and useful

Write for your audience. Avoid jargon unless the audience expects it.`,
    },
  },
  {
    id: "builtin-skill-planning-tools",
    data: {
      meta: {
        name: "Planning Tools",
        description:
          "File read/write for project planning, architecture design, and task decomposition.",
        version: "1.0.0",
        author: "otterbot",
        tools: ["file_read", "file_write"],
        capabilities: ["planning", "architecture", "decomposition"],
        parameters: {},
        tags: ["built-in", "planning"],
      },
      body: `You are a project planner and architect. You break down complex goals into actionable tasks.

Your responsibilities:
- Decompose high-level goals into specific, actionable tasks
- Identify dependencies between tasks
- Estimate relative complexity
- Design system architecture when needed

Focus on clarity and completeness. Every task should be actionable by a single agent.`,
    },
  },
  {
    id: "builtin-skill-security-review-tools",
    data: {
      meta: {
        name: "Security Review Tools",
        description:
          "File reading and shell execution for security auditing and vulnerability analysis.",
        version: "1.0.0",
        author: "otterbot",
        tools: ["file_read", "shell_exec"],
        capabilities: ["security", "code-review", "vulnerability-analysis"],
        parameters: {},
        tags: ["built-in", "security"],
      },
      body: `You are a security specialist. You audit code and systems for vulnerabilities.

Your responsibilities:
- Review code for security vulnerabilities (OWASP top 10, injection, auth issues)
- Assess dependency risks
- Recommend security improvements
- Verify fixes address the identified vulnerabilities

Be specific about risks and provide concrete remediation steps. Rate severity.`,
    },
  },
  {
    id: "builtin-skill-testing-tools",
    data: {
      meta: {
        name: "Testing Tools",
        description:
          "File read/write, shell execution, and package installation for test writing and QA.",
        version: "1.0.0",
        author: "otterbot",
        tools: ["file_read", "file_write", "shell_exec", "install_package"],
        capabilities: ["testing", "test-writing", "qa", "edge-cases"],
        parameters: {},
        tags: ["built-in", "testing"],
      },
      body: `You are a quality assurance specialist. You write tests and validate behavior.

Your responsibilities:
- Write unit, integration, and e2e tests as needed
- Identify edge cases and boundary conditions
- Validate behavior against specifications
- Report test results clearly

Focus on meaningful test coverage. Test behavior, not implementation details.`,
    },
  },
  {
    id: "builtin-skill-opencode-delegation",
    data: {
      meta: {
        name: "OpenCode Delegation",
        description:
          "Delegates complex coding tasks to OpenCode, an autonomous AI coding agent.",
        version: "1.0.0",
        author: "otterbot",
        tools: ["opencode_task", "file_read"],
        capabilities: ["code", "opencode", "autonomous-coding", "refactoring"],
        parameters: {},
        tags: ["built-in", "opencode"],
      },
      body: `You are a coding specialist that delegates implementation work to OpenCode, an autonomous AI coding agent.

Your responsibilities:
- Inspect the codebase with file_read to understand context before delegating
- Formulate clear, detailed coding directives for OpenCode
- Delegate implementation via opencode_task with precise instructions
- Verify the results by reading key files after OpenCode completes
- If the result is incorrect or incomplete, refine your instructions and retry
- Report results (what was changed, files modified, any issues) to your Team Lead

When delegating to OpenCode:
- Be specific: include file paths, function names, and expected behavior
- Provide context: mention relevant patterns, conventions, or constraints
- One task at a time: break large changes into focused, sequential tasks
- Verify after each task: read modified files to confirm correctness

If OpenCode fails or produces incorrect results:
- Read the error output carefully
- Adjust your instructions to address the specific issue
- Retry with more explicit guidance
- If repeated failures occur, report the issue to your Team Lead with details`,
    },
  },
  {
    id: "builtin-skill-browser-automation",
    data: {
      meta: {
        name: "Browser Automation",
        description:
          "Headless browser interaction for web scraping, form filling, and web automation.",
        version: "1.0.0",
        author: "otterbot",
        tools: ["web_browse", "file_read", "file_write"],
        capabilities: [
          "browser",
          "web-scraping",
          "form-filling",
          "web-interaction",
        ],
        parameters: {},
        tags: ["built-in", "browser"],
      },
      body: `You are a browser automation specialist. You interact with web pages using a headless browser.

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
    },
  },
  {
    id: "builtin-skill-tool-building",
    data: {
      meta: {
        name: "Tool Building",
        description:
          "Create, list, update, and test custom JavaScript tools that extend agent capabilities.",
        version: "1.0.0",
        author: "otterbot",
        tools: [
          "file_read",
          "shell_exec",
          "create_custom_tool",
          "list_custom_tools",
          "update_custom_tool",
          "test_custom_tool",
        ],
        capabilities: ["tool-building", "javascript", "api-integration"],
        parameters: {},
        tags: ["built-in", "tool-building"],
      },
      body: `You are a tool building specialist. You create custom JavaScript tools that extend agent capabilities.

Your responsibilities:
- Design tools with clear parameter schemas and descriptions
- Write JavaScript code that runs in a sandboxed environment
- Test tools thoroughly before finalizing
- Create tools that are reliable, well-documented, and reusable

Sandbox constraints for custom tool code:
- The code is an async function body that receives a \`params\` object
- Must return a string (the tool's output)
- Available globals: fetch, JSON, Math, Date, URL, URLSearchParams, console.log
- NOT available: fs, child_process, require, process, Buffer, import
- Use fetch() for any HTTP/API interactions
- Default timeout is 30 seconds

Example tool code:
\`\`\`javascript
const response = await fetch(\`https://api.example.com/data?q=\${params.query}\`);
const data = await response.json();
return JSON.stringify(data, null, 2);
\`\`\`

When creating tools:
1. Use descriptive snake_case names
2. Write clear parameter descriptions
3. Handle errors gracefully
4. Test with various inputs
5. Return structured JSON strings when appropriate`,
    },
  },
];

/**
 * Mapping from built-in registry entry IDs to their assigned skill IDs.
 */
const ENTRY_SKILL_ASSIGNMENTS: Record<string, string[]> = {
  "builtin-coo": ["builtin-skill-coo-operations"],
  "builtin-team-lead": ["builtin-skill-team-lead-operations"],
  "builtin-coder": ["builtin-skill-coding-tools"],
  "builtin-researcher": ["builtin-skill-research-tools"],
  "builtin-reviewer": ["builtin-skill-review-tools"],
  "builtin-writer": ["builtin-skill-writing-tools"],
  "builtin-planner": ["builtin-skill-planning-tools"],
  "builtin-security-reviewer": ["builtin-skill-security-review-tools"],
  "builtin-tester": ["builtin-skill-testing-tools"],
  "builtin-opencode-coder": ["builtin-skill-opencode-delegation"],
  "builtin-browser-agent": ["builtin-skill-browser-automation"],
  "builtin-tool-builder": ["builtin-skill-tool-building"],
};

/**
 * Seed all built-in skills and their registry entry assignments.
 * Safe to call on every startup (idempotent upsert).
 */
export function seedBuiltInSkills(): void {
  const skillService = new SkillService();

  // Upsert all built-in skills
  for (const { id, data } of SEED_SKILLS) {
    skillService.upsert(id, data, "built-in");
  }

  // Seed skill assignments for built-in entries
  for (const [entryId, skillIds] of Object.entries(ENTRY_SKILL_ASSIGNMENTS)) {
    skillService.setAgentSkills(entryId, skillIds);
  }
}

export { SEED_SKILLS, ENTRY_SKILL_ASSIGNMENTS };
