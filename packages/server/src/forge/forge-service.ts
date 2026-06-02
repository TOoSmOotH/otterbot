import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { controlSchema, type ControlDb } from "../db/control-db.js";
import { type FetchFn, type Forge, type ForgeAccount, type ForgeProvider } from "./forge.js";
import { GitHubForge } from "./github.js";
import { GiteaForge } from "./gitea.js";
import type { SshKeyStore } from "../ssh-keys/ssh-key-store.js";

/** Default API base for GitHub when an account doesn't override it. */
const GITHUB_DEFAULT_BASE = "https://api.github.com";

/** Transport + signing context for a forge account's git operations. */
export interface ForgeGitContext {
  sshKeyPath?: string;
  knownHostsPath?: string;
  committer?: { name: string; email: string };
  /** Public-key path used for SSH commit signing, when enabled. */
  signingKeyPath?: string;
}

/**
 * Manages forge accounts, builds a {@link Forge} client, and owns each account's
 * managed SSH keypair (for SSH transport + commit signing). Keys live on disk
 * under `<keysDir>/<accountId>/` so git can reference them with `-i`.
 */
export class ForgeService {
  constructor(
    private readonly control: ControlDb,
    private readonly keysDir: string,
    private readonly fetchFn: FetchFn = fetch,
    /** Standalone reusable SSH keys an account may reference for git transport. */
    private readonly sshKeys?: SshKeyStore
  ) {}

  listAccounts(): ForgeAccount[] {
    return this.control.db.select().from(controlSchema.forgeAccounts).all() as ForgeAccount[];
  }

  /** Accounts with the token redacted + key presence — for the API/UI. */
  listAccountsMasked() {
    return this.listAccounts().map(({ token, ...rest }) => ({
      ...rest,
      hasToken: Boolean(token),
      publicKey: rest.gitTransport === "ssh" ? this.publicKeyFor(rest) : null,
    }));
  }

  getAccount(id: string): ForgeAccount | null {
    return (
      (this.control.db
        .select()
        .from(controlSchema.forgeAccounts)
        .where(eq(controlSchema.forgeAccounts.id, id))
        .get() as ForgeAccount | undefined) ?? null
    );
  }

  addAccount(input: {
    provider: ForgeProvider;
    label: string;
    baseUrl?: string;
    token: string;
    username?: string;
    gitTransport?: "https" | "ssh";
    committerName?: string;
    committerEmail?: string;
    signCommits?: boolean;
    /** A reusable {@link SshKeyStore} key id to use for git-over-SSH. */
    sshKeyId?: string | null;
  }): ForgeAccount {
    if (!input.token) throw new Error("A token is required (used for the forge API).");
    if (input.provider === "gitea" && !input.baseUrl) {
      throw new Error("Gitea accounts need a baseUrl (instance URL).");
    }
    const gitTransport = input.gitTransport ?? "https";
    // A linked SSH key only applies to ssh transport.
    const sshKeyId = gitTransport === "ssh" ? input.sshKeyId ?? null : null;
    const account: ForgeAccount = {
      id: nanoid(),
      provider: input.provider,
      label: input.label || input.provider,
      baseUrl: input.baseUrl || (input.provider === "github" ? GITHUB_DEFAULT_BASE : ""),
      token: input.token,
      username: input.username ?? "",
      gitTransport,
      committerName: input.committerName ?? "",
      committerEmail: input.committerEmail ?? "",
      // Signing requires an SSH key, so only with ssh transport.
      signCommits: gitTransport === "ssh" ? Boolean(input.signCommits) : false,
      sshKeyId,
    };
    this.control.db
      .insert(controlSchema.forgeAccounts)
      .values({ ...account, createdAt: new Date().toISOString() })
      .run();
    // Generate the legacy per-account key only when no reusable key is linked.
    if (gitTransport === "ssh" && !sshKeyId) this.ensureKey(account.id);
    return account;
  }

  deleteAccount(id: string): void {
    this.control.db
      .delete(controlSchema.forgeAccounts)
      .where(eq(controlSchema.forgeAccounts.id, id))
      .run();
  }

  forgeFor(account: ForgeAccount): Forge {
    return account.provider === "gitea"
      ? new GiteaForge(account, this.fetchFn)
      : new GitHubForge(account, this.fetchFn);
  }

  forgeForAccount(id: string | null | undefined): Forge | null {
    if (!id) return null;
    const account = this.getAccount(id);
    return account ? this.forgeFor(account) : null;
  }

  // --- managed SSH key ------------------------------------------------------

  private keyPath(accountId: string): string {
    return join(this.keysDir, accountId, "id_ed25519");
  }

  knownHostsPath(): string {
    mkdirSync(this.keysDir, { recursive: true });
    return join(this.keysDir, "known_hosts");
  }

  /** Generate the account's ed25519 keypair if absent; returns the public key. */
  ensureKey(accountId: string): string | null {
    const priv = this.keyPath(accountId);
    if (!existsSync(priv)) {
      mkdirSync(join(this.keysDir, accountId), { recursive: true });
      const r = spawnSync(
        "ssh-keygen",
        ["-t", "ed25519", "-f", priv, "-N", "", "-C", `otterbot-forge-${accountId}`],
        { timeout: 20_000 }
      );
      if (r.error || r.status !== 0) {
        console.warn(`[forge] ssh-keygen failed for ${accountId}: ${r.error?.message ?? r.status}`);
        return null;
      }
    }
    return this.publicKey(accountId);
  }

  /** The legacy per-account public key from disk, or null. */
  publicKey(accountId: string): string | null {
    const pub = `${this.keyPath(accountId)}.pub`;
    try {
      return existsSync(pub) ? readFileSync(pub, "utf8").trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * The public key to show the user for an account: the linked reusable key's
   * line when one is set, else the legacy per-account managed key. Looked up by
   * id when given just an id (the API/orchestrator path).
   */
  publicKeyForId(accountId: string): string | null {
    const account = this.getAccount(accountId);
    return account ? this.publicKeyFor(account) : null;
  }

  private publicKeyFor(account: Pick<ForgeAccount, "id" | "sshKeyId">): string | null {
    if (account.sshKeyId && this.sshKeys) {
      const linked = this.sshKeys.publicKey(account.sshKeyId);
      if (linked) return linked;
    }
    return this.publicKey(account.id);
  }

  /** Git transport + signing context for an account (ensures the key for ssh). */
  gitContextFor(account: ForgeAccount): ForgeGitContext {
    const committer =
      account.committerName || account.committerEmail
        ? {
            name: account.committerName || "otterbot",
            email: account.committerEmail || "otterbot@localhost",
          }
        : undefined;
    if (account.gitTransport !== "ssh") return { committer };

    // Prefer a linked reusable key, materialized to disk for `git -i`. If the
    // key was force-deleted out from under the account, fall back to the legacy
    // managed key rather than feeding git a missing path.
    if (account.sshKeyId && this.sshKeys?.get(account.sshKeyId)) {
      const mat = this.sshKeys.materialize(account.sshKeyId);
      return {
        sshKeyPath: mat.privateKeyPath,
        knownHostsPath: this.knownHostsPath(),
        committer,
        signingKeyPath: account.signCommits ? mat.publicKeyPath : undefined,
      };
    }

    // Legacy per-account managed key.
    this.ensureKey(account.id);
    return {
      sshKeyPath: this.keyPath(account.id),
      knownHostsPath: this.knownHostsPath(),
      committer,
      signingKeyPath: account.signCommits ? `${this.keyPath(account.id)}.pub` : undefined,
    };
  }
}
