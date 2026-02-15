// Allow self-signed certificates for Node.js fetch calls
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const BASE_URL = "https://localhost:62627";

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

/** Complete the setup wizard via API */
export async function completeSetup(setup: {
  passphrase: string;
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  userName: string;
  userTimezone: string;
  cooName: string;
}): Promise<Response> {
  return apiFetch("/api/setup/complete", {
    method: "POST",
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
