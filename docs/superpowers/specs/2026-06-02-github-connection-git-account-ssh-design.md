# GitHub Connection backed by a Git account (in-sandbox git-over-SSH)

**Date:** 2026-06-02
**Status:** Approved (design) — pending spec review → implementation plan

## Context

A user tried to set up GitHub for an agent (the PM) via **Settings → Connections →
GitHub** and could not select the SSH key they had stored under Credentials. Root-cause
investigation showed this is **not a bug** but a missing capability rooted in two
overlapping GitHub-identity systems:

- **Connections** (`connections` table → `credentials` → `global_secrets`) are assigned
  to agents and deliver a credential's secrets as **environment variables** into the
  agent's sandbox. The GitHub connection type only references a **token** credential
  (`GITHUB_TOKEN`, scope `cap:gh-auth`); it has an empty `configSchema` and no SSH-key
  field (`connection-registry.ts` `CONNECTION_TYPES`, `GITHUB_CREDENTIAL_SCHEMA`).
- **Git accounts** (a.k.a. forge accounts, `forge_accounts` table) already bundle a
  **token** *and* a selectable **SSH key** (`ssh_key_id` → `ssh_keys`) + commit signing.
  They are used by the project pipeline, where git runs **host-side** so the private key
  never enters a sandbox (`forge-service.ts` `gitContextFor`/`materialize`/`ensureKey`).

The user's actual need (confirmed): the PM should use **one GitHub identity** for both
**git** (clone/push/sign over SSH) **and** the **API** (issues, discussions, PRs — which
require a token, not SSH), and it must work from the **PM's own sandbox shell**, not only
through the pipeline. There is no mechanism today that materializes an SSH private key
into an agent's per-agent sandbox.

## Goal

Let a **GitHub Connection reference a Git account** (forge account). Assigning that
connection to an agent delivers the full identity into the agent's sandbox:

- the account's **token** as `GITHUB_TOKEN` (existing scoped-secret path → `gh`/API), and
- the account's **SSH key** materialized into the sandbox + git configured to use it
  (clone/push + commit signing), via a **new, opt-in, read-only key bind**.

Non-goals: unifying/migrating the two systems wholesale; changing how the project
pipeline does host-side git; SSH access to non-GitHub hosts (that is the separate `ssh`
capability).

## Decisions (from brainstorming)

- **(a) Collapse onto Git accounts** rather than adding a raw `sshKeyId` to the connection
  — avoids configuring the token+key bundle in two competing places.
- **(b) Read-only key bind** into the sandbox is the accepted security posture for
  "PM runs git in its own shell." The key is bound read-only (not copied into the
  persistent workspace), only for agents explicitly assigned the connection.
- **(c) Keep a token-only fallback** for GitHub connections (accounts without an SSH key,
  or users who only want API access).

## Architecture

```
Git account (forge_accounts)            ← already: token + sshKeyId(+ signing)
        ▲ referenced by
GitHub Connection (config.gitAccountId) ← NEW linkage
        ▲ assigned to
Agent  ── context build ─▶ shellSecrets:  GITHUB_TOKEN  (env, cap:gh-auth)
                          └▶ gitSsh:       key bind + GIT_SSH_COMMAND + signing  (NEW)
        └─ shell_exec / coding-CLI sandbox (bwrap / sandbox-exec)
```

### Components & files

1. **Connection model + registry** — `integrations/connection-registry.ts`,
   `connections/connection-store.ts`, `shared/src/connection.ts`.
   - GitHub connection stores `config.gitAccountId: string | null` (a `forge_accounts.id`).
   - Token-only path (existing `credentialId` → github credential) remains valid.

