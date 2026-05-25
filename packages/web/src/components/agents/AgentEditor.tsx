import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import type { AgentPeerAccess, AgentProfile, AgentRole } from "@otterbot/shared";
import { useAgentsStore } from "../../stores/agents-store";
import { useGlobalSettingsStore } from "../../stores/global-settings-store";
import { ModelSelect } from "./ModelSelect";
import { PeerAccessEditor } from "./PeerAccessEditor";

interface FormState {
  displayName: string;
  role: AgentRole;
  persona: string;
  transport: "local" | "discord";
  email: string;
  canSpawnSubagents: boolean;
  allowedPeers: AgentPeerAccess[];
}

const BLANK: FormState = {
  displayName: "",
  role: "agent",
  persona: "",
  transport: "local",
  email: "",
  canSpawnSubagents: true,
  allowedPeers: [],
};

/** Modal form for creating a new agent or editing an existing profile. */
export function AgentEditor({ agentId, onClose }: { agentId: string | null; onClose: () => void }) {
  const create = useAgentsStore((s) => s.create);
  const update = useAgentsStore((s) => s.update);
  const remove = useAgentsStore((s) => s.remove);
  const agents = useAgentsStore((s) => s.agents);
  const globalSettings = useGlobalSettingsStore((s) => s.settings);
  const loadGlobalSettings = useGlobalSettingsStore((s) => s.load);
  const models = globalSettings.models;

  const [form, setForm] = useState<FormState>(BLANK);
  const [saving, setSaving] = useState(false);
  const [creds, setCreds] = useState("");
  const [credsStatus, setCredsStatus] = useState("");
  const isEdit = agentId !== null;

  // Model slots — each is the id of a ConfiguredModel.
  const [chatModelId, setChatModelId] = useState("");
  const [embInherit, setEmbInherit] = useState(true);
  const [embModelId, setEmbModelId] = useState("");
  /** The COO's embedding model id — offered as an "inherit" option. */
  const [cooEmbeddingId, setCooEmbeddingId] = useState("");

  /** A COO can't inherit from itself. */
  const canInherit = form.role !== "coo" && agentId !== "coo";
  const inheritEmbedding = embInherit && canInherit;

  useEffect(() => void loadGlobalSettings(), [loadGlobalSettings]);

  // The COO's embedding model — offered as an "inherit" option for new agents.
  useEffect(() => {
    void apiFetch("/api/agents/coo")
      .then((r) => (r.ok ? r.json() : null))
      .then((p: AgentProfile | null) => {
        if (p) setCooEmbeddingId(p.model.embedding);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!agentId) {
      setForm(BLANK);
      setChatModelId(globalSettings.defaultChatModelId);
      setEmbInherit(true);
      setEmbModelId(globalSettings.defaultEmbeddingModelId);
      return;
    }
    void apiFetch(`/api/agents/${agentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p: AgentProfile | null) => {
        if (!p) return;
        setForm({
          displayName: p.displayName,
          role: p.role,
          persona: p.persona,
          transport: p.transport,
          email: p.email ?? "",
          canSpawnSubagents: p.canSpawnSubagents,
          allowedPeers: p.allowedPeers ?? [],
        });
        setChatModelId(p.model.chat);
        // An existing agent shows its own configured embedding model.
        setEmbInherit(false);
        setEmbModelId(p.model.embedding);
      });
  }, [agentId, globalSettings]);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const peerAgents = agents.filter((a) => a.id !== agentId);
  const cooEmbeddingLabel =
    models.find((m) => m.id === cooEmbeddingId)?.label ?? "the COO's embedding model";

  const onSave = async () => {
    if (!form.displayName.trim()) return;
    setSaving(true);
    try {
      const payload: Partial<AgentProfile> & { displayName: string } = {
        displayName: form.displayName.trim(),
        role: form.role,
        persona: form.persona,
        model: {
          chat: chatModelId,
          embedding: inheritEmbedding ? cooEmbeddingId : embModelId,
        },
        transport: form.transport,
        email: form.email.trim() || null,
        canSpawnSubagents: form.canSpawnSubagents,
        allowedPeers: form.allowedPeers,
      };

      if (isEdit && agentId) {
        await update(agentId, payload);
      } else {
        await create(payload);
      }
    } finally {
      setSaving(false);
    }
    onClose();
  };

  const onSaveCreds = async () => {
    if (!agentId) return;
    const record: Record<string, string> = {};
    for (const line of creds.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) record[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    const res = await apiFetch(`/api/agents/${agentId}/credentials`, {
      method: "PATCH",
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

        <div style={sectionBox}>
          <strong style={{ fontSize: 12 }}>Chat model</strong>
          <ModelSelect models={models} kind="chat" value={chatModelId} onChange={setChatModelId} />
        </div>

        <div style={sectionBox}>
          <strong style={{ fontSize: 12 }}>Embedding model</strong>
          {canInherit && (
            <label style={checkboxRow}>
              <input
                type="checkbox"
                checked={embInherit}
                onChange={(e) => setEmbInherit(e.target.checked)}
              />
              Inherit the COO's embedding model
            </label>
          )}
          {inheritEmbedding ? (
            <p style={hintStyle}>Uses {cooEmbeddingLabel}. You can change it later in the Agent Studio.</p>
          ) : (
            <ModelSelect
              models={models}
              kind="embedding"
              value={embModelId}
              onChange={setEmbModelId}
              allowNone
            />
          )}
        </div>

        <Field label="Agent-to-agent transport">
          <select
            value={form.transport}
            onChange={(e) => patch({ transport: e.target.value as "local" | "discord" })}
            style={inputStyle}
          >
            <option value="local">local</option>
            <option value="discord">discord</option>
          </select>
        </Field>
        <p style={hintStyle}>Set this agent's avatar in the Agent Studio → Identity tab.</p>

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

        <p style={hintStyle}>
          Connect this agent to Slack, Discord, or Matrix in the Agent Studio → Channels tab.
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            border: "1px solid rgb(var(--border))",
            borderRadius: 8,
            padding: 10,
          }}
        >
          <span style={{ fontSize: 12, color: "rgb(var(--muted))" }}>Peer access</span>
          <PeerAccessEditor
            agentName={form.displayName}
            peers={form.allowedPeers}
            peerAgents={peerAgents}
            isCoo={agentId === "coo"}
            onChange={(next) => patch({ allowedPeers: next })}
          />
        </div>

        {isEdit && (
          <Field label="Credentials (.env — KEY=VALUE per line; merges into existing secrets)">
            <textarea
              value={creds}
              onChange={(e) => setCreds(e.target.value)}
              rows={4}
              placeholder={
                "ANTHROPIC_API_KEY=...\nGITHUB_TOKEN=...\nSLACK_BOT_TOKEN=...\nSLACK_APP_TOKEN=...\nDISCORD_BOT_TOKEN=..."
              }
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

const checkboxRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
};

const hintStyle: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 12,
  color: "rgb(var(--muted))",
};

const sectionBox: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: 10,
};

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
