import { createServer, type Server, type ServerResponse } from "node:http";
import {
  OPENAI_OAUTH,
  buildAuthorizeUrl,
  exchangeCode,
  generatePkce,
  randomState,
  refreshTokens,
  type OAuthTokens,
  type Pkce,
} from "./openai-oauth.js";

/** Minimal settings backend — satisfied by the orchestrator's app_settings. */
export interface SettingsStore {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
}

/** app_settings key the encrypted token bundle is stored under. */
const SETTINGS_KEY = "openai_oauth";
/** Refresh once the access token has less than this long left. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export interface AuthStatus {
  connected: boolean;
  accountId: string | null;
  expiresAt: number | null;
}

/**
 * Owns the ChatGPT OAuth token bundle for the whole otterbot instance: persists
 * it (in control.db, encrypted with the rest of the DB), refreshes it before
 * expiry, and runs the browser login flow over a loopback callback server.
 *
 * One ChatGPT login per instance — the token is account-wide, so every agent
 * whose chat provider is `openai` uses it once connected.
 */
export class OpenAiAuthStore {
  private tokens: OAuthTokens | null = null;
  private pending: { pkce: Pkce; state: string } | null = null;
  private server: Server | null = null;
  private refreshing: Promise<string> | null = null;

  constructor(private readonly settings: SettingsStore) {
    const raw = settings.getSetting(SETTINGS_KEY);
    if (raw) {
      try {
        this.tokens = JSON.parse(raw) as OAuthTokens;
      } catch {
        this.tokens = null;
      }
    }
  }

  isConnected(): boolean {
    return this.tokens !== null;
  }

  accountId(): string | null {
    return this.tokens?.accountId ?? null;
  }

  status(): AuthStatus {
    return {
      connected: this.tokens !== null,
      accountId: this.tokens?.accountId ?? null,
      expiresAt: this.tokens?.expiresAt ?? null,
    };
  }

  /** A valid access token, refreshed if it is expired or about to expire. */
  async accessToken(): Promise<string> {
    if (!this.tokens) throw new Error("not signed in to ChatGPT");
    if (Date.now() < this.tokens.expiresAt - REFRESH_SKEW_MS) {
      return this.tokens.accessToken;
    }
    // Coalesce concurrent callers onto a single refresh.
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<string> {
    if (!this.tokens) throw new Error("not signed in to ChatGPT");
    const next = await refreshTokens(this.tokens.refreshToken);
    // A refresh response can omit the id_token — keep the known account id.
    if (!next.accountId) next.accountId = this.tokens.accountId;
    this.persist(next);
    return next.accessToken;
  }

  private persist(tokens: OAuthTokens): void {
    this.tokens = tokens;
    this.settings.setSetting(SETTINGS_KEY, JSON.stringify(tokens));
  }

  /** Forget the connection and stop any in-progress login. */
  signOut(): void {
    this.tokens = null;
    this.pending = null;
    this.settings.setSetting(SETTINGS_KEY, "");
    this.closeServer();
  }

  /**
   * Begin a browser login. Starts the loopback callback server and returns the
   * authorize URL to open. The UI then polls `status()` for completion.
   */
  beginLogin(): { authUrl: string } {
    this.closeServer();
    const pkce = generatePkce();
    const state = randomState();
    this.pending = { pkce, state };
    this.startServer();
    return { authUrl: buildAuthorizeUrl(pkce, state) };
  }

  /**
   * Complete a login from the callback URL the browser was redirected to.
   * For when the loopback server is unreachable from the browser — e.g.
   * otterbot running on a remote box, where `localhost:1455` resolves to the
   * user's own machine. Accepts the full `http://localhost:1455/auth/callback`
   * URL, a bare query string, or `code`/`state` params.
   */
  async completeManual(input: string): Promise<void> {
    const pending = this.pending;
    if (!pending) throw new Error("no login is in progress — start sign-in first");
    const { code, state } = parseCallbackParams(input);
    if (!code) throw new Error("could not find an authorization code in that input");
    if (state !== pending.state) {
      throw new Error("state mismatch — paste the URL from this sign-in attempt");
    }
    const tokens = await exchangeCode(code, pending.pkce);
    this.persist(tokens);
    this.pending = null;
    this.closeServer();
  }

  private startServer(): void {
    const server = createServer((req, res) => {
      void this.handleCallback(req.url ?? "", res);
    });
    server.on("error", (err) => {
      console.error("[openai-oauth] callback server error:", err);
    });
    server.listen(OPENAI_OAUTH.redirectPort, "127.0.0.1");
    this.server = server;
  }

  private async handleCallback(url: string, res: ServerResponse): Promise<void> {
    const page = (msg: string) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<!doctype html><html><body style="font-family:system-ui;padding:48px;max-width:480px">` +
          `<h2>${msg}</h2><p>You can close this tab and return to otterbot.</p></body></html>`
      );
    };
    if (!url.startsWith(OPENAI_OAUTH.redirectPath)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const params = new URL(url, `http://localhost:${OPENAI_OAUTH.redirectPort}`).searchParams;
    const code = params.get("code");
    const state = params.get("state");
    const pending = this.pending;
    try {
      if (!pending) throw new Error("no login is in progress");
      if (params.get("error")) throw new Error(params.get("error_description") ?? params.get("error")!);
      if (!code || state !== pending.state) throw new Error("invalid callback (state mismatch)");
      const tokens = await exchangeCode(code, pending.pkce);
      this.persist(tokens);
      this.pending = null;
      page("Signed in to ChatGPT ✓");
    } catch (err) {
      page("Sign-in failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      this.closeServer();
    }
  }

  private closeServer(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

/**
 * Pull `code`/`state` out of whatever the user pasted: a full redirect URL,
 * a bare `?code=…&state=…` query string, or just `code=…&state=…`.
 */
function parseCallbackParams(input: string): { code: string | null; state: string | null } {
  const text = input.trim();
  let search = "";
  try {
    search = new URL(text).search;
  } catch {
    const q = text.indexOf("?");
    if (q >= 0) search = text.slice(q);
    else if (/(^|&)(code|state)=/.test(text)) search = `?${text}`;
  }
  const params = new URLSearchParams(search);
  return { code: params.get("code"), state: params.get("state") };
}

// --- module singleton -------------------------------------------------------

let _store: OpenAiAuthStore | null = null;

/** Initialise the instance-wide ChatGPT auth store (called once at boot). */
export function initOpenAiAuth(settings: SettingsStore): OpenAiAuthStore {
  _store = new OpenAiAuthStore(settings);
  return _store;
}

/** The auth store, or null if the server has not initialised it. */
export function getOpenAiAuth(): OpenAiAuthStore | null {
  return _store;
}
