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
  const [cred, setCred] = useState("http://localhost:1234/v1");
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [cooName, setCooName] = useState("Otterbot COO");
  const [persona, setPersona] = useState(
    "You are the COO — a friendly, decisive coordinator. You answer the user directly and delegate specialised work to other agents."
  );
  const [saving, setSaving] = useState(false);

  const credMeta = CRED[provider];

  const pickProvider = (p: ProviderId) => {
    setProvider(p);
    setTest({ status: "idle" });
    setCred(p === "lmstudio" ? "http://localhost:1234/v1" : p === "ollama" ? "http://localhost:11434/v1" : "");
    setModelId(p === "anthropic" ? "claude-opus-4-7" : p === "openai" ? "gpt-4o" : "local-model");
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
      const ref = { provider, modelId: modelId.trim() };
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
          model: { chat: ref, embedding: ref },
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
            <p style={p}>You can create more agents and fine-tune everything later in the Studio.</p>
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
            <Field label="Model id">
              <input value={modelId} onChange={(e) => setModelId(e.target.value)} style={input} />
            </Field>
            <Field label={credMeta.label}>
              <input
                type={credMeta.secret ? "password" : "text"}
                value={cred}
                onChange={(e) => {
                  setCred(e.target.value);
                  setTest({ status: "idle" });
                }}
                placeholder={credMeta.placeholder}
                style={input}
              />
            </Field>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button style={ghost} onClick={runTest} disabled={test.status === "testing"}>
                {test.status === "testing" ? "Testing…" : "Test connection"}
              </button>
              {test.status === "ok" && <span style={{ fontSize: 12, color: "#4ade80" }}>✓ {test.message}</span>}
              {test.status === "fail" && (
                <span style={{ fontSize: 12, color: "#f87171" }}>✗ {test.message}</span>
              )}
            </div>
            <Buttons>
              <button style={ghost} onClick={() => setStep(0)}>
                Back
              </button>
              <button style={primary} onClick={() => setStep(2)} disabled={!modelId.trim()}>
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
