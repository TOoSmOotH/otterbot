# GitHub Connection backed by a Git account (in-sandbox git-over-SSH) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a GitHub *Connection* reference a Git account (forge account) so an assigned agent gets one GitHub identity in its own sandbox — `GITHUB_TOKEN` for `gh`/API plus an opt-in read-only SSH key bind for `git` clone/push/commit-signing.

**Architecture:** A GitHub connection stores `config.gitAccountId` (a `forge_accounts.id`). At context-build time the orchestrator injects the account's token as a `cap:gh-auth`-scoped secret and produces a `GitSshSetup` descriptor (key path + known_hosts + committer + signing) from the existing `ForgeService.gitContextFor`. A new `SandboxOpts.gitSsh` makes `buildSandboxPlan` bind the key read-only into the agent's sandbox and set `GIT_SSH_COMMAND` + signing env. A context thunk `ctx.gitSsh()` gates the whole thing on the `gh-auth` capability so token and key appear together.

**Tech Stack:** TypeScript monorepo, Fastify + better-sqlite3 + Drizzle (server), React + Zustand (web), bubblewrap/sandbox-exec sandboxing, vitest.

**Spec:** `docs/superpowers/specs/2026-06-02-github-connection-git-account-ssh-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/server/src/integrations/shell.ts` | Sandbox plan builder | Add `GitSshSetup` type + `SandboxOpts.gitSsh`; bind key + git env (bwrap + sandbox-exec) |
| `packages/server/src/integrations/shell.test.ts` | Sandbox plan tests | New tests for the gitSsh bind/env |
| `packages/server/src/forge/forge-service.ts` | Forge accounts + keys | (read only) reuse `gitContextFor`, `getAccount` |
| `packages/server/src/orchestrator/orchestrator.ts` | Identity resolution | `gitSshForAgent()`; token injection in `connectionSecretsForAgent`; wire `resolveGitSsh` |
| `packages/server/src/runtime/agent-context.ts` | Per-agent context | Add `gitSsh()` thunk (gh-auth gated) + `resolveGitSsh` input |
| `packages/server/src/integrations/shell-terminal.ts` | `runAgentShell` | Thread `gitSsh` opt |
| `packages/server/src/integrations/coding-cli.ts` | Coding CLI sandbox | Thread `gitSsh` through `sandboxOptsFor` + `CodingRunOptions` |
| `packages/server/src/agent/tools.ts` | `shell_exec` + coding tool | Pass `ctx.gitSsh()` into sandbox opts |
| `packages/server/src/api.test.ts` | E2E API test | Git-account-backed github connection → agent resolves token + gitSsh |
| `packages/web/src/components/settings/ConnectionsTab.tsx` | Connections UI | Git-account picker for github connections |

---

## Task 1: `SandboxOpts.gitSsh` — bind the key + git env

**Files:**
- Modify: `packages/server/src/integrations/shell.ts`
- Test: `packages/server/src/integrations/shell.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/integrations/shell.test.ts` inside the `describe("buildSandboxPlan project binding", ...)` block (after the existing project tests):

