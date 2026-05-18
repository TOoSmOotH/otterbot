import { useEffect, useState } from "react";
import type { AgentPeerAccess, AgentProfile, AgentRole, ProviderId } from "@otterbot/shared";
import { useAgentsStore } from "../../stores/agents-store";
import { useGlobalSettingsStore } from "../../stores/global-settings-store";
import { useProvidersStore } from "../../stores/providers-store";
import { ProviderOptions } from "../ProviderOptions";

interface FormState {
  displayName: string;
  role: AgentRole;
  persona: string;
  chatProvider: ProviderId;
  chatModel: string;
  embeddingProvider: ProviderId;
  embeddingModel: string;
  transport: "local" | "discord";
  email: string;
  canSpawnSubagents: boolean;
  allowedPeers: AgentPeerAccess[];
}

const BLANK: FormState = {
  displayName: "",
  role: "agent",
  persona: "",
  chatProvider: "lmstudio",
  chatModel: "local-model",
  embeddingProvider: "lmstudio",
  embeddingModel: "local-model",
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
  const providers = useProvidersStore((s) => s.providers);
  const loadProviders = useProvidersStore((s) => s.load);
  const chatProviders = providers.filter((p) => p.supportsChat);
  const embeddingProviders = providers.filter((p) => p.supportsEmbeddings);

  const [form, setForm] = useState<FormState>(BLANK);
  const [saving, setSaving] = useState(false);
  const [creds, setCreds] = useState("");
  const [credsStatus, setCredsStatus] = useState("");
  const isEdit = agentId !== null;

  useEffect(() => {
    if (!agentId) {
      setForm({
        ...BLANK,
        chatProvider: globalSettings.defaultChatModel.provider,
        chatModel: globalSettings.defaultChatModel.modelId,
        embeddingProvider: globalSettings.defaultEmbeddingModel.provider,
        embeddingModel: globalSettings.defaultEmbeddingModel.modelId,
      });
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
          transport: p.transport,
          email: p.email ?? "",
          canSpawnSubagents: p.canSpawnSubagents,
          allowedPeers: p.allowedPeers ?? [],
        });
      });
  }, [agentId, globalSettings]);

  useEffect(() => void loadGlobalSettings(), [loadGlobalSettings]);
  useEffect(() => void loadProviders(), [loadProviders]);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const setPeerMessage = (peerId: string, on: boolean) =>
    setForm((f) => ({
      ...f,
      allowedPeers: on
        ? f.allowedPeers.some((p) => p.agentId === peerId)
          ? f.allowedPeers
          : [...f.allowedPeers, { agentId: peerId, shareMemory: false }]
        : f.allowedPeers.filter((p) => p.agentId !== peerId),
    }));

  const setPeerMemory = (peerId: string, on: boolean) =>
    setForm((f) => ({
      ...f,
      allowedPeers: f.allowedPeers.map((p) =>
        p.agentId === peerId ? { ...p, shareMemory: on } : p
      ),
    }));

  const peerAgents = agents.filter((a) => a.id !== agentId);

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
      canSpawnSubagents: form.canSpawnSubagents,
      allowedPeers: form.allowedPeers,
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
              onChange={(e) => patch({ chatProvider: e.target.value })}
              style={inputStyle}
            >
              <ProviderOptions list={chatProviders} current={form.chatProvider} />
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
              onChange={(e) => patch({ embeddingProvider: e.target.value })}
              style={inputStyle}
            >
              <ProviderOptions list={embeddingProviders} current={form.embeddingProvider} />
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
          Connect this agent to Slack or Discord in the Agent Studio → Channels tab.
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
          {agentId === "coo" ? (
            <p style={hintStyle}>The COO can message and read the memory of every agent.</p>
          ) : peerAgents.length === 0 ? (
            <p style={hintStyle}>No other agents to grant access to yet.</p>
          ) : (
            <>
              <p style={hintStyle}>
                Choose which agents this agent may message. Reading a peer's memory
                (read-only) requires message permission.
              </p>
              {peerAgents.map((a) => {
                const peer = form.allowedPeers.find((p) => p.agentId === a.id);
                const canMessage = peer !== undefined;
                return (
                  <div
                    key={a.id}
                    style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}
                  >
                    <span style={{ flex: 1 }}>{a.displayName}</span>
                    <label style={checkboxRow}>
                      <input
                        type="checkbox"
                        checked={canMessage}
                        onChange={(e) => setPeerMessage(a.id, e.target.checked)}
                      />
                      Can message
                    </label>
                    <label style={{ ...checkboxRow, opacity: canMessage ? 1 : 0.5 }}>
                      <input
                        type="checkbox"
                        checked={peer?.shareMemory ?? false}
                        disabled={!canMessage}
                        onChange={(e) => setPeerMemory(a.id, e.target.checked)}
                      />
                      Can read memory
                    </label>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {isEdit && (
          <Field label="Credentials (.env — KEY=VALUE per line; replaces all secrets)">
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

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 10 }}>{children}</div>;
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
