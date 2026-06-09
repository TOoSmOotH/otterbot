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
import type { SkillConfigSchema } from "@otterbot/shared";

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
  /** Optional typed config schema; Agent Studio renders a form from it. */
  configSchema?: SkillConfigSchema;
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
  configSchema?: SkillConfigSchema;
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
  if (args.configSchema) frontmatter.configSchema = args.configSchema;
  const markdown = matter.stringify(args.body.trim(), frontmatter);
  return {
    id: args.id,
    name: args.name,
    description: args.description,
    tools: args.tools,
    credentialKeys,
    configSchema: args.configSchema,
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
      "PROXMOX_HOST_IP",
      "PROXMOX_TOKEN_ID",
      "PROXMOX_TOKEN_SECRET",
      "PROXMOX_ALLOWED_VMIDS",
      "PROXMOX_VMS",
      "PROXMOX_VERIFY_SSL",
    ],
    configSchema: {
      description:
        "Connect this agent to your Proxmox VE host. The VM list is a convenience " +
        "reference surfaced to the agent — it still discovers VMs and snapshots live " +
        "via the API and is not limited to this list. The allowlist of VMs the agent " +
        "may control is derived from the VMIDs you list here.",
      fields: [
        {
          key: "host",
          label: "Proxmox host",
          type: "string",
          required: true,
          credentialKey: "PROXMOX_HOST",
          scope: "cap:proxmox",
          placeholder: "pve.lan or 10.0.0.5",
          description: "The API is reached at https://<host>:8006.",
        },
        {
          key: "ip",
          label: "Host IP (reference)",
          type: "string",
          credentialKey: "PROXMOX_HOST_IP",
          scope: "cap:proxmox",
          description: "Informational; surfaced to the agent for SSH/context.",
        },
        {
          key: "tokenId",
          label: "API token id",
          type: "string",
          required: true,
          credentialKey: "PROXMOX_TOKEN_ID",
          scope: "cap:proxmox",
          placeholder: "root@pam!otterbot",
        },
        {
          key: "tokenSecret",
          label: "API token secret",
          type: "secret",
          required: true,
          secret: true,
          credentialKey: "PROXMOX_TOKEN_SECRET",
          scope: "direct",
          description: "The token's secret (UUID).",
        },
        {
          key: "verifySsl",
          label: "Verify TLS certificate",
          type: "boolean",
          default: true,
          credentialKey: "PROXMOX_VERIFY_SSL",
          scope: "cap:proxmox",
          description: "Turn off for the self-signed certs common in labs.",
        },
        {
          key: "vms",
          label: "VMs",
          type: "list",
          credentialKey: "PROXMOX_VMS",
          scope: "cap:proxmox",
          description:
            "Reference list of VMs (and their snapshots) the agent may control. " +
            "The vmid allowlist is derived from these entries.",
          itemFields: [
            { key: "vmid", label: "VMID", type: "number", required: true },
            { key: "name", label: "Name", type: "string" },
            {
              key: "snapshots",
              label: "Snapshots",
              type: "list",
              itemFields: [
                { key: "name", label: "Snapshot name", type: "string", required: true },
              ],
            },
          ],
        },
      ],
    },
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

These tools are configured for you in this skill's **Configure** panel in Agent
Studio — you cannot set them yourself. If a tool reports Proxmox is not
configured, or that no VMs are allowed, ask the user to open the panel and fill
in:

