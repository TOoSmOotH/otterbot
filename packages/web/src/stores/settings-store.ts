import { create } from "zustand";
import type { NamedProvider, ProviderTypeMeta, ProviderType } from "@smoothbot/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { NamedProvider, ProviderTypeMeta, ProviderType };

export interface TierDefaults {
  coo: { provider: string; model: string };
  teamLead: { provider: string; model: string };
  worker: { provider: string; model: string };
}

export interface TestResult {
  ok: boolean;
  error?: string;
  testing: boolean;
}

export interface SearchProviderConfig {
  id: string;
  name: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  apiKey?: string;
  apiKeySet: boolean;
  baseUrl?: string;
}

export interface TTSProviderConfig {
  id: string;
  name: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  apiKey?: string;
  apiKeySet: boolean;
  baseUrl?: string;
  voices: string[];
}

export interface STTProviderConfig {
  id: string;
  name: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  apiKey?: string;
  apiKeySet: boolean;
  baseUrl?: string;
}

interface SettingsState {
  providers: NamedProvider[];
  providerTypes: ProviderTypeMeta[];
  defaults: TierDefaults;
  models: Record<string, string[]>; // providerId → model list
  loading: boolean;
  error: string | null;
  testResults: Record<string, TestResult>;

  // Search
  searchProviders: SearchProviderConfig[];
  activeSearchProvider: string | null;
  searchTestResults: Record<string, TestResult>;

  // TTS
  ttsEnabled: boolean;
  ttsProviders: TTSProviderConfig[];
  activeTTSProvider: string | null;
  ttsVoice: string;
  ttsSpeed: number;
  ttsTestResults: Record<string, TestResult>;

  // STT
  sttEnabled: boolean;
  sttProviders: STTProviderConfig[];
  activeSTTProvider: string | null;
  sttLanguage: string;
  sttModelId: string;
  sttTestResults: Record<string, TestResult>;

  // OpenCode
  openCodeEnabled: boolean;
  openCodeApiUrl: string;
  openCodeUsername: string;
  openCodePasswordSet: boolean;
  openCodeTimeoutMs: number;
  openCodeMaxIterations: number;
  openCodeTestResult: TestResult | null;

  loadSettings: () => Promise<void>;
  createProvider: (data: { name: string; type: ProviderType; apiKey?: string; baseUrl?: string }) => Promise<NamedProvider | null>;
  updateProvider: (
    id: string,
    data: { name?: string; apiKey?: string; baseUrl?: string },
  ) => Promise<void>;
  deleteProvider: (id: string) => Promise<{ ok: boolean; error?: string }>;
  updateDefaults: (data: Partial<TierDefaults>) => Promise<void>;
  testProvider: (id: string, model?: string) => Promise<void>;
  fetchModels: (providerId: string) => Promise<void>;

  // Search actions
  loadSearchSettings: () => Promise<void>;
  updateSearchProvider: (
    id: string,
    data: { apiKey?: string; baseUrl?: string },
  ) => Promise<void>;
  setActiveSearchProvider: (id: string | null) => Promise<void>;
  testSearchProvider: (id: string) => Promise<void>;

  // TTS actions
  loadTTSSettings: () => Promise<void>;
  setTTSEnabled: (enabled: boolean) => Promise<void>;
  setActiveTTSProvider: (id: string | null) => Promise<void>;
  setTTSVoice: (voice: string) => Promise<void>;
  setTTSSpeed: (speed: number) => Promise<void>;
  updateTTSProvider: (
    id: string,
    data: { apiKey?: string; baseUrl?: string },
  ) => Promise<void>;
  testTTSProvider: (id: string) => Promise<void>;

  // STT actions
  loadSTTSettings: () => Promise<void>;
  setSTTEnabled: (enabled: boolean) => Promise<void>;
  setActiveSTTProvider: (id: string | null) => Promise<void>;
  setSTTLanguage: (language: string) => Promise<void>;
  setSTTModel: (modelId: string) => Promise<void>;
  updateSTTProvider: (
    id: string,
    data: { apiKey?: string; baseUrl?: string },
  ) => Promise<void>;
  testSTTProvider: (id: string) => Promise<void>;

