import { useState, useEffect, useCallback } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settings-store";
import { ModelCombobox } from "./ModelCombobox";
import { ModuleAgentChat } from "./ModuleAgentChat";

// ─── Types ──────────────────────────────────────────────────────────────────

interface InstalledSpecialist {
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
  hasAgent: boolean;
  lastPolled?: string | null;
  installedAt: string;
  updatedAt: string;
}

interface ConfigField {
  type: "string" | "number" | "boolean" | "secret" | "select";
  description: string;
  required: boolean;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  hidden?: boolean;
  showWhen?: { field: string; value: string };
}

interface SpecialistConfig {
  schema: Record<string, ConfigField>;
  values: Record<string, string | undefined>;
}

interface DbTableInfo {
  name: string;
  rowCount: number;
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface SpecialistsSubViewProps {
  navigateToId?: string | null;
  onNavigatedTo?: () => void;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function SpecialistsSubView({ navigateToId, onNavigatedTo }: SpecialistsSubViewProps) {
  const [specialists, setSpecialists] = useState<InstalledSpecialist[]>([]);
  const [selected, setSelected] = useState<InstalledSpecialist | null>(null);
  const [loading, setLoading] = useState(true);

  // Install state
  const [showInstall, setShowInstall] = useState(false);
  const [installSource, setInstallSource] = useState<"git" | "npm" | "local">("local");
  const [installUri, setInstallUri] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  // Action state
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{ id: string; items: number } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAgentChat, setShowAgentChat] = useState(false);

  // Clone state
  const [showClone, setShowClone] = useState(false);
  const [cloneInstanceId, setCloneInstanceId] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);

