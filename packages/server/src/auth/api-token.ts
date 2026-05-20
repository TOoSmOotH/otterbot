import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * AuthStore — owns the API password and the list of active sessions.
 *
 * On first boot (no env override, no `.auth.json`) the server enters
 * **setup mode**: every authed route returns 503 `needs-setup` until the user
 * POSTs a password to `/api/auth/setup`. From then on the password's scrypt
 * hash lives in `data/.auth.json`; every login mints a fresh random session
 * token, stores its SHA-256, and returns the raw token to the client. The
 * client uses the session token as the bearer — the password is never used
 * as one.
 *
 * `OTTERBOT_API_TOKEN` in the env still works as a pinned static bearer for
 * headless deployments: no `.auth.json` is read or written, no sessions are
 * created, and the setup endpoint refuses.
 */
export type AuthMode = "setup" | "password" | "env";

export interface SessionInfo {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}

export interface SessionCreated {
  ok: true;
  /** Random session token; only returned at creation. */
  token: string;
  sessionId: string;
}

export interface AuthError {
  ok: false;
  error: string;
}

export type AuthResult = SessionCreated | AuthError;

export interface AuthStore {
  mode(): AuthMode;
  /** True once a password has been configured (or env-pinned). */
  hasPassword(): boolean;
  /** Where the auth file lives, or null in env-pinned mode. */
  path(): string | null;

  /** First-run: pick the password and mint the first session. */
  setupPassword(password: string, label: string): AuthResult;
  /** Verify the password and mint a fresh session. */
  login(password: string, label: string): AuthResult;

  /**
   * Validate a Bearer token against env-pin or active sessions. Bumps the
   * matching session's `lastUsedAt`. Returns the session id (or `"env"`) so
   * callers can identify the current session.
   */
  validateToken(token: string): { sessionId: string } | null;

  listSessions(currentSessionId: string | null): SessionInfo[];
  revokeSession(id: string): boolean;
  /**
   * Change the password. The current session is kept; every other session is
   * revoked. Returns a fresh token for the kept session so callers can rotate
   * the client's stored bearer.
   */
  changePassword(
    current: string,
    next: string,
    keepSessionId: string | null
  ): AuthResult;

  /** Forces pending lastUsedAt writes to disk (called on shutdown). */
  flush(): void;
}

const AUTH_FILE = ".auth.json";
const LEGACY_TOKEN_FILE = ".api-token";
const FILE_VERSION = 1;
const MIN_PASSWORD_LENGTH = 8;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 } as const;
const TOUCH_FLUSH_MS = 5_000;

interface PersistedPassword {
  salt: string;
  hash: string;
  params: { N: number; r: number; p: number; keylen: number };
}

interface PersistedSession {
  id: string;
  tokenHash: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
}

interface AuthFile {
  version: number;
  password: PersistedPassword;
  sessions: PersistedSession[];
}

export function createAuthStore(dataDir: string): AuthStore {
  const filePath = join(dataDir, AUTH_FILE);
  const envToken = process.env.OTTERBOT_API_TOKEN?.trim() || null;
  let file: AuthFile | null = null;
  let touchTimer: NodeJS.Timeout | null = null;
  let touchDirty = false;

  if (!envToken && existsSync(filePath)) {
    file = readAuthFile(filePath);
  }

  const persist = () => {
    if (!file) return;
    writeAuthFile(filePath, file);
  };

  const scheduleTouchFlush = () => {
    if (touchTimer || !touchDirty) return;
    touchTimer = setTimeout(() => {
      touchTimer = null;
      if (touchDirty && file) {
        touchDirty = false;
        persist();
      }
    }, TOUCH_FLUSH_MS);
    // Don't keep the process alive just to write a timestamp.
    touchTimer.unref?.();
  };

  return {
    mode() {
      if (envToken) return "env";
      if (file) return "password";
      return "setup";
    },
    hasPassword: () => envToken !== null || file !== null,
    path: () => (envToken ? null : filePath),

    setupPassword(password, label) {
      if (envToken) return { ok: false, error: "password is pinned by OTTERBOT_API_TOKEN" };
      if (file) return { ok: false, error: "already set up" };
      const validation = validatePassword(password);
      if (!validation.ok) return validation;
      file = {
        version: FILE_VERSION,
        password: hashPassword(password),
        sessions: [],
      };
      const created = mintSession(file, label);
      persist();
      return created;
    },

    login(password, label) {
      if (envToken) return { ok: false, error: "password login not available in env-pinned mode" };
      if (!file) return { ok: false, error: "needs-setup" };
      if (!verifyPassword(password, file.password)) {
        return { ok: false, error: "invalid password" };
      }
      const created = mintSession(file, label);
      persist();
      return created;
    },

    validateToken(token) {
      if (envToken) {
        return tokenEquals(token, envToken) ? { sessionId: "env" } : null;
      }
      if (!file) return null;
      const hash = sha256Hex(token);
      for (const session of file.sessions) {
        if (constantTimeStringEquals(hash, session.tokenHash)) {
          session.lastUsedAt = Date.now();
          touchDirty = true;
          scheduleTouchFlush();
          return { sessionId: session.id };
        }
      }
      return null;
    },

    listSessions(currentSessionId) {
      if (!file) return [];
      return file.sessions
        .map<SessionInfo>((s) => ({
          id: s.id,
          label: s.label,
          createdAt: s.createdAt,
          lastUsedAt: s.lastUsedAt,
          current: currentSessionId !== null && currentSessionId === s.id,
        }))
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    },

    revokeSession(id) {
      if (!file) return false;
      const before = file.sessions.length;
      file.sessions = file.sessions.filter((s) => s.id !== id);
      if (file.sessions.length === before) return false;
      persist();
      return true;
    },

    changePassword(current, next, keepSessionId) {
      if (envToken) return { ok: false, error: "password change not available in env-pinned mode" };
      if (!file) return { ok: false, error: "needs-setup" };
      if (!verifyPassword(current, file.password)) {
        return { ok: false, error: "current password is incorrect" };
      }
      const validation = validatePassword(next);
      if (!validation.ok) return validation;
      file.password = hashPassword(next);
      // Revoke every session except the one the caller wants to keep, and
      // rotate that one's token so the old bearer can't be reused later.
      const keep = keepSessionId
        ? file.sessions.find((s) => s.id === keepSessionId)
        : null;
      file.sessions = [];
      let created: AuthResult;
      if (keep) {
        const token = randomToken();
        keep.tokenHash = sha256Hex(token);
        keep.lastUsedAt = Date.now();
        file.sessions.push(keep);
        created = { ok: true, token, sessionId: keep.id };
      } else {
        created = mintSession(file, "Password reset");
      }
      persist();
      return created;
    },

    flush() {
      if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
      }
      if (touchDirty && file) {
        touchDirty = false;
        persist();
      }
    },
  };
}

