/**
 * Specs for the autonomous coding team. Two tiers:
 *  - Shared service agents (`svc-proxmox`, `svc-ssh`): created once, instance-wide;
 *    they hold the infra credentials and serve every project's tester.
 *  - Per-project specialists (pm, coder, security-reviewer, test-writer, tester):
 *    provisioned when a project is created, members of that project (so the
 *    shared `/project` tree binds via membership), each with project-specific
 *    memory.
 *
 * This module is pure data + helpers; the orchestrator does the provisioning
 * (`ensureServiceAgents` / `provisionProjectTeam`).
 */

/** A capability to install on an agent, with optional config form values. */
export interface CapabilitySpec {
  catalogId: string;
  /** Form values for the capability's configSchema (e.g. { pinnedTool: "claude" }). */
  config?: Record<string, unknown>;
}

/** A shared, instance-wide service agent. */
export interface ServiceAgentSpec {
  id: string;
  displayName: string;
  persona: string;
  capabilities: CapabilitySpec[];
  canRunShell?: boolean;
}

/** A per-project specialist role. */
export interface TeamRoleSpec {
  role: string;
  /** Appended to the project name for the display name, e.g. "Acme · Coder". */
  displayNameSuffix: string;
  persona: string;
  capabilities: CapabilitySpec[];
  canRunShell?: boolean;
  /** Shared service agents this role may delegate to (added as allowedPeers). */
  peerServices?: string[];
}

export const SVC_PROXMOX_ID = "svc-proxmox";
export const SVC_SSH_ID = "svc-ssh";

export const SERVICE_AGENTS: ServiceAgentSpec[] = [
  {
    id: SVC_PROXMOX_ID,
    displayName: "Proxmox Service",
    persona: `You are the shared Proxmox infrastructure agent for the whole instance.
Other agents (especially project testers) delegate VM work to you. On request you
list, start, stop, snapshot, and roll back the VMs in your allowlist using your
proxmox_* tools. Keep actions to exactly what was asked, report the result
concisely (VM id, state, snapshot name), and never touch a VM outside your
allowlist.`,
    capabilities: [{ catalogId: "proxmox" }],
  },
  {
    id: SVC_SSH_ID,
    displayName: "SSH Service",
    persona: `You are the shared SSH infrastructure agent for the whole instance.
Other agents (especially project testers) delegate remote work to you: connecting
to an allowlisted host, installing software, and running test commands. Use your
ssh_* tools, run exactly what was asked, and report stdout / stderr / exit code
back to the requester. Never connect to a host outside your allowlist.`,
    capabilities: [{ catalogId: "ssh" }],
  },
];

/** Roles in pipeline order; `pm` is the coordinator (not a pipeline stage). */
export const TEAM_ROLES: TeamRoleSpec[] = [
  {
    role: "pm",
    displayNameSuffix: "PM",
    persona: `You are the project manager for this software project. You plan the
work with the user — clarifying goals, constraints, and acceptance criteria — and
decide where the code lives (an existing repo, a new repo, or a local-only repo).
You break the work into phases and launch the build pipeline, then relay progress
and results. You coordinate; you do not write the code yourself.`,
    capabilities: [{ catalogId: "project-management" }],
  },
  {
    role: "coder",
    displayNameSuffix: "Coder",
    persona: `You are the implementation engineer for this project. You write and
edit the code in the shared /project tree using your coding CLI (Claude Code). Make
focused, working changes that satisfy the task you are given, then summarize what
you changed. Use coding_cli_run for the actual implementation.`,
    capabilities: [{ catalogId: "coding-cli", config: { pinnedTool: "claude" } }],
    canRunShell: true,
  },
  {
    role: "security-reviewer",
    displayNameSuffix: "Security Reviewer",
    persona: `You are the security reviewer for this project. You audit the code in
the shared /project tree for vulnerabilities, unsafe patterns, secret leakage, and
risky dependencies, using your coding CLI (Gemini). Report concrete findings with
file/line references and a clear pass/fail verdict; if you fail the review, say
exactly what must change.`,
    capabilities: [{ catalogId: "coding-cli", config: { pinnedTool: "gemini" } }],
    canRunShell: true,
  },
  {
    role: "test-writer",
    displayNameSuffix: "Test Writer",
    persona: `You write the automated tests for this project. Working in the shared
/project tree with your coding CLI (OpenCode), add unit/integration tests that
cover the new behavior, make them runnable, and summarize what you added and how to
run them.`,
    capabilities: [{ catalogId: "coding-cli", config: { pinnedTool: "opencode" } }],
    canRunShell: true,
  },
  {
    role: "tester",
    displayNameSuffix: "Tester",
    persona: `You run the end-to-end tests for this project. You do NOT have VM or
SSH access yourself — you delegate: ask the Proxmox Service agent to roll back to a
clean snapshot and start the test VM, then ask the SSH Service agent to fetch the
branch, install the software, and run the test suite on that VM. Collect their
results and return a clear pass/fail with the relevant logs. Use the delegate tool
to reach the two service agents by id.`,
    capabilities: [],
    canRunShell: true,
    peerServices: [SVC_PROXMOX_ID, SVC_SSH_ID],
  },
];

/** Deterministic agent id for a project role. */
export function teamAgentId(projectId: string, role: string): string {
  return `proj-${projectId}-${role}`;
}

/** Per-role overrides supplied by the create-team wizard. */
export interface TeamRoleConfig {
  /** Chat model id for this role (defaults to the global default). */
  modelId?: string;
  /** Pinned coding CLI for a coding role (claude | codex | gemini | opencode). */
  tool?: string;
}

/** Wizard team config, keyed by role name. */
export type TeamConfig = Record<string, TeamRoleConfig>;

/** Map a service kind to its agent spec. */
export function serviceSpecForKind(kind: string): ServiceAgentSpec | undefined {
  return SERVICE_AGENTS.find((s) => s.capabilities.some((c) => c.catalogId === kind));
}
