// Allow self-signed certificates for Node.js fetch calls
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = "https://localhost:62627";

/**
 * Read the session cookie from the stored auth state (saved by global setup).
 * This avoids per-test login calls that would hit the rate limiter.
 */
export function getStoredCookie(): string {
  const authStatePath = resolve(__dirname, "../.auth-state.json");
  const state = JSON.parse(readFileSync(authStatePath, "utf-8"));
  const cookies: Array<{ name: string; value: string }> = state.cookies ?? [];
  const session = cookies.find((c) => c.name === "sb_session");
  return session ? `sb_session=${session.value}` : "";
}

/** Shared fetch wrapper that ignores self-signed cert errors */
async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

/** Wait for the server to respond to the setup status endpoint */
export async function waitForServer(timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await apiFetch("/api/setup/status");
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server did not respond within ${timeoutMs}ms`);
}

/** Set passphrase during setup (step 1). Returns session cookie. */
export async function setSetupPassphrase(passphrase: string): Promise<{ cookie: string | null; response: Response }> {
  const res = await apiFetch("/api/setup/passphrase", {
    method: "POST",
    body: JSON.stringify({ passphrase }),
  });
  const cookie = res.headers.get("set-cookie");
  return { cookie, response: res };
}

/** Complete the setup wizard via API (requires auth cookie from setSetupPassphrase) */
export async function completeSetup(
  cookie: string,
  setup: {
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    userName: string;
    userTimezone: string;
    cooName: string;
  },
): Promise<Response> {
  return apiFetch("/api/setup/complete", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify(setup),
  });
}

/** Login and return the session cookie */
export async function login(passphrase: string): Promise<string | null> {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ passphrase }),
  });
  if (!res.ok) return null;
  const setCookie = res.headers.get("set-cookie");
  return setCookie;
}

/** Check setup status */
export async function getSetupStatus(): Promise<{ setupComplete: boolean }> {
  const res = await apiFetch("/api/setup/status");
  return res.json();
}

/** Create a project via API (requires auth cookie) */
export async function createProject(
  cookie: string,
  data: { name: string; description?: string },
): Promise<Response> {
  return apiFetch("/api/projects", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify(data),
  });
}

/** Create a kanban task via API (requires auth cookie) */
export async function createTask(
  cookie: string,
  projectId: string,
  data: { title: string; description?: string; column?: string },
): Promise<Response> {
  return apiFetch(`/api/projects/${projectId}/tasks`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify(data),
  });
}

/** Delete a kanban task via API (requires auth cookie) */
export async function deleteTask(
  cookie: string,
  projectId: string,
  taskId: string,
): Promise<Response> {
  return apiFetch(`/api/projects/${projectId}/tasks/${taskId}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
}

/** Update a kanban task via API (requires auth cookie) */
export async function updateTask(
  cookie: string,
  projectId: string,
  taskId: string,
  data: { title?: string; description?: string; column?: string },
): Promise<Response> {
  return apiFetch(`/api/projects/${projectId}/tasks/${taskId}`, {
    method: "PATCH",
    headers: { Cookie: cookie },
    body: JSON.stringify(data),
  });
}

/** List all projects via API (requires auth cookie) */
export async function getProjects(cookie: string): Promise<Response> {
  return apiFetch("/api/projects", {
    headers: { Cookie: cookie },
  });
}

/** Get tasks for a project via API (requires auth cookie) */
export async function getProjectTasks(
  cookie: string,
  projectId: string,
): Promise<Response> {
  return apiFetch(`/api/projects/${projectId}/tasks`, {
    headers: { Cookie: cookie },
  });
}

/** Get usage summary via API (requires auth cookie) */
export async function getUsageSummary(cookie: string): Promise<Response> {
  return apiFetch("/api/usage/summary", {
    headers: { Cookie: cookie },
  });
}

/** Get pricing settings via API (requires auth cookie) */
export async function getPricing(cookie: string): Promise<Response> {
  return apiFetch("/api/settings/pricing", {
    headers: { Cookie: cookie },
  });
}

/** Set pricing for a model via API (requires auth cookie) */
export async function setPricing(
  cookie: string,
  model: string,
  input: number,
  output: number,
): Promise<Response> {
  return apiFetch(`/api/settings/pricing/${encodeURIComponent(model)}`, {
    method: "PUT",
    headers: { Cookie: cookie },
    body: JSON.stringify({ input, output }),
  });
}

/** Delete custom pricing for a model via API (requires auth cookie) */
export async function deletePricing(
  cookie: string,
  model: string,
): Promise<Response> {
  return apiFetch(`/api/settings/pricing/${encodeURIComponent(model)}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
}

// ---------------------------------------------------------------------------
// Provider CRUD
// ---------------------------------------------------------------------------

/** List all named providers */
export async function getProviders(cookie: string): Promise<Response> {
  return apiFetch("/api/settings/providers", {
    headers: { Cookie: cookie },
  });
}

/** Create a named provider */
export async function createProvider(
  cookie: string,
  data: { name: string; type: string; apiKey?: string; baseUrl?: string },
): Promise<Response> {
  return apiFetch("/api/settings/providers", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify(data),
  });
}

/** Update a named provider */
export async function updateProvider(
  cookie: string,
  id: string,
  data: { name?: string; apiKey?: string; baseUrl?: string },
): Promise<Response> {
  return apiFetch(`/api/settings/providers/${id}`, {
    method: "PUT",
    headers: { Cookie: cookie },
    body: JSON.stringify(data),
  });
}

/** Delete a named provider */
export async function deleteProvider(
  cookie: string,
  id: string,
): Promise<Response> {
  return apiFetch(`/api/settings/providers/${id}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
}

// ---------------------------------------------------------------------------
// Tier defaults
// ---------------------------------------------------------------------------

export interface TierConfig {
  provider: string;
  model: string;
}

export interface TierDefaults {
  coo: TierConfig;
  teamLead: TierConfig;
  worker: TierConfig;
}

/** Get current settings (includes tier defaults) */
export async function getSettings(cookie: string): Promise<Response> {
  return apiFetch("/api/settings", {
    headers: { Cookie: cookie },
  });
}

/** Update tier defaults */
export async function setTierDefaults(
  cookie: string,
  defaults: Partial<TierDefaults>,
): Promise<Response> {
  return apiFetch("/api/settings/defaults", {
    method: "PUT",
    headers: { Cookie: cookie },
    body: JSON.stringify(defaults),
  });
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** List all registry entries */
export async function getRegistry(cookie: string): Promise<Response> {
  return apiFetch("/api/registry", {
    headers: { Cookie: cookie },
  });
}
