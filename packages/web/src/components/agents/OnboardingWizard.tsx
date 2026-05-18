import { useEffect, useState } from "react";
import type { ProviderId } from "@otterbot/shared";
import { useSetupStore } from "../../stores/setup-store";
import { useAgentsStore } from "../../stores/agents-store";
import { useGlobalSettingsStore } from "../../stores/global-settings-store";

/** Per-provider credential field metadata. */
const CRED: Record<ProviderId, { label: string; key: string; placeholder: string; secret: boolean }> = {
  anthropic: { label: "Anthropic API key", key: "ANTHROPIC_API_KEY", placeholder: "sk-ant-…", secret: true },
  openai: { label: "OpenAI API key", key: "OPENAI_API_KEY", placeholder: "sk-…", secret: true },
  lmstudio: { label: "LM Studio base URL", key: "LMSTUDIO_BASE_URL", placeholder: "http://localhost:1234/v1", secret: false },
  ollama: { label: "Ollama base URL", key: "OLLAMA_BASE_URL", placeholder: "http://localhost:11434/v1", secret: false },
};

const PROVIDERS: ProviderId[] = ["anthropic", "openai", "lmstudio", "ollama"];

type TestState = { status: "idle" | "testing" | "ok" | "fail"; message?: string };
type AuthMethod = "api-key" | "oauth";

/** Local providers (LM Studio, Ollama) expose a `/models` list we can fetch. */
const isLocalProvider = (p: ProviderId) => p === "lmstudio" || p === "ollama";
const defaultCred = (p: ProviderId) =>
  p === "lmstudio" ? "http://localhost:1234/v1" : p === "ollama" ? "http://localhost:11434/v1" : "";

/** Account-wide ChatGPT-subscription OAuth, threaded into the chat picker. */
interface OAuthBundle {
  authMethod: AuthMethod;
  setAuthMethod: (m: AuthMethod) => void;
  status: { connected: boolean; accountId: string | null } | null;
  models: string[];
  busy: boolean;
  signIn: () => void;
  signOut: () => void;
}

/**
 * First-run wizard that walks the user through configuring their first agent
 * (the COO): pick a chat model, pick an embedding model, set a personality.
 */
