import { useEffect, useMemo, useState } from "react";
import type {
  GlobalSettings as GlobalSettingsShape,
  ProviderId,
  ProviderInfo,
  ThemeId,
} from "@otterbot/shared";
import { THEMES, useGlobalSettingsStore, applyTheme } from "../../stores/global-settings-store";
import { useProvidersStore } from "../../stores/providers-store";
import { BuiltinEmbedderControls } from "../BuiltinEmbedderControls";

type OpenAiAuthStatus = { connected: boolean; accountId: string | null };

const EMPTY_PROVIDER_CFG = { baseUrl: "", apiKeyConfigured: false };

export function GlobalSettings() {
  const savedSettings = useGlobalSettingsStore((s) => s.settings);
  const load = useGlobalSettingsStore((s) => s.load);
  const saveSettings = useGlobalSettingsStore((s) => s.save);
  const saving = useGlobalSettingsStore((s) => s.saving);
  const providers = useProvidersStore((s) => s.providers);
  const loadProviders = useProvidersStore((s) => s.load);
  const [draft, setDraft] = useState<GlobalSettingsShape>(savedSettings);
  const [status, setStatus] = useState("");

  useEffect(() => void load(), [load]);
  useEffect(() => void loadProviders(), [loadProviders]);
  useEffect(() => setDraft(savedSettings), [savedSettings]);

  const themeOptions = useMemo(() => Object.keys(THEMES) as ThemeId[], []);
  const chatProviders = providers.filter((p) => p.supportsChat);
  const embeddingProviders = providers.filter((p) => p.supportsEmbeddings);
  // Providers with something to configure (the built-in embedder has nothing).
  const credentialProviders = providers.filter((p) => p.needsApiKey || p.baseUrlEnv);

  const patch = (p: Partial<GlobalSettingsShape>) => {
    setDraft((current) => ({ ...current, ...p }));
    setStatus("");
  };

  const save = async () => {
    const saved = await saveSettings(draft);
    setStatus(saved ? "Saved." : "Save failed.");
  };

  return (
    <div data-testid="global-settings" style={page}>
      <header style={header}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18 }}>Global Settings</h1>
          <p style={hint}>Defaults used across otterbot. Per-agent credentials still override these.</p>
        </div>
        <button onClick={save} disabled={saving} style={primary}>
          {saving ? "Saving..." : "Save settings"}
        </button>
      </header>

      <section style={section}>
        <h2 style={h2}>Theme</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {themeOptions.map((theme) => (
            <button
              key={theme}
              data-testid={`theme-${theme}`}
              onClick={() => {
                patch({ theme });
                applyTheme(theme);
              }}
              style={{
                ...themeButton,
                borderColor: draft.theme === theme ? "rgb(var(--accent))" : "rgb(var(--border))",
              }}
            >
              <span style={{ ...swatch, background: `rgb(${THEMES[theme].vars["--accent"]})` }} />
              {THEMES[theme].label}
            </button>
          ))}
        </div>
      </section>

      <section style={section}>
        <h2 style={h2}>Default Models</h2>
        <div style={grid}>
          <ModelPicker
            title="Chat"
            providers={chatProviders}
            provider={draft.defaultChatModel.provider}
            modelId={draft.defaultChatModel.modelId}
            onChange={(provider, modelId) =>
              patch({ defaultChatModel: { provider, modelId } })
            }
          />
          <ModelPicker
            title="Embeddings"
            providers={embeddingProviders}
            provider={draft.defaultEmbeddingModel.provider}
            modelId={draft.defaultEmbeddingModel.modelId}
            onChange={(provider, modelId) =>
              patch({ defaultEmbeddingModel: { provider, modelId } })
            }
          />
        </div>
      </section>

      <section style={section}>
        <h2 style={h2}>Model Providers</h2>
        <div style={providerGrid}>
          {credentialProviders.length === 0 && (
            <p style={hint}>Loading providers…</p>
          )}
          {credentialProviders.map((p) => {
            const cfg = draft.providers[p.id] ?? EMPTY_PROVIDER_CFG;
            return (
              <div key={p.id} style={panel}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>{p.label}</strong>
                  <span style={badge}>
                    {p.id === "openai" && cfg.authMethod === "oauth"
                      ? "OAuth"
                      : cfg.apiKeyConfigured
                        ? "Key saved"
                        : "No key"}
                  </span>
                </div>
                {p.id === "openai" && (
                  <Field label="Authentication">
                    <select
                      value={cfg.authMethod ?? "api-key"}
                      onChange={(e) =>
                        patchProvider(
                          p.id,
                          { authMethod: e.target.value as "api-key" | "oauth" },
                          draft,
                          patch
                        )
                      }
                      style={input}
                    >
                      <option value="api-key">API key</option>
                      <option value="oauth">ChatGPT OAuth</option>
                    </select>
                  </Field>
                )}
                {p.id !== "openai" || cfg.authMethod !== "oauth" ? (
                  <>
                    {p.baseUrlEnv && (
                      <Field label="Base URL">
                        <input
                          value={cfg.baseUrl}
                          onChange={(e) =>
                            patchProvider(p.id, { baseUrl: e.target.value }, draft, patch)
                          }
                          style={input}
                        />
                      </Field>
                    )}
                    {p.apiKeyEnv && (
                      <Field label={p.apiKeyEnv}>
                        <input
                          type="password"
                          placeholder={
                            cfg.apiKeyConfigured ? "Leave blank to keep existing key" : "Optional"
                          }
                          onChange={(e) =>
                            patchProvider(p.id, { apiKey: e.target.value }, draft, patch)
                          }
                          style={input}
                        />
                      </Field>
                    )}
                  </>
                ) : (
                  <OpenAiOAuthControls />
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section style={section}>
        <h2 style={h2}>Built-in Embedder</h2>
        <p style={hint}>
          A zero-setup embedding model that runs on your CPU — no API key, no server. Needed only
          for agents whose embedding provider is "builtin". The model (~30 MB) downloads on demand.
        </p>
        <div style={panel}>
          <BuiltinEmbedderControls />
        </div>
      </section>

      {status && <div style={hint}>{status}</div>}
    </div>
  );
}

function OpenAiOAuthControls() {
  const [status, setStatus] = useState<OpenAiAuthStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    fetch("/api/auth/openai/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});

  useEffect(() => void refresh(), []);

  const signIn = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/openai/login", { method: "POST" });
      const data = (await res.json()) as { authUrl?: string; error?: string };
      if (!data.authUrl) {
        alert(data.error ?? "Could not start sign-in.");
        setBusy(false);
        return;
      }
      window.open(data.authUrl, "_blank", "noopener");
      const started = Date.now();
      const timer = setInterval(async () => {
        const next = await fetch("/api/auth/openai/status")
          .then((r) => r.json())
          .catch(() => null);
        if (next?.connected || Date.now() - started > 300_000) {
          clearInterval(timer);
          if (next) setStatus(next);
          setBusy(false);
        }
      }, 2000);
    } catch {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await fetch("/api/auth/openai/signout", { method: "POST" });
    void refresh();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={hint}>
        Uses the same ChatGPT subscription OAuth route as Hermes/Codex.
      </div>
      {status?.connected ? (
        <>
          <div style={{ fontSize: 12, color: "#4ade80" }}>
            Connected{status.accountId ? ` - account ${status.accountId}` : ""}
          </div>
          <button onClick={signOut} style={{ ...ghostButton, alignSelf: "flex-start" }}>
            Sign out
          </button>
        </>
      ) : (
        <button onClick={signIn} disabled={busy} style={{ ...primary, alignSelf: "flex-start" }}>
          {busy ? "Waiting for sign-in..." : "Sign in with ChatGPT"}
        </button>
      )}
    </div>
  );
}

function ModelPicker({
  title,
  providers,
  provider,
  modelId,
  onChange,
}: {
  title: string;
  providers: ProviderInfo[];
  provider: ProviderId;
  modelId: string;
  onChange: (provider: ProviderId, modelId: string) => void;
}) {
  return (
    <div style={panel}>
      <strong style={{ fontSize: 13 }}>{title}</strong>
      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 8 }}>
        <select
          value={provider}
          onChange={(e) => onChange(e.target.value, modelId)}
          style={input}
        >
          {/* The saved provider may not be in the list yet (still loading). */}
          {!providers.some((p) => p.id === provider) && <option value={provider}>{provider}</option>}
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <input value={modelId} onChange={(e) => onChange(provider, e.target.value)} style={input} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
      <span style={{ color: "rgb(var(--muted))" }}>{label}</span>
      {children}
    </label>
  );
}

function patchProvider(
  provider: ProviderId,
  patchValue: Partial<GlobalSettingsShape["providers"][ProviderId]>,
  draft: GlobalSettingsShape,
  patch: (p: Partial<GlobalSettingsShape>) => void
) {
  patch({
    providers: {
      ...draft.providers,
      [provider]: { ...draft.providers[provider], ...patchValue },
    },
  });
}

const page: React.CSSProperties = {
  height: "100%",
  overflowY: "auto",
  padding: 18,
  display: "flex",
  flexDirection: "column",
  gap: 18,
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const section: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const h2: React.CSSProperties = { margin: 0, fontSize: 14 };
const hint: React.CSSProperties = { margin: "4px 0 0", fontSize: 12, color: "rgb(var(--muted))" };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 };
const providerGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 };

const panel: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const input: React.CSSProperties = {
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "7px 9px",
  fontSize: 13,
  minWidth: 0,
  width: "100%",
};

const primary: React.CSSProperties = {
  background: "rgb(var(--accent))",
  color: "white",
  border: "none",
  borderRadius: 7,
  padding: "8px 13px",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const ghostButton: React.CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 7,
  padding: "7px 11px",
  cursor: "pointer",
  fontSize: 13,
};

const themeButton: React.CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 7,
  padding: "7px 10px",
  cursor: "pointer",
  fontSize: 13,
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const swatch: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: 999,
  border: "1px solid rgb(var(--border))",
};

const badge: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 999,
  padding: "2px 7px",
  fontSize: 11,
  color: "rgb(var(--muted))",
};