```typescript
  it("binds the git SSH key read-only and sets GIT_SSH_COMMAND when gitSsh is set", () => {
    const dir = mkdtempSync(join(tmpdir(), "otter-ws-"));
    const key = join(mkdtempSync(join(tmpdir(), "otter-key-")), "id_ed25519");
    writeFileSync(key, "PRIVATE", { mode: 0o600 });
    try {
      const built = buildSandboxPlan(dir, new Map(), ["/bin/sh", "-c", "true"], {
        gitSsh: { keyPath: key },
      });
      if ("error" in built) return; // no OS sandbox here
      const { plan, sandbox } = built;
      if (sandbox === "bwrap") {
        const i = plan.args.indexOf(key);
        expect(i).toBeGreaterThan(-1);
        expect(plan.args[i - 1]).toBe("--ro-bind");
        expect(plan.args[i + 1]).toBe("/workspace/.ssh/id_ed25519");
        // GIT_SSH_COMMAND is set via --setenv.
        const envIdx = plan.args.indexOf("GIT_SSH_COMMAND");
        expect(envIdx).toBeGreaterThan(-1);
        expect(plan.args[envIdx + 1]).toContain("/workspace/.ssh/id_ed25519");
      } else {
        expect(plan.env.GIT_SSH_COMMAND).toContain(key);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(key, { force: true });
    }
  });

  it("adds SSH commit-signing git config only when a signing key is given", () => {
    const dir = mkdtempSync(join(tmpdir(), "otter-ws-"));
    const key = join(mkdtempSync(join(tmpdir(), "otter-key-")), "id_ed25519");
    writeFileSync(key, "PRIVATE", { mode: 0o600 });
    try {
      const withSign = buildSandboxPlan(dir, new Map(), ["/bin/sh", "-c", "true"], {
        gitSsh: { keyPath: key, signingKeyPath: `${key}.pub` },
      });
      const without = buildSandboxPlan(dir, new Map(), ["/bin/sh", "-c", "true"], {
        gitSsh: { keyPath: key },
      });
      if ("error" in withSign || "error" in without) return;
      const flat = (p: typeof withSign) => ("plan" in p ? p.plan.args.join(" ") + JSON.stringify(p.plan.env) : "");
      expect(flat(withSign)).toContain("commit.gpgsign");
      expect(flat(without)).not.toContain("commit.gpgsign");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(key, { force: true });
    }
  });
```

