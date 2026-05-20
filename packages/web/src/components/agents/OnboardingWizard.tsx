import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import type { ProviderAccount, ProviderId } from "@otterbot/shared";
import { useSetupStore } from "../../stores/setup-store";
import { useAgentsStore } from "../../stores/agents-store";
import { useGlobalSettingsStore } from "../../stores/global-settings-store";
import {
  useProvidersStore,
  providerDefaultCred,
  globalProviderPatch,
} from "../../stores/providers-store";
import {
  ProviderFields,
  Field,
  isLocalProvider,
  type OAuthBundle,
  type TestState,
  type AuthMethod,
} from "./ProviderFields";
import { AvatarUpload } from "./AvatarUpload";

/** The single model the built-in CPU embedder runs. */
const BUILTIN_EMBED_MODEL = "all-MiniLM-L6-v2";

/**
 * First-run wizard that walks the user through configuring their first agent
 * (the COO): pick a chat model, pick an embedding model, set a personality.
 */
export function OnboardingWizard() {
  const markComplete = useSetupStore((s) => s.markComplete);
  const reloadAgents = useAgentsStore((s) => s.load);
  const settings = useGlobalSettingsStore((s) => s.settings);
  const loadSettings = useGlobalSettingsStore((s) => s.load);
  const saveSettings = useGlobalSettingsStore((s) => s.save);
  const providers = useProvidersStore((s) => s.providers);
  const loadProviders = useProvidersStore((s) => s.load);
  const chatProviders = providers.filter((p) => p.supportsChat);
  const embeddingProviders = providers.filter((p) => p.supportsEmbeddings);
  const providerInfo = (id: ProviderId) => providers.find((p) => p.id === id);
  /**
   * The credential field's initial value for a provider: a local server's
   * already-saved base URL when there is one, else the provider default.
   */
  const credSeedFor = (id: ProviderId) => {
    const info = providerInfo(id);
    if (!info) return "";
    const accounts = settings.providers[id] ?? [];
    const savedBaseUrl = accounts[0]?.baseUrl;
    if (isLocalProvider(info) && savedBaseUrl) return savedBaseUrl;
    return providerDefaultCred(info);
  };

  const accountsFor = (id: ProviderId) => settings.providers[id] ?? [];

  const [step, setStep] = useState(0);

  // Chat model slot.
  const [chatProvider, setChatProvider] = useState<ProviderId>("lmstudio");
  const [chatAccount, setChatAccount] = useState("default");
  const [chatModelId, setChatModelId] = useState("local-model");
  const [chatCred, setChatCred] = useState("http://localhost:1234/v1");
  const [chatTest, setChatTest] = useState<TestState>({ status: "idle" });
  const [chatModels, setChatModels] = useState<string[]>([]);
  const [openAiAuth, setOpenAiAuth] = useState<AuthMethod>("api-key");

  // Embedding model slot — may use a different provider than chat. Defaults to
  // the zero-setup built-in CPU embedder.
  const [embProvider, setEmbProvider] = useState<ProviderId>("builtin");
  const [embAccount, setEmbAccount] = useState("default");
  const [embModelId, setEmbModelId] = useState(BUILTIN_EMBED_MODEL);
  const [embCred, setEmbCred] = useState("");
  const [embTest, setEmbTest] = useState<TestState>({ status: "idle" });
  const [embModels, setEmbModels] = useState<string[]>([]);
  /** When true the user chose to skip embeddings (keyword-only memory). */
  const [embSkipped, setEmbSkipped] = useState(false);

  // OpenAI ChatGPT-subscription OAuth (account-wide; chat only).
  const [oauthStatus, setOauthStatus] = useState<{ connected: boolean; accountId: string | null } | null>(null);
  const [oauthModels, setOauthModels] = useState<string[]>([]);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthPaste, setOauthPaste] = useState("");
  const [oauthCompleting, setOauthCompleting] = useState(false);

  const [cooName, setCooName] = useState("Otterbot COO");
  const [persona, setPersona] = useState(
    "You are the COO — a friendly, decisive coordinator. You answer the user directly and delegate specialised work to other agents."
  );
  const [saving, setSaving] = useState(false);

  /** OpenAI via a ChatGPT subscription — tokens live server-side, not in a field. */
  const useChatOAuth = chatProvider === "openai" && openAiAuth === "oauth";

  const pickChatProvider = (p: ProviderId) => {
    setChatProvider(p);
    setOpenAiAuth("api-key");
    setChatTest({ status: "idle" });
    setChatModels([]);
    setChatAccount(accountsFor(p)[0]?.account ?? "default");
    setChatCred(credSeedFor(p));
    setChatModelId(p === "anthropic" ? "claude-opus-4-7" : p === "openai" ? "gpt-4o" : "local-model");
  };

  const pickEmbProvider = (p: ProviderId) => {
    setEmbProvider(p);
    setEmbSkipped(false);
    setEmbTest({ status: "idle" });
    setEmbModels([]);
    setEmbAccount(accountsFor(p)[0]?.account ?? "default");
    // Reuse the chat credential when both slots share a (non-OAuth) provider.
    setEmbCred(p === chatProvider && !useChatOAuth ? chatCred : credSeedFor(p));
    setEmbModelId(
      p === "builtin"
        ? BUILTIN_EMBED_MODEL
        : p === "openai"
          ? "text-embedding-3-small"
          : "local-embedding-model"
    );
  };

  // --- OpenAI OAuth (ChatGPT subscription) -------------------------------
  const refreshOAuth = () =>
    apiFetch("/api/auth/openai/status")
      .then((r) => r.json())
      .then(setOauthStatus)
      .catch(() => {});

  useEffect(() => {
    void refreshOAuth();
    void loadSettings();
    void loadProviders();
  }, [loadSettings, loadProviders]);

  // Once connected, discover the Codex model catalogue for this subscription.
  useEffect(() => {
    if (!oauthStatus?.connected) {
      setOauthModels([]);
      return;
    }
    void apiFetch("/api/provider-models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "openai", secrets: { OPENAI_AUTH_METHOD: "oauth" } }),
    })
      .then((r) => r.json())
      .then((d: { ok: boolean; models?: string[] }) => {
        const list = d.ok && d.models ? d.models : [];
        setOauthModels(list);
        if (list.length > 0) setChatModelId((cur) => (list.includes(cur) ? cur : list[0]));
      })
      .catch(() => setOauthModels([]));
  }, [oauthStatus?.connected]);

  const signInOpenAi = async () => {
    setOauthBusy(true);
    try {
      const res = await apiFetch("/api/auth/openai/login", { method: "POST" });
      const data = (await res.json()) as { authUrl?: string; error?: string };
      if (!data.authUrl) {
        setChatTest({ status: "fail", message: data.error ?? "Could not start sign-in." });
        setOauthBusy(false);
        return;
      }
      window.open(data.authUrl, "_blank", "noopener");
      // Poll until the loopback callback completes (or 5 min timeout).
      const started = Date.now();
      const timer = setInterval(async () => {
        const s = await apiFetch("/api/auth/openai/status")
          .then((r) => r.json())
          .catch(() => null);
        if (s?.connected || Date.now() - started > 300_000) {
          clearInterval(timer);
          if (s) setOauthStatus(s);
          setOauthBusy(false);
        }
      }, 2000);
    } catch {
      setOauthBusy(false);
    }
  };

  const signOutOpenAi = async () => {
    await apiFetch("/api/auth/openai/signout", { method: "POST" });
    setOauthModels([]);
    setOauthPaste("");
    void refreshOAuth();
  };

  // Manual completion: paste the redirect URL when the loopback callback
  // can't be reached (otterbot running on a remote box).
  const completeOpenAi = async () => {
    setOauthCompleting(true);
    try {
      const res = await apiFetch("/api/auth/openai/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: oauthPaste.trim() }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        status?: { connected: boolean; accountId: string | null };
        error?: string;
      };
      if (data.ok && data.status) {
        setOauthStatus(data.status);
        setOauthPaste("");
        setChatTest({ status: "idle" });
      } else {
        setChatTest({ status: "fail", message: data.error ?? "Could not complete sign-in." });
      }
    } catch (err) {
      setChatTest({ status: "fail", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setOauthCompleting(false);
    }
  };

  const oauthBundle: OAuthBundle = {
    authMethod: openAiAuth,
    setAuthMethod: setOpenAiAuth,
    status: oauthStatus,
    models: oauthModels,
    busy: oauthBusy,
    signIn: signInOpenAi,
    signOut: signOutOpenAi,
    paste: oauthPaste,
    onPaste: setOauthPaste,
    complete: completeOpenAi,
    completing: oauthCompleting,
  };

  const finish = async () => {
    setSaving(true);
    try {
      const chatRef = {
        provider: chatProvider,
        account: chatAccount || "default",
        modelId: chatModelId.trim(),
      };
      // Skipped embeddings → empty modelId, which the server resolves to a
      // disabled (null) embedder; memory falls back to keyword search.
      const embeddingRef = embSkipped
        ? { provider: "builtin" as ProviderId, account: "default", modelId: "" }
        : {
            provider: embProvider,
            account: embAccount || "default",
            modelId: embModelId.trim(),
          };

      // Provider credentials are saved to Global Settings — the single source
      // of truth — so every agent reuses them. The built-in embedder has no
      // credential field; OAuth tokens are stored server-side by its flow.
      const current = useGlobalSettingsStore.getState().settings;
      const providerPatch: Record<string, ProviderAccount[]> = {};
      const upsertAccount = (
        p: ProviderId,
        accountName: string,
        value: string,
        extra: Partial<ProviderAccount> = {}
      ) => {
        const info = providerInfo(p);
        if (!info || p === "builtin") return;
        const list =
          providerPatch[p] ?? current.providers[p]?.map((a) => ({ ...a })) ?? [];
        const idx = list.findIndex((a) => a.account === accountName);
        const patch: Partial<ProviderAccount> = value.trim()
          ? { ...globalProviderPatch(info, value.trim()), ...extra }
          : { ...extra };
        if (idx >= 0) {
          list[idx] = { ...list[idx], ...patch, apiKeyConfigured: list[idx].apiKeyConfigured || Boolean(patch.apiKey) };
        } else {
          list.push({
            account: accountName,
            baseUrl: info.defaultBaseUrl ?? "",
            apiKeyConfigured: Boolean(patch.apiKey),
            ...patch,
          } as ProviderAccount);
        }
        providerPatch[p] = list;
      };
      if (!useChatOAuth) upsertAccount(chatProvider, chatRef.account, chatCred);
      if (!embSkipped) upsertAccount(embeddingRef.provider, embeddingRef.account, embCred);
      if (useChatOAuth) {
        // Flip OpenAI to OAuth account-wide on the chosen account so model
        // resolution uses the server-side tokens.
        upsertAccount("openai", chatRef.account, "", { authMethod: "oauth" });
      }
      if (Object.keys(providerPatch).length > 0) {
        await saveSettings({
          ...current,
          providers: { ...current.providers, ...providerPatch },
        });
      }

      const allowedModels = Array.from(
        new Set([chatRef.provider, embeddingRef.provider])
      ).map((p) => ({ provider: p, account: "*", modelId: "*" }));

      await apiFetch("/api/agents/coo", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: cooName.trim() || "Otterbot COO",
          persona,
          model: { chat: chatRef, embedding: embeddingRef },
          allowedModels,
        }),
      });
      await markComplete();
      await reloadAgents();
    } finally {
      setSaving(false);
    }
  };

  const steps = ["Welcome", "Chat model", "Embedding model", "Personality"];

  return (
    <div style={overlay}>
      <div style={panel} data-testid="onboarding-wizard">
        <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          {steps.map((label, i) => (
            <span
              key={label}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: i === step ? "rgb(var(--fg))" : "rgb(var(--muted))",
                borderBottom: `2px solid ${i === step ? "rgb(var(--accent))" : "transparent"}`,
                paddingBottom: 3,
              }}
            >
              {i + 1}. {label}
            </span>
          ))}
        </div>

        {step === 0 && (
          <>
            <h2 style={h2}>Welcome to otterbot</h2>
            <p style={p}>
              otterbot runs a team of AI agents. Each agent has its own personality, memory, model,
              and credentials. Let's set up your first agent — the <strong>COO</strong>, who
              coordinates the rest.
            </p>
            <p style={p}>You can create more agents and fine-tune everything later in the Agent Studio.</p>
            <Buttons>
              <button style={ghost} onClick={() => void markComplete()}>
                Skip setup
              </button>
              <button style={primary} onClick={() => setStep(1)}>
                Get started
              </button>
            </Buttons>
          </>
        )}

        {step === 1 && (
          <>
            <h2 style={h2}>Choose a chat model</h2>
            <p style={p}>Pick where the COO's intelligence comes from. You can change this anytime.</p>
            <ProviderFields
              kind="chat"
              providers={chatProviders}
              provider={chatProvider}
              onProvider={pickChatProvider}
              account={chatAccount}
              onAccount={setChatAccount}
              accounts={accountsFor(chatProvider)}
              cred={chatCred}
              onCred={setChatCred}
              modelId={chatModelId}
              onModelId={setChatModelId}
              test={chatTest}
              onTest={setChatTest}
              models={chatModels}
              onModels={setChatModels}
              modelLabel="Chat model"
              oauth={oauthBundle}
            />
            <Buttons>
              <button style={ghost} onClick={() => setStep(0)}>
                Back
              </button>
              <button
                style={primary}
                onClick={() => setStep(2)}
                disabled={!chatModelId.trim() || (useChatOAuth && !oauthStatus?.connected)}
              >
                Next
              </button>
            </Buttons>
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={h2}>Choose an embedding model</h2>
            <p style={p}>
              Embeddings turn the COO's memories into vectors so it can recall them by{" "}
              <em>meaning</em>, not just exact keywords. The <strong>built-in</strong> option runs
              on your CPU with no setup. This step is optional — without an embedding model memory
              still works, using keyword search.
            </p>
            <ProviderFields
              kind="embedding"
              providers={embeddingProviders}
              provider={embProvider}
              onProvider={pickEmbProvider}
              account={embAccount}
              onAccount={setEmbAccount}
              accounts={accountsFor(embProvider)}
              cred={embCred}
              onCred={setEmbCred}
              modelId={embModelId}
              onModelId={setEmbModelId}
              test={embTest}
              onTest={setEmbTest}
              models={embModels}
              onModels={setEmbModels}
              modelLabel="Embedding model"
            />
            <Buttons>
              <button style={ghost} onClick={() => setStep(1)}>
                Back
              </button>
              <button
                style={ghost}
                onClick={() => {
                  setEmbSkipped(true);
                  setStep(3);
                }}
              >
                Skip — keyword search only
              </button>
              <button
                style={primary}
                onClick={() => {
                  setEmbSkipped(false);
                  setStep(3);
                }}
                disabled={!embModelId.trim()}
              >
                Next
              </button>
            </Buttons>
          </>
        )}

        {step === 3 && (
          <>
            <h2 style={h2}>Give the COO a personality</h2>
            <Field label="Name">
              <input value={cooName} onChange={(e) => setCooName(e.target.value)} style={input} />
            </Field>
            <Field label="Avatar (optional)">
              <AvatarUpload agentId="coo" name={cooName} avatar={null} />
            </Field>
            <Field label="Persona">
              <textarea
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                rows={6}
                style={{ ...input, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
              />
            </Field>
            <Buttons>
              <button style={ghost} onClick={() => setStep(2)}>
                Back
              </button>
              <button style={primary} onClick={finish} disabled={saving} data-testid="onboarding-finish">
                {saving ? "Setting up…" : "Finish setup"}
              </button>
            </Buttons>
          </>
        )}
      </div>
    </div>
  );
}

function Buttons({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>{children}</div>;
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};

const panel: React.CSSProperties = {
  width: 480,
  maxHeight: "88vh",
  overflowY: "auto",
  background: "rgb(var(--bg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 12,
  padding: 20,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const h2: React.CSSProperties = { margin: 0, fontSize: 17 };
const p: React.CSSProperties = { margin: 0, fontSize: 13, color: "rgb(var(--fg))", lineHeight: 1.55 };

const input: React.CSSProperties = {
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "7px 9px",
  fontSize: 13,
  width: "100%",
};

const primary: React.CSSProperties = {
  background: "rgb(var(--accent))",
  color: "white",
  border: "none",
  padding: "8px 16px",
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const ghost: React.CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  padding: "8px 14px",
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 13,
};
