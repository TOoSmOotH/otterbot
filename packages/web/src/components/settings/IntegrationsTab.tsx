import { useEffect, useMemo, useState } from "react";
import type { SkillConfigField, SkillConfigSchema } from "@otterbot/shared";
import {
  useConnectionsStore,
  assignConnection,
  unassignConnection,
  type ConnectionTypeDef,
  type CredentialTypeDef,
} from "../../stores/connections-store";
import { useSecretsStore } from "../../stores/secrets-store";
import { useAgentsStore } from "../../stores/agents-store";
import { useProjectsStore } from "../../stores/projects-store";
import { useSshKeysStore } from "../../stores/ssh-keys-store";

/**
 * Settings → Integrations. One tab that replaces the old Credentials +
 * Connections tabs. The user thinks about a single thing — an *integration*:
 * how an agent (or the whole instance) reaches an external service. Underneath,
 * the two-tier shape is unchanged: an **Account** (reusable identity + secret)
 * and a **Binding** (a specific use + who it's for), but the tiering is kept out
 * of the way behind one guided flow, with reuse offered where it helps.
 */
export function IntegrationsTab() {
  const {
    connections,
    credentials,
    connectionTypes,
    credentialTypes,
    load,
    deleteConnection,
    deleteCredential,
  } = useConnectionsStore();
  const agents = useAgentsStore((s) => s.agents);
  const loadAgents = useAgentsStore((s) => s.load);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void load();
    void loadAgents();
  }, [load, loadAgents]);

  const typeLabel = (type: string) => connectionTypes.find((t) => t.type === type)?.label ?? type;
  const credLabel = (id: string | null) =>
    id ? credentials.find((c) => c.id === id)?.label ?? "(missing)" : "—";
  const agentName = (id: string) => agents.find((a) => a.id === id)?.displayName ?? id;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={hint}>
          An integration is how an agent reaches an external service — chat, email, GitHub,
          Proxmox, SSH, an MCP server. Add one, point it at an account (reused or new), and assign
          it to specific agents or every agent.
        </p>
        {!adding && (
          <button style={primary} onClick={() => setAdding(true)}>
            + Add integration
          </button>
        )}
      </div>

      {adding && (
        <AddIntegration
          connectionTypes={connectionTypes}
          credentialTypes={credentialTypes}
          agents={agents.map((a) => ({ id: a.id, label: a.displayName }))}
          onDone={() => setAdding(false)}
        />
      )}

      {/* --- Integrations (bindings) --- */}
      <section>
        <h4 style={sectionTitle}>Integrations</h4>
        {connections.length === 0 && <p style={hint}>No integrations yet.</p>}
        {connections.map((conn) => (
          <IntegrationRow
            key={conn.id}
            id={conn.id}
            label={conn.label}
            typeLabel={typeLabel(conn.type)}
            isChat={connectionTypes.find((t) => t.type === conn.type)?.isChat ?? false}
            credLabel={credLabel(conn.credentialId)}
            allAgents={conn.allAgents}
            assignedAgentIds={conn.assignedAgentIds}
            agents={agents.map((a) => ({ id: a.id, label: a.displayName }))}
            agentName={agentName}
            onDelete={async () => {
              const res = await deleteConnection(conn.id);
              if (!res.ok && res.error && confirm(`${res.error}\n\nForce delete and unassign everywhere?`)) {
                await deleteConnection(conn.id, true);
              }
            }}
          />
        ))}
      </section>

      {/* --- Accounts (reusable credentials) --- */}
      <AccountsSection credentials={credentials} credentialTypes={credentialTypes} onDelete={deleteCredential} />

      {/* --- Instance secrets (bare global KEY=value) --- */}
      <InstanceSecrets />
    </div>
  );
}