- **Proxmox host** (e.g. \`pve.lan\` or \`10.0.0.5\`); the API is reached at
  \`https://<host>:8006\`.
- **API token id**, e.g. \`root@pam!otterbot\`, and the **token secret** (UUID).
- The **VMs** list — the VMs (and their snapshots) you may control. The vmid
  allowlist is derived from this list; **an empty list means you may control
  nothing.** This list is a *reference* — always confirm the live set with
  \`proxmox_list_vms\` and snapshots with \`proxmox_list_snapshots\` rather than
  trusting it blindly.
- **Verify TLS certificate** — turn off for a self-signed Proxmox cert (common
  in labs); on by default.

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
  capability({
    id: "ssh",
    name: "SSH remote access",
    description:
      "Connect to allowlisted remote hosts over SSH and run commands (optionally with sudo), using a managed key the user installs for passwordless login.",
    tools: ["ssh_generate_key", "ssh_get_public_key", "ssh_list_hosts", "ssh_exec"],
    credentialKeys: ["SSH_HOSTS", "SSH_SUDO_PASSWORD"],
    configSchema: {
      description:
        "List the hosts this agent may reach over SSH. The agent can only connect " +
        "to hosts you add here — an empty list means it can connect to nothing. " +
        "Authentication uses the agent's own managed key: have it run " +
        "ssh_generate_key, then add the shown public key to each host's " +
        "~/.ssh/authorized_keys.",
      fields: [
        {
          key: "hosts",
          label: "Hosts",
          type: "list",
          credentialKey: "SSH_HOSTS",
          scope: "cap:ssh",
          description: "The hosts the agent may SSH to (its allowlist).",
          itemFields: [
            {
              key: "name",
              label: "Name",
              type: "string",
              description: "Friendly label the agent uses to address the host (defaults to the host).",
            },
            {
              key: "host",
              label: "Host",
              type: "string",
              required: true,
              placeholder: "server.lan or 10.0.0.7",
            },
            { key: "port", label: "Port", type: "number", default: 22 },
            {
              key: "user",
              label: "User",
              type: "string",
              required: true,
              placeholder: "ubuntu",
            },
          ],
        },
        {
          key: "sudoPassword",
          label: "Sudo password",
          type: "secret",
          secret: true,
          credentialKey: "SSH_SUDO_PASSWORD",
          scope: "direct",
          description:
            "Optional. Used only when a command is run with sudo, fed to `sudo -S`. " +
            "Leave blank if the remote user has passwordless (NOPASSWD) sudo.",
        },
      ],
    },
    body: `
You can log into remote hosts over SSH and run commands with the \`ssh_*\` tools,
using a keypair this agent manages. You can only reach the hosts the user added
to your allowlist — any other host is refused.

## First-time setup: install your key

Passwordless login uses your own SSH key, which the user must install on each
host once:

1. Run \`ssh_generate_key\` — it creates your \`ed25519\` keypair (if needed) and
   returns your **public key**.
2. Show that public key to the user and ask them to append it to the target
   host's \`~/.ssh/authorized_keys\` (for the login user configured for that host).
3. Once installed, \`ssh_exec\` can log in without a password.

Use \`ssh_get_public_key\` any time to show the key again.

## Tools

- \`ssh_generate_key\` — create (or return the existing) keypair and show the
  public key to copy onto remote hosts.
- \`ssh_get_public_key\` — re-display your public key.
- \`ssh_list_hosts\` — the hosts you are allowed to reach (name, host, port, user).
- \`ssh_exec\` — run a command on an allowlisted host. Address the host by its
  configured \`name\` or \`host\`. Set \`sudo: true\` to run the command as root.

## Running commands

\`ssh_exec\` returns \`exitCode\`, \`stdout\`, and \`stderr\`. A non-zero exit code is a
failure — read \`stderr\` and report it rather than assuming success. Chain steps
in one command with \`&&\` when they must all run.

For privileged work, pass \`sudo: true\`. If the user configured a sudo password
it is supplied automatically (\`sudo -S\`); otherwise the host must allow
passwordless sudo for that user, or the command fails with a sudo prompt error.

You can relay results to the user, or to another agent that delegated the work —
the structured output from \`ssh_exec\` is what you pass back.

## Setup

Hosts and the optional sudo password are configured for you in this skill's
**Configure** panel in Agent Studio — you cannot set them yourself. If a tool
reports no hosts are configured, or a host is not in your allowlist, ask the user
to open the panel and add it. If a connection fails with an authentication error,
the public key probably isn't installed on that host yet — run
\`ssh_get_public_key\` and ask the user to add it.
`,
  }),

  capability({
    id: "coding-cli",
    name: "Coding CLI agents",
    description:
      "Run command-line coding agents — Claude Code, Codex, Antigravity CLI, OpenCode — on a " +
      "task, using your own subscription. Works on your project's shared code tree when " +
      "you belong to one. Supports a headless run that returns a summary, or a live " +
      "terminal UI streamed to the user.",
    tools: ["coding_cli_run", "coding_cli_status", "coding_cli_install"],
    configSchema: {
      description:
        "Optionally pin a default coding CLI for this agent so it doesn't have to be told " +
        "which tool to use (e.g. a 'coder' agent always uses Claude Code). Each tool " +
        "authenticates from this agent's own workspace — log it in from the agent's " +
        "terminal once (see the skill instructions); the credentials persist there and " +
        "stay private to this agent.",
      fields: [
        {
          key: "pinnedTool",
          label: "Default tool",
          type: "string",
          credentialKey: "CODING_CLI_PINNED_TOOL",
          scope: "cap:coding-cli",
          placeholder: "claude | codex | antigravity | opencode",
          description:
            "If set, coding_cli_run uses this tool when none is given. Leave blank to " +
            "choose per call.",
        },
        {
          key: "pinnedPreset",
          label: "Default model preset",
          type: "select",
          credentialKey: "CODING_CLI_PINNED_PRESET",
          scope: "cap:coding-cli",
          optionsSource: "codingModelPresets",
          description:
            "Model preset (from Settings → Coding Models) this agent uses by default — it " +
            "carries the tool, model, and reasoning effort. Choosing a preset also sets the " +
            "tool. Leave blank to use the tool's own default model.",
        },
      ],
    },
    body: `
You can run command-line coding agents — **Claude Code** (\`claude\`), **Codex**
(\`codex\`), **Antigravity CLI** (\`agy\`), and **OpenCode** (\`opencode\`) — to write and
edit code. Each runs inside your sandbox, authenticated by **your own
subscription**, and (if you belong to a project) on that project's shared code
tree at \`/project\`, which you share live with the other agents on the project.

## First-time setup: install + log in ONCE, for all agents

Installs and logins are **shared across every agent** — you set each tool up a
single time, not per agent.

**Install** — once per tool, ever. Use **Settings → Coding CLIs** (Install
button) or run \`coding_cli_install\`. Installing only puts the binary on PATH; it
does not log you in. Re-running it updates the tool to the latest.

**Log in** — once per tool, ever. The login flows are interactive, so run them
from a terminal:

1. Open any agent's terminal (the Terminal button in Agent Studio).
2. Run the tool's login flow and complete it in the browser/device prompt:
   - Claude Code: run \`claude\` and follow the login prompt.
   - Codex: run \`codex login --device-auth\` (enter the code at the shown URL).
   - Antigravity CLI: run \`agy\` and complete the Google login at the shown URL.
   - OpenCode: no login here — set the OpenCode Zen provider's key in
     Settings → Providers (its models, and any configured provider's, are
     bridged into opencode automatically).
3. The login is saved to the shared store, so **every agent is now logged in**.

If a run fails with "command not found", install the tool first. If it fails with
an authentication error, log in once as above. Use \`coding_cli_status\` to see
what's installed and logged in.

## Tools

- \`coding_cli_run\` — run a coding agent on a task. \`interactive: false\` (default)
  runs it to completion and returns a summary; \`interactive: true\` launches its
  live terminal UI, streamed to the user, and returns a summary when it exits.
- \`coding_cli_install\` — install a tool (claude | codex | antigravity | opencode) into
  your workspace. Login still happens once, interactively (see above).
- \`coding_cli_status\` — report which tools are installed and logged in, whether
  you're on a project, and whether a live session is running.

## Working on a project

If you belong to a project, coding runs happen in the shared \`/project\` tree, so
another agent (e.g. one writing tests) sees your changes immediately. Runs are
**serialized per project** — only one coding agent edits the shared code at a
time; if it's busy, wait and retry. **You only edit files** in \`/project\`. Do
**not** \`git commit\`, \`git push\`, or open pull requests — the **project manager**
owns all git and forge actions and is the only agent with forge access. Read-only
\`git diff\`/\`git status\` to review your changes is fine; leave committing, pushing,
and PRs to the PM.
`,
  }),

  capability({
    id: "project-management",
    name: "Project management",
    description:
      "Plan a software project with the user and run its build pipeline (coder → security " +
      "reviewer → test writer → tester). For the per-project PM agent.",
    tools: ["pipeline_start", "pipeline_status", "plan_build", "build_start", "build_status"],
    body: `
You are the project manager for your project. Your job is to **plan** and
**coordinate** the work — you never write the code yourself.

## How to run work: the build graph (your default)

For essentially **any** code change, use the **build graph** (\`plan_build\` →
\`build_start\`), not the single pipeline. The build graph runs several coders in
parallel — each in its own isolated git worktree — then integrates and gates the
result, so it's both faster and more thorough.

1. **Scope it with the Coder first.** Delegate a PLAN-ONLY task to the Coder to map
   the change to concrete files/areas (it must NOT edit code, commit, or start a
   build while planning). Use its findings to choose **disjoint** file groupings.
2. **\`plan_build\` — stage a task graph (this does NOT start it).** Build the graph:
   - **2–5 \`coder\` tasks**, each owning a **disjoint** set of files — no two coder
     tasks may touch the same file, so their branches merge cleanly. Give each a
     concrete title, a short description naming the exact files/functions it should
     change, and a \`filesHint\`. Keep each task **small and self-contained**.
   - **one \`integrator\` task** whose \`deps\` lists **every** coder task id.
   - a **\`security-reviewer\`** task depending on the integrator, then a **\`tester\`**
     task depending on the reviewer.
   Use stable, unique task \`id\`s. Do **NOT** pass a \`projectId\` — your own project
   is used automatically.
3. **Get approval, then \`build_start\`.**
   - Work discussed with the user in chat: present the staged plan (the task graph
     and the returned \`runId\`) and **wait for the user's explicit approval**, then
     call \`build_start\`.
   - Work from an assigned issue: the assignment **is** the approval — call
     \`build_start\` yourself without waiting.
4. **Follow it.** Use \`build_status\` and relay meaningful progress. Coders run in
   parallel; the integrator merges their branches one at a time behind the test
   gate, kicking a task back to its coder on a conflict or failed gate. On a failed
   run, read the failing task's report to decide what to do.

Only for a **trivial single-file fix** may you fall back to \`pipeline_start\` (the
simple sequential pipeline) with \`pipeline_status\`.

Keep the user informed, and summarize reports rather than dumping them.

## Git is yours

**All git and forge actions for the project are yours** — cloning, branching,
committing, pushing, and opening pull requests. You are the only agent with forge
access (the git account + its key are assigned to you). When you run the
pipeline, it commits and publishes (push + PR) automatically; for any manual git
work, run it yourself via \`shell_exec\` / \`gh\` inside \`/project\`.

**Never ask the coder or other specialists to push, commit, or open a PR** — they
have no forge access and it will fail. They only edit files in the shared
\`/project\` tree; you handle everything that touches the remote.
`,
  }),
];

/** Look up a built-in capability by its slug. */
export function getCatalogCapability(id: string): CatalogCapability | undefined {
  return BUILTIN_CAPABILITIES.find((c) => c.id === id);
}
