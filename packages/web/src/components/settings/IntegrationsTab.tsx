import { useEffect, useMemo, useState } from "react";
import type { SkillConfigField, SkillConfigSchema, Credential, Connection } from "@otterbot/shared";
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
import { Modal } from "../Modal";

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
  const loadForgeAccounts = useProjectsStore((s) => s.loadForgeAccounts);
  const [adding, setAdding] = useState(false);
  const [editingConn, setEditingConn] = useState<Connection | null>(null);

  useEffect(() => {
    void load();
    void loadAgents();
    void loadForgeAccounts();
  }, [load, loadAgents, loadForgeAccounts]);

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
        <Modal title="Add integration" onClose={() => setAdding(false)} maxWidth={680}>
          <AddIntegration
            connectionTypes={connectionTypes}
            credentialTypes={credentialTypes}
            agents={agents.map((a) => ({ id: a.id, label: a.displayName }))}
            onDone={() => setAdding(false)}
          />
        </Modal>
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
            onEdit={() => setEditingConn(conn)}
            onDelete={async () => {
              const res = await deleteConnection(conn.id);
              if (!res.ok && res.error && confirm(`${res.error}\n\nForce delete and unassign everywhere?`)) {
                await deleteConnection(conn.id, true);
              }
            }}
          />
        ))}
      </section>

      {editingConn && (
        <Modal title={`Edit ${editingConn.label}`} onClose={() => setEditingConn(null)} maxWidth={620}>
          <EditIntegration
            conn={editingConn}
            connectionTypes={connectionTypes}
            credentials={credentials}
            onDone={() => setEditingConn(null)}
          />
        </Modal>
      )}

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
  const [editing, setEditing] = useState<Credential | null>(null);
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
      {editing && (
        <Modal title={`Edit ${editing.label}`} onClose={() => setEditing(null)} maxWidth={560}>
          <EditAccount account={editing} credentialTypes={credentialTypes} onDone={() => setEditing(null)} />
        </Modal>
      )}
      <p style={hint}>
        Reusable identities + secrets. One account (a Slack token, a Git account) can back several
        integrations. Most are created inline when you add an integration; Git accounts and SSH keys
        are added here. Stored encrypted and never shown back.
      </p>
      {adding && (
        <Modal title="Add account" onClose={() => setAdding(false)} maxWidth={560}>
          <AddAccount onDone={() => setAdding(false)} />
        </Modal>
      )}
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
          <div style={{ display: "flex", gap: 8 }}>
            <button style={ghost} onClick={() => setEditing(cred)}>
              Edit
            </button>
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
        </div>
      ))}
    </section>
  );
}

