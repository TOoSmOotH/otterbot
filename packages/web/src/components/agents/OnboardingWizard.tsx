import { useState } from "react";
import type { ProviderId } from "@otterbot/shared";
import { useSetupStore } from "../../stores/setup-store";
import { useAgentsStore } from "../../stores/agents-store";

/** Per-provider credential field metadata. */
const CRED: Record<ProviderId, { label: string; key: string; placeholder: string; secret: boolean }> = {
  anthropic: { label: "Anthropic API key", key: "ANTHROPIC_API_KEY", placeholder: "sk-ant-…", secret: true },
  openai: { label: "OpenAI API key", key: "OPENAI_API_KEY", placeholder: "sk-…", secret: true },
  lmstudio: { label: "LM Studio base URL", key: "LMSTUDIO_BASE_URL", placeholder: "http://localhost:1234/v1", secret: false },
  ollama: { label: "Ollama base URL", key: "OLLAMA_BASE_URL", placeholder: "http://localhost:11434/v1", secret: false },
};

const PROVIDERS: ProviderId[] = ["anthropic", "openai", "lmstudio", "ollama"];

type TestState = { status: "idle" | "testing" | "ok" | "fail"; message?: string };

/**
 * First-run wizard that walks the user through configuring their first agent
 * (the COO): pick a model, supply a credential, test it, set a personality.
 */
export function OnboardingWizard() {
  const markComplete = useSetupStore((s) => s.markComplete);
  const reloadAgents = useAgentsStore((s) => s.load);

  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState<ProviderId>("lmstudio");
  const [modelId, setModelId] = useState("local-model");
  const [embeddingModelId, setEmbeddingModelId] = useState("local-model");
  const [cred, setCred] = useState("http://localhost:1234/v1");
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [models, setModels] = useState<string[]>([]);
  const [cooName, setCooName] = useState("Otterbot COO");
  const [persona, setPersona] = useState(
    "You are the COO — a friendly, decisive coordinator. You answer the user directly and delegate specialised work to other agents."
  );
  const [saving, setSaving] = useState(false);

  const credMeta = CRED[provider];
  /** Local providers (LM Studio, Ollama) expose a `/models` list we can fetch. */
  const isLocal = provider === "lmstudio" || provider === "ollama";

  const pickProvider = (p: ProviderId) => {
    setProvider(p);
    setTest({ status: "idle" });
    setModels([]);
    setCred(p === "lmstudio" ? "http://localhost:1234/v1" : p === "ollama" ? "http://localhost:11434/v1" : "");
    setModelId(p === "anthropic" ? "claude-opus-4-7" : p === "openai" ? "gpt-4o" : "local-model");
    setEmbeddingModelId(p === "openai" ? "text-embedding-3-small" : "local-embedding-model");
  };

  /** Fetch the model list a local server is currently serving. */
  const loadModels = async () => {
    setTest({ status: "testing" });
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
        setModels(list);
        // Auto-pick: a non-embedding model for chat, an embedding-looking one for embeddings.
        const chatGuess = list.find((m) => !/embed/i.test(m)) ?? list[0];
        const embedGuess = list.find((m) => /embed/i.test(m)) ?? list[0];
        setModelId((cur) => (list.includes(cur) ? cur : chatGuess));
        setEmbeddingModelId((cur) => (list.includes(cur) ? cur : embedGuess));
        setTest({ status: "ok", message: `Found ${list.length} model(s).` });
      } else {
        setModels([]);
        setTest({ status: "fail", message: data.error ?? "No models found at that address." });
      }
    } catch (err) {
      setModels([]);
      setTest({ status: "fail", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const runTest = async () => {
    setTest({ status: "testing" });
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
      setTest(
        data.ok
          ? { status: "ok", message: "Connection succeeded." }
          : { status: "fail", message: data.error ?? "Connection failed." }
      );
    } catch (err) {
      setTest({ status: "fail", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const finish = async () => {
    setSaving(true);
    try {
      const chatRef = { provider, modelId: modelId.trim() };
      const embeddingRef = { provider, modelId: embeddingModelId.trim() };
      if (cred.trim()) {
        await fetch("/api/agents/coo/credentials", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ [credMeta.key]: cred.trim() }),
        });
      }
      await fetch("/api/agents/coo", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: cooName.trim() || "Otterbot COO",
          persona,
          model: { chat: chatRef, embedding: embeddingRef },
          allowedModels: [{ provider, modelId: "*" }],
        }),
      });
      await markComplete();
      await reloadAgents();
    } finally {
      setSaving(false);
    }
  };

  const steps = ["Welcome", "Model", "Personality"];

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
            <h2 style={h2}>Choose a model</h2>
            <p style={p}>Pick where the COO's intelligence comes from. You can change this anytime.</p>
            <Field label="Provider">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {PROVIDERS.map((pr) => (
                  <button
                    key={pr}
                    onClick={() => pickProvider(pr)}
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
            <Field label={credMeta.label}>
              <input
                type={credMeta.secret ? "password" : "text"}
                value={cred}
                onChange={(e) => {
                  setCred(e.target.value);
                  setTest({ status: "idle" });
                  setModels([]);
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
            <ModelField
              label="Chat model"
              value={modelId}
              onChange={setModelId}
              models={isLocal ? models : []}
            />
            <ModelField
              label="Embedding model"
              hint="Used to index the COO's memory. On a local server this is usually a separate text-embedding model."
              value={embeddingModelId}
              onChange={setEmbeddingModelId}
              models={isLocal ? models : []}
            />
            <Buttons>
              <button style={ghost} onClick={() => setStep(0)}>
                Back
              </button>
              <button
                style={primary}
                onClick={() => setStep(2)}
                disabled={!modelId.trim() || !embeddingModelId.trim()}
              >
                Next
              </button>
            </Buttons>
          </>
        )}

        {step === 2 && (
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
              <button style={ghost} onClick={() => setStep(1)}>
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
 * after "Get models") it renders a dropdown; otherwise a free-text input.
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

const ghost: React.CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  padding: "8px 14px",
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 13,
};