  // OpenCode actions
  loadOpenCodeSettings: () => Promise<void>;
  updateOpenCodeSettings: (data: {
    enabled?: boolean;
    apiUrl?: string;
    username?: string;
    password?: string;
    timeoutMs?: number;
    maxIterations?: number;
  }) => Promise<void>;
  testOpenCodeConnection: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSettingsStore = create<SettingsState>((set, get) => ({
  providers: [],
  providerTypes: [],
  defaults: {
    coo: { provider: "", model: "" },
    teamLead: { provider: "", model: "" },
    worker: { provider: "", model: "" },
  },
  models: {},
  loading: false,
  error: null,
  testResults: {},
  searchProviders: [],
  activeSearchProvider: null,
  searchTestResults: {},
  ttsEnabled: false,
  ttsProviders: [],
  activeTTSProvider: null,
  ttsVoice: "af_heart",
  ttsSpeed: 1,
  ttsTestResults: {},
  sttEnabled: false,
  sttProviders: [],
  activeSTTProvider: null,
  sttLanguage: "",
  sttModelId: "onnx-community/whisper-base",
  sttTestResults: {},
  openCodeEnabled: false,
  openCodeApiUrl: "",
  openCodeUsername: "",
  openCodePasswordSet: false,
  openCodeTimeoutMs: 180000,
  openCodeMaxIterations: 50,
  openCodeTestResult: null,

  loadSettings: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to load settings");
      const data = await res.json();
      set({
        providers: data.providers,
        providerTypes: data.providerTypes ?? [],
        defaults: data.defaults,
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  createProvider: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create provider");
      }
      const created = await res.json();
      await get().loadSettings();
      return created as NamedProvider;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return null;
    }
  },

  updateProvider: async (id, data) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/settings/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update provider");
      await get().loadSettings();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  deleteProvider: async (id) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/settings/providers/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        set({ error: data.error || "Failed to delete provider" });
        return { ok: false, error: data.error };
      }
      await get().loadSettings();
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      set({ error: msg });
      return { ok: false, error: msg };
    }
  },

  updateDefaults: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update defaults");
      await get().loadSettings();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  testProvider: async (id, model) => {
    set((s) => ({
      testResults: {
        ...s.testResults,
        [id]: { ok: false, testing: true },
      },
    }));
    try {
      const res = await fetch(`/api/settings/providers/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const data = await res.json();
      set((s) => ({
        testResults: {
          ...s.testResults,
          [id]: { ok: data.ok, error: data.error, testing: false },
        },
      }));
    } catch (err) {
      set((s) => ({
        testResults: {
          ...s.testResults,
          [id]: {
            ok: false,
            error: err instanceof Error ? err.message : "Unknown error",
            testing: false,
          },
        },
      }));
    }
  },

  fetchModels: async (providerId) => {
    try {
      const res = await fetch(`/api/settings/providers/${providerId}/models`);
      if (!res.ok) return;
      const data = await res.json();
      set((s) => ({
        models: { ...s.models, [providerId]: data.models },
      }));
    } catch {
      // Silently fail — user can still type model names manually
    }
  },

  loadSearchSettings: async () => {
    try {
      const res = await fetch("/api/settings/search");
      if (!res.ok) return;
      const data = await res.json();
      set({
        searchProviders: data.providers,
        activeSearchProvider: data.activeProvider,
      });
    } catch {
      // Silently fail
    }
  },

  updateSearchProvider: async (id, data) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/settings/search/provider/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update search provider");
      await get().loadSearchSettings();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  setActiveSearchProvider: async (id) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/search/active", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: id }),
      });
      if (!res.ok) throw new Error("Failed to set active search provider");
      await get().loadSearchSettings();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  testSearchProvider: async (id) => {
    set((s) => ({
      searchTestResults: {
        ...s.searchTestResults,
        [id]: { ok: false, testing: true },
      },
    }));
    try {
      const res = await fetch(`/api/settings/search/provider/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      set((s) => ({
        searchTestResults: {
          ...s.searchTestResults,
          [id]: { ok: data.ok, error: data.error, testing: false },
        },
      }));
    } catch (err) {
      set((s) => ({
        searchTestResults: {
          ...s.searchTestResults,
          [id]: {
            ok: false,
            error: err instanceof Error ? err.message : "Unknown error",
            testing: false,
          },
        },
      }));
    }
  },

  loadTTSSettings: async () => {
    try {
      const res = await fetch("/api/settings/tts");
      if (!res.ok) return;
      const data = await res.json();
      set({
        ttsEnabled: data.enabled,
        ttsProviders: data.providers,
        activeTTSProvider: data.activeProvider,
        ttsVoice: data.voice,
        ttsSpeed: data.speed,
      });
    } catch {
      // Silently fail
    }
  },

  setTTSEnabled: async (enabled) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/tts/enabled", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update TTS enabled state");
      await get().loadTTSSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  setActiveTTSProvider: async (id) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/tts/active", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: id }),
      });
      if (!res.ok) throw new Error("Failed to set active TTS provider");
      await get().loadTTSSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  setTTSVoice: async (voice) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/tts/voice", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice }),
      });
      if (!res.ok) throw new Error("Failed to set TTS voice");
      await get().loadTTSSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  setTTSSpeed: async (speed) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/tts/speed", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speed }),
      });
      if (!res.ok) throw new Error("Failed to set TTS speed");
      await get().loadTTSSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  updateTTSProvider: async (id, data) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/settings/tts/provider/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update TTS provider");
      await get().loadTTSSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  testTTSProvider: async (id) => {
    set((s) => ({
      ttsTestResults: {
        ...s.ttsTestResults,
        [id]: { ok: false, testing: true },
      },
    }));
    try {
      const res = await fetch(`/api/settings/tts/provider/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      set((s) => ({
        ttsTestResults: {
          ...s.ttsTestResults,
          [id]: { ok: data.ok, error: data.error, testing: false },
        },
      }));
    } catch (err) {
      set((s) => ({
        ttsTestResults: {
          ...s.ttsTestResults,
          [id]: {
            ok: false,
            error: err instanceof Error ? err.message : "Unknown error",
            testing: false,
          },
        },
      }));
    }
  },

  // STT actions

  loadSTTSettings: async () => {
    try {
      const res = await fetch("/api/settings/stt");
      if (!res.ok) return;
      const data = await res.json();
      set({
        sttEnabled: data.enabled,
        sttProviders: data.providers,
        activeSTTProvider: data.activeProvider,
        sttLanguage: data.language,
        sttModelId: data.modelId,
      });
    } catch {
      // Silently fail
    }
  },

  setSTTEnabled: async (enabled) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/stt/enabled", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update STT enabled state");
      await get().loadSTTSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  setActiveSTTProvider: async (id) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/stt/active", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: id }),
      });
      if (!res.ok) throw new Error("Failed to set active STT provider");
      await get().loadSTTSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  setSTTLanguage: async (language) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/stt/language", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      });
      if (!res.ok) throw new Error("Failed to set STT language");
      await get().loadSTTSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  setSTTModel: async (modelId) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/stt/model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      if (!res.ok) throw new Error("Failed to set STT model");
      await get().loadSTTSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  updateSTTProvider: async (id, data) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/settings/stt/provider/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update STT provider");
      await get().loadSTTSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  testSTTProvider: async (id) => {
    set((s) => ({
      sttTestResults: {
        ...s.sttTestResults,
        [id]: { ok: false, testing: true },
      },
    }));
    try {
      const res = await fetch(`/api/settings/stt/provider/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      set((s) => ({
        sttTestResults: {
          ...s.sttTestResults,
          [id]: { ok: data.ok, error: data.error, testing: false },
        },
      }));
    } catch (err) {
      set((s) => ({
        sttTestResults: {
          ...s.sttTestResults,
          [id]: {
            ok: false,
            error: err instanceof Error ? err.message : "Unknown error",
            testing: false,
          },
        },
      }));
    }
  },

  // OpenCode actions

  loadOpenCodeSettings: async () => {
    try {
      const res = await fetch("/api/settings/opencode");
      if (!res.ok) return;
      const data = await res.json();
      set({
        openCodeEnabled: data.enabled,
        openCodeApiUrl: data.apiUrl,
        openCodeUsername: data.username,
        openCodePasswordSet: data.passwordSet,
        openCodeTimeoutMs: data.timeoutMs,
        openCodeMaxIterations: data.maxIterations,
      });
    } catch {
      // Silently fail
    }
  },

  updateOpenCodeSettings: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/opencode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update OpenCode settings");
      await get().loadOpenCodeSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  testOpenCodeConnection: async () => {
    set({ openCodeTestResult: { ok: false, testing: true } });
    try {
      const res = await fetch("/api/settings/opencode/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      set({
        openCodeTestResult: {
          ok: data.ok,
          error: data.error,
          testing: false,
        },
      });
    } catch (err) {
      set({
        openCodeTestResult: {
          ok: false,
          error: err instanceof Error ? err.message : "Unknown error",
          testing: false,
        },
      });
    }
  },
}));
