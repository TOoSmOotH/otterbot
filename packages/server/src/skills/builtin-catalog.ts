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
  /** Env-var names this capability expects in the agent's shell or direct integrations. */
  credentialKeys: string[];
  /** The full capability markdown (frontmatter + body) bundled in the repo. */
  markdown: string;
}

/** Build a capability's markdown from its parts; keeps the catalog declarative. */
function capability(args: {
  id: string;
  name: string;
  description: string;
  tools: string[];
  credentialKeys?: string[];
  body: string;
}): CatalogCapability {
  const credentialKeys = args.credentialKeys ?? [];
  const frontmatter: Record<string, unknown> = {
    name: args.name,
    description: args.description,
    version: "1.0.0",
    author: "otterbot",
    tools: args.tools,
    enabled: true,
  };
  if (credentialKeys.length) frontmatter.credentialKeys = credentialKeys;
  const markdown = matter.stringify(args.body.trim(), frontmatter);
  return {
    id: args.id,
    name: args.name,
    description: args.description,
    tools: args.tools,
    credentialKeys,
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
    credentialKeys: ["GITHUB_TOKEN"],
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
    id: "agentic-browsing",
    name: "Agentic browsing",
    description:
      "Drive a real browser — navigate, click, type, read, and screenshot pages — via agent-browser.",
    tools: [
      "browser_navigate",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "browser_press",
      "browser_scroll",
      "browser_back",
      "browser_get_images",
      "browser_console",
      "browser_vision",
    ],
    body: `
You can drive a real, headless web browser. It is **persistent and private to
you** — cookies and logins survive across tasks, so once you sign in to a site
you stay signed in.

## Setup

The browser engine (\`agent-browser\`) ships with otterbot, but Chrome must be
downloaded once on the host. If a browser tool fails saying the engine is not
ready, ask the user to run \`agent-browser install\` on the server (or
\`agent-browser install --with-deps\` on Linux to also install system libraries).
You cannot do this yourself.

## How to browse

Work the page in a loop — never guess element ids:

1. **browser_navigate** to a URL.
2. **browser_snapshot** to see the page as an accessibility tree. Each element
   has a ref like \`@e3\`.
3. Act on a ref: **browser_click** \`@e3\`, **browser_type** \`@e5\` "text",
   **browser_press** "Enter", **browser_scroll** to reveal more.
4. **Snapshot again** after anything that changes the page — refs are only valid
   for the snapshot they came from.

## Tips

- Prefer the snapshot (text) over **browser_vision** (screenshot + vision model);
  reach for vision only for layout, images, or charts the tree can't convey.
- \`browser_get_images\` lists images on the page; \`browser_console\` shows console logs.
- Quote the page URL and what you saw so the user can verify.
`,
  }),

  capability({
    id: "email",
    name: "Email",
    description: "Send email from the agent's own account via the send_email tool.",
    tools: ["send_email"],
    credentialKeys: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"],
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

  capability({
    id: "image-gen",
    name: "Image generation",
    description:
      "Generate and edit images with ChatGPT (gpt-image-2), via the instance's ChatGPT connection.",
    tools: ["generate_image", "edit_image"],
    body: `
You can create and edit images with the \`generate_image\` and \`edit_image\`
tools. They use ChatGPT's image model (gpt-image-2) through the instance's
ChatGPT subscription — no API key or per-agent credential is involved.

## Setup

These tools need the user's ChatGPT account connected for this otterbot instance
(**Settings → OpenAI → Sign in with ChatGPT**). If a tool reports it is not
connected, ask the user to connect ChatGPT there — you cannot do it yourself.

## Usage

- **generate_image**: pass a vivid, specific \`prompt\`. Describe subject, style,
  composition, and mood. Pick \`quality\` (\`low\`/\`medium\`/\`high\`) for the
  speed/detail trade-off, and \`size\` for the aspect ratio.
- **edit_image**: pass a \`prompt\` plus a \`source_image\` — the URL of an image
  you generated earlier, a file in your workspace, or an http(s) URL. Add a
  \`mask\` to confine the edit to part of the image.
- The saved image is shown in the chat automatically; you don't need to paste the
  URL. Briefly tell the user what you made.
`,
  }),

  capability({
    id: "code-reference",
    name: "Code reference",
    description:
      "Search and read the instance's configured reference repositories (hybrid keyword + semantic).",
    tools: ["list_reference_repos", "code_search", "search_code", "read_code"],
    body: `
You can search and read a shared set of reference code repositories that an
admin configured for this instance (for example, a product's source tree).
Use them to answer grounded questions about that code — e.g. "what does this
setting do?" — instead of guessing.

## Setup

No per-agent setup. Repositories are configured instance-wide in
**Global Settings → Code Reference**. If \`list_reference_repos\` returns an empty
list, tell the user to add a repository there — you cannot add one yourself.

## How to answer code questions

1. \`list_reference_repos\` — see which repos are available (and which are still
   indexing).
2. Pick the search that fits:
   - **\`code_search\`** (exact grep) for a specific setting name, symbol, flag,
     or string. This is usually the right first step for "what does X do?".
   - **\`search_code\`** (semantic) for conceptual questions when you don't know
     the exact term.
3. \`read_code\` the most relevant hit using its path and line range, to read the
   surrounding context — especially the comments/annotations near a setting.
4. Cite the repo, file path, and line range in your answer.

Prefer reading the actual file over guessing. Keep reads narrow (a line range),
not whole large files.
`,
  }),

  capability({
    id: "proxmox",
    name: "Proxmox VM control",
    description:
      "Manage specific Proxmox VE virtual machines — start/stop, snapshot, and roll back — over the API.",
    tools: [
      "proxmox_list_vms",
      "proxmox_status",
      "proxmox_start",
      "proxmox_stop",
      "proxmox_list_snapshots",
      "proxmox_rollback",
      "proxmox_create_snapshot",
      "proxmox_delete_snapshot",
    ],
    credentialKeys: [
      "PROXMOX_HOST",
      "PROXMOX_TOKEN_ID",
      "PROXMOX_TOKEN_SECRET",
      "PROXMOX_ALLOWED_VMIDS",
      "PROXMOX_VERIFY_SSL",
    ],
    body: `
You can manage virtual machines on a Proxmox VE server with the \`proxmox_*\`
tools, authenticated by your own API token. You can only touch the VMs the user
explicitly allowed you (the \`PROXMOX_ALLOWED_VMIDS\` allowlist) — any other vmid
is refused.

## Tools

- \`proxmox_list_vms\` — the VMs you may manage (vmid, name, node, status).
- \`proxmox_status\` — a VM's current run state.
- \`proxmox_start\` / \`proxmox_stop\` — boot a VM, or stop it (graceful ACPI
  shutdown by default; \`graceful: false\` for a hard stop).
- \`proxmox_list_snapshots\` — a VM's snapshots.
- \`proxmox_rollback\` — revert a VM to a named snapshot.
- \`proxmox_create_snapshot\` / \`proxmox_delete_snapshot\` — take or remove a snapshot.

Lifecycle and snapshot actions return a Proxmox task id (UPID); they run
asynchronously, so poll \`proxmox_status\` or \`proxmox_list_snapshots\` to confirm
completion before the next step.

## Setup

These tools need credentials configured for you in the Agent Studio Credentials
tab — you cannot set them yourself. If a tool reports Proxmox is not configured,
or that no VMs are allowed, ask the user to add:

- \`PROXMOX_HOST\` — the Proxmox host (e.g. \`pve.lan\` or \`10.0.0.5\`); the API is
  reached at \`https://<host>:8006\`.
- \`PROXMOX_TOKEN_ID\` — the API token id, e.g. \`root@pam!otterbot\`.
- \`PROXMOX_TOKEN_SECRET\` — the token's secret (UUID).
- \`PROXMOX_ALLOWED_VMIDS\` — comma-separated vmids you may control, e.g. \`200\`.
  **Unset means you may control nothing.**
- \`PROXMOX_VERIFY_SSL\` — set to \`false\` for a self-signed Proxmox cert (common
  in labs); defaults to \`true\`.

## Workflow: roll back, then install and test inside a VM

To install and test software against a clean VM:

1. \`proxmox_rollback\` the VM to a known-good snapshot (e.g. \`clean\`).
2. \`proxmox_start\` the VM and poll \`proxmox_status\` until it is \`running\`.
3. SSH into the VM with the \`shell_exec\` tool to install and test — for example
   \`ssh user@<vm-ip> 'sudo apt-get install -y <pkg> && ./run-tests.sh'\`.
4. Optionally \`proxmox_create_snapshot\` to capture a good state, or
   \`proxmox_stop\` when finished.

Getting *into* the VM (its IP/hostname, SSH user, and key) is configured
separately from these tools — it relies on the SSH credentials available in your
\`shell_exec\` environment. If SSH fails, tell the user what credential or host
detail is missing rather than guessing.
`,
  }),
];

/** Look up a built-in capability by its slug. */
export function getCatalogCapability(id: string): CatalogCapability | undefined {
  return BUILTIN_CAPABILITIES.find((c) => c.id === id);
}