Add `writeFileSync` to the existing `node:fs` import at the top of `shell.test.ts` if not already imported.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @otterbot/server test -- src/integrations/shell.test.ts`
Expected: FAIL — `gitSsh` is not a known property of `SandboxOpts` (tsc error) / no bind emitted.

- [ ] **Step 3: Add the `GitSshSetup` type and `SandboxOpts.gitSsh`**

In `packages/server/src/integrations/shell.ts`, just above `export interface SandboxOpts {`, add:

```typescript
/**
 * A Git account's SSH identity to expose for git-over-SSH inside the sandbox.
 * The private key is bound **read-only** (never copied into the workspace) and
 * only when an agent is explicitly assigned a Git-account-backed connection.
 */
export interface GitSshSetup {
  /** Host path to the materialized private key (0600). */
  keyPath: string;
  /** Host path to a known_hosts file, if any. */
  knownHostsPath?: string;
  /** Commit author/committer identity. */
  committer?: { name: string; email: string };
  /** Host path to the public key used for SSH commit signing, when enabled. */
  signingKeyPath?: string;
}
```

Add to the `SandboxOpts` interface (after `projectReadOnly?: boolean;`):

```typescript
  /**
   * Expose a Git account's SSH key for git-over-SSH inside the sandbox. Binds
   * the key read-only at `~/.ssh/id_ed25519` and sets `GIT_SSH_COMMAND` (+ commit
   * signing). Opt-in per connection assignment; capability-gated upstream.
   */
  gitSsh?: GitSshSetup;
```

- [ ] **Step 4: Add a git-SSH env helper**

In `shell.ts`, add this helper near `buildEnv`:

```typescript
/**
 * Env that points git at a bound SSH key for transport + (optional) signing.
 * `keyDir` is the in-sandbox HOME `.ssh` dir (`/workspace/.ssh` on bwrap, the
 * real workspace `.ssh` on macOS where paths aren't remapped).
 */
function gitSshEnv(gitSsh: GitSshSetup, keyDir: string): Record<string, string> {
  const keyPath = `${keyDir}/id_ed25519`;
  const known = gitSsh.knownHostsPath ? ` -o UserKnownHostsFile=${keyDir}/known_hosts` : "";
  const env: Record<string, string> = {
    GIT_SSH_COMMAND: `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new${known}`,
  };
  if (gitSsh.committer) {
    env.GIT_AUTHOR_NAME = gitSsh.committer.name;
    env.GIT_AUTHOR_EMAIL = gitSsh.committer.email;
    env.GIT_COMMITTER_NAME = gitSsh.committer.name;
    env.GIT_COMMITTER_EMAIL = gitSsh.committer.email;
  }
  if (gitSsh.signingKeyPath) {
    // Ad-hoc git config via env (no on-disk .gitconfig needed).
    env.GIT_CONFIG_COUNT = "3";
    env.GIT_CONFIG_KEY_0 = "gpg.format";
    env.GIT_CONFIG_VALUE_0 = "ssh";
    env.GIT_CONFIG_KEY_1 = "user.signingkey";
    env.GIT_CONFIG_VALUE_1 = `${keyDir}/id_ed25519.pub`;
    env.GIT_CONFIG_KEY_2 = "commit.gpgsign";
    env.GIT_CONFIG_VALUE_2 = "true";
  }
  return env;
}
```

- [ ] **Step 5: Bind the key + set env in `bwrapPlan`**

In `bwrapPlan`, immediately after the existing `if (opts.projectWorkspacePath) { ... }` block (around line 293) and before the `const startDir = ...` line, add:

```typescript
  // A Git account's SSH key, when the agent has a git-account-backed connection.
  // Bound read-only under HOME/.ssh; the key is never written into the workspace.
  if (opts.gitSsh) {
    args.push("--ro-bind", opts.gitSsh.keyPath, "/workspace/.ssh/id_ed25519");
    if (opts.gitSsh.knownHostsPath) {
      args.push("--ro-bind-try", opts.gitSsh.knownHostsPath, "/workspace/.ssh/known_hosts");
    }
    if (opts.gitSsh.signingKeyPath) {
      args.push("--ro-bind-try", opts.gitSsh.signingKeyPath, "/workspace/.ssh/id_ed25519.pub");
    }
    Object.assign(env, gitSshEnv(opts.gitSsh, "/workspace/.ssh"));
  }
```

`env` here is the `const env = buildEnv(...)` already defined at the top of `bwrapPlan`; mutating it before the `--setenv` loop (around line 309) means the git env is emitted into the sandbox.

- [ ] **Step 6: Set env in `sandboxExecPlan` (macOS)**

In `sandboxExecPlan`, change the returned `env` to merge the git env. Replace:

```typescript
    env: buildEnv(workspaceDir, secrets, toolsBin),
```

with:

```typescript
    env: {
      ...buildEnv(workspaceDir, secrets, toolsBin),
      // No path remap on macOS: point git at the real host key path.
      ...(opts.gitSsh ? gitSshEnv(opts.gitSsh, dirname(opts.gitSsh.keyPath)) : {}),
    },
```

`dirname` is already imported in `shell.ts` (used for `nodeDir`). On macOS the key isn't remapped, so `keyDir` is the real directory containing the key, and `${keyDir}/id_ed25519` resolves to the real key. (The signing pub-key path assumes `<key>.pub` alongside, which matches `ForgeService.materialize`.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @otterbot/server test -- src/integrations/shell.test.ts`
Expected: PASS (both new tests + existing project-binding tests).

- [ ] **Step 8: Build + commit**

```bash
pnpm --filter @otterbot/server build
git add packages/server/src/integrations/shell.ts packages/server/src/integrations/shell.test.ts
git commit -m "sandbox: optional gitSsh — bind a Git account SSH key + git env"
```

---

## Task 2: `gitSshForAgent` + token injection in the orchestrator

**Files:**
- Modify: `packages/server/src/orchestrator/orchestrator.ts`
- Test: `packages/server/src/api.test.ts`

- [ ] **Step 1: Write the failing E2E test**

Add to `packages/server/src/api.test.ts` inside the `describe("HTTP API (e2e)", ...)` block, before its closing `});`. This drives the real routes to create a forge account (SSH, with a generated key), a github connection referencing it, assigns it to an agent, and asserts the agent's resolved scoped secrets + gitSsh.

```typescript
  it("a Git-account-backed github connection gives an agent a token + gitSsh", async () => {
    // 1. A reusable SSH key.
    const key = await app.inject({
      method: "POST",
      url: "/api/ssh-keys",
      payload: { label: "gh-key", mode: "generate" },
    });
    const keyId = (key.json() as { id: string }).id;

    // 2. A GitHub Git account using SSH transport + that key.
    const acct = await app.inject({
      method: "POST",
      url: "/api/forge-accounts",
      payload: {
        provider: "github",
        label: "gh-acct",
        baseUrl: "https://github.com",
        token: "ghp_test_token",
        username: "bot",
        gitTransport: "ssh",
        sshKeyId: keyId,
      },
    });
    const accountId = (acct.json() as { id: string }).id;

    // 3. A github connection that references the Git account.
    const conn = await app.inject({
      method: "POST",
      url: "/api/connections",
      payload: { type: "github", label: "gh", config: { gitAccountId: accountId } },
    });
    const connId = (conn.json() as { id: string }).id;

    // 4. An agent with the gh-auth capability, assigned the connection.
    await app.inject({ method: "POST", url: "/api/agents", payload: { displayName: "GH Agent" } });
    await app.inject({ method: "POST", url: "/api/agents/gh-agent/skills/install", payload: { catalogId: "gh-auth" } });
    await app.inject({ method: "POST", url: `/api/connections/${connId}/assign`, payload: { agentId: "gh-agent" } });

    // 5. The orchestrator resolves the identity for the agent.
    const got = stack.orch.gitSshForAgentTest("gh-agent");
    expect(got).not.toBeNull();
    expect(got!.keyPath).toMatch(/id_ed25519$/);
    const secrets = stack.orch.scopedSecretsForAgentTest("gh-agent");
    expect(secrets.get("GITHUB_TOKEN")?.value).toBe("ghp_test_token");
    expect(secrets.get("GITHUB_TOKEN")?.scope).toBe("cap:gh-auth");
  });
```

> Note: the exact assignment route/skill-install payloads must match this repo. Verify `POST /api/connections/:id/assign` and the skills-install route names with `grep -n "connections/:id/assign\|skills/install" packages/server/src/server.ts` and adjust the two `inject` calls if they differ. The `gitSshForAgentTest` / `scopedSecretsForAgentTest` helpers are added in Step 3.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @otterbot/server test -- src/api.test.ts`
Expected: FAIL — `gitSshForAgentTest` does not exist on the orchestrator.

- [ ] **Step 3: Implement `gitSshForAgent` + token injection + test shims**

In `orchestrator.ts`, import the type at the top (with the other `integrations/shell` imports, or add one):

```typescript
import type { GitSshSetup } from "../integrations/shell.js";
```

Replace `connectionSecretsForAgent` (around lines 845-854) with:

```typescript
  /** Scoped secrets contributed by an agent's assigned non-chat connections. */
  private connectionSecretsForAgent(agentId: string): Map<string, ScopedSecret> {
    const out = new Map<string, ScopedSecret>();
    for (const conn of this.connectionStore.connectionsForAgent(agentId)) {
      if (isChatConnectionType(conn.type)) continue;
      // GitHub connection backed by a Git account → inject the account's API
      // token as GITHUB_TOKEN (gh-auth scoped), alongside the SSH key handled by
      // gitSshForAgent. Token-only github connections still use credentialId.
      if (conn.type === "github" && typeof conn.config.gitAccountId === "string") {
        const account = this.forge.getAccount(conn.config.gitAccountId);
        if (account?.token) out.set("GITHUB_TOKEN", { value: account.token, scope: "cap:gh-auth" });
        continue;
      }
      if (!conn.credentialId) continue;
      for (const [key, entry] of this.credentials.scopedSecretsFor(conn.credentialId)) {
        out.set(key, entry);
      }
    }
    return out;
  }

  /**
   * The SSH identity for an agent's first Git-account-backed github connection,
   * materialized for in-sandbox git-over-SSH, or null. Only ssh-transport
   * accounts with a usable key qualify; token-only connections return null.
   */
  private gitSshForAgent(agentId: string): GitSshSetup | null {
    let chosen: GitSshSetup | null = null;
    let seen = 0;
    for (const conn of this.connectionStore.connectionsForAgent(agentId)) {
      if (conn.type !== "github" || typeof conn.config.gitAccountId !== "string") continue;
      const account = this.forge.getAccount(conn.config.gitAccountId);
      if (!account || account.gitTransport !== "ssh") continue;
      const gc = this.forge.gitContextFor(account);
      if (!gc.sshKeyPath) continue;
      seen++;
      if (!chosen) {
        chosen = {
          keyPath: gc.sshKeyPath,
          knownHostsPath: gc.knownHostsPath,
          committer: gc.committer,
          signingKeyPath: gc.signingKeyPath,
        };
      }
    }
    if (seen > 1) console.warn(`[connections] agent ${agentId} has ${seen} git-account github connections; using the first.`);
    return chosen;
  }

  /** Test-only accessors for the connection→identity resolution. */
  gitSshForAgentTest(agentId: string): GitSshSetup | null {
    return this.gitSshForAgent(agentId);
  }
  scopedSecretsForAgentTest(agentId: string): Map<string, ScopedSecret> {
    return this.connectionSecretsForAgent(agentId);
  }
```

> If `ScopedSecret` isn't already imported in `orchestrator.ts`, confirm with `grep -n "ScopedSecret" packages/server/src/orchestrator/orchestrator.ts` — it's used by `buildScopedSecrets`, so it is.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @otterbot/server test -- src/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
pnpm --filter @otterbot/server build
git add packages/server/src/orchestrator/orchestrator.ts packages/server/src/api.test.ts
git commit -m "orchestrator: resolve token + gitSsh from a Git-account-backed github connection"
```

---

## Task 3: `ctx.gitSsh()` thunk (gh-auth gated) + wire into context

**Files:**
- Modify: `packages/server/src/runtime/agent-context.ts`
- Modify: `packages/server/src/orchestrator/orchestrator.ts`

- [ ] **Step 1: Add the field + input to `AgentContext`**

In `agent-context.ts`, in the `AgentContext` interface (near `projectRepos`), add:

```typescript
  /**
   * The Git-account SSH identity to expose for in-sandbox git-over-SSH, or null.
   * Gated on the `gh-auth` capability so the key appears only when the token
   * does. A thunk so assignment/capability changes take effect next turn.
   */
  gitSsh: () => GitSshSetup | null;
```

Import the type at the top of `agent-context.ts`:

```typescript
import type { GitSshSetup } from "../integrations/shell.js";
```

In the `BuildAgentContextInput` (the input interface with `resolveProjectRepos?`), add:

```typescript
  /** Resolve the agent's Git-account SSH identity (subject to gh-auth gating). */
  resolveGitSsh?: () => GitSshSetup | null;
```

- [ ] **Step 2: Implement the gated thunk in `buildAgentContext`**

In `buildAgentContext`, in the `const ctx: AgentContext = { ... }` literal (next to `projectRepos`), add:

```typescript
    gitSsh: () => {
      // Same gate as the GITHUB_TOKEN secret (cap:gh-auth): only expose the key
      // when the capability is enabled, so token and key appear together.
      const enabled = new Set(skills.listEnabled().map((s) => s.id));
      if (!enabled.has("gh-auth")) return null;
      return input.resolveGitSsh?.() ?? null;
    },
```

(`skills` is the local already used by `shellSecrets`.)

- [ ] **Step 3: Wire `resolveGitSsh` in the orchestrator**

In `orchestrator.ts`, in the `buildAgentContext({ ... })` call (around line 1110, next to `resolveProjectRepos`), add:

```typescript
      resolveGitSsh: () => this.gitSshForAgent(profile.id),
```

- [ ] **Step 4: Update the prompt test fake context**

`packages/server/src/agent/prompt.test.ts`'s `makeCtx` casts a partial object to `AgentContext`. Add `gitSsh: () => null,` next to `projectRepos: () => []` so the type stays satisfied (it's `as unknown as AgentContext`, so this is belt-and-suspenders; add it for clarity).

