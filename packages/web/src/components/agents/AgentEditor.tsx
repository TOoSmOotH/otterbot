import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import type {
  AgentPeerAccess,
  AgentProfile,
  AgentRole,
  ModelRef,
  ProviderAccount,
  ProviderId,
} from "@otterbot/shared";
import { useAgentsStore } from "../../stores/agents-store";
import { useGlobalSettingsStore } from "../../stores/global-settings-store";
import {
  useProvidersStore,
  providerDefaultCred,
  globalProviderPatch,
} from "../../stores/providers-store";
import { ProviderFields, isLocalProvider, type TestState } from "./ProviderFields";
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

/** Default chat model for a freshly-picked provider. */
const defaultChatModel = (p: ProviderId) =>
  p === "anthropic" ? "claude-opus-4-7" : p === "openai" ? "gpt-4o" : "local-model";
const defaultEmbedModel = (p: ProviderId) =>
  p === "builtin"
    ? "all-MiniLM-L6-v2"
    : p === "openai"
      ? "text-embedding-3-small"
      : "local-embedding-model";

/** Modal form for creating a new agent or editing an existing profile. */
export function AgentEditor({ agentId, onClose }: { agentId: string | null; onClose: () => void }) {
  const create = useAgentsStore((s) => s.create);
  const update = useAgentsStore((s) => s.update);
  const remove = useAgentsStore((s) => s.remove);
  const agents = useAgentsStore((s) => s.agents);
  const globalSettings = useGlobalSettingsStore((s) => s.settings);
  const loadGlobalSettings = useGlobalSettingsStore((s) => s.load);
  const saveSettings = useGlobalSettingsStore((s) => s.save);
  const providers = useProvidersStore((s) => s.providers);
  const loadProviders = useProvidersStore((s) => s.load);
  const chatProviders = providers.filter((p) => p.supportsChat);
  const embeddingProviders = providers.filter((p) => p.supportsEmbeddings);
  /**
   * The credential field's initial value for a provider: a local server's
   * already-saved base URL when there is one, else the provider default.
   */
  const credSeedFor = (id: ProviderId) => {
    const info = providers.find((p) => p.id === id);
    if (!info) return "";
    const accounts = globalSettings.providers[id] ?? [];
    if (isLocalProvider(info) && accounts[0]?.baseUrl) return accounts[0].baseUrl;
    return providerDefaultCred(info);
  };
  const accountsFor = (id: ProviderId) => globalSettings.providers[id] ?? [];

  const [form, setForm] = useState<FormState>(BLANK);
  const [saving, setSaving] = useState(false);
  const [creds, setCreds] = useState("");
  const [credsStatus, setCredsStatus] = useState("");
  const isEdit = agentId !== null;

  // Chat model slot.
  const [chatProvider, setChatProvider] = useState<ProviderId>("lmstudio");
  const [chatAccount, setChatAccount] = useState("default");
  const [chatModel, setChatModel] = useState("local-model");
  const [chatCred, setChatCred] = useState("");
  const [chatTest, setChatTest] = useState<TestState>({ status: "idle" });
  const [chatModels, setChatModels] = useState<string[]>([]);

  // Embedding model slot — new agents inherit the COO's embedding by default.
  const [embInherit, setEmbInherit] = useState(true);
  const [embProvider, setEmbProvider] = useState<ProviderId>("builtin");
  const [embAccount, setEmbAccount] = useState("default");
  const [embModel, setEmbModel] = useState("all-MiniLM-L6-v2");
  const [embCred, setEmbCred] = useState("");
  const [embTest, setEmbTest] = useState<TestState>({ status: "idle" });
  const [embModels, setEmbModels] = useState<string[]>([]);
  const [cooEmbedding, setCooEmbedding] = useState<ModelRef | null>(null);

  /** A COO can't inherit from itself. */
  const canInherit = form.role !== "coo" && agentId !== "coo";
  const inheritEmbedding = embInherit && canInherit;

  useEffect(() => void loadGlobalSettings(), [loadGlobalSettings]);
  useEffect(() => void loadProviders(), [loadProviders]);

  // The COO's embedding model — offered as an "inherit" option for new agents.
  useEffect(() => {
    void apiFetch("/api/agents/coo")
      .then((r) => (r.ok ? r.json() : null))
      .then((p: AgentProfile | null) => {
        if (p) setCooEmbedding(p.model.embedding);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!agentId) {
      setForm(BLANK);
      setChatProvider(globalSettings.defaultChatModel.provider);
      setChatAccount(globalSettings.defaultChatModel.account || "default");
      setChatModel(globalSettings.defaultChatModel.modelId);
      setEmbInherit(true);
      setEmbProvider(globalSettings.defaultEmbeddingModel.provider);
      setEmbAccount(globalSettings.defaultEmbeddingModel.account || "default");
      setEmbModel(globalSettings.defaultEmbeddingModel.modelId);
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
        setChatProvider(p.model.chat.provider);
        setChatAccount(p.model.chat.account || "default");
        setChatModel(p.model.chat.modelId);
        // An existing agent shows its own configured embedding model.
        setEmbInherit(false);
        setEmbProvider(p.model.embedding.provider);
        setEmbAccount(p.model.embedding.account || "default");
        setEmbModel(p.model.embedding.modelId);
      });
  }, [agentId, globalSettings]);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const pickChatProvider = (p: ProviderId) => {
    setChatProvider(p);
    setChatTest({ status: "idle" });
    setChatModels([]);
    setChatAccount(accountsFor(p)[0]?.account ?? "default");
    setChatCred(credSeedFor(p));
    setChatModel(defaultChatModel(p));
  };

  const pickEmbProvider = (p: ProviderId) => {
    setEmbProvider(p);
    setEmbTest({ status: "idle" });
    setEmbModels([]);
    setEmbAccount(accountsFor(p)[0]?.account ?? "default");
    setEmbCred(credSeedFor(p));
    setEmbModel(defaultEmbedModel(p));
  };

  const peerAgents = agents.filter((a) => a.id !== agentId);

  const onSave = async () => {
    if (!form.displayName.trim()) return;
    setSaving(true);
    try {
      const chatRef: ModelRef = {
        provider: chatProvider,
        account: chatAccount || "default",
        modelId: chatModel.trim(),
      };
      const embeddingRef: ModelRef =
        inheritEmbedding && cooEmbedding
          ? cooEmbedding
          : {
              provider: embProvider,
              account: embAccount || "default",
              modelId: embModel.trim(),
            };
      const payload: Partial<AgentProfile> & { displayName: string } = {
        displayName: form.displayName.trim(),
        role: form.role,
        persona: form.persona,
        model: { chat: chatRef, embedding: embeddingRef },
        allowedModels: Array.from(new Set([chatRef.provider, embeddingRef.provider])).map((p) => ({
          provider: p,
          account: "*",
          modelId: "*",
        })),
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

      // Provider credentials typed into the model pickers are saved to Global
      // Settings — the single source of truth — so every agent reuses them.
      const current = useGlobalSettingsStore.getState().settings;
      const providerPatch: Record<string, ProviderAccount[]> = {};
      const upsertAccount = (p: ProviderId, accountName: string, value: string) => {
        const info = providers.find((x) => x.id === p);
        if (!info || p === "builtin" || !value.trim()) return;
        const list = providerPatch[p] ?? current.providers[p]?.map((a) => ({ ...a })) ?? [];
        const idx = list.findIndex((a) => a.account === accountName);
        const patch = globalProviderPatch(info, value.trim());
        if (idx >= 0) {
          list[idx] = {
            ...list[idx],
            ...patch,
            apiKeyConfigured: list[idx].apiKeyConfigured || Boolean(patch.apiKey),
          };
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
      upsertAccount(chatProvider, chatRef.account, chatCred);
      if (!inheritEmbedding) upsertAccount(embProvider, embeddingRef.account, embCred);
      if (Object.keys(providerPatch).length > 0) {
        await saveSettings({
          ...current,
          providers: { ...current.providers, ...providerPatch },
        });
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
            modelId={chatModel}
            onModelId={setChatModel}
            test={chatTest}
            onTest={setChatTest}
            models={chatModels}
            onModels={setChatModels}
            modelLabel="Chat model"
          />
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
            <p style={hintStyle}>
              {cooEmbedding
                ? `Uses the COO's embedding model — ${cooEmbedding.provider} / ${
                    cooEmbedding.modelId || "(disabled)"
                  }. Copied at creation; you can change it later in the Agent Studio.`
                : "Uses the COO's embedding model."}
            </p>
          ) : (
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
              modelId={embModel}
              onModelId={setEmbModel}
              test={embTest}
              onTest={setEmbTest}
              models={embModels}
              onModels={setEmbModels}
              modelLabel="Embedding model"
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
          <PeerAccessEditor
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
