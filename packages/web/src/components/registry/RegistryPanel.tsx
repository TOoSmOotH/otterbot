import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import type { RegistryEntry } from "@smoothbot/shared";

const PROVIDER_OPTIONS = [
  "anthropic",
  "openai",
  "ollama",
  "openai-compatible",
];

export function RegistryPanel({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [selected, setSelected] = useState<RegistryEntry | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    systemPrompt: "",
    capabilities: "",
    defaultModel: "",
    defaultProvider: "anthropic",
    tools: "",
  });

  useEffect(() => {
    loadEntries();
  }, []);

  const loadEntries = async () => {
    const res = await fetch("/api/registry");
    const data = await res.json();
    setEntries(data);
  };

  const selectEntry = (entry: RegistryEntry) => {
    setSelected(entry);
    setForm({
      name: entry.name,
      description: entry.description,
      systemPrompt: entry.systemPrompt,
      capabilities: entry.capabilities.join(", "),
      defaultModel: entry.defaultModel,
      defaultProvider: entry.defaultProvider,
      tools: entry.tools.join(", "),
    });
    setEditing(false);
  };

  const saveEntry = async () => {
    if (!selected) return;

    const body = {
      name: form.name,
      description: form.description,
      systemPrompt: form.systemPrompt,
      capabilities: form.capabilities.split(",").map((s) => s.trim()).filter(Boolean),
      defaultModel: form.defaultModel,
      defaultProvider: form.defaultProvider,
      tools: form.tools.split(",").map((s) => s.trim()).filter(Boolean),
    };

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

  const deleteEntry = async () => {
    if (!selected) return;
    await fetch(`/api/registry/${selected.id}`, { method: "DELETE" });
    setSelected(null);
    await loadEntries();
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-[900px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Agent Registry</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            &times;
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Entry list */}
          <div className="w-[240px] border-r border-border overflow-y-auto">
            <div className="p-2">
              <button
                onClick={addEntry}
                className="w-full text-xs text-center py-1.5 rounded-md border border-dashed border-border hover:border-primary/50 hover:text-primary transition-colors"
              >
                + Add Agent Template
              </button>
            </div>
            {entries.map((entry) => (
              <button
                key={entry.id}
                onClick={() => selectEntry(entry)}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm transition-colors",
                  selected?.id === entry.id
                    ? "bg-secondary text-foreground"
                    : "hover:bg-secondary/50 text-muted-foreground",
                )}
              >
                <div className="font-medium text-xs">{entry.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {entry.capabilities.join(", ")}
                </div>
              </button>
            ))}
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
                  <h3 className="text-sm font-semibold">{form.name}</h3>
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
                    ) : (
                      <>
                        <button
                          onClick={() => setEditing(true)}
                          className="text-xs bg-secondary text-foreground px-3 py-1 rounded-md hover:bg-secondary/80"
                        >
                          Edit
                        </button>
                        <button
                          onClick={deleteEntry}
                          className="text-xs text-destructive px-3 py-1 rounded-md hover:bg-destructive/10"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>

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
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">{form.description}</p>
                  )}
                </Field>

                {/* Model & Provider */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Model" editing={editing}>
                    {editing ? (
                      <input
                        value={form.defaultModel}
                        onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
                        className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                      />
                    ) : (
                      <p className="text-xs font-mono bg-secondary inline-block px-2 py-0.5 rounded">
                        {form.defaultModel}
                      </p>
                    )}
                  </Field>
                  <Field label="Provider" editing={editing}>
                    {editing ? (
                      <select
                        value={form.defaultProvider}
                        onChange={(e) => setForm({ ...form, defaultProvider: e.target.value })}
                        className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                      >
                        {PROVIDER_OPTIONS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-xs font-mono bg-secondary inline-block px-2 py-0.5 rounded">
                        {form.defaultProvider}
                      </p>
                    )}
                  </Field>
                </div>

                {/* Capabilities */}
                <Field label="Capabilities (comma-separated)" editing={editing}>
                  {editing ? (
                    <input
                      value={form.capabilities}
                      onChange={(e) => setForm({ ...form, capabilities: e.target.value })}
                      className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                    />
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {form.capabilities.split(",").filter(Boolean).map((c) => (
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
                      {form.tools.split(",").filter(Boolean).map((t) => (
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

                {/* System Prompt */}
                <Field label="System Prompt" editing={editing}>
                  {editing ? (
                    <textarea
                      value={form.systemPrompt}
                      onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                      rows={8}
                      className="w-full bg-secondary rounded-md px-3 py-2 text-sm outline-none focus:ring-1 ring-primary resize-y font-mono"
                    />
                  ) : (
                    <pre className="text-xs text-muted-foreground bg-secondary rounded-md p-3 whitespace-pre-wrap font-mono max-h-[200px] overflow-y-auto">
                      {form.systemPrompt}
                    </pre>
                  )}
                </Field>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
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
