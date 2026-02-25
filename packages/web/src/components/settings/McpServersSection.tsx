import { useState, useEffect } from "react";
import { useMcpStore } from "../../stores/mcp-store";
import type { McpServerConfig, McpServerCreate, McpServerUpdate, McpServerRuntime } from "@otterbot/shared";
import { getSocket } from "../../lib/socket";

type ViewMode = "list" | "add" | "edit" | "tools";

const STATUS_COLORS: Record<string, string> = {
  connected: "bg-green-500",
  connecting: "bg-yellow-500",
  disconnected: "bg-zinc-500",
  error: "bg-red-500",
};

const STATUS_LABELS: Record<string, string> = {
  connected: "Connected",
  connecting: "Connecting...",
  disconnected: "Disconnected",
  error: "Error",
};

export function McpServersSection() {
  const {
    servers,
    statuses,
    warnings,
    loading,
    error,
    loadServers,
    createServer,
    updateServer,
    deleteServer,
    startServer,
    stopServer,
    restartServer,
    testServer,
    updateAllowedTools,
    updateStatus,
  } = useMcpStore();

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toolsServerId, setToolsServerId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadServers();
  }, []);

  // Listen for real-time status updates
  useEffect(() => {
    const socket = getSocket();
    const handler = (runtime: McpServerRuntime) => {
      updateStatus(runtime);
    };
    socket.on("mcp:status", handler);
    return () => {
      socket.off("mcp:status", handler);
    };
  }, [updateStatus]);

  const setLoading = (id: string, val: boolean) => {
    setActionLoading((prev) => ({ ...prev, [id]: val }));
  };

  const handleStart = async (id: string) => {
    setLoading(id, true);
    await startServer(id);
    setLoading(id, false);
    await loadServers();
  };

  const handleStop = async (id: string) => {
    setLoading(id, true);
    await stopServer(id);
    setLoading(id, false);
  };

  const handleRestart = async (id: string) => {
    setLoading(id, true);
    await restartServer(id);
    setLoading(id, false);
    await loadServers();
  };

  const handleTest = async (id: string) => {
    setLoading(id, true);
    await testServer(id);
    setLoading(id, false);
  };

  const handleDelete = async (id: string) => {
    await deleteServer(id);
    setConfirmDelete(null);
  };

  const handleToggleEnabled = async (server: McpServerConfig) => {
    await updateServer(server.id, { enabled: !server.enabled });
  };

  const handleEditTools = (id: string) => {
    setToolsServerId(id);
    setViewMode("tools");
  };

  const handleEdit = (id: string) => {
    setEditingId(id);
    setViewMode("edit");
  };

  const handleBack = () => {
    setViewMode("list");
    setEditingId(null);
    setToolsServerId(null);
  };

  if (viewMode === "add") {
    return (
      <McpServerForm
        onSave={async (data) => {
          await createServer(data as McpServerCreate);
          handleBack();
        }}
        onCancel={handleBack}
      />
    );
  }

  if (viewMode === "edit" && editingId) {
    const server = servers.find((s) => s.id === editingId);
    if (!server) {
      handleBack();
      return null;
    }
    return (
      <McpServerForm
        server={server}
        onSave={async (data) => {
          await updateServer(editingId, data as McpServerUpdate);
          handleBack();
        }}
        onCancel={handleBack}
      />
    );
  }

  if (viewMode === "tools" && toolsServerId) {
    const server = servers.find((s) => s.id === toolsServerId);
    if (!server) {
      handleBack();
      return null;
    }
    return (
      <McpToolApproval
        server={server}
        onSave={async (allowedTools) => {
          await updateAllowedTools(toolsServerId, allowedTools);
          handleBack();
        }}
        onCancel={handleBack}
      />
    );
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium">MCP Servers</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Connect external tool servers using the Model Context Protocol
          </p>
        </div>
        <button
          onClick={() => setViewMode("add")}
          className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90"
        >
          Add Server
        </button>
      </div>

      {error && (
        <div className="border border-red-500/30 bg-red-500/10 rounded-lg p-3 text-xs text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
          Loading...
        </div>
      ) : servers.length === 0 ? (
        <div className="border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
          No MCP servers configured. Click "Add Server" to connect one.
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => {
            const status = statuses[server.id] ?? { id: server.id, status: "disconnected", toolCount: 0 };
            const serverWarnings = warnings[server.id] ?? [];
            const isLoading = actionLoading[server.id] ?? false;

            return (
              <div key={server.id} className="border border-border rounded-lg p-4 space-y-3">
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {/* Toggle */}
                    <button
                      onClick={() => handleToggleEnabled(server)}
                      className={`relative w-9 h-5 rounded-full transition-colors ${
                        server.enabled ? "bg-primary" : "bg-secondary"
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          server.enabled ? "translate-x-4" : ""
                        }`}
                      />
                    </button>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{server.name}</span>
                        <span className={`inline-block w-2 h-2 rounded-full ${STATUS_COLORS[status.status]}`} />
                        <span className="text-[10px] text-muted-foreground">
                          {STATUS_LABELS[status.status]}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                        <span className="font-mono">{server.transport}</span>
                        {server.transport === "stdio" && server.command && (
                          <span className="font-mono">{server.command} {server.args.join(" ")}</span>
                        )}
                        {server.transport === "sse" && server.url && (
                          <span className="font-mono truncate max-w-[200px]">{server.url}</span>
                        )}
                        {status.toolCount > 0 && (
                          <span>{status.toolCount} tools</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Warnings */}
                {serverWarnings.length > 0 && (
                  <div className="border border-yellow-500/30 bg-yellow-500/10 rounded-md p-2 space-y-1">
                    {serverWarnings.map((w, i) => (
                      <p key={i} className="text-[10px] text-yellow-400">{w.message}</p>
                    ))}
                  </div>
                )}

                {/* Error display */}
                {status.status === "error" && status.error && (
                  <div className="border border-red-500/30 bg-red-500/10 rounded-md p-2">
                    <p className="text-[10px] text-red-400">{status.error}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  {status.status === "connected" ? (
                    <>
                      <button
                        onClick={() => handleStop(server.id)}
                        disabled={isLoading}
                        className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 disabled:opacity-50"
                      >
                        {isLoading ? "Stopping..." : "Stop"}
                      </button>
                      <button
                        onClick={() => handleRestart(server.id)}
                        disabled={isLoading}
                        className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 disabled:opacity-50"
                      >
                        Restart
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleStart(server.id)}
                      disabled={isLoading}
                      className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 disabled:opacity-50"
                    >
                      {isLoading ? "Starting..." : "Start"}
                    </button>
                  )}
                  <button
                    onClick={() => handleTest(server.id)}
                    disabled={isLoading}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 disabled:opacity-50"
                  >
                    {isLoading ? "Testing..." : "Test"}
                  </button>
                  <button
                    onClick={() => handleEditTools(server.id)}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                  >
                    Tools
                  </button>
                  <button
                    onClick={() => handleEdit(server.id)}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                  >
                    Edit
                  </button>
                  {confirmDelete === server.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(server.id)}
                        className="text-xs bg-red-500/10 text-red-500 rounded-md px-2 py-1"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-xs text-muted-foreground px-2 py-1"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(server.id)}
                      className="text-xs text-red-500 hover:text-red-400 px-2 py-1"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Server Add/Edit Form
// ===========================================================================

function McpServerForm({
  server,
  onSave,
  onCancel,
}: {
  server?: McpServerConfig;
  onSave: (data: McpServerCreate | McpServerUpdate) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(server?.name ?? "");
  const [transport, setTransport] = useState<"stdio" | "sse">(server?.transport ?? "stdio");
  const [command, setCommand] = useState(server?.command ?? "");
  const [args, setArgs] = useState(server?.args.join(" ") ?? "");
  const [envText, setEnvText] = useState(
    Object.entries(server?.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  );
  const [url, setUrl] = useState(server?.url ?? "");
  const [headersText, setHeadersText] = useState(
    Object.entries(server?.headers ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
  );
  const [autoStart, setAutoStart] = useState(server?.autoStart ?? false);
  const [timeout, setTimeout_] = useState(String(server?.timeout ?? 30000));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const parseEnv = (text: string): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
      }
    }
    return env;
  };

  const parseHeaders = (text: string): Record<string, string> => {
    const headers: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf(":");
      if (idx > 0) {
        headers[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
      }
    }
    return headers;
  };

  const handleSubmit = async () => {
    setFormError(null);
    if (!name.trim()) {
      setFormError("Name is required");
      return;
    }
    if (transport === "stdio" && !command.trim()) {
      setFormError("Command is required for stdio transport");
      return;
    }
    if (transport === "sse" && !url.trim()) {
      setFormError("URL is required for SSE transport");
      return;
    }

    setSaving(true);
    try {
      const data: McpServerCreate | McpServerUpdate = {
        name: name.trim(),
        transport,
        ...(transport === "stdio" && {
          command: command.trim(),
          args: args.trim() ? args.trim().split(/\s+/) : [],
          env: parseEnv(envText),
        }),
        ...(transport === "sse" && {
          url: url.trim(),
          headers: parseHeaders(headersText),
        }),
        autoStart,
        timeout: parseInt(timeout) || 30000,
      };
      await onSave(data);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const inputClass = "w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary";
  const labelClass = "text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block";

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">
          {server ? "Edit MCP Server" : "Add MCP Server"}
        </h2>
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
          Back
        </button>
      </div>

      {formError && (
        <div className="border border-red-500/30 bg-red-500/10 rounded-lg p-3 text-xs text-red-400">
          {formError}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className={labelClass}>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My MCP Server"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Transport</label>
          <div className="flex gap-2">
            <button
              onClick={() => setTransport("stdio")}
              className={`text-xs px-3 py-1.5 rounded-md ${
                transport === "stdio" ? "bg-primary text-primary-foreground" : "bg-secondary"
              }`}
            >
              stdio
            </button>
            <button
              onClick={() => setTransport("sse")}
              className={`text-xs px-3 py-1.5 rounded-md ${
                transport === "sse" ? "bg-primary text-primary-foreground" : "bg-secondary"
              }`}
            >
              SSE
            </button>
          </div>
        </div>

        {transport === "stdio" && (
          <>
            <div>
              <label className={labelClass}>Command</label>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx"
                className={`${inputClass} font-mono`}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Allowed: npx, node, python, python3, uvx, docker, deno
              </p>
            </div>

            <div>
              <label className={labelClass}>Arguments</label>
              <input
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                className={`${inputClass} font-mono`}
              />
            </div>

            <div>
              <label className={labelClass}>Environment Variables</label>
              <textarea
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                placeholder={"KEY=value\nANOTHER_KEY=another_value"}
                rows={3}
                className={`${inputClass} font-mono resize-none`}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                One per line: KEY=value. Sensitive vars are stored encrypted.
              </p>
            </div>
          </>
        )}

        {transport === "sse" && (
          <>
            <div>
              <label className={labelClass}>URL</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp-server.example.com/sse"
                className={`${inputClass} font-mono`}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                HTTPS required for non-localhost URLs
              </p>
            </div>

            <div>
              <label className={labelClass}>Headers</label>
              <textarea
                value={headersText}
                onChange={(e) => setHeadersText(e.target.value)}
                placeholder={"Authorization: Bearer your-token"}
                rows={2}
                className={`${inputClass} font-mono resize-none`}
              />
            </div>
          </>
        )}

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoStart(!autoStart)}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                autoStart ? "bg-primary" : "bg-secondary"
              }`}
            >
              <div
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  autoStart ? "translate-x-4" : ""
                }`}
              />
            </button>
            <span className="text-xs text-muted-foreground">Auto-start on boot</span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Timeout (ms):</label>
            <input
              value={timeout}
              onChange={(e) => setTimeout_(e.target.value)}
              className="w-20 bg-secondary rounded-md px-2 py-1 text-xs font-mono outline-none focus:ring-1 ring-primary"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="text-xs bg-primary text-primary-foreground px-4 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : server ? "Save Changes" : "Create Server"}
        </button>
        <button
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ===========================================================================
// Tool Approval Panel
// ===========================================================================

function McpToolApproval({
  server,
  onSave,
  onCancel,
}: {
  server: McpServerConfig;
  onSave: (allowedTools: string[] | null) => Promise<void>;
  onCancel: () => void;
}) {
  const tools = server.discoveredTools ?? [];
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (server.allowedTools === null) return new Set(tools.map((t) => t.name));
    return new Set(server.allowedTools);
  });
  const [allowAll, setAllowAll] = useState(server.allowedTools === null);
  const [saving, setSaving] = useState(false);

  const toggleTool = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setNext(next);
  };

  const setNext = (next: Set<string>) => {
    setSelected(next);
    setAllowAll(false);
  };

  const handleAllowAll = () => {
    setSelected(new Set(tools.map((t) => t.name)));
    setAllowAll(true);
  };

  const handleDenyAll = () => {
    setSelected(new Set());
    setAllowAll(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (allowAll) {
        await onSave(null);
      } else {
        await onSave([...selected]);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium">Tools - {server.name}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Select which tools from this server are available to agents
          </p>
        </div>
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
          Back
        </button>
      </div>

      {tools.length === 0 ? (
        <div className="border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
          No tools discovered. Start or test the server first.
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <button
              onClick={handleAllowAll}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
            >
              Allow All
            </button>
            <button
              onClick={handleDenyAll}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
            >
              Deny All
            </button>
            {allowAll && (
              <span className="text-[10px] text-yellow-400 flex items-center">
                All tools allowed (including future discoveries)
              </span>
            )}
          </div>

          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {tools.map((tool) => (
              <label
                key={tool.name}
                className="flex items-start gap-3 p-2 rounded-md hover:bg-secondary/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(tool.name)}
                  onChange={() => toggleTool(tool.name)}
                  className="mt-0.5 accent-primary"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-mono">{tool.name}</div>
                  {tool.description && (
                    <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                      {tool.description}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs bg-primary text-primary-foreground px-4 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={onCancel}
              className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