- [ ] **Step 5: Build to verify type wiring**

Run: `pnpm --filter @otterbot/server build`
Expected: PASS (no tsc errors).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/runtime/agent-context.ts packages/server/src/orchestrator/orchestrator.ts packages/server/src/agent/prompt.test.ts
git commit -m "agent-context: gh-auth-gated gitSsh() thunk wired from the orchestrator"
```

---

## Task 4: Thread `gitSsh` to every sandbox entry point

**Files:**
- Modify: `packages/server/src/integrations/shell-terminal.ts`
- Modify: `packages/server/src/integrations/coding-cli.ts`
- Modify: `packages/server/src/agent/tools.ts`

- [ ] **Step 1: `runAgentShell` accepts `gitSsh`**

In `shell-terminal.ts`, extend the opts param (line ~44) and forward it (line ~52):

```typescript
  opts: { projectWorkspacePath?: string | null; gitSsh?: import("./shell.js").GitSshSetup } = {}
```

and in the `buildSandboxPlan(...)` call's options object add:

```typescript
    gitSsh: opts.gitSsh,
```

- [ ] **Step 2: `shell_exec` passes `ctx.gitSsh()`**

In `tools.ts`, in the `runAgentShell(...)` call (around line 584), add to the options object:

```typescript
          gitSsh: ctx.gitSsh() ?? undefined,
