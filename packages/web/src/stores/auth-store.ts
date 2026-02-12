import { create } from "zustand";

export type AppScreen = "loading" | "setup" | "login" | "app";

export interface Provider {
  id: string;
  name: string;
}

interface AuthState {
  screen: AppScreen;
  providers: Provider[];
  error: string | null;

  checkStatus: () => Promise<void>;
  login: (passphrase: string) => Promise<boolean>;
  completeSetup: (data: {
    passphrase: string;
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    userName: string;
    userAvatar?: string;
    userBio?: string;
    userTimezone: string;
    ttsVoice?: string;
    userModelPackId?: string;
    userGearConfig?: Record<string, boolean> | null;
  }) => Promise<boolean>;
  logout: () => Promise<void>;
  setError: (error: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  screen: "loading",
  providers: [],
  error: null,

  checkStatus: async () => {
    try {
      const setupRes = await fetch("/api/setup/status");
      const setupData = await setupRes.json();

      if (!setupData.setupComplete) {
        set({ screen: "setup", providers: setupData.providers });
        return;
      }

      // Setup done — check for valid session
      const authRes = await fetch("/api/auth/check");
      const authData = await authRes.json();

      if (authData.authenticated) {
        set({ screen: "app" });
      } else {
        set({ screen: "login" });
      }
    } catch {
      set({ screen: "login", error: "Failed to connect to server" });
    }
  },

  login: async (passphrase) => {
    set({ error: null });
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });

      if (res.ok) {
        set({ screen: "app" });
        return true;
      }

      const data = await res.json();
      set({ error: data.error || "Invalid passphrase" });
      return false;
    } catch {
      set({ error: "Failed to connect to server" });
      return false;
    }
  },

  completeSetup: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/setup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        set({ screen: "app" });
        return true;
      }

      const err = await res.json();
      set({ error: err.error || "Setup failed" });
      return false;
    } catch {
      set({ error: "Failed to connect to server" });
      return false;
    }
  },

  logout: async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    set({ screen: "login", error: null });
  },

  setError: (error) => set({ error }),
}));