/** Reusable accounts (credentials), with create flows for Git accounts + SSH keys. */
function AccountsSection({
  credentials,
  credentialTypes,
  onDelete,
}: {
  credentials: ReturnType<typeof useConnectionsStore.getState>["credentials"];
  credentialTypes: CredentialTypeDef[];
  onDelete: (id: string, force?: boolean) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4 style={sectionTitle}>Accounts</h4>
        {!adding && (
          <button style={ghost} onClick={() => setAdding(true)}>
            + Add account
          </button>
        )}
      </div>
      <p style={hint}>
        Reusable identities + secrets. One account (a Slack token, a Git account) can back several
        integrations. Most are created inline when you add an integration; Git accounts and SSH keys
        are added here. Stored encrypted and never shown back.
      </p>
      {adding && <AddAccount onDone={() => setAdding(false)} />}
      {credentials.length === 0 && <p style={hint}>No accounts yet.</p>}
      {credentials.map((cred) => (
        <div key={cred.id} style={row}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 600 }}>
              {cred.label} <span style={badge}>{credTypeLabel(cred.type, credentialTypes)}</span>
            </span>
            <span style={hint}>
              {Object.entries(cred.hints ?? {})
                .map(([k, v]) => `${k}=${v}`)
                .join("  ") || "no secrets stored"}
            </span>
          </div>
          <button
            style={danger}
            onClick={async () => {
              const res = await onDelete(cred.id);
              if (!res.ok && res.error && confirm(`${res.error}\n\nForce delete anyway?`)) {
                await onDelete(cred.id, true);
              }
            }}
          >
            Delete
          </button>
        </div>
      ))}
    </section>
  );
}