```

- [ ] **Step 3: `coding-cli` threads `gitSsh`**

In `coding-cli.ts`:

(a) Add to `CodingRunOptions` (the interface with `projectWorkspacePath?: string | null;`):

```typescript
  gitSsh?: import("./shell.js").GitSshSetup;
```

(b) Update `sandboxOptsFor` signature + body:

```typescript
function sandboxOptsFor(
  projectWorkspacePath?: string | null,
  interactive = false,
  gitSsh?: import("./shell.js").GitSshSetup
): SandboxOpts {
  return {
    interactive,
    projectWorkspacePath: projectWorkspacePath ?? undefined,
    startIn: projectWorkspacePath ? "project" : "workspace",
    gitSsh,
  };
}
```

(c) In both `runCodingCliHeadless` and `startCodingSession`, pass `opts.gitSsh` to `sandboxOptsFor`. The headless call (around line 203) becomes:

```typescript
    sandboxOptsFor(opts.projectWorkspacePath, false, opts.gitSsh)
```

The interactive call (around line 324) becomes:

```typescript
    sandboxOptsFor(opts.projectWorkspacePath, true, opts.gitSsh)
```

- [ ] **Step 4: Coding tool passes `gitSsh` in `common`**

In `tools.ts`, in the `const common = { ... }` object (around line 718-725, next to `projectWorkspacePath`), add:

```typescript
            gitSsh: ctx.gitSsh() ?? undefined,
