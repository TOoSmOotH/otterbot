import { create } from "zustand";
import { apiFetch } from "../lib/api";

/** An SSH key as returned by the API — never includes the private key. */
export interface SshKey {
  id: string;
  label: string;
  publicKey: string;
  fingerprint: string;
  createdAt: string;
}

/**
 * Standalone, reusable SSH keys (Settings → Credentials). The user generates or
 * imports a key; the private key never leaves the server. A git account may
 * reference one for git-over-SSH.
 */
interface SshKeysState {
  keys: SshKey[];
  loading: boolean;
  busy: boolean;
  error: string;
  load: () => Promise<void>;
  /** Generate a new ed25519 key; returns it (with the public key to copy). */
  generate: (label: string) => Promise<SshKey | null>;
  /** Import an existing private key; returns the derived public record. */
  import: (label: string, privateKey: string) => Promise<SshKey | null>;
  /** Delete a key. Returns false (and sets error) if it's in use and not forced. */
  remove: (id: string, force?: boolean) => Promise<boolean>;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export const useSshKeysStore = create<SshKeysState>((set, get) => ({
  keys: [],
  loading: false,
  busy: false,
  error: "",

  load: async () => {
    set({ loading: true });
    try {
      const res = await apiFetch("/api/ssh-keys");
      if (res.ok) set({ keys: (await res.json()) as SshKey[] });
    } finally {
      set({ loading: false });
    }
  },

  generate: async (label) => {
    set({ busy: true, error: "" });
    try {
      const res = await apiFetch("/api/ssh-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, mode: "generate" }),
      });
      if (!res.ok) {
        set({ error: await readError(res) });
        return null;
      }
      const key = (await res.json()) as SshKey;
      await get().load();
      return key;
    } finally {
      set({ busy: false });
    }
  },

  import: async (label, privateKey) => {
    set({ busy: true, error: "" });
    try {
      const res = await apiFetch("/api/ssh-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, mode: "import", privateKey }),
      });
      if (!res.ok) {
        set({ error: await readError(res) });
        return null;
      }
      const key = (await res.json()) as SshKey;
      await get().load();
      return key;
    } finally {
      set({ busy: false });
    }
  },

  remove: async (id, force = false) => {
    set({ busy: true, error: "" });
    try {
      const res = await apiFetch(`/api/ssh-keys/${encodeURIComponent(id)}${force ? "?force=true" : ""}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        set({ error: await readError(res) });
        return false;
      }
      await get().load();
      return true;
    } finally {
      set({ busy: false });
    }
  },
}));