  const loadSpecialists = useCallback(async () => {
    try {
      const res = await fetch("/api/modules");
      if (res.ok) {
        const data: InstalledSpecialist[] = await res.json();
        setSpecialists(data);
        // Re-select if the selected specialist was updated
        if (selected) {
          const updated = data.find((s) => s.id === selected.id);
          if (updated) setSelected(updated);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    loadSpecialists();
  }, []);

  // Handle cross-tab navigation
  useEffect(() => {
    if (navigateToId && specialists.length > 0) {
      const target = specialists.find((s) => s.id === navigateToId);
      if (target) setSelected(target);
      onNavigatedTo?.();
    }
  }, [navigateToId, specialists, onNavigatedTo]);

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
        await loadSpecialists();
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "Installation failed");
    } finally {
      setInstalling(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    setTogglingId(id);
    try {
      await fetch(`/api/modules/${id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      await loadSpecialists();
    } catch {
      /* ignore */
    } finally {
      setTogglingId(null);
    }
  };

  const handleSync = async (id: string, fullSync = false) => {
    setSyncingId(id);
    setSyncResult(null);
    try {
      const res = await fetch(`/api/modules/${id}/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullSync }),
      });
      if (res.ok) {
        const data = await res.json();
        setSyncResult({ id, items: data.items });
        setTimeout(() => setSyncResult(null), 5000);
        await loadSpecialists();
      }
    } catch {
      /* ignore */
    } finally {
      setSyncingId(null);
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
      if (selected?.id === id) setSelected(null);
      await loadSpecialists();
    } catch {
      /* ignore */
    } finally {
      setDeletingId(null);
    }
  };

  const handleClone = async () => {
    if (!selected || !cloneInstanceId.trim()) return;
    setCloning(true);
    setCloneError(null);
    try {
      const res = await fetch("/api/modules/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: selected.source,
          uri: selected.sourceUri,
          instanceId: cloneInstanceId.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setCloneError(data.error ?? "Clone failed");
        return;
      }
      setShowClone(false);
      setCloneInstanceId("");
      // Reload the list and select the new clone
      const listRes = await fetch("/api/modules");
      if (listRes.ok) {
        const data: InstalledSpecialist[] = await listRes.json();
        setSpecialists(data);
        const newEntry = data.find((s) => s.id === cloneInstanceId.trim());
        if (newEntry) setSelected(newEntry);
      }
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : "Clone failed");
    } finally {
      setCloning(false);
    }
  };

  const openClone = () => {
    if (!selected) return;
    setShowClone(true);
    setCloneInstanceId(`${selected.moduleId ?? selected.id}-${Date.now().toString(36)}`);
    setCloneError(null);
  };

  const enabled = specialists.filter((s) => s.enabled);
  const disabled = specialists.filter((s) => !s.enabled);

  return (
    <div className="flex flex-1 overflow-hidden" style={{ minHeight: "400px" }}>
      {/* Left: Specialist list */}
      <div className="w-[240px] border-r border-border overflow-y-auto">
        <div className="p-2 space-y-1">
          <button
            onClick={() => setShowInstall(!showInstall)}
            className="w-full text-xs text-center py-1.5 rounded-md border border-dashed border-border hover:border-primary/50 hover:text-primary transition-colors"
          >
            + Install Specialist
          </button>
          {specialists.some((m) => m.loaded && (m.hasAgent || m.hasQuery)) && (
            <button
              onClick={() => setShowAgentChat(true)}
              className="w-full text-xs text-center py-1.5 rounded-md border border-dashed border-border hover:border-primary/50 hover:text-primary transition-colors"
            >
              Chat with Specialists
            </button>
          )}
        </div>

        {loading && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            Loading...
          </div>
        )}

        {!loading && specialists.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            No specialists installed
          </div>
        )}

        {enabled.length > 0 && (
          <SidebarGroup label="Enabled">
            {enabled.map((s) => (
              <SidebarItem
                key={s.id}
                specialist={s}
                selected={selected?.id === s.id}
                onClick={() => setSelected(s)}
              />
            ))}
          </SidebarGroup>
        )}

        {disabled.length > 0 && (
          <SidebarGroup label="Disabled">
            {disabled.map((s) => (
              <SidebarItem
                key={s.id}
                specialist={s}
                selected={selected?.id === s.id}
                onClick={() => setSelected(s)}
              />
            ))}
          </SidebarGroup>
        )}
      </div>

      {/* Right: Detail panel */}
      <div className="flex-1 overflow-y-auto p-5">
        {showInstall ? (
          <InstallForm
            installSource={installSource}
            setInstallSource={setInstallSource}
            installUri={installUri}
            setInstallUri={setInstallUri}
            instanceId={instanceId}
            setInstanceId={setInstanceId}
            installing={installing}
            installError={installError}
            onInstall={handleInstall}
            onCancel={() => setShowInstall(false)}
          />
        ) : !selected ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Select a specialist agent to view or configure
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{selected.name}</h3>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    v{selected.version}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-muted-foreground">{selected.id}</span>
                  {selected.moduleId && selected.moduleId !== selected.id && (
                    <span className="text-[10px] text-muted-foreground/60">
                      (type: {selected.moduleId})
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggle(selected.id, !selected.enabled)}
                  disabled={togglingId === selected.id}
                  className={cn(
                    "relative w-9 h-5 rounded-full transition-colors",
                    selected.enabled ? "bg-primary" : "bg-secondary",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform",
                      selected.enabled && "translate-x-4",
                    )}
                  />
                </button>
                <span className="text-[10px] text-muted-foreground">
                  {selected.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            </div>

            {/* Status bar */}
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
              <span>
                Source: <span className="font-mono">{selected.source}</span>
              </span>
              <span>
                Documents: <span className="font-mono">{selected.documents}</span>
              </span>
              {selected.loaded && <span className="text-green-500">Loaded</span>}
              {!selected.loaded && selected.enabled && (
                <span className="text-yellow-500">Not loaded</span>
              )}
              {selected.hasQuery && <span className="text-primary">Queryable</span>}
            </div>

            {selected.sourceUri && (
              <div className="text-[10px] text-muted-foreground font-mono truncate">
                {selected.sourceUri}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2">
              {selected.loaded && (
                <>
                  <button
                    onClick={() => handleSync(selected.id)}
                    disabled={syncingId === selected.id}
                    className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80 disabled:opacity-50"
                  >
                    {syncingId === selected.id
                      ? "Syncing..."
                      : syncResult?.id === selected.id
                        ? `Synced ${syncResult.items} items`
                        : "Sync Now"}
                  </button>
                  <button
                    onClick={() => handleSync(selected.id, true)}
                    disabled={syncingId === selected.id}
                    className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80 disabled:opacity-50"
                  >
                    Full Sync
                  </button>
                </>
              )}
              <button
                onClick={openClone}
                className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80"
              >
                Clone
              </button>
              <button
                onClick={() => handleDelete(selected.id)}
                disabled={deletingId === selected.id}
                className={cn(
                  "text-xs px-3 py-1.5 rounded-md",
                  confirmDeleteId === selected.id
                    ? "bg-red-500/10 text-red-500"
                    : "text-red-500 hover:bg-red-500/10",
                )}
              >
                {deletingId === selected.id
                  ? "Removing..."
                  : confirmDeleteId === selected.id
                    ? "Confirm Remove"
                    : "Uninstall"}
              </button>
              {confirmDeleteId === selected.id && (
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              )}
            </div>

            {/* Clone form */}
            {showClone && (
              <div className="border border-border rounded-md p-3 space-y-2">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                  Clone Specialist
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Creates a new instance of <span className="font-mono">{selected.moduleId ?? selected.id}</span> with its own config and knowledge store.
                </p>
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                    Instance ID
                  </label>
                  <input
                    type="text"
                    value={cloneInstanceId}
                    onChange={(e) => setCloneInstanceId(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleClone()}
                    placeholder="my-specialist-instance"
                    className="w-full bg-secondary rounded-md px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary font-mono"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleClone}
                    disabled={cloning || !cloneInstanceId.trim()}
                    className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
                  >
                    {cloning ? "Cloning..." : "Create Clone"}
                  </button>
                  <button
                    onClick={() => { setShowClone(false); setCloneError(null); }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                  {cloneError && <span className="text-xs text-red-500">{cloneError}</span>}
                </div>
              </div>
            )}

            {/* Knowledge Store / Database info */}
            {selected.loaded && <SpecialistDbInfo moduleId={selected.id} />}

            {/* Query box */}
            {selected.loaded && (selected.hasAgent || selected.hasQuery) && (
              <SpecialistQueryBox moduleId={selected.id} />
            )}

            {/* Configuration */}
            <SpecialistConfigPanel moduleId={selected.id} />
          </div>
        )}
      </div>

      {/* Agent Chat modal */}
      {showAgentChat && (
        <ModuleAgentChat
          modules={specialists
            .filter((m) => m.loaded && (m.hasAgent || m.hasQuery))
            .map((m) => ({ id: m.id, name: m.name }))}
          onClose={() => setShowAgentChat(false)}
        />
      )}
    </div>
  );
}

// ─── Sidebar Components ─────────────────────────────────────────────────────

function SidebarGroup({ label, children }: { label: string; children: React.ReactNode }) {
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
  specialist,
  selected,
  onClick,
}: {
  specialist: InstalledSpecialist;
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
        <span className="font-medium text-xs truncate">{specialist.name}</span>
        <span className="text-[9px] text-muted-foreground/60 font-mono">
          v{specialist.version}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground truncate">
        {specialist.documents} docs
        {specialist.hasAgent && " · Agent"}
      </div>
    </button>
  );
}

// ─── Install Form ───────────────────────────────────────────────────────────

function InstallForm({
  installSource,
  setInstallSource,
  installUri,
  setInstallUri,
  instanceId,
  setInstanceId,
  installing,
  installError,
  onInstall,
  onCancel,
}: {
  installSource: "git" | "npm" | "local";
  setInstallSource: (s: "git" | "npm" | "local") => void;
  installUri: string;
  setInstallUri: (s: string) => void;
  instanceId: string;
  setInstanceId: (s: string) => void;
  installing: boolean;
  installError: string | null;
  onInstall: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Install Specialist Agent</h3>
        <button
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>

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
              ? "/path/to/specialist"
              : installSource === "git"
                ? "https://github.com/user/otterbot-specialist-example.git"
                : "otterbot-specialist-example"
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
          placeholder="auto-generated from specialist name"
          className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onInstall}
          disabled={installing || !installUri.trim()}
          className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {installing ? "Installing..." : "Install"}
        </button>
        {installError && <span className="text-xs text-red-500">{installError}</span>}
      </div>
    </div>
  );
}