```

- [ ] **Step 5: Build to verify the threading**

Run: `pnpm --filter @otterbot/server build`
Expected: PASS.

- [ ] **Step 6: Run the full server suite**

Run: `pnpm --filter @otterbot/server test`
Expected: PASS (all prior tests + Task 1/2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/integrations/shell-terminal.ts packages/server/src/integrations/coding-cli.ts packages/server/src/agent/tools.ts
git commit -m "thread gitSsh through shell_exec + coding-CLI sandboxes"
```

---

## Task 5: Connections UI — Git account picker for GitHub

**Files:**
- Modify: `packages/web/src/components/settings/ConnectionsTab.tsx`

- [ ] **Step 1: Load forge accounts in the connection form**

In `ConnectionsTab.tsx`, in the `AddConnection` component, read forge accounts from the projects store (already used elsewhere for git accounts):

```typescript
  const forgeAccounts = useProjectsStore((s) => s.forgeAccounts);
  const loadForgeAccounts = useProjectsStore((s) => s.loadForgeAccounts);
  useEffect(() => { void loadForgeAccounts(); }, [loadForgeAccounts]);
```

Add the import if absent: `import { useProjectsStore } from "../../stores/projects-store";` and `useEffect` from React.

- [ ] **Step 2: Render the Git-account picker for the github type**

In the github branch of the form (where, for `type === "github"`, the credential picker is rendered around lines 219-227), add above/around the credential picker a Git-account selector that writes `config.gitAccountId`:

