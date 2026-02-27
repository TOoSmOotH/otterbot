import { useState, useEffect, useCallback } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settings-store";
import { ModelCombobox } from "./ModelCombobox";

interface InstalledModule {
  id: string;
  moduleId?: string;
  name: string;
  version: string;
  source: "git" | "npm" | "local";
  sourceUri: string;
  enabled: boolean;
  loaded: boolean;
  documents: number;
  hasQuery: boolean;
  installedAt: string;
  updatedAt: string;
}

interface ConfigField {
  type: "string" | "number" | "boolean" | "secret" | "select";
  description: string;
  required: boolean;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
}

interface ModuleConfig {
  schema: Record<string, ConfigField>;
  values: Record<string, string | undefined>;
}

interface DbTableInfo {
  name: string;
  rowCount: number;
}

function ModuleDbInfo({ moduleId }: { moduleId: string }) {
  const [tables, setTables] = useState<DbTableInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/modules/${moduleId}/db-info`);
        if (res.ok) {
          const data = await res.json();
          setTables(data.tables ?? []);
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, [moduleId]);

  if (loading) return null;
  if (tables.length === 0) return null;

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
        Database
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {tables.map((t) => (
          <div key={t.name} className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground font-mono">{t.name}</span>
            <span className="text-muted-foreground/60 font-mono">{t.rowCount.toLocaleString()} rows</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModuleConfigPanel({ moduleId, moduleLoaded }: { moduleId: string; moduleLoaded: boolean }) {
  const [config, setConfig] = useState<ModuleConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const providers = useSettingsStore((s) => s.providers);
  const models = useSettingsStore((s) => s.models);
  const fetchModels = useSettingsStore((s) => s.fetchModels);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  // Load providers on mount
  useEffect(() => {
    if (providers.length === 0) {
      loadSettings();
    }
  }, [providers.length, loadSettings]);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/modules/${moduleId}/config`);
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        // Initialize edit values from current values
        const vals: Record<string, string> = {};
        for (const [key, field] of Object.entries(data.schema as Record<string, ConfigField>)) {
          vals[key] = data.values[key] ?? (field.default != null ? String(field.default) : "");
        }
        setEditValues(vals);
        setDirty(false);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [moduleId]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Fetch models when provider changes
  const selectedProvider = editValues.agent_provider;
  useEffect(() => {
    if (selectedProvider) {
      const provider = providers.find((p) => p.id === selectedProvider);
      if (provider && !models[provider.id]) {
        fetchModels(provider.id);
      }
    }
  }, [selectedProvider, providers, models, fetchModels]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const updates: Record<string, string | null> = {};
      for (const key of Object.keys(config.schema)) {
        const newVal = editValues[key] ?? "";
        const oldVal = config.values[key] ?? "";
        if (newVal !== oldVal) {
          updates[key] = newVal || null;
        }
      }
      if (Object.keys(updates).length === 0) {
        setDirty(false);
        return;
      }
      const res = await fetch(`/api/modules/${moduleId}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Save failed");
      } else {
        setDirty(false);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 2000);
        await loadConfig();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-[10px] text-muted-foreground py-2">Loading config...</div>;
  }

  if (!config || Object.keys(config.schema).length === 0) {
    return moduleLoaded ? <ModuleDbInfo moduleId={moduleId} /> : null;
  }

  // Separate core config from agent config
  const coreFields = Object.entries(config.schema).filter(([key]) => !key.startsWith("agent_"));
  const agentFields = Object.entries(config.schema).filter(([key]) => key.startsWith("agent_"));

  const renderField = ([key, field]: [string, ConfigField]) => {
    // Special handling for agent_provider
    if (key === "agent_provider") {
      return (
        <div key={key}>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5">
            {key.replace(/_/g, " ")}
          </label>
          <p className="text-[10px] text-muted-foreground/60 mb-1">{field.description}</p>
          <select
            value={editValues[key] ?? ""}
            onChange={(e) => {
              setEditValues({ ...editValues, [key]: e.target.value });
              setDirty(true);
              // Fetch models for newly selected provider
              if (e.target.value) {
                fetchModels(e.target.value);
              }
            }}
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary"
          >
            <option value="">System default</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.type})
              </option>
            ))}
          </select>
        </div>
      );
    }

    // Special handling for agent_model
    if (key === "agent_model") {
      const provId = editValues.agent_provider;
      const modelOptions = provId ? (models[provId] ?? []) : [];
      return (
        <div key={key}>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5">
            {key.replace(/_/g, " ")}
          </label>
          <p className="text-[10px] text-muted-foreground/60 mb-1">{field.description}</p>
          <ModelCombobox
            value={editValues[key] ?? ""}
            options={modelOptions}
            onChange={(val) => {
              setEditValues({ ...editValues, [key]: val });
              setDirty(true);
            }}
            placeholder="System default"
          />
        </div>
      );
    }

    // Generic select field
    if (field.type === "select" && field.options) {
      return (
        <div key={key}>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5">
            {key.replace(/_/g, " ")}
            {field.required && <span className="text-red-400">*</span>}
          </label>
          <p className="text-[10px] text-muted-foreground/60 mb-1">{field.description}</p>
          <select
            value={editValues[key] ?? ""}
            onChange={(e) => {
              setEditValues({ ...editValues, [key]: e.target.value });
              setDirty(true);
            }}
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary"
          >
            {field.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );
    }

    // Boolean toggle
    if (field.type === "boolean") {
      return (
        <div key={key}>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5">
            {key.replace(/_/g, " ")}
            {field.required && <span className="text-red-400">*</span>}
          </label>
          <p className="text-[10px] text-muted-foreground/60 mb-1">{field.description}</p>
          <button
            onClick={() => {
              const newVal = editValues[key] === "true" ? "false" : "true";
              setEditValues({ ...editValues, [key]: newVal });
              setDirty(true);
            }}
            className={cn(
              "relative w-9 h-5 rounded-full transition-colors",
              editValues[key] === "true" ? "bg-primary" : "bg-secondary",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform",
                editValues[key] === "true" && "translate-x-4",
              )}
            />
          </button>
        </div>
      );
    }

    // Default: text/number/secret input
    return (
      <div key={key}>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5">
          {key.replace(/_/g, " ")}
          {field.required && <span className="text-red-400">*</span>}
          {field.type === "secret" && (
            <span className="text-yellow-500 normal-case">(secret)</span>
          )}
        </label>
        <p className="text-[10px] text-muted-foreground/60 mb-1">{field.description}</p>
        <input
          type={field.type === "secret" ? "password" : "text"}
          value={editValues[key] ?? ""}
          onChange={(e) => {
            setEditValues({ ...editValues, [key]: e.target.value });
            setDirty(true);
          }}
          placeholder={field.default != null ? String(field.default) : undefined}
          className="w-full bg-secondary rounded-md px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary font-mono"
        />
      </div>
    );
  };

  return (
    <div className="border-t border-border pt-3 space-y-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
        Configuration
      </div>

      {coreFields.length > 0 && (
        <div className="space-y-3">
          {coreFields.map(renderField)}
        </div>
      )}

      {agentFields.length > 0 && (
        <details className="group">
          <summary className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium cursor-pointer hover:text-foreground">
            Agent Settings
          </summary>
          <div className="space-y-3 mt-3">
            {agentFields.map(renderField)}
          </div>
        </details>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {error && <span className="text-xs text-red-500">{error}</span>}
        {success && <span className="text-xs text-green-500">Saved</span>}
      </div>

      {moduleLoaded && <ModuleDbInfo moduleId={moduleId} />}
    </div>
  );
}

export function ModulesSection() {
  const [modules, setModules] = useState<InstalledModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInstall, setShowInstall] = useState(false);
  const [installSource, setInstallSource] = useState<"git" | "npm" | "local">("local");
  const [installUri, setInstallUri] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [duplicateInstanceId, setDuplicateInstanceId] = useState("");
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadModules = async () => {
    try {
      const res = await fetch("/api/modules");
      if (res.ok) {
        setModules(await res.json());
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadModules();
  }, []);

  const handleInstall = async () => {
    if (!installUri.trim()) return;
    setInstalling(true);
    setInstallError(null);
    try {
      const res = await fetch("/api/modules/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: installSource,
          uri: installUri,
          ...(instanceId.trim() ? { instanceId: instanceId.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setInstallError(data.error ?? "Installation failed");
      } else {
        setInstallUri("");
        setInstanceId("");
        setShowInstall(false);
        await loadModules();
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "Installation failed");
    } finally {
      setInstalling(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    setTogglingId(id);
    setToggleError(null);
    try {
      const res = await fetch(`/api/modules/${id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const data = await res.json();
        setToggleError(data.error ?? "Toggle failed");
      }
      await loadModules();
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDuplicate = async (mod: InstalledModule) => {
    if (duplicatingId !== mod.id) {
      setDuplicatingId(mod.id);
      setDuplicateInstanceId(`${mod.moduleId ?? mod.id}-copy`);
      setDuplicateError(null);
      return;
    }
    if (!duplicateInstanceId.trim()) return;
    setDuplicateError(null);
    try {
      const res = await fetch("/api/modules/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: mod.source,
          uri: mod.sourceUri,
          instanceId: duplicateInstanceId.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setDuplicateError(data.error ?? "Duplicate failed");
        return;
      }
      setDuplicatingId(null);
      setDuplicateInstanceId("");
      await loadModules();
    } catch (err) {
      setDuplicateError(err instanceof Error ? err.message : "Duplicate failed");
    }
  };

  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setDeletingId(id);
    try {
      await fetch(`/api/modules/${id}`, { method: "DELETE" });
      setConfirmDeleteId(null);
      await loadModules();
    } catch {
      /* ignore */
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-5 space-y-4">
      <p className="text-xs text-muted-foreground">
        Install and manage knowledge modules. Modules are data sources that index content
        into isolated knowledge stores, queryable by the COO via tools.
      </p>

      {/* Install button */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowInstall(!showInstall)}
          className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90"
        >
          {showInstall ? "Cancel" : "Install Module"}
        </button>
      </div>

      {/* Install form */}
      {showInstall && (
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
              Source
            </label>
            <div className="flex gap-2">
              {(["local", "git", "npm"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setInstallSource(s)}
                  className={cn(
                    "text-xs px-3 py-1.5 rounded-md",
                    installSource === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground hover:bg-secondary/80",
                  )}
                >
                  {s === "local" ? "Local Path" : s === "git" ? "Git URL" : "npm Package"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
              {installSource === "local"
                ? "File Path"
                : installSource === "git"
                  ? "Repository URL"
                  : "Package Name"}
            </label>
            <input
              type="text"
              value={installUri}
              onChange={(e) => setInstallUri(e.target.value)}
              placeholder={
                installSource === "local"
                  ? "/path/to/module"
                  : installSource === "git"
                    ? "https://github.com/user/otterbot-module-example.git"
                    : "otterbot-module-example"
              }
              className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
            />
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
              Instance ID <span className="normal-case">(optional, for multi-instance)</span>
            </label>
            <input
              type="text"
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
              placeholder="auto-generated from module name"
              className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleInstall}
              disabled={installing || !installUri.trim()}
              className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {installing ? "Installing..." : "Install"}
            </button>
            {installError && (
              <span className="text-xs text-red-500">{installError}</span>
            )}
          </div>
        </div>
      )}

      {toggleError && (
        <div className="border border-red-500/30 bg-red-500/10 rounded-lg p-3 flex items-center justify-between">
          <span className="text-xs text-red-500">{toggleError}</span>
          <button
            onClick={() => setToggleError(null)}
            className="text-xs text-red-500 hover:text-red-400 ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Module list */}
      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          Loading modules...
        </div>
      ) : modules.length === 0 ? (
        <div className="border border-border rounded-lg p-6 text-center">
          <p className="text-sm text-muted-foreground">No modules installed</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            Click "Install Module" to add a knowledge source.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {modules.map((mod) => (
            <div key={mod.id} className="border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <label className="flex items-center cursor-pointer">
                    <button
                      onClick={() => handleToggle(mod.id, !mod.enabled)}
                      disabled={togglingId === mod.id}
                      className={cn(
                        "relative w-9 h-5 rounded-full transition-colors",
                        mod.enabled ? "bg-primary" : "bg-secondary",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform",
                          mod.enabled && "translate-x-4",
                        )}
                      />
                    </button>
                  </label>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{mod.name}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        v{mod.version}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">{mod.id}</span>
                      {mod.moduleId && mod.moduleId !== mod.id && (
                        <span className="text-[10px] text-muted-foreground/60">
                          (type: {mod.moduleId})
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {mod.loaded && (
                    <span className="text-[10px] text-green-500">Loaded</span>
                  )}
                  {!mod.loaded && mod.enabled && (
                    <span className="text-[10px] text-yellow-500">Not loaded</span>
                  )}
                  <button
                    onClick={() => setExpandedId(expandedId === mod.id ? null : mod.id)}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                  >
                    {expandedId === mod.id ? "Hide Config" : "Config"}
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                <span>
                  Source: <span className="font-mono">{mod.source}</span>
                </span>
                <span>
                  Documents: <span className="font-mono">{mod.documents}</span>
                </span>
                {mod.hasQuery && (
                  <span className="text-primary">Queryable</span>
                )}
              </div>

              {mod.sourceUri && (
                <div className="text-[10px] text-muted-foreground font-mono truncate">
                  {mod.sourceUri}
                </div>
              )}

              {/* Config panel */}
              {expandedId === mod.id && (
                <ModuleConfigPanel moduleId={mod.id} moduleLoaded={mod.loaded} />
              )}

              {/* Duplicate inline form */}
              {duplicatingId === mod.id && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={duplicateInstanceId}
                    onChange={(e) => setDuplicateInstanceId(e.target.value)}
                    placeholder="new-instance-id"
                    className="flex-1 bg-secondary rounded-md px-2 py-1 text-xs outline-none focus:ring-1 ring-primary font-mono"
                    onKeyDown={(e) => e.key === "Enter" && handleDuplicate(mod)}
                  />
                  <button
                    onClick={() => handleDuplicate(mod)}
                    disabled={!duplicateInstanceId.trim()}
                    className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded-md hover:bg-primary/90 disabled:opacity-50"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => { setDuplicatingId(null); setDuplicateError(null); }}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                  >
                    Cancel
                  </button>
                  {duplicateError && (
                    <span className="text-xs text-red-500">{duplicateError}</span>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDuplicate(mod)}
                  disabled={duplicatingId === mod.id}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                >
                  Duplicate
                </button>
                <button
                  onClick={() => handleDelete(mod.id)}
                  disabled={deletingId === mod.id}
                  className={cn(
                    "text-xs px-2 py-1",
                    confirmDeleteId === mod.id
                      ? "bg-red-500/10 text-red-500 rounded-md"
                      : "text-red-500 hover:text-red-400",
                  )}
                >
                  {deletingId === mod.id
                    ? "Removing..."
                    : confirmDeleteId === mod.id
                      ? "Confirm Remove"
                      : "Remove"}
                </button>
                {confirmDeleteId === mod.id && (
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
