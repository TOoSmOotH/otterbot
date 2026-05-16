import { useEffect, useState } from "react";
import type { AgentProfile, AgentRole, ProviderId } from "@otterbot/shared";
import { useAgentsStore } from "../../stores/agents-store";
import { useModelPacksStore } from "../../stores/model-packs-store";

const PROVIDERS: ProviderId[] = ["anthropic", "openai", "lmstudio", "ollama"];

interface FormState {
  displayName: string;
  role: AgentRole;
  persona: string;
  chatProvider: ProviderId;
  chatModel: string;
  embeddingProvider: ProviderId;
  embeddingModel: string;
  modelPack: string;
  transport: "local" | "discord";
  email: string;
  canSpawnSubagents: boolean;
}

const BLANK: FormState = {
  displayName: "",
  role: "agent",
  persona: "",
  chatProvider: "lmstudio",
  chatModel: "local-model",
  embeddingProvider: "lmstudio",
  embeddingModel: "local-model",
  modelPack: "prototype-pete",
  transport: "local",
  email: "",
  canSpawnSubagents: true,
};

/** Modal form for creating a new agent or editing an existing profile. */
export function AgentEditor({ agentId, onClose }: { agentId: string | null; onClose: () => void }) {
  const create = useAgentsStore((s) => s.create);
  const update = useAgentsStore((s) => s.update);
  const remove = useAgentsStore((s) => s.remove);
  const packs = useModelPacksStore((s) => s.packs);

  const [form, setForm] = useState<FormState>(BLANK);
  const [saving, setSaving] = useState(false);
  const [creds, setCreds] = useState("");
  const [credsStatus, setCredsStatus] = useState("");
  const isEdit = agentId !== null;

  useEffect(() => {
    if (!agentId) {
      setForm(BLANK);
      return;
    }
    void fetch(`/api/agents/${agentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p: AgentProfile | null) => {
        if (!p) return;
        setForm({
          displayName: p.displayName,
          role: p.role,
          persona: p.persona,
          chatProvider: p.model.chat.provider,
          chatModel: p.model.chat.modelId,
          embeddingProvider: p.model.embedding.provider,
          embeddingModel: p.model.embedding.modelId,
          modelPack: p.artwork.modelPack,
          transport: p.transport,
          email: p.email ?? "",
          canSpawnSubagents: p.canSpawnSubagents,
        });
      });
  }, [agentId]);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const onSave = async () => {
    if (!form.displayName.trim()) return;
    setSaving(true);
    const payload: Partial<AgentProfile> & { displayName: string } = {
      displayName: form.displayName.trim(),
      role: form.role,
      persona: form.persona,
      model: {
        chat: { provider: form.chatProvider, modelId: form.chatModel.trim() },
        embedding: { provider: form.embeddingProvider, modelId: form.embeddingModel.trim() },
      },
      allowedModels: [
        { provider: form.chatProvider, modelId: "*" },
        { provider: form.embeddingProvider, modelId: "*" },
      ],
      transport: form.transport,
      email: form.email.trim() || null,
      artwork: { modelPack: form.modelPack },
      canSpawnSubagents: form.canSpawnSubagents,
    };
    if (isEdit && agentId) {
      await update(agentId, payload);
    } else {
      await create(payload);
    }
    setSaving(false);
    onClose();
  };

  const onSaveCreds = async () => {
    if (!agentId) return;
    const record: Record<string, string> = {};
    for (const line of creds.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) record[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    const res = await fetch(`/api/agents/${agentId}/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
    });
    setCredsStatus(res.ok ? `Saved ${Object.keys(record).length} secret(s).` : "Failed to save.");
  };

  const onDelete = async () => {
    if (!agentId || agentId === "coo") return;
    if (!confirm(`Delete agent "${form.displayName}"? This removes its memory and skills.`)) return;
    await remove(agentId);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid="agent-editor"
        style={{
          width: 460,
          maxHeight: "88vh",
          overflowY: "auto",
          background: "rgb(var(--bg))",
          border: "1px solid rgb(var(--border))",
          borderRadius: 12,
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 15 }}>{isEdit ? "Edit agent" : "New agent"}</h2>

        <Field label="Name">
          <input
            data-testid="agent-name"
            value={form.displayName}
            onChange={(e) => patch({ displayName: e.target.value })}
            style={inputStyle}
          />
        </Field>

        <Field label="Role">
          <select
            value={form.role}
            onChange={(e) => patch({ role: e.target.value as AgentRole })}
            disabled={agentId === "coo"}
            style={inputStyle}
          >
            <option value="agent">Agent</option>
            <option value="coo">COO</option>
          </select>
        </Field>

        <Field label="Persona (SOUL.md)">
          <textarea
            value={form.persona}
            onChange={(e) => patch({ persona: e.target.value })}
            rows={5}
            placeholder="Describe this agent's personality, expertise, and how it should behave…"
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          />
        </Field>

        <Row>
          <Field label="Chat provider">
            <select
              value={form.chatProvider}
              onChange={(e) => patch({ chatProvider: e.target.value as ProviderId })}
              style={inputStyle}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Chat model">
            <input
              value={form.chatModel}
              onChange={(e) => patch({ chatModel: e.target.value })}
              style={inputStyle}
            />
          </Field>
        </Row>

        <Row>
          <Field label="Embedding provider">
            <select
              value={form.embeddingProvider}
              onChange={(e) => patch({ embeddingProvider: e.target.value as ProviderId })}
              style={inputStyle}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Embedding model">
            <input
              value={form.embeddingModel}
              onChange={(e) => patch({ embeddingModel: e.target.value })}
              style={inputStyle}
            />
          </Field>
        </Row>

        <Row>
          <Field label="Avatar">
            <select
              value={form.modelPack}
              onChange={(e) => patch({ modelPack: e.target.value })}
              style={inputStyle}
            >
              {packs.length === 0 && <option value={form.modelPack}>{form.modelPack}</option>}
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Transport">
            <select
              value={form.transport}
              onChange={(e) => patch({ transport: e.target.value as "local" | "discord" })}
              style={inputStyle}
            >
              <option value="local">local</option>
              <option value="discord">discord</option>
            </select>
          </Field>
        </Row>

        <Field label="Email address">
          <input
            value={form.email}
            onChange={(e) => patch({ email: e.target.value })}
            placeholder="agent@otter.local"
            style={inputStyle}
          />
        </Field>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={form.canSpawnSubagents}
            onChange={(e) => patch({ canSpawnSubagents: e.target.checked })}
          />
          Can spawn subagents
        </label>

        {isEdit && (
          <Field label="Credentials (.env — KEY=VALUE per line; replaces all secrets)">
            <textarea
              value={creds}
              onChange={(e) => setCreds(e.target.value)}
              rows={4}
              placeholder={"ANTHROPIC_API_KEY=...\nGITHUB_TOKEN=...\nSMTP_HOST=...\nLMSTUDIO_BASE_URL=..."}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <button type="button" onClick={onSaveCreds} style={ghostBtn}>
                Save credentials
              </button>
              {credsStatus && (
                <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>{credsStatus}</span>
              )}
            </div>
          </Field>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button data-testid="agent-save" onClick={onSave} disabled={saving} style={primaryBtn}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create agent"}
          </button>
          <button onClick={onClose} style={ghostBtn}>
            Cancel
          </button>
          {isEdit && agentId !== "coo" && (
            <button onClick={onDelete} style={{ ...ghostBtn, color: "#f87171", marginLeft: "auto" }}>
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, flex: 1 }}>
      <span style={{ color: "rgb(var(--muted))" }}>{label}</span>
      {children}
    </label>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 10 }}>{children}</div>;
}

const inputStyle: React.CSSProperties = {
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
  width: "100%",
};

const primaryBtn: React.CSSProperties = {
  background: "rgb(var(--accent))",
  color: "white",
  border: "none",
  padding: "7px 14px",
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const ghostBtn: React.CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  padding: "7px 14px",
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 13,
};