```tsx
{def?.type === "github" && (
  <>
    <label style={lbl}>Git account (token + SSH key)</label>
    <select
      value={(config.gitAccountId as string) ?? ""}
      onChange={(e) => setConfig({ ...config, gitAccountId: e.target.value || undefined })}
      style={input}
    >
      <option value="">Token credential only (no git-over-SSH)</option>
      {forgeAccounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.label} · {a.gitTransport === "ssh" ? "SSH" : "HTTPS"}
          {a.gitTransport === "ssh" ? "" : " — no SSH key"}
        </option>
      ))}
    </select>
    {forgeAccounts.length === 0 && (
      <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>
        No Git accounts yet — add one in Settings → Credentials → Git account (Transport: SSH).
      </span>
    )}
  </>
)}
```

> Match the local variable names already in `AddConnection` — if the form's config state setter is named differently than `config`/`setConfig`, adapt these two identifiers. Verify with `grep -n "config\|setConfig\|def?.type\|credentialType" packages/web/src/components/settings/ConnectionsTab.tsx`. The credential picker (token fallback) stays as-is.

- [ ] **Step 3: Ensure `gitAccountId` is sent on save**

Confirm the existing create/update path sends `config` (it does — `POST /api/connections` body includes `config`). No change needed beyond writing `gitAccountId` into `config` in Step 2. The Edit path (if the component has one) should seed `config.gitAccountId` from the existing connection.

- [ ] **Step 4: Typecheck + build the web package**

Run: `cd packages/web && npx tsc --noEmit && cd ../.. && pnpm --filter @otterbot/web build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/settings/ConnectionsTab.tsx
git commit -m "connections UI: pick a Git account (token + SSH key) for github connections"
```

---

## Task 6: Manual verification on the remote test server

**Files:** none (verification only)

- [ ] **Step 1: Deploy** — SSH to the remote (`mreeves@192.168.95.69`, repo `/home/mreeves/otterbot`), `git pull`, build all three packages with `corepack pnpm`, back up `data/control.db*`, restart the detached `node packages/server/dist/index.js`, confirm it boots (see `server.log`).

- [ ] **Step 2: Configure** — In the app: Settings → Credentials → Git account → GitHub, Transport SSH, select/generate the SSH key (add the public key to GitHub). Then Settings → Connections → Add → GitHub → pick that Git account. Assign the connection to the PM agent (and confirm the PM has the `gh-auth` capability).

- [ ] **Step 3: Verify in the PM's own shell** — Ask the PM to run, from its shell: `gh issue list -R <your/repo>` (token path) and `git clone git@github.com:<your/private-repo>.git /tmp/t && cd /tmp/t && git commit --allow-empty -m "otterbot signed" && git log --show-signature -1` (SSH key + signing path). Both should succeed; the commit should show a good SSH signature.

- [ ] **Step 4: Negative check** — Disable the PM's `gh-auth` capability; confirm a new `shell_exec` no longer has `GITHUB_TOKEN` in env and `ls -la ~/.ssh/id_ed25519` is absent (key + token gone together).

---

## Self-Review notes (filled during writing)

- **Spec coverage:** token injection (Task 2), in-sandbox key bind (Task 1), `resolveGitSsh` + gh-auth gating (Task 3), threading to shell_exec + coding CLI (Task 4), Git-account picker UI (Task 5), token-only fallback (Task 5 default option; Task 2 keeps `credentialId` path), edge cases — no key → null (Task 2 `gitContextFor`/transport checks), deleted account → `getAccount` null → null (Task 2), multiple connections → first wins + warn (Task 2), gh-auth gating (Task 3). Testing strategy → Tasks 1/2 unit+e2e, Task 6 manual.
- **Type consistency:** `GitSshSetup` defined once in `shell.ts`, imported by `orchestrator.ts` and `agent-context.ts`; `gitSshForAgent`/`gitSsh()`/`SandboxOpts.gitSsh`/`CodingRunOptions.gitSsh` all use it.
- **Known adaptation points flagged inline:** assignment/skill-install route names (Task 2 Step 1), `AddConnection` local identifiers (Task 5 Step 2). Implementer must grep-confirm these before editing.
