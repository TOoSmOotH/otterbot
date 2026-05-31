import { useEffect, useState } from "react";
import type { SkillConfigSchema, SkillConfigField } from "@otterbot/shared";
import { apiFetch } from "../../lib/api";

/**
 * Schema-driven config form for a skill. Renders one input per field declared
 * in the `configSchema`, pre-fills from stored config (secrets masked), and
 * writes the values back. Reused for the per-agent skill config (install-time
 * prompt + "Configure" panel) and the global Settings → Secrets forms.
 *
 * By default it talks to the per-agent endpoint derived from `agentId`/`skillId`.
 * Pass `loadPath`/`savePath`/`saveMethod` to point it at another endpoint (e.g.
 * the global `/api/secrets/capability/:capId`).
 */
export function SkillConfigForm({
  agentId,
  skillId,
  schema,
  loadPath,
  savePath,
  saveMethod = "POST",
  savedMessage = "Saved — agent restarted.",
  onSaved,
}: {
  agentId?: string;
  skillId?: string;
  schema: SkillConfigSchema;
  loadPath?: string;
  savePath?: string;
  saveMethod?: "POST" | "PUT";
  savedMessage?: string;
  onSaved?: () => void;
}) {
  const getPath = loadPath ?? `/api/agents/${agentId}/skills/${skillId}/config`;
  const putPath = savePath ?? `/api/agents/${agentId}/skills/${skillId}/config`;
  const [values, setValues] = useState<Record<string, unknown>>(() => defaults(schema));
  const [secretsPresent, setSecretsPresent] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiFetch(getPath)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) {
          setLoaded(true);
          return;
        }
        setValues({ ...defaults(schema), ...(data.values ?? {}) });
        setSecretsPresent(data.secretsPresent ?? {});
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getPath]);

  const setField = (key: string, value: unknown) => {
    setValues((v) => ({ ...v, [key]: value }));
    setStatus("");
  };

  const save = async () => {
    setBusy(true);
    const res = await apiFetch(putPath, {
      method: saveMethod,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    setBusy(false);
    setStatus(res.ok ? savedMessage : "Failed to save.");
    if (res.ok) {
      // A saved secret is now present; clear the field so it shows the masked state.
      setSecretsPresent((p) => {
        const next = { ...p };
        for (const f of schema.fields) {
          if (f.secret && String(values[f.key] ?? "").trim()) next[f.key] = true;
        }
        return next;
      });
      setValues((v) => {
        const next = { ...v };
        for (const f of schema.fields) if (f.secret) next[f.key] = "";
        return next;
      });
      onSaved?.();
    }
  };

  if (!loaded) return <div style={hint}>Loading configuration…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
      {schema.description && <p style={hint}>{schema.description}</p>}
      {schema.fields.map((field) => (
        <FieldInput
          key={field.key}
          field={field}
          value={values[field.key]}
          secretPresent={secretsPresent[field.key]}
          onChange={(v) => setField(field.key, v)}
        />
      ))}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={() => void save()} disabled={busy} style={primary}>
          {busy ? "Saving…" : "Save configuration"}
        </button>
        {status && <span style={{ fontSize: 12, color: "rgb(var(--muted))" }}>{status}</span>}
      </div>
    </div>
  );
}

/** One field — a scalar input, a checkbox, or a repeatable list editor. */
function FieldInput({
  field,
  value,
  secretPresent,
  onChange,
}: {
  field: SkillConfigField;
  value: unknown;
  secretPresent?: boolean;
  onChange: (v: unknown) => void;
}) {
  if (field.type === "list") {
    return <ListEditor field={field} value={Array.isArray(value) ? value : []} onChange={onChange} />;
  }
  if (field.type === "boolean") {
    return (
      <label style={checkboxRow}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        {field.label}
        {field.description && <span style={hint}> — {field.description}</span>}
      </label>
    );
  }
  const isSecret = field.type === "secret";
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
      <span style={{ color: "rgb(var(--muted))" }}>
        {field.label}
        {field.required ? " *" : ""}
      </span>
      <input
        type={isSecret ? "password" : field.type === "number" ? "number" : "text"}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) =>
          onChange(field.type === "number" ? numberOrEmpty(e.target.value) : e.target.value)
        }
        placeholder={
          isSecret && secretPresent ? "•••••••• (set — leave blank to keep)" : field.placeholder
        }
        style={input}
      />
      {field.description && <span style={hint}>{field.description}</span>}
    </label>
  );
}

/** A repeatable array of sub-objects shaped by `field.itemFields`. */
function ListEditor({
  field,
  value,
  onChange,
}: {
  field: SkillConfigField;
  value: unknown[];
  onChange: (v: unknown[]) => void;
}) {
  const itemFields = field.itemFields ?? [];
  const setItem = (i: number, item: Record<string, unknown>) =>
    onChange(value.map((row, idx) => (idx === i ? item : row)));
  const removeItem = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const addItem = () => onChange([...value, emptyItem(itemFields)]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ color: "rgb(var(--muted))", fontSize: 12 }}>{field.label}</span>
      {field.description && <span style={hint}>{field.description}</span>}
      {value.length === 0 && <span style={hint}>None yet.</span>}
      {value.map((rawItem, i) => {
        const item = (rawItem ?? {}) as Record<string, unknown>;
        return (
          <div key={i} style={{ ...card, display: "flex", flexDirection: "column", gap: 6 }}>
            {itemFields.map((sub) => (
              <FieldInput
                key={sub.key}
                field={sub}
                value={item[sub.key]}
                onChange={(v) => setItem(i, { ...item, [sub.key]: v })}
              />
            ))}
            <button
              type="button"
              onClick={() => removeItem(i)}
              style={{ ...ghost, alignSelf: "flex-start", color: "#f87171" }}
            >
              Remove
            </button>
          </div>
        );
      })}
      <button type="button" onClick={addItem} style={{ ...ghost, alignSelf: "flex-start" }}>
        + Add {singular(field.label)}
      </button>
    </div>
  );
}

function defaults(schema: SkillConfigSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of schema.fields) out[f.key] = defaultFor(f);
  return out;
}

function defaultFor(field: SkillConfigField): unknown {
  switch (field.type) {
    case "boolean":
      return field.default ?? false;
    case "list":
      return [];
    default:
      return field.default ?? "";
  }
}

function emptyItem(itemFields: SkillConfigField[]): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const f of itemFields) o[f.key] = defaultFor(f);
  return o;
}

function numberOrEmpty(raw: string): number | string {
  if (raw.trim() === "") return "";
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

/** Best-effort singular of a list label for the "+ Add X" button. */
function singular(label: string): string {
  return label.toLowerCase().replace(/s$/, "");
}

const input: React.CSSProperties = {
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
  width: "100%",
};

const primary: React.CSSProperties = {
  background: "rgb(var(--accent))",
  color: "white",
  border: "none",
  padding: "7px 16px",
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  alignSelf: "flex-start",
};

const ghost: React.CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  padding: "3px 10px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 11,
};

const card: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: 10,
};

const hint: React.CSSProperties = {
  fontSize: 12,
  color: "rgb(var(--muted))",
  margin: 0,
  lineHeight: 1.5,
};

const checkboxRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
};
