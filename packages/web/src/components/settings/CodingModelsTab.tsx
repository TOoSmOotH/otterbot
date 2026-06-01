import { useMemo, useState } from "react";
import type {
  CodingModelPreset,
  CodingToolId,
  GlobalSettings as GlobalSettingsShape,
  ProviderId,
  ProviderInfo,
} from "@otterbot/shared";
import { apiFetch } from "../../lib/api";
import { uniqueModelId } from "../../lib/model-id";

/**
 * Settings → Coding Models. Manage named, reusable per-tool model presets for
 * the coding CLIs (claude / codex / gemini / opencode). Each tool exposes
 * different knobs, so the editor is tool-aware:
 *   - claude / codex — model + reasoning effort
 *   - gemini — model
 *   - opencode — provider + model, sourced from the configured registry
 * Presets are assigned to agents (or project roles) and resolved into the
 * tool's flags at spawn time. Persisted within GlobalSettings via the save bar.
 */

const TOOLS: { id: CodingToolId; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "opencode", label: "OpenCode" },
];

/** Effort levels offered for the tools that support a reasoning knob. */
const EFFORTS = ["", "low", "medium", "high"];

type PatchFn = (p: Partial<GlobalSettingsShape>) => void;

interface AccountOption {
  provider: ProviderId;
  account: string;
  label: string;
}