2. **Identity resolution (server)** — `orchestrator.ts`
   (`connectionSecretsForAgent`/`buildScopedSecrets` ~lines 827–854) +
   `forge/forge-service.ts`.
   - For each assigned GitHub connection with a `gitAccountId`, resolve the forge account:
     - add `GITHUB_TOKEN = account.token` to the agent's scoped secrets at scope
       `cap:gh-auth` (so it reaches the shell only when gh-auth is enabled, matching
       today's behavior);
     - produce a **git-ssh descriptor** from `forge-service.gitContextFor(account)` /
       `materialize(sshKeyId)`: `{ keyPath, knownHostsPath, committer, signingKeyPath? }`.
   - New `AgentContext` thunk `resolveGitSsh(): GitSshMaterialization | null`, wired in
     the orchestrator like `resolveProjectWorkspacePath`/`resolveProjectRules`. A thunk so
     assignment changes take effect next turn. Returns null when no git-account connection
     is assigned (or the account has no SSH key → token-only).

3. **The new sandbox primitive** — `integrations/shell.ts`.
   - `SandboxOpts.gitSsh?: { keyPath: string; knownHostsPath?: string;
     committer?: { name: string; email: string }; signingKeyPath?: string }`.
   - **bwrap** (`bwrapPlan`): after the `/workspace` bind, add
     `--ro-bind <keyPath> /workspace/.ssh/id_ed25519` (and known_hosts) into a `0700`
     `.ssh` dir, and set env: `GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes
     -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=~/.ssh/known_hosts"`.
   - **Committer + signing without writing files**: pass via env —
     `GIT_AUTHOR_NAME/EMAIL`, `GIT_COMMITTER_NAME/EMAIL`, and ad-hoc git config via
     `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` for
     `gpg.format=ssh`, `user.signingkey=~/.ssh/id_ed25519.pub`, `commit.gpgsign=true`
     (only when `signingKeyPath` is set).
   - **sandbox-exec** (macOS, `sandboxExecPlan`): no remap — set the same env using the
     real host `keyPath`; no bind needed (reads allowed by default).
   - `buildEnv` extended (or a helper) to emit the git env when `gitSsh` is present.

4. **Thread the descriptor to every sandbox entry point** —
   `runtime/agent-context.ts` (field + default), `agent/tools.ts` (`shell_exec` ~585 and
   the coding-CLI path ~692–724), `integrations/shell-terminal.ts`,
   `integrations/coding-cli.ts` (`sandboxOptsFor`). Each forwards `ctx.gitSsh()` into
   `SandboxOpts.gitSsh`, mirroring how `projectWorkspacePath` already flows.

5. **UI** — `web/src/components/settings/ConnectionsTab.tsx`,
   `stores/connections-store.ts`, reusing `ssh-keys-store`/forge-accounts store.
   - GitHub connection form: a **"Git account" picker** listing forge accounts with
     transport + key hint (e.g. `myorg · SSH · SHA256:…`), writing `config.gitAccountId`.
     Link to create a Git account when none exist.
   - Token-only fallback: keep the existing github-credential picker, presented as the
     secondary option ("token only — no git-over-SSH/signing").

## Data flow (assigned agent, per turn)

1. `buildScopedSecrets(profile)` → `connectionSecretsForAgent(agentId)` walks the agent's
   connections. For a github connection with `gitAccountId`, it adds `GITHUB_TOKEN`
   (scope `cap:gh-auth`) from the forge account.
2. `resolveGitSsh()` returns the descriptor for that account (key materialized to host via
   `forge-service`), or null.
3. On `shell_exec`/coding-CLI, the context passes `gitSsh` into `buildSandboxPlan`, which
   binds the key read-only and sets `GIT_SSH_COMMAND` + signing env.
4. Inside the sandbox: `gh` uses `GITHUB_TOKEN`; `git clone/push` uses the bound key;
   commits are SSH-signed with the account identity.

## Error handling & edge cases

- **Account has no SSH key** (`gitTransport=https` or `sshKeyId` null) → `resolveGitSsh()`
  returns null; only `GITHUB_TOKEN` is injected (token-only, no key bind). UI marks the
  account as "token only" in the picker.
- **Referenced account/key deleted** → resolution returns null (and logs); the agent falls
  back to token-only rather than feeding git a missing key path (mirrors
  `gitContextFor`'s existing fallback).
- **gh-auth capability disabled** → `GITHUB_TOKEN` stays out of the shell env (unchanged
  scope behavior). The key bind is gated the same way **at the context layer**:
  `resolveGitSsh()` returns null unless the agent's `gh-auth` capability is enabled, so
  `shell.ts` stays capability-agnostic and token + key appear/disappear together.
- **Multiple github connections assigned** → define a deterministic winner (first assigned,
  consistent with existing "most recent project wins" style) and `log()` the others as
  ignored; do not silently merge two identities.
- **Key file permissions** — the materialized host key must be `0600` and the in-sandbox
  `.ssh` dir `0700`, else ssh refuses the key.

## Testing strategy

- **Unit (`shell.test.ts`)**: `buildSandboxPlan({ gitSsh })` emits the read-only key bind
  at `/workspace/.ssh/id_ed25519` and a `GIT_SSH_COMMAND` env entry; emits signing
  `GIT_CONFIG_*` only when `signingKeyPath` is set; omits all of it when `gitSsh` is absent.
- **Unit (orchestrator/credentials)**: an agent assigned a git-account-backed github
  connection resolves `GITHUB_TOKEN` (scope `cap:gh-auth`) + a non-null `gitSsh`; a
  token-only github connection resolves the token and a null `gitSsh`; a deleted account
  resolves to token-only/null.
- **Integration (`api.test.ts`)**: create a forge account (ssh + key) → create a github
  connection with `config.gitAccountId` → assign to an agent → assert the resolved sandbox
  env/binds for that agent include the key bind + `GIT_SSH_COMMAND` and `GITHUB_TOKEN`.
- **Manual (remote)**: assign the connection to the PM; from its own shell, `git clone` a
  private repo over SSH, make a signed commit, `git push`, and `gh issue list` — all
  succeed with one configured Git account.

## Out of scope / follow-ups

- Migrating existing token-only github connections to Git accounts (kept working as-is).
- Per-agent git-over-SSH for non-GitHub forges in chat (same mechanism could extend later).
- Surfacing/unifying forge accounts and the Connections "credential" model beyond GitHub.
