import { useEffect, useMemo, useState } from "react";
import type { GlobalSettings as GlobalSettingsShape, ProviderId, ThemeId } from "@otterbot/shared";
import {
  PROVIDERS,
  THEMES,
  useGlobalSettingsStore,
  applyTheme,
} from "../../stores/global-settings-store";

const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  lmstudio: "LM Studio",
  ollama: "Ollama",
};

const API_KEY_LABELS: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  lmstudio: "LMSTUDIO_API_KEY",
  ollama: "OLLAMA_API_KEY",
};

export function GlobalSettings() {
  const savedSettings = useGlobalSettingsStore((s) => s.settings);
  const load = useGlobalSettingsStore((s) => s.load);
  const saveSettings = useGlobalSettingsStore((s) => s.save);
  const saving = useGlobalSettingsStore((s) => s.saving);
  const [draft, setDraft] = useState<GlobalSettingsShape>(savedSettings);
  const [status, setStatus] = useState("");

  useEffect(() => void load(), [load]);
  useEffect(() => setDraft(savedSettings), [savedSettings]);

  const themeOptions = useMemo(() => Object.keys(THEMES) as ThemeId[], []);

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
            provider={draft.defaultChatModel.provider}
            modelId={draft.defaultChatModel.modelId}
            onChange={(provider, modelId) =>
              patch({ defaultChatModel: { provider, modelId } })
            }
          />
          <ModelPicker
            title="Embeddings"
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
          {PROVIDERS.map((provider) => {
            const cfg = draft.providers[provider];
            return (
              <div key={provider} style={panel}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>{PROVIDER_LABELS[provider]}</strong>
                  <span style={badge}>
                    {cfg.apiKeyConfigured ? "Key saved" : "No key"}
                  </span>
                </div>
                <Field label="Base URL">
                  <input
                    value={cfg.baseUrl}
                    onChange={(e) =>
                      patchProvider(provider, { baseUrl: e.target.value }, draft, patch)
                    }
                    style={input}
                  />
                </Field>
                <Field label={API_KEY_LABELS[provider]}>
                  <input
                    type="password"
                    placeholder={cfg.apiKeyConfigured ? "Leave blank to keep existing key" : "Optional"}
                    onChange={(e) =>
                      patchProvider(provider, { apiKey: e.target.value }, draft, patch)
                    }
                    style={input}
                  />
                </Field>
              </div>
            );
          })}
        </div>
      </section>

      {status && <div style={hint}>{status}</div>}
    </div>
  );
}

function ModelPicker({
  title,
  provider,
  modelId,
  onChange,
}: {
  title: string;
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
          onChange={(e) => onChange(e.target.value as ProviderId, modelId)}
          style={input}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
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

