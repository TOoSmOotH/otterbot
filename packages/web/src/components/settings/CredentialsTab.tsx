import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Icon } from "../ui/Icon";
import type { CredentialScope, SkillConfigSchema } from "@otterbot/shared";
import { apiFetch } from "../../lib/api";
import { useProjectsStore } from "../../stores/projects-store";
import { useSecretsStore } from "../../stores/secrets-store";
import { GitCredWizard, ForgeAccountRow } from "./GitCredsTab";
import { SkillConfigForm } from "../agents/SkillConfigForm";

/** A builtin capability surfaced as a structured credential type. */
type CapId = "proxmox" | "ssh";
const CAPS: Record<CapId, { label: string; blurb: string }> = {
  proxmox: { label: "Proxmox", blurb: "Proxmox VE host, API token, and VM allowlist." },
  ssh: { label: "SSH host", blurb: "SSH host allowlist (host, user, port) and optional sudo." },
};

/**
 * Settings → Credentials. One place to manage every instance-wide credential
 * agents share: git accounts (forge), structured integrations (Proxmox, SSH),
 * and generic key/value secrets. A single "Add" wizard picks the type. Secret
 * values are never shown back — only names, scopes, and type. A credential's
 * scope controls exposure: `direct` never reaches an agent's shell or the LLM.
 */
