/**
 * API client wrapper. The server gates every `/api/*` request on a shared
 * secret stored in localStorage; this module reads it, attaches it as the
 * Authorization header, and notifies listeners when the server rejects it so
 * the auth gate can re-prompt.
 */

import type { Artifact } from "@otterbot/shared";

const TOKEN_KEY = "otterbot.api-token";

const listeners = new Set<() => void>();

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode — silently fall back to in-memory only */
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Subscribe to forced sign-outs (server returned 401). */
export function onAuthInvalid(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function fireAuthInvalid() {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* listener errors are not our problem */
    }
  }
}

/**
 * `fetch`, but with the bearer token attached and 401 escalation. Drop-in
 * replacement for `fetch(input, init)` everywhere except `<img src>` (use
 * `withToken()` for those).
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = getToken();
  if (token && !headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    fireAuthInvalid();
  }
  return res;
}

/**
 * Upload a file for an agent to process. Returns the stored {@link Artifact}
 * (its URL, name, kind, mimeType). Throws on a non-2xx response.
 */
export async function uploadFile(agentId: string, file: File): Promise<Artifact> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await apiFetch(`/api/agents/${agentId}/files`, { method: "POST", body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `upload failed (${res.status})`);
  }
  return (await res.json()) as Artifact;
}

/**
 * Append the token as a query param. Use for URLs consumed by elements that
 * can't set request headers, e.g. `<img src>` and `<a download>`. Only adds
 * the token for same-origin URLs so we don't leak it to external hosts.
 */
export function withToken(path: string | null | undefined): string {
  if (!path) return path ?? "";
  const token = getToken();
  if (!token) return path;
  // Same-origin = relative path, or a URL whose host matches location.host.
  let sameOrigin = path.startsWith("/") && !path.startsWith("//");
  if (!sameOrigin) {
    try {
      sameOrigin = new URL(path, window.location.href).host === window.location.host;
    } catch {
      sameOrigin = false;
    }
  }
  if (!sameOrigin) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}token=${encodeURIComponent(token)}`;
}

export type AuthState = "ok" | "needs-token" | "needs-setup" | "auth-off";

/** Check whether the server requires auth and whether our token is accepted. */
export async function checkAuth(): Promise<AuthState> {
  // /api/auth/status is the only always-open endpoint. If it doesn't exist
  // (old server) treat it as auth-off.
  let statusRes: Response;
  try {
    statusRes = await fetch("/api/auth/status");
  } catch {
    return "auth-off";
  }
  if (!statusRes.ok) return "auth-off";
  const body = (await statusRes.json()) as { authRequired?: boolean; needsSetup?: boolean };
  if (!body.authRequired) return "auth-off";
  if (body.needsSetup) return "needs-setup";

  const token = getToken();
  if (!token) return "needs-token";

  // Probe a cheap authenticated endpoint to confirm our token works.
  const probe = await fetch("/api/agents", { headers: { authorization: `Bearer ${token}` } });
  if (probe.status === 401) {
    clearToken();
    return "needs-token";
  }
  return "ok";
}

interface AuthSuccess {
  ok: true;
  token: string;
  sessionId: string;
}

interface AuthFailure {
  ok: false;
  error?: string;
}

/** Submit a password; server mints a session token and returns it. */
async function authPost(
  url: string,
  body: Record<string, unknown>
): Promise<AuthSuccess | AuthFailure> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AuthSuccess & AuthFailure>;
  if (!res.ok || !data.token || !data.sessionId) {
    return { ok: false, error: data.error };
  }
  return { ok: true, token: data.token, sessionId: data.sessionId };
}

/** Verify the password and store the new session token returned by the server. */
export async function loginWithPassword(
  password: string
): Promise<AuthSuccess | AuthFailure> {
  const result = await authPost("/api/auth/login", { password });
  if (result.ok) setToken(result.token);
  return result;
}

/** First-run: create the password; server mints + returns the first session token. */
export async function setupPassword(
  password: string
): Promise<AuthSuccess | AuthFailure> {
  const result = await authPost("/api/auth/setup", { password });
  if (result.ok) setToken(result.token);
  return result;
}

/** Sign out the current session and forget the local token. */
export async function logout(): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } finally {
    clearToken();
  }
}

export interface SessionInfo {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}

export type AuthBackendMode = "setup" | "password" | "env";

export interface SessionList {
  mode: AuthBackendMode;
  sessions: SessionInfo[];
}

export async function listSessions(): Promise<SessionList | null> {
  const res = await apiFetch("/api/auth/sessions");
  if (!res.ok) return null;
  return (await res.json()) as SessionList;
}

export async function revokeSession(id: string): Promise<boolean> {
  const res = await apiFetch(`/api/auth/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return res.ok;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<AuthSuccess | AuthFailure> {
  const res = await apiFetch("/api/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AuthSuccess & AuthFailure>;
  if (!res.ok || !data.token || !data.sessionId) {
    return { ok: false, error: data.error };
  }
  // The server rotated our session's token; replace the bearer we use.
  setToken(data.token);
  return { ok: true, token: data.token, sessionId: data.sessionId };
}
