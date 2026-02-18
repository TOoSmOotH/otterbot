import { create } from "zustand";
import type { ProviderTypeMeta } from "@otterbot/shared";

export type AppScreen = "loading" | "setup" | "change-passphrase" | "login" | "app";

interface AuthState {
  screen: AppScreen;
  providerTypes: ProviderTypeMeta[];
  error: string | null;

  checkStatus: () => Promise<void>;
  login: (passphrase: string) => Promise<boolean>;
  setSetupPassphrase: (passphrase: string) => Promise<boolean>;
  changeTemporaryPassphrase: (newPassphrase: string) => Promise<boolean>;
  completeSetup: (data: {
    provider: string;
    providerName?: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    userName: string;
    userAvatar?: string;
    userBio?: string;
    userTimezone: string;
    ttsVoice?: string;
    ttsProvider?: string;
    userModelPackId?: string;
    userGearConfig?: Record<string, boolean> | null;
    cooName: string;
    cooModelPackId?: string;
    cooGearConfig?: Record<string, boolean> | null;
    searchProvider?: string;
    searchApiKey?: string;
    searchBaseUrl?: string;
    adminName: string;
    adminModelPackId?: string;
    adminGearConfig?: Record<string, boolean> | null;
    openCodeEnabled?: boolean;
    openCodeProvider?: string;
    openCodeModel?: string;
    openCodeApiKey?: string;
    openCodeBaseUrl?: string;
  }) => Promise<boolean>;
  logout: () => Promise<void>;
  setError: (error: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  screen: "loading",
  providerTypes: [],
  error: null,

  checkStatus: async () => {
    try {
      const setupRes = await fetch("/api/setup/status");
      const setupData = await setupRes.json();

      if (!setupData.setupComplete) {
        // Check if passphrase was set via env (temporary)
        const authRes = await fetch("/api/auth/check");
        const authData = await authRes.json();

        if (authData.authenticated && authData.isTemporary) {
          set({ screen: "change-passphrase", providerTypes: setupData.providerTypes ?? [] });
          return;
        }

        if (authData.authenticated) {
          set({ screen: "setup", providerTypes: setupData.providerTypes ?? [] });
          return;
        }

        set({ screen: "setup", providerTypes: setupData.providerTypes ?? [] });
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
        // Check if temporary passphrase
        const authRes = await fetch("/api/auth/check");
        const authData = await authRes.json();
        
        if (authData.isTemporary) {
          set({ screen: "change-passphrase" });
          return true;
        }

        // Check if setup is complete
        const setupRes = await fetch("/api/setup/status");
        const setupData = await setupRes.json();
        
        if (!setupData.setupComplete) {
          set({ screen: "setup", providerTypes: setupData.providerTypes ?? [] });
        } else {
          set({ screen: "app" });
        }
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

  setSetupPassphrase: async (passphrase) => {
    set({ error: null });
    try {
      const res = await fetch("/api/setup/passphrase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });

      if (res.ok) {
        return true;
      }

      const data = await res.json();
      set({ error: data.error || "Failed to set passphrase" });
      return false;
    } catch {
      set({ error: "Failed to connect to server" });
      return false;
    }
  },

  changeTemporaryPassphrase: async (newPassphrase) => {
    set({ error: null });
    try {
      const res = await fetch("/api/auth/change-temporary-passphrase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassphrase }),
      });

      if (res.ok) {
        set({ screen: "setup" });
        return true;
      }

      const data = await res.json();
      set({ error: data.error || "Failed to change passphrase" });
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