export function CredentialsTab() {
  const accounts = useProjectsStore((s) => s.forgeAccounts);
  const loadForge = useProjectsStore((s) => s.loadForgeAccounts);
  const delForge = useProjectsStore((s) => s.deleteForgeAccount);

  const keys = useSecretsStore((s) => s.keys);
  const loadSecrets = useSecretsStore((s) => s.load);
  const setScope = useSecretsStore((s) => s.setScope);
  const removeSecret = useSecretsStore((s) => s.remove);
  const busy = useSecretsStore((s) => s.busy);

  const [adding, setAdding] = useState(false);
  const [editCap, setEditCap] = useState<CapId | null>(null);

  useEffect(() => {
    void loadForge();
    void loadSecrets();
  }, [loadForge, loadSecrets]);

  const reload = () => {
    void loadForge();
    void loadSecrets();
  };

  const proxmoxConfigured = keys.some((k) => k.key === "PROXMOX_HOST");
  const sshConfigured = keys.some((k) => k.key === "SSH_HOSTS");
  // Generic secrets exclude the keys owned by the structured forms above.
  const genericRows = useMemo(
    () => keys.filter((k) => !k.key.startsWith("PROXMOX_") && !k.key.startsWith("SSH_")),
    [keys]
  );

  const isEmpty =
    accounts.length === 0 && !proxmoxConfigured && !sshConfigured && genericRows.length === 0;

  const removeCapKeys = async (capId: CapId) => {
    const prefix = capId === "proxmox" ? "PROXMOX_" : "SSH_";
    for (const k of keys.filter((x) => x.key.startsWith(prefix))) await removeSecret(k.key);
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Credentials</h3>
        <span style={{ flex: 1 }} />
        <button style={ghostBtn} onClick={() => setAdding(true)}>
          <Icon icon={Plus} size={14} /> Add
        </button>
      </div>
      <p style={{ color: "rgb(var(--muted))", fontSize: 12, marginTop: 4 }}>
        Credentials shared by every agent — git accounts, integrations, and secrets. Stored
        encrypted and never shown back. A secret&apos;s <strong>scope</strong> decides where it can
        be used: <em>Direct</em> (integrations only — never the shell or the LLM), <em>Shell</em>, or{" "}
        <em>Capability</em> (shell, only while that capability is enabled).
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        {isEmpty && <span style={{ color: "rgb(var(--muted))", fontSize: 12 }}>None configured.</span>}

        {accounts.map((a) => (
          <div key={a.id} style={listItem}>
            <TypeBadge>Git</TypeBadge>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ForgeAccountRow account={a} onDelete={() => void delForge(a.id)} />
            </div>
          </div>
        ))}

        {proxmoxConfigured && (
          <CapRow
            capId="proxmox"
            subtitle="Configured"
            onEdit={() => setEditCap("proxmox")}
            onDelete={() => void removeCapKeys("proxmox")}
            disabled={busy}
          />
        )}
        {sshConfigured && (
          <CapRow
            capId="ssh"
            subtitle="Configured"
            onEdit={() => setEditCap("ssh")}
            onDelete={() => void removeCapKeys("ssh")}
            disabled={busy}
          />
        )}

        {genericRows.map((row) => (
          <div key={row.key} style={listItem}>
            <TypeBadge>Secret</TypeBadge>
            <div style={{ ...rowBox, flex: 1 }}>
              <code style={{ fontSize: 13, flex: 1, wordBreak: "break-all" }}>{row.key}</code>
              <ScopePicker
                value={row.scope}
                disabled={busy}
                onChange={(s) => void setScope(row.key, s)}
              />
              <button style={chipX} disabled={busy} title="Delete" onClick={() => void removeSecret(row.key)}>
                <Icon icon={X} size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {adding && (
        <AddCredentialWizard
          onClose={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
      {editCap && (
        <CapabilityModal
          capId={editCap}
          onClose={() => {
            setEditCap(null);
            reload();
          }}
          onSaved={reload}
        />
      )}
    </div>
  );
}

/** A configured-integration row (Proxmox / SSH) with edit + delete. */
function CapRow({
  capId,
  subtitle,
  onEdit,
  onDelete,
  disabled,
}: {
  capId: CapId;
  subtitle: string;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  return (
    <div style={listItem}>
      <TypeBadge>{CAPS[capId].label}</TypeBadge>
      <div style={{ ...rowBox, flex: 1 }}>
        <span style={{ fontSize: 13, flex: 1 }}>
          {CAPS[capId].label}
          {subtitle && <span style={{ color: "rgb(var(--muted))", fontSize: 11 }}> · {subtitle}</span>}
        </span>
        <button style={ghostSm} disabled={disabled} onClick={onEdit}>
          Edit
        </button>
        <button style={chipX} disabled={disabled} title="Delete" onClick={onDelete}>
          <Icon icon={X} size={14} />
        </button>
      </div>
    </div>
  );
}

/** Add wizard: step 1 picks the credential type, then routes to its form. */
function AddCredentialWizard({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<"git" | CapId | "generic" | null>(null);

  if (type === "git") return <GitCredWizard onClose={onClose} />;
  if (type === "proxmox" || type === "ssh")
    return <CapabilityModal capId={type} onClose={onClose} onSaved={() => {}} />;
  if (type === "generic") return <GenericSecretModal onClose={onClose} />;

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={h2}>Add a credential</h2>
        <p style={hint}>What kind of credential do you want to add?</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          <ChoiceBtn label="Git account" blurb="GitHub / Gitea — token, transport, commit signing." onClick={() => setType("git")} />
          <ChoiceBtn label="Proxmox" blurb={CAPS.proxmox.blurb} onClick={() => setType("proxmox")} />
          <ChoiceBtn label="SSH host" blurb={CAPS.ssh.blurb} onClick={() => setType("ssh")} />
          <ChoiceBtn label="Generic secret" blurb="Any KEY=value with a scope." onClick={() => setType("generic")} />
        </div>
        <div style={actions}>
          <button style={ghostBtn} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ChoiceBtn({ label, blurb, onClick }: { label: string; blurb: string; onClick: () => void }) {
  return (
    <button style={choice} onClick={onClick}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>{blurb}</span>
    </button>
  );
}

/** Modal wrapper around the schema-driven config form for a builtin capability. */
function CapabilityModal({
  capId,
  onClose,
  onSaved,
}: {
  capId: CapId;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [schema, setSchema] = useState<SkillConfigSchema | null>(null);
  const [loaded, setLoaded] = useState(false);
  const path = `/api/secrets/capability/${capId}`;

  useEffect(() => {
    let cancelled = false;
    void apiFetch(path)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { schema?: SkillConfigSchema } | null) => {
        if (cancelled) return;
        setSchema(data?.schema ?? null);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={h2}>{CAPS[capId].label}</h2>
        {!loaded && <p style={hint}>Loading…</p>}
        {loaded && !schema && <p style={hint}>Configuration is unavailable.</p>}
        {schema && (
          <SkillConfigForm
            schema={schema}
            loadPath={path}
            savePath={path}
            saveMethod="PUT"
            savedMessage="Saved — all agents restarted."
            onSaved={onSaved}
          />
        )}
        <div style={actions}>
          <button style={ghostBtn} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Modal to add a single generic KEY=value secret with a scope. */
function GenericSecretModal({ onClose }: { onClose: () => void }) {
  const upsert = useSecretsStore((s) => s.upsert);
  const busy = useSecretsStore((s) => s.busy);
  const error = useSecretsStore((s) => s.error);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<CredentialScope>("broad");

  const save = async () => {
    if (await upsert(key, value, scope)) onClose();
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={h2}>Add a secret</h2>
        <label style={lbl}>Key</label>
        <input style={input} placeholder="e.g. CLOUDFLARE_API_TOKEN" value={key} onChange={(e) => setKey(e.target.value)} />
        <label style={lbl}>Value</label>
        <input style={input} type="password" placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} />
        <label style={lbl}>Scope</label>
        <ScopePicker value={scope} disabled={busy} onChange={setScope} />
        {error && <div style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>{error}</div>}
        <div style={actions}>
          <button style={ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button style={primaryBtn} disabled={busy || !key.trim()} onClick={() => void save()}>
            {busy ? "Saving…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Pick a credential scope. "Capability" reveals a text input for the capability
 * id(s), producing a `cap:<id>` scope; the other two map directly. Holds local
 * draft state so typing a capability id works inline, and never emits a bare
 * `cap:` (which the server rejects).
 */
function ScopePicker({
  value,
  disabled,
  onChange,
}: {
  value: CredentialScope;
  disabled?: boolean;
  onChange: (scope: CredentialScope) => void;
}) {
  const [kind, setKind] = useState<"direct" | "broad" | "cap">(
    value.startsWith("cap:") ? "cap" : (value as "direct" | "broad")
  );
  const [capIds, setCapIds] = useState(value.startsWith("cap:") ? value.slice(4) : "");

  useEffect(() => {
    setKind(value.startsWith("cap:") ? "cap" : (value as "direct" | "broad"));
    setCapIds(value.startsWith("cap:") ? value.slice(4) : "");
  }, [value]);

  const emitCap = (raw: string) => {
    const ids = raw.trim();
    if (ids) onChange(`cap:${ids}` as CredentialScope);
  };

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <select
        style={select}
        disabled={disabled}
        value={kind}
        onChange={(e) => {
          const next = e.target.value as "direct" | "broad" | "cap";
          setKind(next);
          if (next === "cap") emitCap(capIds);
          else onChange(next);
        }}
      >
        <option value="direct">Direct</option>
        <option value="broad">Shell</option>
        <option value="cap">Capability…</option>
      </select>
      {kind === "cap" && (
        <input
          style={{ ...input, width: 150 }}
          placeholder="capability id(s)"
          value={capIds}
          disabled={disabled}
          onChange={(e) => setCapIds(e.target.value)}
          onBlur={(e) => emitCap(e.target.value)}
        />
      )}
    </span>
  );
}

function TypeBadge({ children }: { children: React.ReactNode }) {
  return <span style={typeBadge}>{children}</span>;
}

const listItem: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center" };
const rowBox: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "6px 8px",
};
const typeBadge: React.CSSProperties = {
  flex: "0 0 auto",
  width: 64,
  textAlign: "center",
  fontSize: 10,
  fontWeight: 600,
  color: "rgb(var(--muted))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 4,
  padding: "2px 4px",
};
const input: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
};
const select: React.CSSProperties = { ...input, width: "auto", padding: "6px 6px" };
const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, margin: "10px 0 2px" };
const hint: React.CSSProperties = { color: "rgb(var(--muted))", fontSize: 12, marginTop: 4 };
const h2: React.CSSProperties = { margin: "0 0 4px", fontSize: 16, fontWeight: 600 };
const actions: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 };
const choice: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  textAlign: "left",
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: "10px 12px",
  cursor: "pointer",
};
const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};
const modal: React.CSSProperties = {
  width: "min(92vw, 520px)",
  maxHeight: "86vh",
  overflowY: "auto",
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 10,
  padding: 18,
  boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
};
const primaryBtn: React.CSSProperties = {
  background: "rgb(var(--accent))",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "7px 14px",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
const ghostBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "6px 12px",
  cursor: "pointer",
  fontSize: 12,
};
const ghostSm: React.CSSProperties = { ...ghostBtn, padding: "4px 10px" };
const chipX: React.CSSProperties = {
  display: "inline-flex",
  background: "transparent",
  border: "none",
  color: "rgb(var(--muted))",
  cursor: "pointer",
  padding: 0,
};