/** Compact create flow for the two account kinds not made via Add-integration. */
function AddAccount({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<"git" | "ssh-key">("git");
  const addForgeAccount = useProjectsStore((s) => s.addForgeAccount);
  const sshKeys = useSshKeysStore();
  const reload = useConnectionsStore((s) => s.load);
  const [busy, setBusy] = useState(false);
  const [pubKey, setPubKey] = useState<string | null>(null);

  // Git account fields
  const [gitDraft, setGitDraft] = useState<GitDraft>(emptyGitDraft());
  // SSH key fields
  const [keyMode, setKeyMode] = useState<"generate" | "import">("generate");
  const [keyLabel, setKeyLabel] = useState("");
  const [privateKey, setPrivateKey] = useState("");

  const submit = async () => {
    setBusy(true);
    try {
      if (kind === "git") {
        const res = await createGitAccount(gitDraft, addForgeAccount);
        if (res?.publicKey) {
          setPubKey(res.publicKey);
        } else {
          await reload();
          onDone();
        }
      } else {
        const key =
          keyMode === "import" ? await sshKeys.import(keyLabel, privateKey) : await sshKeys.generate(keyLabel);
        if (key) setPubKey(key.publicKey);
      }
      await reload();
    } finally {
      setBusy(false);
    }
  };

  if (pubKey) {
    return (
      <div style={card}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Public key — add it to the host/forge:</span>
        <textarea readOnly style={{ ...input, minHeight: 70, fontFamily: "monospace" }} value={pubKey} />
        <button style={primary} onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div style={card}>
      <label style={fieldLabel}>
        Account kind
        <select style={input} value={kind} onChange={(e) => setKind(e.target.value as "git" | "ssh-key")}>
          <option value="git">Git account (GitHub / Gitea)</option>
          <option value="ssh-key">SSH key</option>
        </select>
      </label>

      {kind === "git" ? (
        <GitAccountFields value={gitDraft} onChange={setGitDraft} />
      ) : (
        <>
          <div style={{ display: "flex", gap: 12 }}>
            <label style={radio}>
              <input type="radio" checked={keyMode === "generate"} onChange={() => setKeyMode("generate")} />
              Generate
            </label>
            <label style={radio}>
              <input type="radio" checked={keyMode === "import"} onChange={() => setKeyMode("import")} />
              Import
            </label>
          </div>
          <label style={fieldLabel}>
            Label
            <input style={input} value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)} />
          </label>
          {keyMode === "import" && (
            <label style={fieldLabel}>
              Private key (PEM / OpenSSH)
              <textarea
                style={{ ...input, minHeight: 90, fontFamily: "monospace" }}
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
              />
            </label>
          )}
        </>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button style={primary} disabled={busy} onClick={() => void submit()}>
          {busy ? "Saving…" : "Create account"}
        </button>
        <button style={ghost} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function credTypeLabel(type: string, types: CredentialTypeDef[]): string {
  return types.find((t) => t.type === type)?.label ?? type;
}

/** One integration row, with an expandable assignment editor. */
function IntegrationRow({
  id,
  label,
  typeLabel,
  isChat,
  credLabel,
  allAgents,
  assignedAgentIds,
  agents,
  agentName,
  onDelete,
}: {
  id: string;
  label: string;
  typeLabel: string;
  isChat: boolean;
  credLabel: string;
  allAgents: boolean;
  assignedAgentIds: string[];
  agents: Array<{ id: string; label: string }>;
  agentName: (id: string) => string;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { updateConnection } = useConnectionsStore();

  const summary = allAgents
    ? "all agents"
    : assignedAgentIds.length
      ? assignedAgentIds.map(agentName).join(", ")
      : "unassigned";

  const toggleAllAgents = async (next: boolean) => {
    await updateConnection(id, { allAgents: next });
    await useConnectionsStore.getState().load();
  };
  const toggleAgent = async (agentId: string, next: boolean) => {
    if (next) await assignConnection(agentId, id);
    else await unassignConnection(agentId, id);
    await useConnectionsStore.getState().load();
  };

  return (
    <div style={{ ...card, marginBottom: 6, gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 600 }}>
            {label} <span style={badge}>{typeLabel}</span>
          </span>
          <span style={hint}>
            account: {credLabel} · {summary}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={ghost} onClick={() => setEditing((v) => !v)}>
            {editing ? "Done" : "Assign"}
          </button>
          <button style={danger} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      {editing && (
        <div style={{ ...card, background: "rgb(var(--bg))", gap: 6 }}>
          <label style={radio}>
            <input
              type="checkbox"
              checked={allAgents}
              disabled={isChat}
              onChange={(e) => void toggleAllAgents(e.target.checked)}
            />
            All agents (instance-wide){isChat ? " — not available for chat" : ""}
          </label>
          {!allAgents &&
            agents.map((a) => {
              const checked = assignedAgentIds.includes(a.id);
              return (
                <label key={a.id} style={radio}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => void toggleAgent(a.id, e.target.checked)}
                  />
                  {a.label}
                </label>
              );
            })}
        </div>
      )}
    </div>
  );
}

/** Instance-wide bare secrets (KEY=value), shared by every agent (scope-filtered). */
function InstanceSecrets() {
  const { keys, load, upsert, setScope, remove } = useSecretsStore();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [scope, setScopeState] = useState("broad");

  useEffect(() => void load(), [load]);

  const add = async () => {
    if (!key.trim()) return;
    const ok = await upsert(key.trim(), value, scope as never);
    if (ok) {
      setKey("");
      setValue("");
    }
  };

  return (
    <section>
      <h4 style={sectionTitle}>Instance secrets</h4>
      <p style={hint}>
        Bare KEY=value secrets shared by every agent. Scope decides where each is used: Direct
        (integrations only), Shell, or Capability (shell, only while that capability is on).
      </p>
      {keys.map((k) => (
        <div key={k.key} style={row}>
          <span style={{ fontFamily: "monospace", fontSize: 13 }}>{k.key}</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              style={input}
              value={k.scope.startsWith("cap:") ? "cap" : k.scope}
              onChange={(e) => void setScope(k.key, (e.target.value === "cap" ? "cap:custom" : e.target.value) as never)}
            >
              <option value="direct">Direct</option>
              <option value="broad">Shell</option>
              <option value="cap">Capability</option>
            </select>
            <button style={danger} onClick={() => void remove(k.key)}>
              Delete
            </button>
          </div>
        </div>
      ))}
      <div style={{ ...card, marginTop: 6 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input style={{ ...input, flex: 1 }} placeholder="KEY" value={key} onChange={(e) => setKey(e.target.value)} />
          <input
            style={{ ...input, flex: 2 }}
            type="password"
            placeholder="value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <select style={input} value={scope} onChange={(e) => setScopeState(e.target.value)}>
            <option value="direct">Direct</option>
            <option value="broad">Shell</option>
          </select>
          <button style={primary} onClick={() => void add()}>
            Add
          </button>
        </div>
      </div>
    </section>
  );
}

/** Wizard: pick a service → choose/create an account → config → who it's for. */
function AddIntegration({
  connectionTypes,
  credentialTypes,
  agents,
  onDone,
}: {
  connectionTypes: ConnectionTypeDef[];
  credentialTypes: CredentialTypeDef[];
  agents: Array<{ id: string; label: string }>;
  onDone: () => void;
}) {
  const { credentials, createCredential, createConnection, busy, error } = useConnectionsStore();
  const forgeAccounts = useProjectsStore((s) => s.forgeAccounts);
  const loadForgeAccounts = useProjectsStore((s) => s.loadForgeAccounts);
  useEffect(() => void loadForgeAccounts(), [loadForgeAccounts]);

  const [typeKey, setTypeKey] = useState(connectionTypes[0]?.type ?? "");
  const def = useMemo(() => connectionTypes.find((t) => t.type === typeKey), [connectionTypes, typeKey]);
  const credDef = useMemo(
    () => credentialTypes.find((t) => t.type === def?.credentialType),
    [credentialTypes, def]
  );

  const [label, setLabel] = useState("");
  const [credMode, setCredMode] = useState<"existing" | "new">("new");
  const [credId, setCredId] = useState("");
  const [credLabel, setCredLabel] = useState("");
  const [credValues, setCredValues] = useState<Record<string, unknown>>({});
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [allAgents, setAllAgents] = useState(false);
  const [assignTo, setAssignTo] = useState<Set<string>>(new Set());

  const compatibleCreds = credentials.filter((c) => c.type === def?.credentialType);

  const submit = async () => {
    if (!def) return;
    let credentialId: string | null = null;
    // GitHub authenticates through a Git account (config.gitAccountId), not a
    // standalone token credential — so skip the generic credential step for it.
    if (def.credentialType && def.type !== "github") {
      if (credMode === "existing") {
        credentialId = credId || compatibleCreds[0]?.id || null;
      } else if (credDef) {
        const created = await createCredential({
          type: credDef.type,
          label: credLabel || `${label || def.label} account`,
          secrets: stringify(credValues),
        });
        credentialId = created?.id ?? null;
      }
    }
    const conn = await createConnection({
      type: def.type,
      label: label || def.label,
      config,
      credentialId,
      allAgents,
    });
    if (conn) {
      if (!allAgents) {
        for (const agentId of assignTo) await assignConnection(agentId, conn.id);
      }
      await useConnectionsStore.getState().load();
      onDone();
    }
  };

  return (
    <div style={card}>
      <label style={fieldLabel}>
        Service
        <select value={typeKey} onChange={(e) => setTypeKey(e.target.value)} style={input}>
          {connectionTypes.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label style={fieldLabel}>
        Name
        <input style={input} value={label} placeholder={def?.label} onChange={(e) => setLabel(e.target.value)} />
      </label>

      {def?.credentialType && def.type !== "github" && (
        <div style={{ ...card, background: "rgb(var(--bg))" }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 6 }}>
            <label style={radio}>
              <input type="radio" checked={credMode === "new"} onChange={() => setCredMode("new")} />
              New account
            </label>
            <label style={radio}>
              <input
                type="radio"
                checked={credMode === "existing"}
                onChange={() => setCredMode("existing")}
                disabled={compatibleCreds.length === 0}
              />
              Reuse existing
            </label>
          </div>

          {credMode === "existing" ? (
            <select value={credId} onChange={(e) => setCredId(e.target.value)} style={input}>
              <option value="">Select an account…</option>
              {compatibleCreds.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            credDef && (
              <>
                <label style={fieldLabel}>
                  Account name
                  <input
                    style={input}
                    value={credLabel}
                    placeholder={`${credDef.label} account`}
                    onChange={(e) => setCredLabel(e.target.value)}
                  />
                </label>
                <SchemaFields schema={credDef.fieldSchema} values={credValues} onChange={setCredValues} />
              </>
            )
          )}
        </div>
      )}

      {def?.type === "github" && (
        <GitAccountChooser
          value={config.gitAccountId as string | undefined}
          onChange={(id) => setConfig({ ...config, gitAccountId: id })}
          forgeAccounts={forgeAccounts}
          reloadForge={loadForgeAccounts}
        />
      )}

      {def &&
        (def.isChat ? (
          <ChatConfigFields config={config} onChange={setConfig} channelLabel={chatChannelLabel(def.type)} />
        ) : (
          <SchemaFields schema={def.configSchema} values={config} onChange={setConfig} />
        ))}

      {/* Who it's for */}
      <div style={{ ...card, background: "rgb(var(--bg))", gap: 6 }}>
        <span style={{ fontSize: 12, opacity: 0.8 }}>Assign to</span>
        {!def?.isChat && (
          <label style={radio}>
            <input type="checkbox" checked={allAgents} onChange={(e) => setAllAgents(e.target.checked)} />
            All agents (instance-wide)
          </label>
        )}
        {!allAgents &&
          agents.map((a) => (
            <label key={a.id} style={radio}>
              <input
                type="checkbox"
                checked={assignTo.has(a.id)}
                onChange={(e) => {
                  const next = new Set(assignTo);
                  if (e.target.checked) next.add(a.id);
                  else next.delete(a.id);
                  setAssignTo(next);
                }}
              />
              {a.label}
            </label>
          ))}
      </div>

      {error && <span style={{ color: "tomato", fontSize: 12 }}>{error}</span>}
      <div style={{ display: "flex", gap: 8 }}>
        <button style={primary} disabled={busy} onClick={() => void submit()}>
          {busy ? "Saving…" : "Create integration"}
        </button>
        <button style={ghost} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function chatChannelLabel(type: string): string {
  return type === "matrix" ? "Room ID" : "Channel ID";
}

/** Editable draft for a Git (forge) account, incl. how its SSH key is provided. */
export type GitDraft = {
  provider: "github" | "gitea";
  label: string;
  baseUrl: string;
  token: string;
  username: string;
  gitTransport: "https" | "ssh";
  committerName: string;
  committerEmail: string;
  signCommits: boolean;
  /** For ssh transport: generate a managed key, or link a reusable SSH-key account. */
  sshKeyMode: "generate" | "link";
  sshKeyId: string;
};

export const emptyGitDraft = (): GitDraft => ({
  provider: "github",
  label: "",
  baseUrl: "",
  token: "",
  username: "",
  gitTransport: "https",
  committerName: "",
  committerEmail: "",
  signCommits: false,
  sshKeyMode: "generate",
  sshKeyId: "",
});

/** Persist a {@link GitDraft} via the forge endpoint; returns id + public key. */
async function createGitAccount(
  d: GitDraft,
  addForgeAccount: (input: {
    provider: "github" | "gitea";
    label: string;
    baseUrl?: string;
    token: string;
    username?: string;
    gitTransport?: "https" | "ssh";
    committerName?: string;
    committerEmail?: string;
    signCommits?: boolean;
    sshKeyId?: string | null;
  }) => Promise<{ id: string; publicKey: string | null } | null>
): Promise<{ id: string; publicKey: string | null } | null> {
  return addForgeAccount({
    provider: d.provider,
    label: d.label || d.provider,
    baseUrl: d.baseUrl || undefined,
    token: d.token,
    username: d.username || undefined,
    gitTransport: d.gitTransport,
    committerName: d.committerName || undefined,
    committerEmail: d.committerEmail || undefined,
    signCommits: d.signCommits,
    sshKeyId: d.gitTransport === "ssh" && d.sshKeyMode === "link" ? d.sshKeyId || null : null,
  });
}

/** Controlled fields for a Git account, including SSH-key choice on ssh transport. */
function GitAccountFields({ value, onChange }: { value: GitDraft; onChange: (d: GitDraft) => void }) {
  const keys = useSshKeysStore((s) => s.keys);
  const loadKeys = useSshKeysStore((s) => s.load);
  useEffect(() => void loadKeys(), [loadKeys]);
  const set = (patch: Partial<GitDraft>) => onChange({ ...value, ...patch });
  return (
    <>
      <label style={fieldLabel}>
        Provider
        <select style={input} value={value.provider} onChange={(e) => set({ provider: e.target.value as "github" | "gitea" })}>
          <option value="github">GitHub</option>
          <option value="gitea">Gitea</option>
        </select>
      </label>
      <label style={fieldLabel}>
        Label
        <input style={input} value={value.label} onChange={(e) => set({ label: e.target.value })} />
      </label>
      {value.provider === "gitea" && (
        <label style={fieldLabel}>
          Base URL
          <input style={input} value={value.baseUrl} placeholder="https://gitea.example.com" onChange={(e) => set({ baseUrl: e.target.value })} />
        </label>
      )}
      <label style={fieldLabel}>
        API token
        <input style={input} type="password" value={value.token} onChange={(e) => set({ token: e.target.value })} />
      </label>
      <label style={fieldLabel}>
        Bot username
        <input style={input} value={value.username} onChange={(e) => set({ username: e.target.value })} />
      </label>
      <label style={fieldLabel}>
        Git transport
        <select style={input} value={value.gitTransport} onChange={(e) => set({ gitTransport: e.target.value as "https" | "ssh" })}>
          <option value="https">HTTPS (token)</option>
          <option value="ssh">SSH (key)</option>
        </select>
      </label>
      <label style={fieldLabel}>
        Committer name
        <input style={input} value={value.committerName} onChange={(e) => set({ committerName: e.target.value })} />
      </label>
      <label style={fieldLabel}>
        Committer email
        <input style={input} value={value.committerEmail} onChange={(e) => set({ committerEmail: e.target.value })} />
      </label>
      {value.gitTransport === "ssh" && (
        <div style={{ ...card, background: "rgb(var(--bg))", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>SSH key (for git-over-SSH)</span>
          <div style={{ display: "flex", gap: 12 }}>
            <label style={radio}>
              <input type="radio" checked={value.sshKeyMode === "generate"} onChange={() => set({ sshKeyMode: "generate" })} />
              Generate a managed key
            </label>
            <label style={radio}>
              <input
                type="radio"
                checked={value.sshKeyMode === "link"}
                onChange={() => set({ sshKeyMode: "link" })}
                disabled={keys.length === 0}
              />
              Link an existing SSH key
            </label>
          </div>
          {value.sshKeyMode === "link" ? (
            <select style={input} value={value.sshKeyId} onChange={(e) => set({ sshKeyId: e.target.value })}>
              <option value="">Select an SSH key…</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label} · {k.fingerprint}
                </option>
              ))}
            </select>
          ) : (
            keys.length === 0 && (
              <span style={hint}>A new key is generated on save; you’ll get its public key to add to the forge.</span>
            )
          )}
          <label style={radio}>
            <input type="checkbox" checked={value.signCommits} onChange={(e) => set({ signCommits: e.target.checked })} />
            SSH-sign commits
          </label>
        </div>
      )}
    </>
  );
}

/**
 * Picks the Git account a GitHub integration uses — reuse an existing one or
 * create a new one inline. A Git account bundles the token + transport + SSH
 * key, so it (not a standalone SSH key) is what GitHub points at.
 */
function GitAccountChooser({
  value,
  onChange,
  forgeAccounts,
  reloadForge,
}: {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  forgeAccounts: Array<{ id: string; label: string; gitTransport: "https" | "ssh" }>;
  reloadForge: () => Promise<void>;
}) {
  const addForgeAccount = useProjectsStore((s) => s.addForgeAccount);
  const [mode, setMode] = useState<"existing" | "new">(forgeAccounts.length ? "existing" : "new");
  const [draft, setDraft] = useState<GitDraft>(emptyGitDraft());
  const [busy, setBusy] = useState(false);
  const [pubKey, setPubKey] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const res = await createGitAccount(draft, addForgeAccount);
      if (res) {
        await reloadForge();
        onChange(res.id);
        setMode("existing");
        if (res.publicKey) setPubKey(res.publicKey);
        setDraft(emptyGitDraft());
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...card, background: "rgb(var(--bg))", gap: 8 }}>
      <span style={{ fontSize: 12, opacity: 0.8 }}>Git account</span>
      <p style={hint}>
        A Git account bundles the API token, transport, and (for SSH) a key. GitHub uses a Git
        account — SSH keys attach to one here, not to the integration directly.
      </p>
      <div style={{ display: "flex", gap: 12 }}>
        <label style={radio}>
          <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} disabled={forgeAccounts.length === 0} />
          Reuse existing
        </label>
        <label style={radio}>
          <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} />
          New Git account
        </label>
      </div>

      {mode === "existing" ? (
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} style={input}>
          <option value="">None (token-only — pick or create a Git account for git push/PR)</option>
          {forgeAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} · {a.gitTransport === "ssh" ? "SSH" : "HTTPS"}
            </option>
          ))}
        </select>
      ) : (
        <>
          <GitAccountFields value={draft} onChange={setDraft} />
          <button style={ghost} disabled={busy || !draft.token} onClick={() => void create()}>
            {busy ? "Creating…" : "Create Git account"}
          </button>
        </>
      )}

      {pubKey && (
        <div style={{ ...card, gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Public key — add it to the forge:</span>
          <textarea readOnly style={{ ...input, minHeight: 60, fontFamily: "monospace" }} value={pubKey} />
        </div>
      )}
    </div>
  );
}

/** Bespoke chat config (channel + access gates). */
function ChatConfigFields({
  config,
  onChange,
  channelLabel,
}: {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
  channelLabel: string;
}) {
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v });
  const allowed = Array.isArray(config.allowedUserIds) ? (config.allowedUserIds as string[]) : [];
  return (
    <>
      <label style={fieldLabel}>
        {channelLabel}
        <input style={input} value={(config.channelId as string) ?? ""} onChange={(e) => set("channelId", e.target.value)} />
      </label>
      <label style={radio}>
        <input type="checkbox" checked={config.mentionOnly === true} onChange={(e) => set("mentionOnly", e.target.checked)} />
        Only respond when @mentioned
      </label>
      <label style={radio}>
        <input type="checkbox" checked={config.publicBot === true} onChange={(e) => set("publicBot", e.target.checked)} />
        Public — anyone in the channel may talk to the agent
      </label>
      {config.publicBot !== true && (
        <label style={fieldLabel}>
          Allowed user IDs (one per line)
          <textarea
            style={{ ...input, minHeight: 60 }}
            value={allowed.join("\n")}
            onChange={(e) => set("allowedUserIds", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
          />
        </label>
      )}
    </>
  );
}

/** Generic renderer for a SkillConfigSchema (scalars/secret/boolean; list → JSON). */
function SchemaFields({
  schema,
  values,
  onChange,
}: {
  schema: SkillConfigSchema;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  return (
    <>
      {schema.description && <p style={hint}>{schema.description}</p>}
      {schema.fields.map((f) => (
        <Field key={f.key} field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
      ))}
    </>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: SkillConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (field.type === "boolean") {
    return (
      <label style={radio}>
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        {field.label}
      </label>
    );
  }
  if (field.type === "list") {
    return (
      <label style={fieldLabel}>
        {field.label} (JSON)
        <textarea
          style={{ ...input, minHeight: 60, fontFamily: "monospace" }}
          value={typeof value === "string" ? value : JSON.stringify(value ?? [], null, 0)}
          onChange={(e) => onChange(e.target.value)}
          placeholder="[]"
        />
      </label>
    );
  }
  return (
    <label style={fieldLabel}>
      {field.label}
      <input
        style={input}
        type={field.type === "secret" ? "password" : field.type === "number" ? "number" : "text"}
        value={(value as string | number | undefined) ?? ""}
        placeholder={field.placeholder}
        onChange={(e) => onChange(field.type === "number" ? Number(e.target.value) : e.target.value)}
      />
    </label>
  );
}

/** Coerce form values into a string→string secret map (drops blanks). */
function stringify(values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

const hint: React.CSSProperties = { fontSize: 12, color: "rgb(var(--muted))", margin: 0 };
const sectionTitle: React.CSSProperties = { margin: "0 0 8px", fontSize: 13, opacity: 0.8 };
const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 10px",
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  marginBottom: 6,
};
const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 12,
  border: "1px solid rgb(var(--border))",
  borderRadius: 10,
};
const badge: React.CSSProperties = {
  fontSize: 11,
  padding: "1px 6px",
  borderRadius: 6,
  background: "rgb(var(--bg))",
  border: "1px solid rgb(var(--border))",
  color: "rgb(var(--muted))",
};
const fieldLabel: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13 };
const radio: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, fontSize: 13 };
const input: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid rgb(var(--border))",
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
};
const primary: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "none",
  background: "rgb(var(--accent))",
  color: "white",
  cursor: "pointer",
};
const ghost: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid rgb(var(--border))",
  background: "transparent",
  color: "rgb(var(--fg))",
  cursor: "pointer",
};
const danger: React.CSSProperties = { ...ghost, color: "tomato" };
