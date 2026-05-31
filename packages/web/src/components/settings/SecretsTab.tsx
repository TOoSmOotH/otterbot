import { useEffect, useMemo, useState } from "react";
import type { CredentialScope, SkillConfigSchema } from "@otterbot/shared";
import { apiFetch } from "../../lib/api";
import { useSecretsStore } from "../../stores/secrets-store";
import { SkillConfigForm } from "../agents/SkillConfigForm";

/**
 * Settings → Secrets. Instance-wide credentials shared by every agent: a
 * structured Proxmox form plus a generic key/value store. Values are never
 * returned by the server (only keys + scopes), and the credential `scope`
 * controls exposure — `direct` secrets never reach an agent's shell or the LLM.
 * Git credentials live in their own specialised tab.
 */
export function SecretsTab() {
  return (
    <div style={{ maxWidth: 680, display: "flex", flexDirection: "column", gap: 28 }}>
      <header>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Secrets</h3>
        <p style={hint}>
          Credentials shared by every agent. They are stored encrypted and are never shown back —
          only their names and exposure scope. A secret&apos;s <strong>scope</strong> decides where
          it can be used:{" "}
          <em>Direct</em> (structured integrations only — never the shell or the LLM),{" "}
          <em>Shell</em> (available to an agent&apos;s shell commands), or{" "}
          <em>Capability</em> (shell, but only while that capability is enabled). For git
          credentials, use the <strong>Git Creds</strong> tab.
        </p>
      </header>

      <ProxmoxSection />
      <GenericSecretsSection />
    </div>
  );
}

/** Structured Proxmox connection form, reusing the capability config schema. */
function ProxmoxSection() {
  const [schema, setSchema] = useState<SkillConfigSchema | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiFetch("/api/secrets/proxmox")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { schema?: SkillConfigSchema } | null) => {
        if (cancelled) return;
        setSchema(data?.schema ?? null);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <h4 style={sectionTitle}>Proxmox</h4>
      {!loaded && <p style={hint}>Loading…</p>}
      {loaded && !schema && <p style={hint}>Proxmox configuration is unavailable.</p>}
      {schema && (
        <SkillConfigForm
          schema={schema}
          loadPath="/api/secrets/proxmox"
          savePath="/api/secrets/proxmox"
          saveMethod="PUT"
          savedMessage="Saved — all agents restarted."
        />
      )}
    </section>
  );
}

/** Generic add/list/delete for arbitrary KEY=value secrets with a scope. */
function GenericSecretsSection() {
  const keys = useSecretsStore((s) => s.keys);
  const load = useSecretsStore((s) => s.load);
  const upsert = useSecretsStore((s) => s.upsert);
  const setScope = useSecretsStore((s) => s.setScope);
  const remove = useSecretsStore((s) => s.remove);
  const busy = useSecretsStore((s) => s.busy);
  const error = useSecretsStore((s) => s.error);

  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newScope, setNewScope] = useState<CredentialScope>("broad");

  useEffect(() => {
    void load();
  }, [load]);

  // Proxmox keys are managed by the structured form above — hide them here so
  // the two surfaces don't fight over the same credentials.
  const rows = useMemo(() => keys.filter((k) => !k.key.startsWith("PROXMOX_")), [keys]);

  const add = async () => {
    const ok = await upsert(newKey, newValue, newScope);
    if (ok) {
      setNewKey("");
      setNewValue("");
      setNewScope("broad");
    }
  };

  return (
    <section>
      <h4 style={sectionTitle}>Other secrets</h4>
      <p style={hint}>
        Any credential an agent&apos;s tools or shell commands need — API tokens, passwords,
        endpoints.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        {rows.length === 0 && <span style={hint}>None configured.</span>}
        {rows.map((row) => (
          <div key={row.key} style={card}>
            <code style={{ fontSize: 13, flex: 1, wordBreak: "break-all" }}>{row.key}</code>
            <ScopePicker value={row.scope} disabled={busy} onChange={(s) => void setScope(row.key, s)} />
            <button
              type="button"
              style={{ ...ghost, color: "#f87171" }}
              disabled={busy}
              onClick={() => void remove(row.key)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <div style={{ ...card, flexDirection: "column", alignItems: "stretch", gap: 8, marginTop: 12 }}>
        <span style={{ color: "rgb(var(--muted))", fontSize: 12, fontWeight: 600 }}>Add secret</span>
        <input
          style={input}
          placeholder="KEY (e.g. CLOUDFLARE_API_TOKEN)"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <input
          style={input}
          type="password"
          placeholder="value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ScopePicker value={newScope} disabled={busy} onChange={setNewScope} />
          <span style={{ flex: 1 }} />
          <button style={primary} disabled={busy || !newKey.trim()} onClick={() => void add()}>
            {busy ? "Saving…" : "Add"}
          </button>
        </div>
        {error && <span style={{ fontSize: 12, color: "#f87171" }}>{error}</span>}
      </div>
    </section>
  );
}

/**
 * Pick a credential scope. "Capability" reveals a text input for the capability
 * id(s), producing a `cap:<id>` scope; the other two map directly. Holds local
 * draft state so typing a capability id works inline (the committed `value` only
 * updates once a complete scope is emitted), and never emits a bare `cap:`.
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

  // Re-sync when the committed value changes underneath us (e.g. after reload).
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

const hint: React.CSSProperties = {
  fontSize: 12,
  color: "rgb(var(--muted))",
  margin: "4px 0 0",
  lineHeight: 1.6,
};

const sectionTitle: React.CSSProperties = { margin: "0 0 2px", fontSize: 13, fontWeight: 600 };

const card: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: 10,
};

const input: React.CSSProperties = {
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
};

const select: React.CSSProperties = { ...input, padding: "6px 6px" };

const primary: React.CSSProperties = {
  background: "rgb(var(--accent))",
  color: "white",
  border: "none",
  padding: "7px 16px",
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const ghost: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgb(var(--border))",
  padding: "4px 10px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
};