/** Migrate a legacy `.api-token` file (raw password) into the new auth file. */
export function migrateLegacyToken(dataDir: string, store: AuthStore): void {
  if (store.mode() !== "setup") return;
  const legacy = join(dataDir, LEGACY_TOKEN_FILE);
  if (!existsSync(legacy)) return;
  let raw = "";
  try {
    raw = readFileSync(legacy, "utf8").trim();
  } catch {
    return;
  }
  if (!raw) {
    try { unlinkSync(legacy); } catch { /* best effort */ }
    return;
  }
  const result = store.setupPassword(raw, "Migrated from legacy .api-token");
  if (result.ok) {
    try { unlinkSync(legacy); } catch { /* best effort */ }
  }
}

// ---- Internal helpers -----------------------------------------------------

function mintSession(file: AuthFile, label: string): SessionCreated {
  const id = randomBytes(6).toString("hex");
  const token = randomToken();
  const now = Date.now();
  file.sessions.push({
    id,
    tokenHash: sha256Hex(token),
    label: label.trim() || "Unknown device",
    createdAt: now,
    lastUsedAt: now,
  });
  return { ok: true, token, sessionId: id };
}

function randomToken(): string {
  return randomBytes(32).toString("hex");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashPassword(password: string): PersistedPassword {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  }).toString("hex");
  return { salt, hash, params: { ...SCRYPT_PARAMS } };
}

function verifyPassword(password: string, persisted: PersistedPassword): boolean {
  const candidate = scryptSync(password, persisted.salt, persisted.params.keylen, {
    N: persisted.params.N,
    r: persisted.params.r,
    p: persisted.params.p,
  });
  const stored = Buffer.from(persisted.hash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

function validatePassword(password: string): AuthError | { ok: true } {
  const trimmed = password ?? "";
  if (trimmed.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }
  return { ok: true };
}

function readAuthFile(path: string): AuthFile | null {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as AuthFile;
    if (parsed.version !== FILE_VERSION) return null;
    if (!parsed.password || !Array.isArray(parsed.sessions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeAuthFile(path: string, file: AuthFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

// ---- Public helpers (still used by callers) -------------------------------

const COOKIE_NAME = "otterbot_token";

/** Constant-time equality so we don't leak length / prefix via timing. */
export function tokenEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Extract a token from a request — header, query, or cookie. */
export function extractToken(req: {
  headers: Record<string, string | string[] | undefined>;
  query?: unknown;
}): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const query = req.query as { token?: unknown } | undefined;
  if (query && typeof query.token === "string" && query.token) return query.token;

  const cookie = req.headers["cookie"];
  if (typeof cookie === "string") {
    const parsed = parseCookie(cookie, COOKIE_NAME);
    if (parsed) return parsed;
  }
  return null;
}

export { COOKIE_NAME as TOKEN_COOKIE };

function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Hex/length-safe equality used inside the store. */
function constantTimeStringEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Best-effort label from a User-Agent header. Used when the client omits one. */
export function labelFromUserAgent(ua: string | undefined): string {
  if (!ua) return "Unknown device";
  const browser =
    /Firefox\/[\d.]+/.test(ua)
      ? "Firefox"
      : /Edg\/[\d.]+/.test(ua)
        ? "Edge"
        : /OPR\/[\d.]+|Opera/.test(ua)
          ? "Opera"
          : /Chrome\/[\d.]+/.test(ua)
            ? "Chrome"
            : /Safari\/[\d.]+/.test(ua)
              ? "Safari"
              : "Browser";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${os}`;
}
