import { useState, useEffect, useMemo } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settings-store";
import { useModelPackStore } from "../../stores/model-pack-store";
import type { RegistryEntry, GearConfig } from "@smoothbot/shared";
import { CharacterSelect } from "../character-select/CharacterSelect";
import { ModelCombobox } from "./ModelCombobox";

export function AgentTemplatesTab() {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [selected, setSelected] = useState<RegistryEntry | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    systemPrompt: "",
    promptAddendum: "" as string,
    capabilities: "",
    defaultModel: "",
    defaultProvider: "anthropic",
    tools: "",
    modelPackId: null as string | null,
    gearConfig: null as GearConfig | null,
  });

  const providers = useSettingsStore((s) => s.providers);
  const models = useSettingsStore((s) => s.models);
  const fetchModels = useSettingsStore((s) => s.fetchModels);
  const modelPacks = useModelPackStore((s) => s.packs);
  const loadPacks = useModelPackStore((s) => s.loadPacks);

  useEffect(() => {
    loadEntries();
    loadPacks();
  }, []);

  // Fetch models when the selected provider changes
  useEffect(() => {
    if (form.defaultProvider && !models[form.defaultProvider]) {
      fetchModels(form.defaultProvider);
    }
  }, [form.defaultProvider]);

  const loadEntries = async () => {
    const res = await fetch("/api/registry");
    const data = await res.json();
    setEntries(data);
  };

  const grouped = useMemo(() => {
    const core = entries.filter(
      (e) => e.builtIn && (e.role === "coo" || e.role === "team_lead"),
    );
    const workers = entries.filter((e) => e.builtIn && e.role === "worker");
    const custom = entries.filter((e) => !e.builtIn);
    return { core, workers, custom };
  }, [entries]);

  const selectEntry = (entry: RegistryEntry) => {
    setSelected(entry);
    setForm({
      name: entry.name,
      description: entry.description,
      systemPrompt: entry.systemPrompt,
      promptAddendum: entry.promptAddendum ?? "",
      capabilities: entry.capabilities.join(", "),
      defaultModel: entry.defaultModel,
      defaultProvider: entry.defaultProvider,
      tools: entry.tools.join(", "),
      modelPackId: entry.modelPackId ?? null,
      gearConfig: entry.gearConfig ?? null,
    });
    setEditing(false);
  };

  const isCooClone = selected != null && !selected.builtIn && selected.role === "coo";

  const builtInCooPrompt = useMemo(() => {
    const builtInCoo = entries.find((e) => e.builtIn && e.role === "coo");
    return builtInCoo?.systemPrompt ?? "";
  }, [entries]);

  const saveEntry = async () => {
    if (!selected) return;

    const body: Record<string, unknown> = {
      name: form.name,
      description: form.description,
      systemPrompt: form.systemPrompt,
      capabilities: form.capabilities
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      defaultModel: form.defaultModel,
      defaultProvider: form.defaultProvider,
      tools: form.tools
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      modelPackId: form.modelPackId,
      gearConfig: form.gearConfig,
    };

    // For COO clones, send promptAddendum (empty string → null)
    if (isCooClone) {
      body.promptAddendum = form.promptAddendum.trim() || null;
    }

    await fetch(`/api/registry/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    await loadEntries();
    setEditing(false);
  };

  const addEntry = async () => {
    const body = {
      name: "New Agent",
      description: "Description",
      systemPrompt: "You are a helpful assistant.",
      capabilities: [],
      defaultModel: "claude-sonnet-4-5-20250929",
      defaultProvider: "anthropic",
      tools: [],
    };

    const res = await fetch("/api/registry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const newEntry = await res.json();
    await loadEntries();
    selectEntry(newEntry);
    setEditing(true);
  };

  const cloneEntry = async (id: string) => {
    const res = await fetch(`/api/registry/${id}/clone`, { method: "POST" });
    if (!res.ok) return;
    const cloned = await res.json();
    await loadEntries();
    selectEntry(cloned);
    setEditing(true);
  };

  const deleteEntry = async () => {
    if (!selected) return;
    await fetch(`/api/registry/${selected.id}`, { method: "DELETE" });
    setSelected(null);
    await loadEntries();
  };

  const clonedFromName = useMemo(() => {
    if (!selected?.clonedFromId) return null;
    const source = entries.find((e) => e.id === selected.clonedFromId);
    return source?.name ?? null;
  }, [selected, entries]);

  return (
    <div className="flex flex-1 overflow-hidden" style={{ minHeight: "400px" }}>
      {/* Left: Entry list */}
      <div className="w-[240px] border-r border-border overflow-y-auto">
        <div className="p-2">
          <button
            onClick={addEntry}
            className="w-full text-xs text-center py-1.5 rounded-md border border-dashed border-border hover:border-primary/50 hover:text-primary transition-colors"
          >
            + New Custom Template
          </button>
        </div>

        {grouped.core.length > 0 && (
          <SidebarGroup label="Core">
            {grouped.core.map((entry) => (
              <SidebarItem
                key={entry.id}
                entry={entry}
                selected={selected?.id === entry.id}
                onClick={() => selectEntry(entry)}
              />
            ))}
          </SidebarGroup>
        )}

        {grouped.workers.length > 0 && (
          <SidebarGroup label="Workers">
            {grouped.workers.map((entry) => (
              <SidebarItem
                key={entry.id}
                entry={entry}
                selected={selected?.id === entry.id}
                onClick={() => selectEntry(entry)}
              />
            ))}
          </SidebarGroup>
        )}

        {grouped.custom.length > 0 && (
          <SidebarGroup label="Custom">
            {grouped.custom.map((entry) => (
              <SidebarItem
                key={entry.id}
                entry={entry}
                selected={selected?.id === entry.id}
                onClick={() => selectEntry(entry)}
              />
            ))}
          </SidebarGroup>
        )}
      </div>

      {/* Right: Detail/Edit */}
      <div className="flex-1 overflow-y-auto p-5">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Select an agent template to view or edit
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{form.name}</h3>
                {selected.builtIn && (
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                    Built-in
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {editing ? (
                  <>
                    <button
                      onClick={saveEntry}
                      className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded-md hover:bg-primary/90"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditing(false);
                        if (selected) selectEntry(selected);
                      }}
                      className="text-xs text-muted-foreground px-3 py-1 rounded-md hover:bg-secondary"
                    >
                      Cancel
                    </button>
                  </>
                ) : selected.builtIn ? (
                  // Built-in COO: no Clone (it's a singleton); other built-ins: allow Clone
                  selected.role === "coo" ? null : (
                    <button
                      onClick={() => cloneEntry(selected.id)}
                      className="text-xs bg-secondary text-foreground px-3 py-1 rounded-md hover:bg-secondary/80"
                    >
                      Clone
                    </button>
                  )
                ) : (
                  <>
                    <button
                      onClick={() => setEditing(true)}
                      className="text-xs bg-secondary text-foreground px-3 py-1 rounded-md hover:bg-secondary/80"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => cloneEntry(selected.id)}
                      className="text-xs bg-secondary text-foreground px-3 py-1 rounded-md hover:bg-secondary/80"
                    >
                      Clone
                    </button>
                    {selected.role !== "coo" && (
                      <button
                        onClick={deleteEntry}
                        className="text-xs text-destructive px-3 py-1 rounded-md hover:bg-destructive/10"
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {clonedFromName && (
              <p className="text-[10px] text-muted-foreground">
                Cloned from: {clonedFromName}
              </p>
            )}

            {/* Name */}
            <Field label="Name" editing={editing}>
              {editing ? (
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                />
              ) : (
                <p className="text-sm">{form.name}</p>
              )}
            </Field>

            {/* Description */}
            <Field label="Description" editing={editing}>
              {editing ? (
                <input
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {form.description}
                </p>
              )}
            </Field>

            {/* Model & Provider */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Provider" editing={editing}>
                {editing ? (
                  <select
                    value={form.defaultProvider}
                    onChange={(e) => {
                      const newProvider = e.target.value;
                      setForm({ ...form, defaultProvider: newProvider });
                      if (!models[newProvider]) {
                        fetchModels(newProvider);
                      }
                    }}
                    className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs font-mono bg-secondary inline-block px-2 py-0.5 rounded">
                    {providers.find((p) => p.id === form.defaultProvider)?.name ?? form.defaultProvider}
                  </p>
                )}
              </Field>
              <Field label="Model" editing={editing}>
                {editing ? (
                  <ModelCombobox
                    value={form.defaultModel}
                    options={models[form.defaultProvider] ?? []}
                    onChange={(model) => setForm({ ...form, defaultModel: model })}
                    placeholder="Select or type a model..."
                  />
                ) : (
                  <p className="text-xs font-mono bg-secondary inline-block px-2 py-0.5 rounded">
                    {form.defaultModel}
                  </p>
                )}
              </Field>
            </div>

            {/* 3D Character */}
            <Field label="3D Character" editing={editing}>
              {editing ? (
                <>
                  <CharacterSelect
                    packs={modelPacks}
                    selected={form.modelPackId}
                    onSelect={(id) => setForm({ ...form, modelPackId: id, gearConfig: null })}
                    gearConfig={form.gearConfig}
                    onGearConfigChange={(gc) => setForm({ ...form, gearConfig: gc })}
                  />
                </>
              ) : (
                <p className="text-xs font-mono bg-secondary inline-block px-2 py-0.5 rounded">
                  {form.modelPackId
                    ? modelPacks.find((p) => p.id === form.modelPackId)?.name ?? form.modelPackId
                    : "None"}
                </p>
              )}
            </Field>

            {/* Capabilities */}
            <Field label="Capabilities (comma-separated)" editing={editing}>
              {editing ? (
                <input
                  value={form.capabilities}
                  onChange={(e) =>
                    setForm({ ...form, capabilities: e.target.value })
                  }
                  className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                />
              ) : (
                <div className="flex flex-wrap gap-1">
                  {form.capabilities
                    .split(",")
                    .filter(Boolean)
                    .map((c) => (
                      <span
                        key={c.trim()}
                        className="text-[10px] bg-secondary px-2 py-0.5 rounded"
                      >
                        {c.trim()}
                      </span>
                    ))}
                </div>
              )}
            </Field>

            {/* Tools */}
            <Field label="Tools (comma-separated)" editing={editing}>
              {editing ? (
                <input
                  value={form.tools}
                  onChange={(e) => setForm({ ...form, tools: e.target.value })}
                  className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                />
              ) : (
                <div className="flex flex-wrap gap-1">
                  {form.tools
                    .split(",")
                    .filter(Boolean)
                    .map((t) => (
                      <span
                        key={t.trim()}
                        className="text-[10px] bg-secondary px-2 py-0.5 rounded font-mono"
                      >
                        {t.trim()}
                      </span>
                    ))}
                </div>
              )}
            </Field>

            {/* System Prompt — COO clones show base (read-only) + addendum (editable) */}
            {isCooClone ? (
              <>
                <Field label="Base System Prompt" editing={false}>
                  <p className="text-[10px] text-muted-foreground mb-1">
                    This base prompt is maintained by Smoothbot and updates automatically.
                  </p>
                  <pre className="text-xs text-muted-foreground bg-secondary rounded-md p-3 whitespace-pre-wrap font-mono max-h-[200px] overflow-y-auto">
                    {builtInCooPrompt}
                  </pre>
                </Field>
                <Field label="Prompt Addendum" editing={editing}>
                  {editing ? (
                    <textarea
                      value={form.promptAddendum}
                      onChange={(e) =>
                        setForm({ ...form, promptAddendum: e.target.value })
                      }
                      rows={6}
                      placeholder="Add custom instructions that will be appended to the base prompt..."
                      className="w-full bg-secondary rounded-md px-3 py-2 text-sm outline-none focus:ring-1 ring-primary resize-y font-mono"
                    />
                  ) : (
                    <pre className="text-xs text-muted-foreground bg-secondary rounded-md p-3 whitespace-pre-wrap font-mono max-h-[200px] overflow-y-auto">
                      {form.promptAddendum || "(none)"}
                    </pre>
                  )}
                </Field>
              </>
            ) : (
              <Field label="System Prompt" editing={editing}>
                {editing ? (
                  <textarea
                    value={form.systemPrompt}
                    onChange={(e) =>
                      setForm({ ...form, systemPrompt: e.target.value })
                    }
                    rows={8}
                    className="w-full bg-secondary rounded-md px-3 py-2 text-sm outline-none focus:ring-1 ring-primary resize-y font-mono"
                  />
                ) : (
                  <pre className="text-xs text-muted-foreground bg-secondary rounded-md p-3 whitespace-pre-wrap font-mono max-h-[200px] overflow-y-auto">
                    {form.systemPrompt}
                  </pre>
                )}
              </Field>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </div>
      {children}
    </div>
  );
}

function SidebarItem({
  entry,
  selected,
  onClick,
}: {
  entry: RegistryEntry;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2 text-sm transition-colors",
        selected
          ? "bg-secondary text-foreground"
          : "hover:bg-secondary/50 text-muted-foreground",
      )}
    >
      <div className="flex items-center gap-1.5">
        {entry.builtIn && (
          <svg
            className="w-3 h-3 text-muted-foreground/50 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        )}
        <span className="font-medium text-xs truncate">{entry.name}</span>
      </div>
      <div className="text-[10px] text-muted-foreground truncate">
        {entry.capabilities.join(", ")}
      </div>
    </button>
  );
}

function Field({
  label,
  editing,
  children,
}: {
  label: string;
  editing: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
        {label}
      </label>
      {children}
    </div>
  );
}