/** Edit an existing account: git accounts get their fields; others re-enter secrets. */
function EditAccount({
  account,
  credentialTypes,
  onDone,
}: {
  account: Credential;
  credentialTypes: CredentialTypeDef[];
  onDone: () => void;
}) {
  const updateCredential = useConnectionsStore((s) => s.updateCredential);
  const reload = useConnectionsStore((s) => s.load);
  const keys = useSshKeysStore((s) => s.keys);
  const loadKeys = useSshKeysStore((s) => s.load);
  useEffect(() => void loadKeys(), [loadKeys]);

  const isGit = account.type === "git";
  const isSshKey = account.type === "ssh-key";
  const credDef = credentialTypes.find((t) => t.type === account.type);
  const cfg = account.config ?? {};

  const [label, setLabel] = useState(account.label);
  const [busy, setBusy] = useState(false);
  // Git fields (seeded from config; token blank = keep).
  const [git, setGit] = useState({
    provider: cfg.provider === "gitea" ? "gitea" : ("github" as "github" | "gitea"),
    baseUrl: typeof cfg.baseUrl === "string" ? cfg.baseUrl : "",
    gitTransport: cfg.gitTransport === "ssh" ? "ssh" : ("https" as "https" | "ssh"),
    username: typeof cfg.username === "string" ? cfg.username : "",
    committerName: typeof cfg.committerName === "string" ? cfg.committerName : "",
    committerEmail: typeof cfg.committerEmail === "string" ? cfg.committerEmail : "",
    signCommits: cfg.signCommits === true,
    sshKeyId: typeof cfg.sshKeyId === "string" ? cfg.sshKeyId : "",
    token: "",
  });
  // Non-git: re-enter secret fields (blank keeps the stored value).
  const [values, setValues] = useState<Record<string, unknown>>({});

  const save = async () => {
    setBusy(true);
    try {
      if (isGit) {
        await updateCredential(account.id, {
          label,
          config: {
            provider: git.provider,
            baseUrl: git.baseUrl,
            username: git.username,
            gitTransport: git.gitTransport,
            committerName: git.committerName,
            committerEmail: git.committerEmail,
            signCommits: git.signCommits,
            sshKeyId: git.gitTransport === "ssh" ? git.sshKeyId || null : null,
          },
          secrets: git.token ? { FORGE_TOKEN: git.token } : undefined,
        });
      } else if (isSshKey) {
        await updateCredential(account.id, { label });
      } else {
        await updateCredential(account.id, { label, secrets: stringify(values) });
      }
      await reload();
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={fieldLabel}>
        Label
        <input style={input} value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>

      {isGit && (
        <>
          <label style={fieldLabel}>
            Provider
            <select style={input} value={git.provider} onChange={(e) => setGit({ ...git, provider: e.target.value as "github" | "gitea" })}>
              <option value="github">GitHub</option>
              <option value="gitea">Gitea</option>
            </select>
          </label>
          {git.provider === "gitea" && (
            <label style={fieldLabel}>
              Base URL
              <input style={input} value={git.baseUrl} placeholder="https://gitea.example.com" onChange={(e) => setGit({ ...git, baseUrl: e.target.value })} />
            </label>
          )}
          <label style={fieldLabel}>
            API token
            <input
              style={input}
              type="password"
              placeholder="•••• (leave blank to keep)"
              value={git.token}
              onChange={(e) => setGit({ ...git, token: e.target.value })}
            />
          </label>
          <label style={fieldLabel}>
            Bot username
            <input style={input} value={git.username} onChange={(e) => setGit({ ...git, username: e.target.value })} />
          </label>
          <label style={fieldLabel}>
            Git transport
            <select style={input} value={git.gitTransport} onChange={(e) => setGit({ ...git, gitTransport: e.target.value as "https" | "ssh" })}>
              <option value="https">HTTPS — token only</option>
              <option value="ssh">SSH — uses an SSH key</option>
            </select>
          </label>
          <label style={fieldLabel}>
            Committer name
            <input style={input} value={git.committerName} onChange={(e) => setGit({ ...git, committerName: e.target.value })} />
          </label>
          <label style={fieldLabel}>
            Committer email
            <input style={input} value={git.committerEmail} onChange={(e) => setGit({ ...git, committerEmail: e.target.value })} />
          </label>
          {git.gitTransport === "ssh" && (
            <>
              <label style={fieldLabel}>
                SSH key
                <select style={input} value={git.sshKeyId} onChange={(e) => setGit({ ...git, sshKeyId: e.target.value })}>
                  <option value="">(managed key — none linked)</option>
                  {keys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label} · {k.fingerprint}
                    </option>
                  ))}
                </select>
              </label>
              <label style={radio}>
                <input type="checkbox" checked={git.signCommits} onChange={(e) => setGit({ ...git, signCommits: e.target.checked })} />
                SSH-sign commits
              </label>
            </>
          )}
        </>
      )}

      {isSshKey && (
        <span style={hint}>
          {typeof cfg.fingerprint === "string" ? cfg.fingerprint : ""} — the key material can't be edited; delete and
          re-add to rotate.
        </span>
      )}

      {!isGit && !isSshKey && credDef && (
        <>
          <p style={hint}>Re-enter only the fields you want to change — blanks keep the stored value.</p>
          <SchemaFields schema={credDef.fieldSchema} values={values} onChange={setValues} />
        </>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button style={ghost} onClick={onDone}>
          Cancel
        </button>
        <button style={primary} disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
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
        const res = await createGitAccount(gitDraft, addForgeAccount, sshKeys.generate);
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
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Public key — add it to the host/forge:</span>
        <textarea readOnly style={{ ...input, minHeight: 70, fontFamily: "monospace" }} value={pubKey} />
        <button style={primary} onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
  onEdit,
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
  onEdit: () => void;
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
          <button style={ghost} onClick={onEdit}>
            Edit
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

/** Edit a binding: label, its config, and which account it uses. */
function EditIntegration({
  conn,
  connectionTypes,
  credentials,
  onDone,
}: {
  conn: Connection;
  connectionTypes: ConnectionTypeDef[];
  credentials: Credential[];
  onDone: () => void;
}) {
  const updateConnection = useConnectionsStore((s) => s.updateConnection);
  const reload = useConnectionsStore((s) => s.load);
  const forgeAccounts = useProjectsStore((s) => s.forgeAccounts);
  const loadForge = useProjectsStore((s) => s.loadForgeAccounts);
  useEffect(() => void loadForge(), [loadForge]);

  const def = connectionTypes.find((t) => t.type === conn.type);
  const [label, setLabel] = useState(conn.label);
  const [config, setConfig] = useState<Record<string, unknown>>(conn.config ?? {});
  const [credentialId, setCredentialId] = useState<string | null>(conn.credentialId);
  const [busy, setBusy] = useState(false);
  const compatible = credentials.filter((c) => c.type === def?.credentialType);

  const save = async () => {
    setBusy(true);
    try {
      await updateConnection(conn.id, { label, config, credentialId });
      await reload();
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={fieldLabel}>
        Name
        <input style={input} value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>

      {conn.type === "github" ? (
        <label style={fieldLabel}>
          Git account
          <select
            style={input}
            value={(config.gitAccountId as string) ?? ""}
            onChange={(e) => setConfig({ ...config, gitAccountId: e.target.value || undefined })}
          >
            <option value="">Select a Git account…</option>
            {forgeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} · {a.gitTransport === "ssh" ? "SSH" : "HTTPS"}
              </option>
            ))}
          </select>
        </label>
      ) : (
        def?.credentialType && (
          <label style={fieldLabel}>
            Account
            <select style={input} value={credentialId ?? ""} onChange={(e) => setCredentialId(e.target.value || null)}>
              <option value="">None</option>
              {compatible.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )
      )}

      {def &&
        (def.isChat ? (
          <ChatConfigFields config={config} onChange={setConfig} channelLabel={chatChannelLabel(def.type)} />
        ) : def.configSchema.fields.length > 0 ? (
          <SchemaFields schema={def.configSchema} values={config} onChange={setConfig} />
        ) : null)}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button style={ghost} onClick={onDone}>
          Cancel
        </button>
        <button style={primary} disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
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
  const addForgeAccount = useProjectsStore((s) => s.addForgeAccount);
  const generateKey = useSshKeysStore((s) => s.generate);
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
  const [step, setStep] = useState(0);
  // GitHub Git-account sub-state (the account step for github).
  const [gitMode, setGitMode] = useState<"existing" | "new">(forgeAccounts.length ? "existing" : "new");
  const [gitModeTouched, setGitModeTouched] = useState(false);
  const [gitDraft, setGitDraft] = useState<GitDraft>(emptyGitDraft());
  const [gitPubKey, setGitPubKey] = useState<string | null>(null);

  // Git accounts load async after mount; once they arrive, default to reusing an
  // existing one (unless the user already chose a mode), so a just-created
  // account is selectable instead of being stuck on "New".
  useEffect(() => {
    if (!gitModeTouched && forgeAccounts.length > 0) setGitMode("existing");
  }, [forgeAccounts.length, gitModeTouched]);

  const compatibleCreds = credentials.filter((c) => c.type === def?.credentialType);

  // The wizard shows only the steps a given service needs.
  const needsAccount = !!def && (def.type === "github" || (!!def.credentialType && def.type !== "github"));
  const needsConfig = !!def && (def.isChat || def.configSchema.fields.length > 0);
  const steps: Array<"service" | "account" | "config" | "assign"> = ["service"];
  if (needsAccount) steps.push("account");
  if (needsConfig) steps.push("config");
  steps.push("assign");
  const clamped = Math.min(step, steps.length - 1);
  const stepKey = steps[clamped];
  const stepTitle = { service: "Service", account: "Account", config: "Configure", assign: "Assign" }[stepKey];

  // Switching service resets the per-service inputs and returns to step 1.
  const selectService = (t: string) => {
    setTypeKey(t);
    setStep(0);
    setLabel("");
    setConfig({});
    setCredMode("new");
    setCredId("");
    setCredLabel("");
    setCredValues({});
    setGitMode(forgeAccounts.length ? "existing" : "new");
    setGitModeTouched(false);
    setGitDraft(emptyGitDraft());
    setGitPubKey(null);
  };

  // Next on the GitHub "new account" sub-step creates the Git account (and shows
  // its public key) instead of advancing; otherwise Next just advances.
  const gitAccountId = (config.gitAccountId as string | undefined) ?? undefined;
  const needsGitCreate = stepKey === "account" && def?.type === "github" && gitMode === "new" && !gitAccountId;
  const createGit = async () => {
    const res = await createGitAccount(gitDraft, addForgeAccount, generateKey);
    if (res) {
      await loadForgeAccounts();
      setConfig({ ...config, gitAccountId: res.id });
      setGitMode("existing");
      setGitPubKey(res.publicKey);
    }
  };
  // Can't leave the GitHub account step until a Git account is chosen/created.
  const blockedOnGit = stepKey === "account" && def?.type === "github" && !gitAccountId && !needsGitCreate;

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

  const onLast = clamped === steps.length - 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Step indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {steps.map((s, i) => (
          <span
            key={s}
            style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 999,
              border: "1px solid rgb(var(--border))",
              background: i === clamped ? "rgb(var(--accent))" : "transparent",
              color: i === clamped ? "white" : "rgb(var(--muted))",
            }}
          >
            {i + 1}. {{ service: "Service", account: "Account", config: "Configure", assign: "Assign" }[s]}
          </span>
        ))}
      </div>
      <span style={{ fontSize: 14, fontWeight: 600 }}>
        {stepTitle}
        {def && stepKey !== "service" ? ` — ${def.label}` : ""}
      </span>

      {/* --- Step: Service --- */}
      {stepKey === "service" && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {connectionTypes.map((t) => (
              <button
                key={t.type}
                onClick={() => selectService(t.type)}
                style={{
                  ...ghost,
                  borderColor: typeKey === t.type ? "rgb(var(--accent))" : "rgb(var(--border))",
                  background: typeKey === t.type ? "rgba(var(--accent), 0.12)" : "transparent",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <label style={fieldLabel}>
            Name
            <input style={input} value={label} placeholder={def?.label} onChange={(e) => setLabel(e.target.value)} />
          </label>
        </>
      )}

      {/* --- Step: Account (GitHub → a Git account) --- */}
      {stepKey === "account" && def?.type === "github" && (
        <div style={{ ...card, background: "rgb(var(--bg))", gap: 8 }}>
          <p style={hint}>
            A Git account bundles the provider (GitHub or Gitea), API token, transport, and (for
            SSH) a key. Pick the provider when you create the account below — SSH keys attach to a
            Git account here, not to the integration directly.
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            <label style={radio}>
              <input
                type="radio"
                checked={gitMode === "existing"}
                onChange={() => {
                  setGitMode("existing");
                  setGitModeTouched(true);
                }}
                disabled={forgeAccounts.length === 0}
              />
              Reuse existing
            </label>
            <label style={radio}>
              <input
                type="radio"
                checked={gitMode === "new"}
                onChange={() => {
                  setGitMode("new");
                  setGitModeTouched(true);
                  setConfig({ ...config, gitAccountId: undefined });
                  setGitPubKey(null);
                }}
              />
              New Git account
            </label>
          </div>

          {gitMode === "existing" ? (
            <select
              value={gitAccountId ?? ""}
              onChange={(e) => setConfig({ ...config, gitAccountId: e.target.value || undefined })}
              style={input}
            >
              <option value="">Select a Git account…</option>
              {forgeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.gitTransport === "ssh" ? "SSH" : "HTTPS"}
                </option>
              ))}
            </select>
          ) : gitAccountId ? (
            <span style={{ fontSize: 13 }}>✓ Git account created — press Next to continue.</span>
          ) : (
            <GitAccountFields value={gitDraft} onChange={setGitDraft} />
          )}

          {gitPubKey && (
            <div style={{ ...card, gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Public key — add it to the forge:</span>
              <textarea readOnly style={{ ...input, minHeight: 60, fontFamily: "monospace" }} value={gitPubKey} />
            </div>
          )}
        </div>
      )}
      {stepKey === "account" && def?.type !== "github" && def?.credentialType && (
        <div style={{ ...card, background: "rgb(var(--bg))" }}>
          <p style={hint}>The {def.label} account these credentials belong to. Reuse one or enter a new set.</p>
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

      {/* --- Step: Configure --- */}
      {stepKey === "config" &&
        def &&
        (def.isChat ? (
          <ChatConfigFields config={config} onChange={setConfig} channelLabel={chatChannelLabel(def.type)} />
        ) : (
          <SchemaFields schema={def.configSchema} values={config} onChange={setConfig} />
        ))}

      {/* --- Step: Assign --- */}
      {stepKey === "assign" && (
        <div style={{ ...card, background: "rgb(var(--bg))", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Who can use this integration?</span>
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
          {def?.isChat && <span style={hint}>Chat integrations are answered by one agent — pick exactly one.</span>}
        </div>
      )}

      {error && <span style={{ color: "tomato", fontSize: 12 }}>{error}</span>}
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
        <button style={ghost} onClick={onDone}>
          Cancel
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          {clamped > 0 && (
            <button style={ghost} onClick={() => setStep(clamped - 1)}>
              Back
            </button>
          )}
          {onLast ? (
            <button style={primary} disabled={busy} onClick={() => void submit()}>
              {busy ? "Saving…" : "Create integration"}
            </button>
          ) : needsGitCreate ? (
            <button style={primary} disabled={busy || !gitDraft.token} onClick={() => void createGit()}>
              {busy ? "Creating…" : "Create Git account"}
            </button>
          ) : (
            <button style={primary} disabled={!typeKey || blockedOnGit} onClick={() => setStep(clamped + 1)}>
              Next
            </button>
          )}
        </div>
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
  gitTransport: "https" | "ssh";
  committerName: string;
  committerEmail: string;
  signCommits: boolean;
  /** For ssh transport: create a brand-new reusable SSH key, or use an existing one. */
  sshKeyMode: "new" | "existing";
  /** Label for the new key (sshKeyMode = "new"). */
  newKeyLabel: string;
  /** Existing reusable SSH-key account id (sshKeyMode = "existing"). */
  sshKeyId: string;
};

export const emptyGitDraft = (): GitDraft => ({
  provider: "github",
  label: "",
  baseUrl: "",
  token: "",
  gitTransport: "https",
  committerName: "",
  committerEmail: "",
  signCommits: false,
  sshKeyMode: "new",
  newKeyLabel: "",
  sshKeyId: "",
});

/**
 * Persist a {@link GitDraft} via the forge endpoint; returns id + public key.
 * On SSH transport with `sshKeyMode = "new"` a reusable SSH-key account is
 * generated first (via `generateKey`) and linked, so it shows up under Accounts.
 */
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
  }) => Promise<{ id: string; publicKey: string | null } | null>,
  generateKey: (label: string) => Promise<{ id: string; publicKey: string } | null>
): Promise<{ id: string; publicKey: string | null } | null> {
  let sshKeyId: string | null = null;
  if (d.gitTransport === "ssh") {
    if (d.sshKeyMode === "new") {
      const key = await generateKey(d.newKeyLabel || `${d.label || d.provider} key`);
      sshKeyId = key?.id ?? null;
    } else {
      sshKeyId = d.sshKeyId || null;
    }
  }
  return addForgeAccount({
    provider: d.provider,
    label: d.label || d.provider,
    baseUrl: d.baseUrl || undefined,
    token: d.token,
    gitTransport: d.gitTransport,
    committerName: d.committerName || undefined,
    committerEmail: d.committerEmail || undefined,
    signCommits: d.signCommits,
    sshKeyId,
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
        <span style={hint}>The bot username is detected from the token automatically.</span>
      </label>
      <label style={fieldLabel}>
        Git transport
        <select style={input} value={value.gitTransport} onChange={(e) => set({ gitTransport: e.target.value as "https" | "ssh" })}>
          <option value="https">HTTPS — token only (no SSH key)</option>
          <option value="ssh">SSH — set up an SSH key</option>
        </select>
        <span style={hint}>
          {value.gitTransport === "https"
            ? "Clones/pushes over HTTPS using the API token. Choose SSH to create or attach an SSH key."
            : "Clones/pushes over SSH — pick or create the key below."}
        </span>
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
              <input type="radio" checked={value.sshKeyMode === "new"} onChange={() => set({ sshKeyMode: "new" })} />
              Create a new SSH key
            </label>
            <label style={radio}>
              <input
                type="radio"
                checked={value.sshKeyMode === "existing"}
                onChange={() => set({ sshKeyMode: "existing" })}
                disabled={keys.length === 0}
              />
              Use an existing SSH key
            </label>
          </div>
          {value.sshKeyMode === "existing" ? (
            <select style={input} value={value.sshKeyId} onChange={(e) => set({ sshKeyId: e.target.value })}>
              <option value="">Select an SSH key…</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label} · {k.fingerprint}
                </option>
              ))}
            </select>
          ) : (
            <label style={fieldLabel}>
              New key label
              <input
                style={input}
                value={value.newKeyLabel}
                placeholder={`${value.label || value.provider} key`}
                onChange={(e) => set({ newKeyLabel: e.target.value })}
              />
            </label>
          )}
          <span style={hint}>The public key is shown after saving — add it to the forge.</span>
          <label style={radio}>
            <input type="checkbox" checked={value.signCommits} onChange={(e) => set({ signCommits: e.target.checked })} />
            SSH-sign commits
          </label>
        </div>
      )}
    </>
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
