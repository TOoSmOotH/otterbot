/**
 * The first-party capability catalog.
 *
 * A capability is a skill with `meta.tools` populated plus an `enabled` flag —
 * a bundle of (the built-in tools the agent needs) + (a customizable prompt,
 * including a `## Setup` section, that drives them). Unlike the old Hermes
 * index, every entry here is fully authored and bundled in the repo: installing
 * a capability copies its markdown straight onto the agent — no network fetch.
 *
 * Provisioning is self-service: a capability's body has a `## Setup` section
 * telling the agent to install missing dependencies itself via `shell_exec`
 * (network + `npm i -g` + curl static binaries are allowed in the sandbox; no
 * root/apt). Because the capability also grants `shell_exec`, the agent can.
 */

import matter from "gray-matter";

/** A built-in capability the user can install onto an agent. */
export interface CatalogCapability {
  /** Slug — also the skill id when installed. */
  id: string;
  name: string;
  description: string;
  /** Built-in tools this capability grants — see `GRANTABLE_TOOL_NAMES`. */
  tools: string[];
  /** The full capability markdown (frontmatter + body) bundled in the repo. */
  markdown: string;
}

/** Build a capability's markdown from its parts; keeps the catalog declarative. */
function capability(args: {
  id: string;
  name: string;
  description: string;
  tools: string[];
  body: string;
}): CatalogCapability {
  const markdown = matter.stringify(args.body.trim(), {
    name: args.name,
    description: args.description,
    version: "1.0.0",
    author: "otterbot",
    tools: args.tools,
    enabled: true,
  });
  return {
    id: args.id,
    name: args.name,
    description: args.description,
    tools: args.tools,
    markdown,
  };
}

/** The bundled first-party capabilities. */
export const BUILTIN_CAPABILITIES: CatalogCapability[] = [
  capability({
    id: "gh-auth",
    name: "GitHub via gh",
    description:
      "Operate GitHub from the shell with the gh CLI — issues, PRs, repos, releases.",
    tools: ["shell_exec"],
    body: `
Use the GitHub CLI (\`gh\`) for any GitHub task: issues, pull requests, repos,
releases, and the GitHub API. \`gh\` reads its credentials from the
\`GITHUB_TOKEN\` environment variable automatically — it is already present in
your shell environment when a GitHub token is configured for you, so you do
**not** need to run \`gh auth login\`.

## Setup

Before your first GitHub command, make sure \`gh\` is available:

1. Check whether it is already on PATH: \`gh --version\`.
2. If that fails, install the static binary into \`~/bin\` (no root needed):
   \`\`\`sh
   mkdir -p ~/bin && \\
   curl -fsSL https://github.com/cli/cli/releases/latest/download/gh_$(uname -s | tr A-Z a-z)_amd64.tar.gz \\
     | tar xz --strip-components=2 -C ~/bin '*/bin/gh' && \\
   export PATH="$HOME/bin:$PATH" && gh --version
   \`\`\`
3. \`~/bin\` is your workspace HOME, so the binary persists across calls. Add
   \`export PATH="$HOME/bin:$PATH"\` at the start of later commands that need it.

## Usage

- Confirm auth: \`gh auth status\` (it should report it is logged in via
  \`GITHUB_TOKEN\`).
- Create an issue: \`gh issue create --repo owner/repo --title "..." --body "..."\`.
- List issues: \`gh issue list --repo owner/repo\`.
- Open a PR: \`gh pr create --repo owner/repo --title "..." --body "..."\`.
- Anything else: \`gh api\` for raw REST/GraphQL calls.

If a command fails with an authentication error, the \`GITHUB_TOKEN\` secret is
missing or invalid — tell the user to add it in the Agent Studio Credentials
tab rather than trying to log in interactively.
`,
  }),

  capability({
    id: "web-research",
    name: "Web research",
    description:
      "Search the web (DuckDuckGo) and synthesize findings from multiple sources.",
    tools: ["web_search"],
    body: `
You can search the web with the \`web_search\` tool (DuckDuckGo — keyless, no
setup). Use it whenever a question needs current information or facts you are
unsure about.

## Setup

No setup needed — \`web_search\` works out of the box.

## Usage

- Run focused queries; refine wording if the first results are weak.
- Issue several searches for a broad question, each targeting a different angle.
- Cross-check claims across more than one source before stating them as fact.
- Cite the source URLs in your answer so the user can verify.
`,
  }),

  capability({
    id: "email",
    name: "Email",
    description: "Send email from the agent's own account via the send_email tool.",
    tools: ["send_email"],
    body: `
You can send email with the \`send_email\` tool, from your own configured email
account.

## Setup

\`send_email\` needs SMTP credentials configured for you. If a send fails with a
credentials error, ask the user to add the SMTP settings in the Agent Studio
Credentials tab — you cannot configure them yourself.

## Usage

- Call \`send_email\` with \`to\`, \`subject\`, and \`text\`.
- Write a clear subject line and a concise, well-structured body.
- Confirm to the user what you sent and to whom after a successful send.
- Never send email the user did not ask for or approve.
`,
  }),
];

/** Look up a built-in capability by its slug. */
export function getCatalogCapability(id: string): CatalogCapability | undefined {
  return BUILTIN_CAPABILITIES.find((c) => c.id === id);
}
