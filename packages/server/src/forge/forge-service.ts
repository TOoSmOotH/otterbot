import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { controlSchema, type ControlDb } from "../db/control-db.js";
import { type FetchFn, type Forge, type ForgeAccount, type ForgeProvider } from "./forge.js";
import { GitHubForge } from "./github.js";
import { GiteaForge } from "./gitea.js";

/** Default API base for GitHub when an account doesn't override it. */
const GITHUB_DEFAULT_BASE = "https://api.github.com";

/** Manages forge accounts and builds a {@link Forge} client for one. */
export class ForgeService {
  constructor(
    private readonly control: ControlDb,
    private readonly fetchFn: FetchFn = fetch
  ) {}

  listAccounts(): ForgeAccount[] {
    return this.control.db.select().from(controlSchema.forgeAccounts).all() as ForgeAccount[];
  }

  /** Accounts with the token redacted — for the API/UI. */
  listAccountsMasked(): Array<Omit<ForgeAccount, "token"> & { hasToken: boolean }> {
    return this.listAccounts().map(({ token, ...rest }) => ({ ...rest, hasToken: Boolean(token) }));
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
  }): ForgeAccount {
    if (!input.token) throw new Error("A token is required.");
    if (input.provider === "gitea" && !input.baseUrl) {
      throw new Error("Gitea accounts need a baseUrl (instance URL).");
    }
    const account: ForgeAccount = {
      id: nanoid(),
      provider: input.provider,
      label: input.label || input.provider,
      baseUrl: input.baseUrl || (input.provider === "github" ? GITHUB_DEFAULT_BASE : ""),
      token: input.token,
      username: input.username ?? "",
    };
    this.control.db
      .insert(controlSchema.forgeAccounts)
      .values({ ...account, createdAt: new Date().toISOString() })
      .run();
    return account;
  }

  deleteAccount(id: string): void {
    this.control.db
      .delete(controlSchema.forgeAccounts)
      .where(eq(controlSchema.forgeAccounts.id, id))
      .run();
  }

  /** Build a Forge client for an account. */
  forgeFor(account: ForgeAccount): Forge {
    return account.provider === "gitea"
      ? new GiteaForge(account, this.fetchFn)
      : new GitHubForge(account, this.fetchFn);
  }

  /** Build a Forge client for an account id, or null if unknown. */
  forgeForAccount(id: string | null | undefined): Forge | null {
    if (!id) return null;
    const account = this.getAccount(id);
    return account ? this.forgeFor(account) : null;
  }
}