export function CodingModelsTab({
  draft,
  patch,
  providers,
}: {
  draft: GlobalSettingsShape;
  patch: PatchFn;
  providers: ProviderInfo[];
}) {
  const presets = draft.codingModelPresets;

  // Every (provider, account) pair the user has configured — opencode presets
  // pick a model from one of these (reusing the existing model registry).
  const accountOptions = useMemo<AccountOption[]>(() => {
    const out: AccountOption[] = [];
    for (const info of providers) {
      if (!info.supportsChat) continue;
      for (const acc of draft.providers[info.id] ?? []) {
        out.push({ provider: info.id, account: acc.account, label: `${info.label} · ${acc.account}` });
      }
    }
    return out;
  }, [providers, draft.providers]);

  const updatePreset = (id: string, p: Partial<CodingModelPreset>) =>
    patch({ codingModelPresets: presets.map((m) => (m.id === id ? { ...m, ...p } : m)) });

  const deletePreset = (m: CodingModelPreset) => {
    if (!window.confirm(`Delete preset "${m.label}"? Agents assigned to it fall back to the tool default.`))
      return;
    patch({ codingModelPresets: presets.filter((x) => x.id !== m.id) });
  };

  const addPreset = (m: CodingModelPreset) => patch({ codingModelPresets: [...presets, m] });

  const [adding, setAdding] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section style={section}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={h2}>Coding Models</h2>
          <button onClick={() => setAdding(true)} style={ghostButton}>
            + Add preset
          </button>
        </div>
        <p style={hint}>
          Named model presets for the coding CLIs. Each carries a tool plus its model and
          (where supported) reasoning effort. Assign a preset to an agent in its{" "}
          <strong>Coding CLI</strong> capability config, or to project roles when creating a team —
          so e.g. two OpenCode agents can run different models.
        </p>

        {adding && (
          <AddPresetForm
            accounts={accountOptions}
            existingIds={presets.map((m) => m.id)}
            onCancel={() => setAdding(false)}
            onAdd={(m) => {
              addPreset(m);
              setAdding(false);
            }}
          />
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {presets.length === 0 && !adding && <p style={hint}>No presets configured yet.</p>}
          {presets.map((m) => (
            <PresetCard
              key={m.id}
              preset={m}
              accounts={accountOptions}
              onPatch={(p) => updatePreset(m.id, p)}
              onDelete={() => deletePreset(m)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

/** A short, human description of a preset's effective model selection. */
function describePreset(m: CodingModelPreset): string {
  if (m.tool === "opencode") return m.providerModel || "tool default";
  const bits = [m.model || "tool default"];
  if (m.effort) bits.push(`effort: ${m.effort}`);
  return bits.join(" · ");
}

function PresetCard({
  preset,
  accounts,
  onPatch,
  onDelete,
}: {
  preset: CodingModelPreset;
  accounts: AccountOption[];
  onPatch: (p: Partial<CodingModelPreset>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const toolLabel = TOOLS.find((t) => t.id === preset.tool)?.label ?? preset.tool;
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{preset.label}</div>
          <div style={{ fontSize: 11, color: "rgb(var(--muted))" }}>
            {toolLabel} — {describePreset(preset)}
          </div>
        </div>
        <button onClick={() => setEditing((e) => !e)} style={ghostButton}>
          {editing ? "Done" : "Edit"}
        </button>
        <button onClick={onDelete} style={{ ...ghostButton, color: "rgb(var(--danger))" }}>
          Delete
        </button>
      </div>
      {editing && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <Field label="Name">
            <input value={preset.label} onChange={(e) => onPatch({ label: e.target.value })} style={input} />
          </Field>
          <ToolFields
            tool={preset.tool}
            value={preset}
            accounts={accounts}
            onChange={(p) => onPatch(p)}
          />
        </div>
      )}
    </div>
  );
}

function AddPresetForm({
  accounts,
  existingIds,
  onCancel,
  onAdd,
}: {
  accounts: AccountOption[];
  existingIds: string[];
  onCancel: () => void;
  onAdd: (m: CodingModelPreset) => void;
}) {
  const [tool, setTool] = useState<CodingToolId>("claude");
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<Partial<CodingModelPreset>>({});

  const submit = () => {
    const name = label.trim() || defaultLabel(tool, fields);
    onAdd({
      id: uniqueModelId(existingIds, name),
      label: name,
      tool,
      ...cleanFields(tool, fields),
    });
  };

  return (
    <div style={panel}>
      <strong style={{ fontSize: 13 }}>Add a coding-model preset</strong>
      <Field label="Tool">
        <select
          value={tool}
          onChange={(e) => {
            setTool(e.target.value as CodingToolId);
            setFields({});
          }}
          style={input}
        >
          {TOOLS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Name">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={defaultLabel(tool, fields)}
          style={input}
        />
      </Field>
      <ToolFields tool={tool} value={fields} accounts={accounts} onChange={(p) => setFields((f) => ({ ...f, ...p }))} />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={submit} style={primary}>
          Add preset
        </button>
        <button onClick={onCancel} style={ghostButton}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The tool-specific knob inputs shared by the add form and the edit panel. */
function ToolFields({
  tool,
  value,
  accounts,
  onChange,
}: {
  tool: CodingToolId;
  value: Partial<CodingModelPreset>;
  accounts: AccountOption[];
  onChange: (p: Partial<CodingModelPreset>) => void;
}) {
  if (tool === "opencode") {
    return <OpencodeFields value={value} accounts={accounts} onChange={onChange} />;
  }
  const supportsEffort = tool === "claude" || tool === "codex";
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Field label="Model">
        <input
          value={value.model ?? ""}
          onChange={(e) => onChange({ model: e.target.value })}
          placeholder={tool === "claude" ? "opus | sonnet | haiku | id" : "model id (blank = default)"}
          style={{ ...input, minWidth: 200 }}
        />
      </Field>
      {supportsEffort && (
        <Field label="Reasoning effort">
          <select
            value={value.effort ?? ""}
            onChange={(e) => onChange({ effort: e.target.value })}
            style={{ ...input, width: 150 }}
          >
            {EFFORTS.map((e) => (
              <option key={e} value={e}>
                {e || "— default —"}
              </option>
            ))}
          </select>
        </Field>
      )}
    </div>
  );
}

/**
 * OpenCode preset fields: pick a provider/account from the registry, list its
 * models, and store the resolved `provider/model` string. The user may also type
 * the `provider/model` string directly (e.g. for an opencode-native provider).
 */
function OpencodeFields({
  value,
  accounts,
  onChange,
}: {
  value: Partial<CodingModelPreset>;
  accounts: AccountOption[];
  onChange: (p: Partial<CodingModelPreset>) => void;
}) {
  const [pair, setPair] = useState(`${accounts[0]?.provider ?? ""}|${accounts[0]?.account ?? ""}`);
  const [provider, account] = pair.split("|");
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [note, setNote] = useState("");

  const listModels = async () => {
    setFetching(true);
    setNote("");
    setModels([]);
    try {
      const res = await apiFetch("/api/provider-models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, account }),
      });
      const data = (await res.json()) as { ok: boolean; models?: string[]; error?: string };
      if (data.ok && data.models?.length) {
        setModels(data.models);
        setNote(`Found ${data.models.length} model(s).`);
      } else {
        setNote(`${data.error ?? "Couldn't list models"} — type the model id below.`);
      }
    } catch (err) {
      setNote(`${err instanceof Error ? err.message : String(err)} — type the model id below.`);
    } finally {
      setFetching(false);
    }
  };

  // Map an Otterbot provider + model id to the opencode "provider/model" string.
  const setFromModel = (modelId: string) => {
    onChange({ providerModel: modelId ? `${provider}/${modelId}` : "", registryModelId: undefined });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {accounts.length > 0 ? (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label="Provider account">
            <select value={pair} onChange={(e) => setPair(e.target.value)} style={{ ...input, minWidth: 200 }}>
              {accounts.map((a) => (
                <option key={`${a.provider}|${a.account}`} value={`${a.provider}|${a.account}`}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
          <button onClick={() => void listModels()} disabled={fetching || !provider} style={ghostButton}>
            {fetching ? "Listing…" : "List models"}
          </button>
        </div>
      ) : (
        <p style={hint}>No chat providers configured — add one in the Providers tab, or type a provider/model string below.</p>
      )}
      {note && <span style={{ fontSize: 12, color: "rgb(var(--muted))" }}>{note}</span>}
      {models.length > 0 && (
        <Field label="Model">
          <select value="" onChange={(e) => setFromModel(e.target.value)} style={input}>
            <option value="">— pick from {models.length} model(s) —</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="provider/model">
        <input
          value={value.providerModel ?? ""}
          onChange={(e) => onChange({ providerModel: e.target.value })}
          placeholder="e.g. anthropic/claude-sonnet-4-6 or ollama/llama3"
          style={input}
        />
      </Field>
    </div>
  );
}

function defaultLabel(tool: CodingToolId, f: Partial<CodingModelPreset>): string {
  const toolLabel = TOOLS.find((t) => t.id === tool)?.label ?? tool;
  if (tool === "opencode") return f.providerModel ? `${toolLabel} · ${f.providerModel}` : toolLabel;
  const bits = [toolLabel];
  if (f.model) bits.push(f.model);
  if (f.effort) bits.push(f.effort);
  return bits.join(" · ");
}

/** Keep only the fields meaningful for the tool, dropping blanks. */
function cleanFields(tool: CodingToolId, f: Partial<CodingModelPreset>): Partial<CodingModelPreset> {
  if (tool === "opencode") {
    return {
      ...(f.providerModel?.trim() ? { providerModel: f.providerModel.trim() } : {}),
      ...(f.registryModelId ? { registryModelId: f.registryModelId } : {}),
    };
  }
  const supportsEffort = tool === "claude" || tool === "codex";
  return {
    ...(f.model?.trim() ? { model: f.model.trim() } : {}),
    ...(supportsEffort && f.effort?.trim() ? { effort: f.effort.trim() } : {}),
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
      <span style={{ color: "rgb(var(--muted))" }}>{label}</span>
      {children}
    </label>
  );
}

const section: React.CSSProperties = {
  background: "rgb(var(--surface))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 10,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const h2: React.CSSProperties = { margin: 0, fontSize: 15 };

const hint: React.CSSProperties = {
  fontSize: 12,
  color: "rgb(var(--muted))",
  margin: 0,
  lineHeight: 1.5,
};

const card: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: 12,
};

const panel: React.CSSProperties = {
  border: "1px solid rgb(var(--border-strong))",
  borderRadius: 8,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  background: "rgb(var(--surface-sunken))",
};

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
};

const ghostButton: React.CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  padding: "5px 12px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
};
