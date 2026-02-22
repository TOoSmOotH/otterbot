import { create } from "zustand";
import type { NamedProvider, ProviderTypeMeta, ProviderType, CustomModel, ModelOption, AgentModelOverride } from "@otterbot/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { NamedProvider, ProviderTypeMeta, ProviderType, CustomModel, ModelOption, AgentModelOverride };

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

export interface ScheduledTaskInfo {
  id: string;
  name: string;
  description: string;
  defaultIntervalMs: number;
  minIntervalMs: number;
  enabled: boolean;
  intervalMs: number;
}

export interface CustomTaskInfo {
  id: string;
  name: string;
  description: string;
  message: string;
  mode: "coo-prompt" | "coo-background" | "notification";
  intervalMs: number;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  models: Record<string, ModelOption[]>; // providerId → model list
  customModels: CustomModel[];
  loading: boolean;
  error: string | null;
  testResults: Record<string, TestResult>;

  // Scheduled Tasks
  scheduledTasks: ScheduledTaskInfo[];
  scheduledTasksLoading: boolean;

  // Custom Scheduled Tasks
  customTasks: CustomTaskInfo[];
  customTasksLoading: boolean;

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
  openCodeModel: string;
  openCodeProviderId: string;
  openCodeInteractive: boolean;
  openCodeTestResult: TestResult | null;

  // Claude Code
  claudeCodeEnabled: boolean;
  claudeCodeAuthMode: "api-key" | "oauth";
  claudeCodeApiKeySet: boolean;
  claudeCodeModel: string;
  claudeCodeApprovalMode: "full-auto" | "auto-edit";
  claudeCodeTimeoutMs: number;
  claudeCodeMaxTurns: number;
  claudeCodeTestResult: TestResult | null;

  // Codex
  codexEnabled: boolean;
  codexAuthMode: "api-key" | "oauth";
  codexApiKeySet: boolean;
  codexModel: string;
  codexApprovalMode: "full-auto" | "suggest" | "ask";
  codexTimeoutMs: number;
  codexTestResult: TestResult | null;

  // GitHub
  gitHubEnabled: boolean;
  gitHubTokenSet: boolean;
  gitHubUsername: string | null;
  gitHubTestResult: TestResult | null;

  // GitHub SSH
  sshKeySet: boolean;
  sshKeyFingerprint: string | null;
  sshKeyType: string | null;
  sshPublicKey: string | null;
  sshTestResult: TestResult & { username?: string } | null;

  // Discord
  discordEnabled: boolean;
  discordTokenSet: boolean;
  discordRequireMention: boolean;
  discordBotUsername: string | null;
  discordAllowedChannels: string[];
  discordAvailableChannels: Array<{ id: string; name: string; guildName: string }>;
  discordPairedUsers: Array<{ discordUserId: string; discordUsername: string; pairedAt: string }>;
  discordPendingPairings: Array<{ code: string; discordUserId: string; discordUsername: string; createdAt: string }>;
  discordTestResult: TestResult | null;

  // Slack
  slackEnabled: boolean;
  slackBotTokenSet: boolean;
  slackSigningSecretSet: boolean;
  slackAppTokenSet: boolean;
  slackRequireMention: boolean;
  slackBotUsername: string | null;
  slackAllowedChannels: string[];
  slackAvailableChannels: Array<{ id: string; name: string }>;
  slackPairedUsers: Array<{ slackUserId: string; slackUsername: string; pairedAt: string }>;
  slackPendingPairings: Array<{ code: string; slackUserId: string; slackUsername: string; createdAt: string }>;
  slackTestResult: TestResult | null;

  // Google
  googleConnected: boolean;
  googleConnectedEmail: string | null;
  googleClientIdSet: boolean;
  googleClientSecretSet: boolean;
  googleRedirectBaseUrl: string | null;

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