// ─── Database Info ──────────────────────────────────────────────────────────

function SpecialistDbInfo({ moduleId }: { moduleId: string }) {
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

  if (loading || tables.length === 0) return null;

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
        Knowledge Store
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {tables.map((t) => (
          <div key={t.name} className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground font-mono">{t.name}</span>
            <span className="text-muted-foreground/60 font-mono">
              {t.rowCount.toLocaleString()} rows
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Query Box ──────────────────────────────────────────────────────────────

function SpecialistQueryBox({ moduleId }: { moduleId: string }) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [lastQ, setLastQ] = useState<string | null>(null);
  const [lastA, setLastA] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAsk = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setError(null);
    setLastQ(q);
    setLastA(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 150_000);
      const res = await fetch(`/api/modules/${moduleId}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Query failed");
      } else {
        setLastA(data.answer ?? "(no answer returned)");
        setQuestion("");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Request timed out — the agent may be busy.");
      } else {
        setError(err instanceof Error ? err.message : "Query failed");
      }
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
        Ask Specialist
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAsk()}
          placeholder="Ask a question..."
          disabled={asking}
          className="flex-1 bg-secondary rounded-md px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary"
        />
        <button
          onClick={handleAsk}
          disabled={asking || !question.trim()}
          className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {asking ? "Asking..." : "Ask"}
        </button>
      </div>
      {error && <div className="text-xs text-red-500">{error}</div>}
      {lastQ && asking && (
        <div className="bg-secondary/50 rounded-md p-3 space-y-2">
          <div className="text-[10px] text-muted-foreground">Q: {lastQ}</div>
          <div className="text-xs text-muted-foreground animate-pulse">
            Thinking... this may take a minute while the specialist reasons.
          </div>
        </div>
      )}
      {lastQ && !asking && lastA !== null && (
        <div className="bg-secondary/50 rounded-md p-3 space-y-2">
          <div className="text-[10px] text-muted-foreground">Q: {lastQ}</div>
          <div className="text-xs text-foreground whitespace-pre-wrap">
            {lastA || "(empty response)"}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Config Panel ───────────────────────────────────────────────────────────

function SpecialistConfigPanel({ moduleId }: { moduleId: string }) {
  const [config, setConfig] = useState<SpecialistConfig | null>(null);
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

  useEffect(() => {
    if (providers.length === 0) loadSettings();
  }, [providers.length, loadSettings]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/modules/${moduleId}/config`);
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        const vals: Record<string, string> = {};
        for (const [key, field] of Object.entries(
          data.schema as Record<string, ConfigField>,
        )) {
          vals[key] =
            data.values[key] ?? (field.default != null ? String(field.default) : "");
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

  const selectedProvider = editValues.agent_provider;
  useEffect(() => {
    if (selectedProvider) {
      const provider = providers.find((p) => p.id === selectedProvider);
      if (provider && !models[provider.id]) fetchModels(provider.id);
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
        if (newVal !== oldVal) updates[key] = newVal || null;
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
    return (
      <div className="text-[10px] text-muted-foreground py-2">Loading config...</div>
    );
  }

  if (!config || Object.keys(config.schema).length === 0) return null;

  const coreFields = Object.entries(config.schema).filter(
    ([key]) => !key.startsWith("agent_"),
  );
  const agentFields = Object.entries(config.schema).filter(([key]) =>
    key.startsWith("agent_"),
  );

  const renderField = ([key, field]: [string, ConfigField]) => {
    if (field.hidden) return null;
    if (field.showWhen) {
      const depValue = editValues[field.showWhen.field] ?? "";
      if (depValue !== field.showWhen.value) return null;
    }

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
              if (e.target.value) fetchModels(e.target.value);
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

    if (key === "agent_prompt") {
      return (
        <div key={key}>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5">
            {key.replace(/_/g, " ")}
          </label>
          <p className="text-[10px] text-muted-foreground/60 mb-1">{field.description}</p>
          <textarea
            value={editValues[key] ?? ""}
            onChange={(e) => {
              setEditValues({ ...editValues, [key]: e.target.value });
              setDirty(true);
            }}
            placeholder={field.default != null ? String(field.default) : undefined}
            rows={8}
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary font-mono resize-y"
          />
        </div>
      );
    }

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
        <div className="space-y-3">{coreFields.map(renderField)}</div>
      )}

      {agentFields.length > 0 && (
        <details className="group">
          <summary className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium cursor-pointer hover:text-foreground">
            Agent Settings
          </summary>
          <div className="space-y-3 mt-3">{agentFields.map(renderField)}</div>
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
    </div>
  );
}
