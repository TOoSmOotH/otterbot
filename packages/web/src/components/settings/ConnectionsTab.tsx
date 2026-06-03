import { useEffect, useMemo, useState } from "react";
import type { SkillConfigField, SkillConfigSchema } from "@otterbot/shared";
import {
  useConnectionsStore,
  type ConnectionTypeDef,
  type CredentialTypeDef,
} from "../../stores/connections-store";
import { useProjectsStore } from "../../stores/projects-store";

/**
 * Settings → Connections. Define a reusable connector (type + config) that
 * references a named Credential, then assign it to agents in Agent Studio.
 */
export function ConnectionsTab() {
  const {
    connections,
    credentials,
    connectionTypes,
    credentialTypes,
    load,
    deleteConnection,
    deleteCredential,
  } = useConnectionsStore();
  const [adding, setAdding] = useState(false);

  useEffect(() => void load(), [load]);

  const credLabel = (id: string | null) =>
    id ? credentials.find((c) => c.id === id)?.label ?? "(missing)" : "—";
  const typeLabel = (type: string) =>
    connectionTypes.find((t) => t.type === type)?.label ?? type;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={hint}>
          Define a connector once and assign it to agents. Each connection references a credential
          you can reuse across connections.
        </p>
        {!adding && (
          <button style={primary} onClick={() => setAdding(true)}>
            + Add connection
          </button>
        )}
      </div>

      {adding && (
        <AddConnection
          connectionTypes={connectionTypes}
          credentialTypes={credentialTypes}
          onDone={() => setAdding(false)}
        />
      )}

      <section>
        <h4 style={sectionTitle}>Connections</h4>
        {connections.length === 0 && <p style={hint}>No connections yet.</p>}
        {connections.map((conn) => (
          <div key={conn.id} style={row}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: 600 }}>
                {conn.label} <span style={badge}>{typeLabel(conn.type)}</span>
              </span>
              <span style={hint}>
                credential: {credLabel(conn.credentialId)} ·{" "}
                {conn.assignedAgentIds.length
                  ? `assigned to ${conn.assignedAgentIds.length} agent(s)`
                  : "unassigned"}
              </span>
            </div>
            <button
              style={danger}
              onClick={async () => {
                const res = await deleteConnection(conn.id);
                if (!res.ok && res.error) {
                  if (confirm(`${res.error}\n\nForce delete and unassign everywhere?`)) {
                    await deleteConnection(conn.id, true);
                  }
                }
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </section>

      <section>
        <h4 style={sectionTitle}>Credentials</h4>
        {credentials.length === 0 && <p style={hint}>No credentials yet.</p>}
        {credentials.map((cred) => (
          <div key={cred.id} style={row}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: 600 }}>
                {cred.label} <span style={badge}>{cred.type}</span>
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
                const res = await deleteCredential(cred.id);
                if (!res.ok && res.error) {
                  if (confirm(`${res.error}\n\nForce delete anyway?`)) {
                    await deleteCredential(cred.id, true);
                  }
                }
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

/** Wizard: pick a type → choose/create a credential → fill connection config. */
function AddConnection({
  connectionTypes,
  credentialTypes,
  onDone,
}: {
  connectionTypes: ConnectionTypeDef[];
  credentialTypes: CredentialTypeDef[];
  onDone: () => void;
}) {
  const { credentials, createCredential, createConnection, busy, error } = useConnectionsStore();
  const forgeAccounts = useProjectsStore((s) => s.forgeAccounts);
  const loadForgeAccounts = useProjectsStore((s) => s.loadForgeAccounts);
  useEffect(() => { void loadForgeAccounts(); }, [loadForgeAccounts]);
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

  // Credentials compatible with the selected connection type.
  const compatibleCreds = credentials.filter((c) => c.type === def?.credentialType);

  const submit = async () => {
    if (!def) return;
    let credentialId: string | null = null;
    if (def.credentialType) {
      if (credMode === "existing") {
        credentialId = credId || compatibleCreds[0]?.id || null;
      } else if (credDef) {
        const created = await createCredential({
          type: credDef.type,
          label: credLabel || `${label || def.label} credential`,
          secrets: stringify(credValues),
        });
        credentialId = created?.id ?? null;
      }
    }
    const created = await createConnection({
      type: def.type,
      label: label || def.label,
      config,
      credentialId,
    });
    if (created) onDone();
  };

  return (
    <div style={card}>
      <label style={fieldLabel}>
        Type
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
        <input
          style={input}
          value={label}
          placeholder={def?.label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>

      {def?.credentialType && (
        <div style={{ ...card, background: "rgb(var(--bg))" }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 6 }}>
            <label style={radio}>
              <input
                type="radio"
                checked={credMode === "new"}
                onChange={() => setCredMode("new")}
              />
              New credential
            </label>
            <label style={radio}>
              <input
                type="radio"
                checked={credMode === "existing"}
                onChange={() => setCredMode("existing")}
                disabled={compatibleCreds.length === 0}
              />
              Use existing
            </label>
          </div>

          {credMode === "existing" ? (
            <select value={credId} onChange={(e) => setCredId(e.target.value)} style={input}>
              <option value="">Select a credential…</option>
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
                  Credential name
                  <input
                    style={input}
                    value={credLabel}
                    placeholder={`${credDef.label} credential`}
                    onChange={(e) => setCredLabel(e.target.value)}
                  />
                </label>
                <SchemaFields
                  schema={credDef.fieldSchema}
                  values={credValues}
                  onChange={setCredValues}
                />
              </>
            )
          )}
        </div>
      )}

      {def?.type === "github" && (
        <>
          <label style={fieldLabel}>
            Git account (token + SSH key)
            <select
              value={(config.gitAccountId as string) ?? ""}
              onChange={(e) => setConfig({ ...config, gitAccountId: e.target.value || undefined })}
              style={input}
            >
              <option value="">Token credential only (no git-over-SSH)</option>
              {forgeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.gitTransport === "ssh" ? "SSH" : "HTTPS — no SSH key"}
                </option>
              ))}
            </select>
          </label>
          {forgeAccounts.length === 0 && (
            <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>
              No Git accounts yet — add one in Settings → Credentials → Git account (Transport: SSH).
            </span>
          )}
        </>
      )}

      {def && (def.isChat ? (
        <ChatConfigFields config={config} onChange={setConfig} channelLabel={chatChannelLabel(def.type)} />
      ) : (
        <SchemaFields schema={def.configSchema} values={config} onChange={setConfig} />
      ))}

      {error && <span style={{ color: "tomato", fontSize: 12 }}>{error}</span>}
      <div style={{ display: "flex", gap: 8 }}>
        <button style={primary} disabled={busy} onClick={() => void submit()}>
          {busy ? "Saving…" : "Create connection"}
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

/** Bespoke chat-connection config (channel + access gates). */
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