  // Custom models
  loadCustomModels: (providerId?: string) => Promise<void>;
  createCustomModel: (data: { providerId: string; modelId: string; label?: string }) => Promise<CustomModel | null>;
  deleteCustomModel: (id: string) => Promise<void>;

  // Agent model overrides
  agentModelOverrides: AgentModelOverride[];
  loadAgentModelOverrides: () => Promise<void>;
  setAgentModelOverride: (registryEntryId: string, provider: string, model: string) => Promise<void>;
  clearAgentModelOverride: (registryEntryId: string) => Promise<void>;

  // Scheduled Tasks actions
  loadScheduledTasks: () => Promise<void>;
  updateScheduledTask: (taskId: string, data: { enabled?: boolean; intervalMs?: number }) => Promise<void>;

  // Custom Tasks actions
  loadCustomTasks: () => Promise<void>;
  createCustomTask: (data: {
    name: string;
    description?: string;
    message: string;
    mode?: "coo-prompt" | "coo-background" | "notification";
    intervalMs: number;
    enabled?: boolean;
  }) => Promise<void>;
  updateCustomTask: (id: string, data: {
    name?: string;
    description?: string;
    message?: string;
    mode?: "coo-prompt" | "coo-background" | "notification";
    intervalMs?: number;
    enabled?: boolean;
  }) => Promise<void>;
  deleteCustomTask: (id: string) => Promise<void>;

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
    interactive?: boolean;
  }) => Promise<void>;
  testOpenCodeConnection: () => Promise<void>;

  // Claude Code actions
  loadClaudeCodeSettings: () => Promise<void>;
  updateClaudeCodeSettings: (data: {
    enabled?: boolean;
    authMode?: "api-key" | "oauth";
    apiKey?: string;
    model?: string;
    approvalMode?: "full-auto" | "auto-edit";
    timeoutMs?: number;
    maxTurns?: number;
  }) => Promise<void>;
  testClaudeCodeConnection: () => Promise<void>;

  // Codex actions
  loadCodexSettings: () => Promise<void>;
  updateCodexSettings: (data: {
    enabled?: boolean;
    authMode?: "api-key" | "oauth";
    apiKey?: string;
    model?: string;
    approvalMode?: "full-auto" | "suggest" | "ask";
    timeoutMs?: number;
  }) => Promise<void>;
  testCodexConnection: () => Promise<void>;

  // GitHub actions
  loadGitHubSettings: () => Promise<void>;
  updateGitHubSettings: (data: {
    enabled?: boolean;
    token?: string;
  }) => Promise<void>;
  testGitHubConnection: () => Promise<void>;

  // GitHub SSH actions
  generateSSHKey: (type?: "ed25519" | "rsa") => Promise<void>;
  importSSHKey: (privateKey: string) => Promise<void>;
  getSSHPublicKey: () => Promise<void>;
  removeSSHKey: () => Promise<void>;
  testSSHConnection: () => Promise<void>;

  // Discord actions
  loadDiscordSettings: () => Promise<void>;
  updateDiscordSettings: (data: {
    enabled?: boolean;
    botToken?: string;
    requireMention?: boolean;
    allowedChannels?: string[];
  }) => Promise<void>;
  testDiscordConnection: () => Promise<void>;
  approveDiscordPairing: (code: string) => Promise<void>;
  rejectDiscordPairing: (code: string) => Promise<void>;
  revokeDiscordUser: (userId: string) => Promise<void>;

  // Slack actions
  loadSlackSettings: () => Promise<void>;
  updateSlackSettings: (data: {
    enabled?: boolean;
    botToken?: string;
    signingSecret?: string;
    appToken?: string;
    requireMention?: boolean;
    allowedChannels?: string[];
  }) => Promise<void>;
  testSlackConnection: () => Promise<void>;
  approveSlackPairing: (code: string) => Promise<void>;
  rejectSlackPairing: (code: string) => Promise<void>;
  revokeSlackUser: (userId: string) => Promise<void>;

  // Google actions
  loadGoogleSettings: () => Promise<void>;
  updateGoogleCredentials: (data: {
    clientId?: string;
    clientSecret?: string;
    redirectBaseUrl?: string;
  }) => Promise<void>;
  beginGoogleOAuth: () => Promise<string | null>;
  disconnectGoogle: () => Promise<void>;

  // Backup & Restore
  backupDatabase: () => Promise<void>;
  restoreDatabase: (file: File) => Promise<{ ok: boolean; error?: string }>;
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
  customModels: [],
  agentModelOverrides: [],
  loading: false,
  error: null,
  testResults: {},
  scheduledTasks: [],
  scheduledTasksLoading: false,
  customTasks: [],
  customTasksLoading: false,
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
  openCodeModel: "",
  openCodeProviderId: "",
  openCodeInteractive: false,
  openCodeTestResult: null,
  claudeCodeEnabled: false,
  claudeCodeAuthMode: "api-key",
  claudeCodeApiKeySet: false,
  claudeCodeModel: "claude-sonnet-4-5-20250929",
  claudeCodeApprovalMode: "full-auto",
  claudeCodeTimeoutMs: 1200000,
  claudeCodeMaxTurns: 50,
  claudeCodeTestResult: null,
  codexEnabled: false,
  codexAuthMode: "api-key",
  codexApiKeySet: false,
  codexModel: "codex-mini",
  codexApprovalMode: "full-auto",
  codexTimeoutMs: 1200000,
  codexTestResult: null,
  gitHubEnabled: false,
  gitHubTokenSet: false,
  gitHubUsername: null,
  gitHubTestResult: null,
  sshKeySet: false,
  sshKeyFingerprint: null,
  sshKeyType: null,
  sshPublicKey: null,
  sshTestResult: null,
  discordEnabled: false,
  discordTokenSet: false,
  discordRequireMention: true,
  discordBotUsername: null,
  discordAllowedChannels: [],
  discordAvailableChannels: [],
  discordPairedUsers: [],
  discordPendingPairings: [],
  discordTestResult: null,
  slackEnabled: false,
  slackBotTokenSet: false,
  slackSigningSecretSet: false,
  slackAppTokenSet: false,
  slackRequireMention: true,
  slackBotUsername: null,
  slackAllowedChannels: [],
  slackAvailableChannels: [],
  slackPairedUsers: [],
  slackPendingPairings: [],
  slackTestResult: null,
  googleConnected: false,
  googleConnectedEmail: null,
  googleClientIdSet: false,
  googleClientSecretSet: false,
  googleRedirectBaseUrl: null,

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

  loadCustomModels: async (providerId) => {
    try {
      const url = providerId
        ? `/api/settings/custom-models?providerId=${encodeURIComponent(providerId)}`
        : "/api/settings/custom-models";
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      set({ customModels: data.customModels });
    } catch {
      // Silently fail
    }
  },

  createCustomModel: async (data) => {
    try {
      const res = await fetch("/api/settings/custom-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) return null;
      const created = await res.json();
      await get().loadCustomModels();
      // Refresh the model list for this provider so the new custom model appears
      await get().fetchModels(data.providerId);
      return created as CustomModel;
    } catch {
      return null;
    }
  },

  deleteCustomModel: async (id) => {
    try {
      const cm = get().customModels.find((m) => m.id === id);
      await fetch(`/api/settings/custom-models/${id}`, { method: "DELETE" });
      await get().loadCustomModels();
      // Refresh model list for the affected provider
      if (cm) {
        await get().fetchModels(cm.providerId);
      }
    } catch {
      // Silently fail
    }
  },

  loadAgentModelOverrides: async () => {
    try {
      const res = await fetch("/api/settings/agent-model-overrides");
      if (!res.ok) return;
      const data = await res.json();
      set({ agentModelOverrides: data.overrides ?? [] });
    } catch {
      // Silently fail
    }
  },

  setAgentModelOverride: async (registryEntryId, provider, model) => {
    try {
      await fetch(`/api/settings/agent-model-overrides/${registryEntryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model }),
      });
      await get().loadAgentModelOverrides();
    } catch {
      // Silently fail
    }
  },

  clearAgentModelOverride: async (registryEntryId) => {
    try {
      await fetch(`/api/settings/agent-model-overrides/${registryEntryId}`, {
        method: "DELETE",
      });
      await get().loadAgentModelOverrides();
    } catch {
      // Silently fail
    }
  },

  loadScheduledTasks: async () => {
    set({ scheduledTasksLoading: true });
    try {
      const res = await fetch("/api/settings/scheduled-tasks");
      if (!res.ok) return;
      const data = await res.json();
      set({ scheduledTasks: data.tasks });
    } catch {
      // Silently fail
    } finally {
      set({ scheduledTasksLoading: false });
    }
  },

  updateScheduledTask: async (taskId, data) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/settings/scheduled-tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update scheduled task");
      await get().loadScheduledTasks();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  loadCustomTasks: async () => {
    set({ customTasksLoading: true });
    try {
      const res = await fetch("/api/settings/custom-tasks");
      if (!res.ok) return;
      const data = await res.json();
      set({ customTasks: data.tasks });
    } catch {
      // Silently fail
    } finally {
      set({ customTasksLoading: false });
    }
  },

  createCustomTask: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/custom-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create custom task");
      await get().loadCustomTasks();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  updateCustomTask: async (id, data) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/settings/custom-tasks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update custom task");
      await get().loadCustomTasks();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  deleteCustomTask: async (id) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/settings/custom-tasks/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete custom task");
      await get().loadCustomTasks();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
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
        openCodeModel: data.model ?? "",
        openCodeProviderId: data.providerId ?? "",
        openCodeInteractive: data.interactive ?? false,
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

  // Claude Code actions

  loadClaudeCodeSettings: async () => {
    try {
      const res = await fetch("/api/settings/claude-code");
      if (!res.ok) return;
      const data = await res.json();
      set({
        claudeCodeEnabled: data.enabled,
        claudeCodeAuthMode: data.authMode ?? "api-key",
        claudeCodeApiKeySet: data.apiKeySet,
        claudeCodeModel: data.model ?? "claude-sonnet-4-5-20250929",
        claudeCodeApprovalMode: data.approvalMode ?? "full-auto",
        claudeCodeTimeoutMs: data.timeoutMs ?? 1200000,
        claudeCodeMaxTurns: data.maxTurns ?? 50,
      });
    } catch {
      // Silently fail
    }
  },

  updateClaudeCodeSettings: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/claude-code", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update Claude Code settings");
      await get().loadClaudeCodeSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  testClaudeCodeConnection: async () => {
    set({ claudeCodeTestResult: { ok: false, testing: true } });
    try {
      const res = await fetch("/api/settings/claude-code/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      set({
        claudeCodeTestResult: {
          ok: data.ok,
          error: data.error,
          testing: false,
        },
      });
    } catch (err) {
      set({
        claudeCodeTestResult: {
          ok: false,
          error: err instanceof Error ? err.message : "Unknown error",
          testing: false,
        },
      });
    }
  },

  // Codex actions

  loadCodexSettings: async () => {
    try {
      const res = await fetch("/api/settings/codex");
      if (!res.ok) return;
      const data = await res.json();
      set({
        codexEnabled: data.enabled,
        codexAuthMode: data.authMode ?? "api-key",
        codexApiKeySet: data.apiKeySet,
        codexModel: data.model ?? "codex-mini",
        codexApprovalMode: data.approvalMode ?? "full-auto",
        codexTimeoutMs: data.timeoutMs ?? 1200000,
      });
    } catch {
      // Silently fail
    }
  },

  updateCodexSettings: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/codex", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update Codex settings");
      await get().loadCodexSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  testCodexConnection: async () => {
    set({ codexTestResult: { ok: false, testing: true } });
    try {
      const res = await fetch("/api/settings/codex/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      set({
        codexTestResult: {
          ok: data.ok,
          error: data.error,
          testing: false,
        },
      });
    } catch (err) {
      set({
        codexTestResult: {
          ok: false,
          error: err instanceof Error ? err.message : "Unknown error",
          testing: false,
        },
      });
    }
  },

  // GitHub actions

  loadGitHubSettings: async () => {
    try {
      const res = await fetch("/api/settings/github");
      if (!res.ok) return;
      const data = await res.json();
      set({
        gitHubEnabled: data.enabled,
        gitHubTokenSet: data.tokenSet,
        gitHubUsername: data.username,
        sshKeySet: data.sshKeySet,
        sshKeyFingerprint: data.sshKeyFingerprint,
        sshKeyType: data.sshKeyType,
      });
    } catch {
      // Silently fail
    }
  },

  updateGitHubSettings: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/github", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update GitHub settings");
      await get().loadGitHubSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  testGitHubConnection: async () => {
    set({ gitHubTestResult: { ok: false, testing: true } });
    try {
      const res = await fetch("/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      set({
        gitHubTestResult: {
          ok: data.ok,
          error: data.error,
          testing: false,
        },
        gitHubUsername: data.ok ? data.username : get().gitHubUsername,
      });
    } catch (err) {
      set({
        gitHubTestResult: {
          ok: false,
          error: err instanceof Error ? err.message : "Unknown error",
          testing: false,
        },
      });
    }
  },

  // GitHub SSH actions

  generateSSHKey: async (type) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/github/ssh/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: type ?? "ed25519" }),
      });
      const data = await res.json();
      if (!data.ok) {
        set({ error: data.error ?? "Failed to generate SSH key" });
        return;
      }
      set({ sshPublicKey: data.publicKey });
      await get().loadGitHubSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  importSSHKey: async (privateKey) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/github/ssh/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privateKey }),
      });
      const data = await res.json();
      if (!data.ok) {
        set({ error: data.error ?? "Failed to import SSH key" });
        return;
      }
      set({ sshPublicKey: data.publicKey });
      await get().loadGitHubSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  getSSHPublicKey: async () => {
    try {
      const res = await fetch("/api/settings/github/ssh/public-key");
      if (!res.ok) return;
      const data = await res.json();
      set({ sshPublicKey: data.publicKey });
    } catch {
      // Silently fail
    }
  },

  removeSSHKey: async () => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/github/ssh", {
        method: "DELETE",
      });
      const data = await res.json();
      if (!data.ok) {
        set({ error: data.error ?? "Failed to remove SSH key" });
        return;
      }
      set({ sshPublicKey: null, sshTestResult: null });
      await get().loadGitHubSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  testSSHConnection: async () => {
    set({ sshTestResult: { ok: false, testing: true } });
    try {
      const res = await fetch("/api/settings/github/ssh/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      set({
        sshTestResult: {
          ok: data.ok,
          error: data.error,
          username: data.username,
          testing: false,
        },
      });
    } catch (err) {
      set({
        sshTestResult: {
          ok: false,
          error: err instanceof Error ? err.message : "Unknown error",
          testing: false,
        },
      });
    }
  },

  // Discord actions

  loadDiscordSettings: async () => {
    try {
      const res = await fetch("/api/settings/discord");
      if (!res.ok) return;
      const data = await res.json();
      set({
        discordEnabled: data.enabled,
        discordTokenSet: data.tokenSet,
        discordRequireMention: data.requireMention,
        discordBotUsername: data.botUsername,
        discordAllowedChannels: data.allowedChannels ?? [],
        discordAvailableChannels: data.availableChannels ?? [],
        discordPairedUsers: data.pairedUsers,
        discordPendingPairings: data.pendingPairings,
      });
    } catch {
      // Silently fail
    }
  },

  updateDiscordSettings: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/discord", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update Discord settings");
      await get().loadDiscordSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  testDiscordConnection: async () => {
    set({ discordTestResult: { ok: false, testing: true } });
    try {
      const res = await fetch("/api/settings/discord/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      set({
        discordTestResult: {
          ok: data.ok,
          error: data.error,
          testing: false,
        },
        discordBotUsername: data.ok ? data.botUsername : get().discordBotUsername,
      });
    } catch (err) {
      set({
        discordTestResult: {
          ok: false,
          error: err instanceof Error ? err.message : "Unknown error",
          testing: false,
        },
      });
    }
  },

  approveDiscordPairing: async (code) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/discord/pair/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error("Failed to approve pairing");
      await get().loadDiscordSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  rejectDiscordPairing: async (code) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/discord/pair/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error("Failed to reject pairing");
      await get().loadDiscordSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  revokeDiscordUser: async (userId) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/settings/discord/pair/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to revoke user");
      await get().loadDiscordSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  // Slack actions

  loadSlackSettings: async () => {
    try {
      const res = await fetch("/api/settings/slack");
      if (!res.ok) return;
      const data = await res.json();
      set({
        slackEnabled: data.enabled,
        slackBotTokenSet: data.botTokenSet,
        slackSigningSecretSet: data.signingSecretSet,
        slackAppTokenSet: data.appTokenSet,
        slackRequireMention: data.requireMention,
        slackBotUsername: data.botUsername,
        slackAllowedChannels: data.allowedChannels ?? [],
        slackAvailableChannels: data.availableChannels ?? [],
        slackPairedUsers: data.pairedUsers,
        slackPendingPairings: data.pendingPairings,
      });
    } catch { /* ignore */ }
  },

  updateSlackSettings: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/slack", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update Slack settings");
      await get().loadSlackSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  testSlackConnection: async () => {
    set({ slackTestResult: { ok: false, testing: true } });
    try {
      const res = await fetch("/api/settings/slack/test", {
        method: "POST",
      });
      const data = await res.json();
      set({
        slackTestResult: {
          ok: data.ok,
          error: data.error,
          testing: false,
        },
        slackBotUsername: data.ok ? data.botUsername : get().slackBotUsername,
      });
    } catch {
      set({
        slackTestResult: {
          ok: false,
          error: "Network error",
          testing: false,
        },
      });
    }
  },

  approveSlackPairing: async (code) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/slack/pair/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error("Failed to approve pairing");
      await get().loadSlackSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  rejectSlackPairing: async (code) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/slack/pair/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error("Failed to reject pairing");
      await get().loadSlackSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  revokeSlackUser: async (userId) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/settings/slack/pair/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to revoke user");
      await get().loadSlackSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  // Google actions

  loadGoogleSettings: async () => {
    try {
      const res = await fetch("/api/settings/google");
      if (!res.ok) return;
      const data = await res.json();
      set({
        googleConnected: data.connected,
        googleConnectedEmail: data.connectedEmail,
        googleClientIdSet: data.clientIdSet,
        googleClientSecretSet: data.clientSecretSet,
        googleRedirectBaseUrl: data.redirectBaseUrl,
      });
    } catch {
      // Silently fail
    }
  },

  updateGoogleCredentials: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/google", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update Google credentials");
      await get().loadGoogleSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  beginGoogleOAuth: async () => {
    try {
      const res = await fetch("/api/settings/google/oauth/begin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.url ?? null;
    } catch {
      return null;
    }
  },

  disconnectGoogle: async () => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/google/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed to disconnect Google");
      await get().loadGoogleSettings();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  backupDatabase: async () => {
    try {
      const res = await fetch("/api/settings/backup");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Backup failed");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `otterbot-backup-${new Date().toISOString().split("T")[0]}.db`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  restoreDatabase: async (file: File) => {
    set({ error: null });
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/settings/restore", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || "Restore failed" };
      }

      // Reload settings as DB changed
      await get().loadSettings();
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      set({ error: msg });
      return { ok: false, error: msg };
    }
  },
}));