export function OnboardingWizard() {
  const markComplete = useSetupStore((s) => s.markComplete);
  const reloadAgents = useAgentsStore((s) => s.load);
  const loadSettings = useGlobalSettingsStore((s) => s.load);
  const saveSettings = useGlobalSettingsStore((s) => s.save);

  const [step, setStep] = useState(0);

  // Chat model slot.
  const [chatProvider, setChatProvider] = useState<ProviderId>("lmstudio");
  const [chatModelId, setChatModelId] = useState("local-model");
  const [chatCred, setChatCred] = useState(defaultCred("lmstudio"));
  const [chatTest, setChatTest] = useState<TestState>({ status: "idle" });
  const [chatModels, setChatModels] = useState<string[]>([]);
  const [openAiAuth, setOpenAiAuth] = useState<AuthMethod>("api-key");

  // Embedding model slot — may use a different provider than chat.
  const [embProvider, setEmbProvider] = useState<ProviderId>("lmstudio");
  const [embModelId, setEmbModelId] = useState("local-embedding-model");
  const [embCred, setEmbCred] = useState(defaultCred("lmstudio"));
  const [embTest, setEmbTest] = useState<TestState>({ status: "idle" });
  const [embModels, setEmbModels] = useState<string[]>([]);

  // OpenAI ChatGPT-subscription OAuth (account-wide; chat only).
  const [oauthStatus, setOauthStatus] = useState<{ connected: boolean; accountId: string | null } | null>(null);
  const [oauthModels, setOauthModels] = useState<string[]>([]);
  const [oauthBusy, setOauthBusy] = useState(false);

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
    setChatCred(defaultCred(p));
    setChatModelId(p === "anthropic" ? "claude-opus-4-7" : p === "openai" ? "gpt-4o" : "local-model");
  };

  const pickEmbProvider = (p: ProviderId) => {
    setEmbProvider(p);
    setEmbTest({ status: "idle" });
    setEmbModels([]);
    // Reuse the chat credential when both slots share a (non-OAuth) provider.
    setEmbCred(p === chatProvider && !useChatOAuth ? chatCred : defaultCred(p));
    setEmbModelId(p === "openai" ? "text-embedding-3-small" : "local-embedding-model");
  };

  // --- OpenAI OAuth (ChatGPT subscription) -------------------------------
  const refreshOAuth = () =>
    fetch("/api/auth/openai/status")
      .then((r) => r.json())
      .then(setOauthStatus)
      .catch(() => {});

  useEffect(() => {
    void refreshOAuth();
    void loadSettings();
  }, [loadSettings]);

  // Once connected, discover the Codex model catalogue for this subscription.
  useEffect(() => {
    if (!oauthStatus?.connected) {
      setOauthModels([]);
      return;
    }
    void fetch("/api/provider-models", {
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
      const res = await fetch("/api/auth/openai/login", { method: "POST" });
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
        const s = await fetch("/api/auth/openai/status")
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
    await fetch("/api/auth/openai/signout", { method: "POST" });
    setOauthModels([]);
    void refreshOAuth();
  };

  const oauthBundle: OAuthBundle = {
    authMethod: openAiAuth,
    setAuthMethod: setOpenAiAuth,
    status: oauthStatus,
    models: oauthModels,
    busy: oauthBusy,
    signIn: signInOpenAi,
    signOut: signOutOpenAi,
  };

  const finish = async () => {
    setSaving(true);
    try {
      const chatRef = { provider: chatProvider, modelId: chatModelId.trim() };
      const embeddingRef = { provider: embProvider, modelId: embModelId.trim() };

      if (useChatOAuth) {
        // Tokens are stored server-side by the OAuth flow; flip the OpenAI
        // provider over to OAuth account-wide so model resolution uses them.
        const current = useGlobalSettingsStore.getState().settings;
        await saveSettings({
          ...current,
          providers: {
            ...current.providers,
            openai: { ...current.providers.openai, authMethod: "oauth" },
          },
        });
      }

      // Collect credentials for both slots; a shared provider key is written once.
      const secrets: Record<string, string> = {};
      if (!useChatOAuth && chatCred.trim()) secrets[CRED[chatProvider].key] = chatCred.trim();
      if (embCred.trim()) secrets[CRED[embProvider].key] = embCred.trim();
      if (Object.keys(secrets).length > 0) {
        await fetch("/api/agents/coo/credentials", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(secrets),
        });
      }

      const allowedModels = Array.from(new Set([chatProvider, embProvider])).map((p) => ({
        provider: p,
        modelId: "*",
      }));

      await fetch("/api/agents/coo", {
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
              provider={chatProvider}
              onProvider={pickChatProvider}
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
              Embeddings index the COO's memory for semantic search. This can be a different
              provider than the chat model — a local text-embedding model works well.
            </p>
            <ProviderFields
              kind="embedding"
              provider={embProvider}
              onProvider={pickEmbProvider}
              cred={embCred}
              onCred={setEmbCred}
              modelId={embModelId}
              onModelId={setEmbModelId}
              test={embTest}
              onTest={setEmbTest}
              models={embModels}
              onModels={setEmbModels}
              modelLabel="Embedding model"
              modelHint="Anthropic has no embedding endpoint — pick OpenAI or a local text-embedding model."
            />
            <Buttons>
              <button style={ghost} onClick={() => setStep(1)}>
                Back
              </button>
              <button style={primary} onClick={() => setStep(3)} disabled={!embModelId.trim()}>
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

/**
 * Provider + credential + model selection for one model slot (chat or
 * embedding). When `oauth` is supplied (chat only) an OpenAI ChatGPT-
 * subscription option is offered alongside the API key.
 */
function ProviderFields({
  kind,
  provider,
  onProvider,
  cred,
  onCred,
  modelId,
  onModelId,
  test,
  onTest,
  models,
  onModels,
  modelLabel,
  modelHint,
  oauth,
}: {
  kind: "chat" | "embedding";
  provider: ProviderId;
  onProvider: (p: ProviderId) => void;
  cred: string;
  onCred: (v: string) => void;
  modelId: string;
  onModelId: (v: string) => void;
  test: TestState;
  onTest: (t: TestState) => void;
  models: string[];
  onModels: (m: string[]) => void;
  modelLabel: string;
  modelHint?: string;
  oauth?: OAuthBundle;
}) {
  const credMeta = CRED[provider];
  const isLocal = isLocalProvider(provider);
  const useOAuth = !!oauth && provider === "openai" && oauth.authMethod === "oauth";

  /** Fetch the model list a local server is currently serving. */
  const loadModels = async () => {
    onTest({ status: "testing" });
    try {
      const res = await fetch("/api/provider-models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          secrets: cred.trim() ? { [credMeta.key]: cred.trim() } : {},
        }),
      });
      const data = (await res.json()) as { ok: boolean; models?: string[]; error?: string };
      if (data.ok && data.models && data.models.length > 0) {
        const list = data.models;
        onModels(list);
        // Bias the auto-pick: an embedding-looking model for the embedding slot.
        const guess =
          kind === "embedding"
            ? (list.find((m) => /embed/i.test(m)) ?? list[0])
            : (list.find((m) => !/embed/i.test(m)) ?? list[0]);
        if (!list.includes(modelId)) onModelId(guess);
        onTest({ status: "ok", message: `Found ${list.length} model(s).` });
      } else {
        onModels([]);
        onTest({ status: "fail", message: data.error ?? "No models found at that address." });
      }
    } catch (err) {
      onModels([]);
      onTest({ status: "fail", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const runTest = async () => {
    onTest({ status: "testing" });
    try {
      const res = await fetch("/api/test-model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          modelId: modelId.trim(),
          secrets: cred.trim() ? { [credMeta.key]: cred.trim() } : {},
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      onTest(
        data.ok
          ? { status: "ok", message: "Connection succeeded." }
          : { status: "fail", message: data.error ?? "Connection failed." }
      );
    } catch (err) {
      onTest({ status: "fail", message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <>
      <Field label="Provider">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {PROVIDERS.map((pr) => (
            <button
              key={pr}
              onClick={() => onProvider(pr)}
              style={{
                ...chip,
                background: provider === pr ? "rgb(var(--accent))" : "transparent",
                color: provider === pr ? "white" : "rgb(var(--fg))",
              }}
            >
              {pr}
            </button>
          ))}
        </div>
      </Field>

      {oauth && provider === "openai" && (
        <Field label="Authentication">
          <div style={{ display: "flex", gap: 6 }}>
            {(["api-key", "oauth"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  oauth.setAuthMethod(m);
                  onTest({ status: "idle" });
                }}
                style={{
                  ...chip,
                  background: oauth.authMethod === m ? "rgb(var(--accent))" : "transparent",
                  color: oauth.authMethod === m ? "white" : "rgb(var(--fg))",
                }}
              >
                {m === "api-key" ? "API key" : "ChatGPT subscription"}
              </button>
            ))}
          </div>
        </Field>
      )}

      {useOAuth && oauth ? (
        <div style={oauthCard}>
          <strong style={{ fontSize: 12 }}>ChatGPT subscription</strong>
          {oauth.status?.connected ? (
            <>
              <div style={{ fontSize: 12, color: "#4ade80" }}>
                ✓ Connected{oauth.status.accountId ? ` · account ${oauth.status.accountId}` : ""}
              </div>
              <button onClick={oauth.signOut} style={{ ...ghost, alignSelf: "flex-start" }}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, color: "rgb(var(--muted))", lineHeight: 1.5 }}>
                Use a ChatGPT Plus/Pro subscription instead of an API key. Sign-in is account-wide —
                it applies to every agent whose chat provider is OpenAI. Unofficial route; it may
                stop working if OpenAI changes it.
              </div>
              <button
                onClick={oauth.signIn}
                disabled={oauth.busy}
                style={{ ...primary, alignSelf: "flex-start" }}
              >
                {oauth.busy ? "Waiting for sign-in…" : "Sign in with ChatGPT"}
              </button>
              {test.status === "fail" && (
                <span style={{ fontSize: 12, color: "#f87171" }}>✗ {test.message}</span>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <Field label={credMeta.label}>
            <input
              type={credMeta.secret ? "password" : "text"}
              value={cred}
              onChange={(e) => {
                onCred(e.target.value);
                onTest({ status: "idle" });
                onModels([]);
              }}
              placeholder={credMeta.placeholder}
              style={input}
            />
          </Field>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              style={ghost}
              onClick={isLocal ? loadModels : runTest}
              disabled={test.status === "testing"}
            >
              {test.status === "testing"
                ? isLocal
                  ? "Loading…"
                  : "Testing…"
                : isLocal
                  ? "Get models"
                  : "Test connection"}
            </button>
            {test.status === "ok" && <span style={{ fontSize: 12, color: "#4ade80" }}>✓ {test.message}</span>}
            {test.status === "fail" && (
              <span style={{ fontSize: 12, color: "#f87171" }}>✗ {test.message}</span>
            )}
          </div>
        </>
      )}

      <ModelField
        label={modelLabel}
        hint={modelHint}
        value={modelId}
        onChange={onModelId}
        models={useOAuth && oauth ? oauth.models : isLocal ? models : []}
      />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
      <span style={{ color: "rgb(var(--muted))" }}>{label}</span>
      {children}
    </label>
  );
}

/**
 * A model-id input. When a fetched model list is available (local providers
 * after "Get models", or the Codex catalogue) it renders a dropdown;
 * otherwise a free-text input.
 */
function ModelField({
  label,
  hint,
  value,
  onChange,
  models,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  models: string[];
}) {
  return (
    <Field label={label}>
      {models.length > 0 ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} style={input}>
          {/* The current value may not be in the list yet (e.g. a custom id). */}
          {!models.includes(value) && <option value={value}>{value}</option>}
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} style={input} />
      )}
      {hint && <span style={{ color: "rgb(var(--muted))", fontSize: 11 }}>{hint}</span>}
    </Field>
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

const chip: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "4px 12px",
  fontSize: 12,
  cursor: "pointer",
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

const oauthCard: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
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
