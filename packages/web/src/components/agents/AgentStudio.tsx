import { useEffect, useRef, useState } from "react";
import type {
  AgentProfile,
  AgentConnectorStatus,
  AgentPeerAccess,
  AgentProfileSummary,
  ChannelConnectorStatus,
  Connection,
  McpServerConfig,
  McpServerStatus,
  Skill,
  ScheduledTask,
  MemoryEntry,
} from "@otterbot/shared";
import { apiFetch } from "../../lib/api";
import { useAgentsStore } from "../../stores/agents-store";
import { useChatStore } from "../../stores/chat-store";
import { useGlobalSettingsStore } from "../../stores/global-settings-store";
import { ModelSelect } from "./ModelSelect";
import { AvatarUpload } from "./AvatarUpload";
import { PeerAccessEditor, type IncomingPeer } from "./PeerAccessEditor";
import { TerminalModal } from "./TerminalModal";
import { SkillConfigForm } from "./SkillConfigForm";
import {
  useConnectionsStore,
  assignConnection,
  unassignConnection,
  fetchAgentConnections,
} from "../../stores/connections-store";

const TABS = ["Identity", "Persona", "Model", "Skills", "Connections", "Peers", "Schedule", "Memory", "Credentials"] as const;
type StudioTab = (typeof TABS)[number];

/** Full-screen agent management surface — identity, persona, model, skills,
 *  cron schedule, memory, and credentials for one agent. */
export function AgentStudio({
  agentId,
  onOpenSettings,
}: {
  agentId: string | null;
  onOpenSettings?: (tab?: string) => void;
}) {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [tab, setTab] = useState<StudioTab>("Identity");
  // Bumped after a full reset to remount the tab subtree, so the Memory tab
  // (which loads its list on mount) reflects the now-empty memory.
  const [resetNonce, setResetNonce] = useState(0);
  const reloadRoster = useAgentsStore((s) => s.load);
  const removeAgent = useAgentsStore((s) => s.remove);
  const currentConversation = useChatStore((s) => s.currentConversation);
  const newConversation = useChatStore((s) => s.newConversation);

  const loadProfile = () => {
    if (!agentId) return;
    void apiFetch(`/api/agents/${agentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p: AgentProfile | null) => setProfile(p));
  };

  // Clear the stale profile on agent switch so the tabs (which seed their
  // state from `profile` on mount) never briefly render another agent's data.
  useEffect(() => {
    setProfile(null);
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  if (!agentId) {
    return <Empty>Select an agent, then open the Agent Studio.</Empty>;
  }
  if (!profile) {
    return <Empty>Loading…</Empty>;
  }

  const onSaved = () => {
    loadProfile();
    void reloadRoster();
  };

  const resetAgent = async () => {
    if (
      !confirm(
        `Reset "${profile.displayName}"? This clears the current conversation and ` +
          `erases ALL of this agent's long-term memory. Skills and credentials are kept. ` +
          `This cannot be undone.`
      )
    ) {
      return;
    }
    const conversationId = currentConversation[profile.id] ?? undefined;
    const res = await apiFetch(`/api/agents/${profile.id}/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId }),
    });
    if (!res.ok) {
      alert("Reset failed.");
      return;
    }
    // Drop the now-cleared conversation locally and remount the tabs so the
    // Memory tab reloads its (empty) list.
    newConversation(profile.id);
    setResetNonce((n) => n + 1);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <header
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid rgb(var(--border))",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <strong style={{ fontSize: 14 }}>{profile.displayName}</strong>
        <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>Agent Studio</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={resetAgent} style={{ ...ghost, color: "#f87171" }}>
            Reset agent
          </button>
          {profile.role !== "coo" && (
            <button
              onClick={async () => {
                if (confirm(`Delete "${profile.displayName}" and all its data?`)) {
                  await removeAgent(profile.id);
                }
              }}
              style={{ ...ghost, color: "#f87171" }}
            >
              Delete agent
            </button>
          )}
        </div>
      </header>

      <nav style={{ display: "flex", gap: 4, padding: 6, borderBottom: "1px solid rgb(var(--border))", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t}
            data-testid={`studio-tab-${t}`}
            onClick={() => setTab(t)}
            style={{
              background: tab === t ? "rgb(var(--accent))" : "transparent",
              color: tab === t ? "white" : "rgb(var(--fg))",
              border: "1px solid rgb(var(--border))",
              padding: "3px 10px",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {t}
          </button>
        ))}
      </nav>

      {/*
       * The key remounts the tab subtree when the selected agent changes — tab
       * components seed local state from `profile` via useState, which only runs
       * on mount, so without this they would keep showing the previously-viewed
       * agent's settings. `resetNonce` also forces a remount after a full reset
       * so the Memory tab reloads its (now-empty) list.
       */}
      <div key={`${profile.id}-${resetNonce}`} style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {tab === "Identity" && <IdentityTab profile={profile} onSaved={onSaved} />}
        {tab === "Persona" && <PersonaTab profile={profile} onSaved={onSaved} />}
        {tab === "Model" && <ModelTab profile={profile} onSaved={onSaved} />}
        {tab === "Skills" && (
          <SkillsTab profile={profile} onSaved={onSaved} onOpenSettings={onOpenSettings} />
        )}
        {tab === "Connections" && <ChannelsTab profile={profile} onSaved={onSaved} />}
        {tab === "Peers" && <PeersTab profile={profile} onSaved={onSaved} />}
        {tab === "Schedule" && <ScheduleTab agentId={profile.id} />}
        {tab === "Memory" && <MemoryTab agentId={profile.id} />}
        {tab === "Credentials" && <CredentialsTab agentId={profile.id} />}
      </div>
    </div>
  );
}

// --- Identity -------------------------------------------------------------

function IdentityTab({ profile, onSaved }: TabProps) {
  const update = useAgentsStore((s) => s.update);

  const [displayName, setName] = useState(profile.displayName);
  const [email, setEmail] = useState(profile.email ?? "");
  const [transport, setTransport] = useState(profile.transport);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await update(profile.id, {
      displayName,
      email: email.trim() || null,
      transport,
    });
    setSaved(true);
    onSaved();
  };

  return (
    <Form>
      <Field label="Display name">
        <input value={displayName} onChange={(e) => setName(e.target.value)} style={input} />
      </Field>
      <Field label="Avatar">
        <AvatarUpload
          agentId={profile.id}
          name={profile.displayName}
          avatar={profile.artwork.avatar}
          onChange={onSaved}
        />
      </Field>
      <Field label="Email address">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="agent@otter.local" style={input} />
      </Field>
      <Field label="Agent-to-agent transport">
        <select value={transport} onChange={(e) => setTransport(e.target.value as "local" | "discord")} style={input}>
          <option value="local">local</option>
          <option value="discord">discord</option>
        </select>
      </Field>
      <SaveBar onSave={save} saved={saved} onDirty={() => setSaved(false)} />
    </Form>
  );
}

// --- Skills ---------------------------------------------------------------

/** Split a command line into the executable + its arguments. */
function parseCommand(line: string): { command: string; args: string[] } {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  return { command: parts[0] ?? "", args: parts.slice(1) };
}

const MCP_STATE_COLOR: Record<string, string> = {
  connected: "#4ade80",
  connecting: "rgb(var(--muted))",
  error: "#f87171",
  disabled: "rgb(var(--muted))",
};

/** A built-in skill catalog entry — mirrors the server's `CatalogCapability`. */
interface CatalogSkill {
  id: string;
  name: string;
  description: string;
  tools: string[];
}

/**
 * What an agent is allowed to do — installed skills, the core toggles
 * (shell / web / subagents), MCP servers, and the built-in skill catalog.
 */
function SkillsTab({
  profile,
  onSaved,
  onOpenSettings,
}: TabProps & { onOpenSettings?: (tab?: string) => void }) {
  const update = useAgentsStore((s) => s.update);
  const [canSpawn, setCanSpawn] = useState(profile.canSpawnSubagents);
  const [limit, setLimit] = useState(profile.subagentLimit);
  const [dispatchToSubagent, setDispatchToSubagent] = useState(profile.dispatchToSubagent);
  const [canRunShell, setCanRunShell] = useState(profile.canRunShell);
  const [canWebSearch, setCanWebSearch] = useState(profile.canWebSearch);
  const [autoLearn, setAutoLearn] = useState(profile.autoLearn);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(profile.mcpServers);
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus[]>([]);
  const [saved, setSaved] = useState(false);
  const [termOpen, setTermOpen] = useState(false);

  // --- Installed skills + catalog ---
  const [skills, setSkills] = useState<Skill[]>([]);
  const [catalog, setCatalog] = useState<CatalogSkill[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);
  // Skill whose Configure panel should auto-open (set right after install).
  const [configuredId, setConfiguredId] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);

  const loadSkills = () => {
    void apiFetch(`/api/agents/${profile.id}/skills`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setSkills);
  };
  useEffect(loadSkills, [profile.id]);
  useEffect(() => {
    void apiFetch("/api/skill-catalog")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCatalog);
  }, []);

  const installedIds = new Set(skills.map((s) => s.id));

  const installSkill = async (id: string) => {
    setAddingId(id);
    setSkillError(null);
    const res = await apiFetch(`/api/agents/${profile.id}/skills/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ catalogId: id }),
    });
    setAddingId(null);
    if (res.ok) {
      // Prompt for configuration right away if the skill declares a schema.
      const skill = (await res.json()) as Skill;
      if (skill?.meta?.configSchema) setConfiguredId(id);
      loadSkills();
    } else {
      setSkillError((await res.json())?.error ?? `Failed to install ${id}`);
    }
  };

  const toggleSkill = async (id: string, enabled: boolean) => {
    const res = await apiFetch(`/api/agents/${profile.id}/skills/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (res.ok) loadSkills();
  };

  const saveSkillBody = async (id: string, body: string) => {
    const res = await apiFetch(`/api/agents/${profile.id}/skills/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (res.ok) loadSkills();
  };

  const addCustomSkill = async () => {
    if (!raw.trim()) return;
    setBusy(true);
    const res = await apiFetch(`/api/agents/${profile.id}/skills`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    setBusy(false);
    if (res.ok) {
      setRaw("");
      loadSkills();
    } else {
      alert((await res.json())?.error ?? "Failed to add skill");
    }
  };

  const delSkill = async (id: string) => {
    await apiFetch(`/api/agents/${profile.id}/skills/${id}`, { method: "DELETE" });
    loadSkills();
  };

  const refreshMcp = () =>
    apiFetch(`/api/agents/${profile.id}/mcp`)
      .then((r) => (r.ok ? (r.json() as Promise<McpServerStatus[]>) : null))
      .then((s) => s && setMcpStatus(s))
      .catch(() => {});
  useEffect(() => {
    void refreshMcp();
    const timer = setInterval(refreshMcp, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const setServer = (i: number, patch: Partial<McpServerConfig>) =>
    setMcpServers((list) => list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const save = async () => {
    await update(profile.id, {
      canSpawnSubagents: canSpawn,
      subagentLimit: limit,
      dispatchToSubagent: canSpawn && dispatchToSubagent,
      canRunShell,
      canWebSearch,
      autoLearn,
      mcpServers: mcpServers.filter((s) => s.name.trim()),
    });
    setSaved(true);
    onSaved();
    void refreshMcp();
  };

  return (
    <Form>
      <p style={hint}>
        Skills bundle the tools an agent needs with a prompt that drives them. Enabled
        skills are always active — their tools are granted and their prompt is injected
        every turn.
      </p>

      {/* --- Installed skills --- */}
      <strong style={{ fontSize: 13 }}>Installed skills ({skills.length})</strong>
      {skills.length === 0 && <div style={hint}>No skills installed yet.</div>}
      {skillError && <div style={{ ...hint, color: "#f87171" }}>{skillError}</div>}
      {skills.map((s) => (
        <InstalledSkill
          key={s.id}
          skill={s}
          agentId={profile.id}
          autoOpenConfig={s.id === configuredId}
          onToggle={(en) => void toggleSkill(s.id, en)}
          onSaveBody={(body) => void saveSkillBody(s.id, body)}
          onRemove={() => void delSkill(s.id)}
          onOpenSettings={onOpenSettings}
        />
      ))}

      {/* --- Core toggles --- */}
      <strong style={{ fontSize: 13, marginTop: 8 }}>Core tools</strong>
      <p style={{ ...hint, marginTop: 0 }}>
        Always-available toggles, independent of installed skills.
      </p>

      <div style={channelCard}>
        <label style={checkboxRow}>
          <input
            type="checkbox"
            checked={canRunShell}
            onChange={(e) => setCanRunShell(e.target.checked)}
          />
          Shell access
        </label>
        <p style={{ ...hint, marginTop: 0 }}>
          A <code>shell_exec</code> tool that runs commands in a sandboxed per-agent workspace —
          confined to that directory (bubblewrap on Linux, sandbox-exec on macOS). It runs real
          commands; only enable it for agents you trust.
        </p>
        {profile.canRunShell ? (
          <button
            type="button"
            style={{ ...ghost, alignSelf: "flex-start" }}
            onClick={() => setTermOpen(true)}
          >
            ⌨ Launch terminal
          </button>
        ) : (
          canRunShell && (
            <p style={{ ...hint, marginTop: 0, fontStyle: "italic" }}>
              Save to enable the interactive terminal.
            </p>
          )
        )}
      </div>

      <div style={channelCard}>
        <label style={checkboxRow}>
          <input
            type="checkbox"
            checked={canWebSearch}
            onChange={(e) => setCanWebSearch(e.target.checked)}
          />
          Web search
        </label>
        <p style={{ ...hint, marginTop: 0 }}>
          A <code>web_search</code> tool that queries DuckDuckGo — keyless, no setup.
        </p>
      </div>

      <div style={channelCard}>
        <label style={checkboxRow}>
          <input
            type="checkbox"
            checked={canSpawn}
            onChange={(e) => setCanSpawn(e.target.checked)}
          />
          Spawn subagents
        </label>
        {canSpawn && (
          <>
            <label
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "rgb(var(--muted))" }}
            >
              Limit
              <input
                type="number"
                min={0}
                max={20}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                style={{ ...input, width: 80 }}
              />
            </label>
            <label style={checkboxRow}>
              <input
                type="checkbox"
                checked={dispatchToSubagent}
                onChange={(e) => setDispatchToSubagent(e.target.checked)}
              />
              Dispatch delegated work to a subagent
            </label>
            <p style={{ ...hint, marginTop: 0 }}>
              When another agent delegates a task to this one, hand it to a fresh subagent
              instead of running it on this agent's serial queue — so it can serve many
              requesters in parallel (e.g. an image-generation service agent).
            </p>
          </>
        )}
      </div>

      {/* --- Learning --- */}
      <strong style={{ fontSize: 13, marginTop: 8 }}>Learning</strong>
      <div style={channelCard}>
        <label style={checkboxRow}>
          <input
            type="checkbox"
            checked={autoLearn}
            onChange={(e) => setAutoLearn(e.target.checked)}
          />
          Auto-learning
        </label>
        <p style={{ ...hint, marginTop: 0 }}>
          When a chat session closes, the agent reflects on it — summarizing the conversation,
          extracting facts into memory, rebuilding its user profile, and optionally authoring a
          skill. Turn this off to keep the agent's memory and skills frozen.
        </p>
      </div>

      <div style={channelCard}>
        <strong style={{ fontSize: 12 }}>MCP servers</strong>
        <p style={{ ...hint, marginTop: 0 }}>
          Connect Model Context Protocol servers; their tools are added to this agent. stdio
          servers run as local processes (unsandboxed) with the agent's credentials as env.
        </p>
        {mcpServers.map((s, i) => {
          const st = mcpStatus.find((x) => x.name === s.name);
          return (
            <div key={i} style={{ ...channelCard, gap: 6 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  value={s.name}
                  onChange={(e) => setServer(i, { name: e.target.value })}
                  placeholder="server name"
                  style={{ ...input, flex: 1 }}
                />
                <select
                  value={s.transport}
                  onChange={(e) => setServer(i, { transport: e.target.value as "stdio" | "sse" })}
                  style={{ ...input, flex: "0 0 90px" }}
                >
                  <option value="stdio">stdio</option>
                  <option value="sse">sse</option>
                </select>
                <label style={{ ...checkboxRow, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => setServer(i, { enabled: e.target.checked })}
                  />
                  on
                </label>
                <button
                  type="button"
                  onClick={() => setMcpServers((l) => l.filter((_, idx) => idx !== i))}
                  style={{ ...ghost, padding: "4px 10px" }}
                >
                  Remove
                </button>
              </div>
              {s.transport === "stdio" ? (
                <input
                  value={[s.command ?? "", ...(s.args ?? [])].filter(Boolean).join(" ")}
                  onChange={(e) => setServer(i, parseCommand(e.target.value))}
                  placeholder="npx -y @modelcontextprotocol/server-filesystem /path"
                  style={{ ...input, fontFamily: "monospace", fontSize: 12 }}
                />
              ) : (
                <input
                  value={s.url ?? ""}
                  onChange={(e) => setServer(i, { url: e.target.value })}
                  placeholder="https://mcp.example.com/sse"
                  style={{ ...input, fontFamily: "monospace", fontSize: 12 }}
                />
              )}
              {st && (
                <span style={{ fontSize: 11, color: MCP_STATE_COLOR[st.state] ?? "rgb(var(--muted))" }}>
                  {st.state === "connected"
                    ? `✓ connected · ${st.toolCount} tool(s)`
                    : st.state === "error"
                      ? `✗ ${st.error ?? "failed"}`
                      : st.state}
                </span>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() =>
            setMcpServers((l) => [
              ...l,
              { name: "", transport: "stdio", enabled: true, command: "", args: [], url: "" },
            ])
          }
          style={{ ...ghost, alignSelf: "flex-start" }}
        >
          + Add MCP server
        </button>
      </div>

      <SaveBar onSave={save} saved={saved} onDirty={() => setSaved(false)} />

      {/* --- Built-in skill catalog --- */}
      <strong style={{ fontSize: 13, marginTop: 8 }}>
        Skill catalog{catalog.length > 0 ? ` (${catalog.length})` : ""}
      </strong>
      <p style={{ ...hint, marginTop: 0 }}>
        First-party skills bundled with Otterbot. Installing one copies its definition onto
        the agent — already tool-equipped, enabled by default.
      </p>
      {catalog.length === 0 && <div style={hint}>Loading catalog…</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {catalog.map((c) => {
          const installed = installedIds.has(c.id);
          return (
            <div key={c.id} style={{ ...card, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 12 }}>{c.name}</strong>
                {c.tools.map((t) => (
                  <span key={t} style={badge}>
                    {t}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 11, color: "rgb(var(--muted))", flex: 1 }}>
                {c.description}
              </div>
              <button
                onClick={() => void installSkill(c.id)}
                disabled={installed || addingId === c.id}
                style={{
                  ...ghost,
                  alignSelf: "flex-start",
                  opacity: installed ? 0.6 : 1,
                  cursor: installed ? "default" : "pointer",
                }}
              >
                {installed ? "Installed ✓" : addingId === c.id ? "Adding…" : "Add to agent"}
              </button>
            </div>
          );
        })}
      </div>

      {/* --- Custom skill --- */}
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          Add a custom skill
        </summary>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <Field label="Skill markdown (YAML frontmatter + body)">
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={8}
              placeholder={
                "---\nname: My skill\ndescription: ...\ntools: [shell_exec]\ntags: [custom]\n---\n\n## Setup\n...\n\n## Usage\n..."
              }
              style={{ ...input, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
            />
          </Field>
          <button onClick={addCustomSkill} disabled={busy} style={primary}>
            {busy ? "Adding…" : "Add skill"}
          </button>
        </div>
      </details>

      {termOpen && (
        <TerminalModal
          agentId={profile.id}
          agentName={profile.displayName}
          onClose={() => setTermOpen(false)}
        />
      )}
    </Form>
  );
}

/** One installed skill: enable/disable toggle, config form, editable body, badges. */
function InstalledSkill({
  skill,
  agentId,
  autoOpenConfig,
  onToggle,
  onSaveBody,
  onRemove,
  onOpenSettings,
}: {
  skill: Skill;
  agentId: string;
  autoOpenConfig?: boolean;
  onToggle: (enabled: boolean) => void;
  onSaveBody: (body: string) => void;
  onRemove: () => void;
  onOpenSettings?: (tab?: string) => void;
}) {
  const [body, setBody] = useState(skill.body);
  const [open, setOpen] = useState(!!autoOpenConfig);
  const [showConfig, setShowConfig] = useState(!!autoOpenConfig);
  const dirty = body !== skill.body;
  const hasConfig = !!skill.meta.configSchema;
  return (
    <details style={card} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary
        style={{
          cursor: "pointer",
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <strong style={{ fontSize: 13, whiteSpace: "nowrap" }}>{skill.meta.name}</strong>
        <span style={badge}>{skill.source}</span>
        {hasConfig && <span style={{ ...badge, color: "rgb(var(--accent))" }}>⚙ configurable</span>}
        {skill.meta.tools.map((t) => (
          <span key={t} style={badge}>
            {t}
          </span>
        ))}
        {(skill.meta.mcpServers ?? []).map((m) => (
          <span key={m.name} style={badge}>
            mcp:{m.name}
          </span>
        ))}
        <span style={{ fontSize: 11, color: "rgb(var(--muted))", whiteSpace: "nowrap" }}>
          used {skill.useCount}×
        </span>
        <button
          onClick={onRemove}
          style={{ ...ghost, marginLeft: "auto", color: "#f87171" }}
        >
          Remove
        </button>
      </summary>
      <label style={{ ...checkboxRow, marginTop: 8 }}>
        <input
          type="checkbox"
          checked={skill.enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        Enabled {skill.enabled ? "— tools granted, prompt active" : "— inactive"}
      </label>
      <div style={{ fontSize: 12, color: "rgb(var(--muted))", marginTop: 6 }}>
        {skill.meta.description}
      </div>
      {skill.id === "coding-cli" && (
        <div style={{ ...hint, marginTop: 8 }}>
          Installing and logging in are shared by all agents — set them up once in{" "}
          <button
            type="button"
            onClick={() => onOpenSettings?.("Coding CLIs")}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: "rgb(var(--accent))",
              cursor: "pointer",
              font: "inherit",
              textDecoration: "underline",
            }}
          >
            Settings → Coding CLIs
          </button>
          . The options below just pin a default tool/model for this agent.
        </div>
      )}
      {hasConfig && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setShowConfig((v) => !v)}
            style={{ ...ghost, alignSelf: "flex-start" }}
          >
            {showConfig ? "Hide configuration" : "⚙ Configure"}
          </button>
          {showConfig && (
            <SkillConfigForm
              agentId={agentId}
              skillId={skill.id}
              schema={skill.meta.configSchema!}
            />
          )}
        </div>
      )}
      <Field label="Customization prompt">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          style={{ ...input, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
        />
      </Field>
      <button
        onClick={() => onSaveBody(body)}
        disabled={!dirty}
        style={{ ...primary, alignSelf: "flex-start", opacity: dirty ? 1 : 0.6 }}
      >
        Save changes
      </button>
    </details>
  );
}

// --- Channels -------------------------------------------------------------

/** Split a comma/newline-separated id list into a trimmed array. */
function parseIds(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Slack / Discord chat connectors: tokens, channel id, and the access gate. */
/** A coloured dot + label for one connector's live state. */
function ConnectorBadge({ s }: { s: ChannelConnectorStatus | undefined }) {
  if (!s || !s.enabled) return null;
  const view: Record<string, { color: string; text: string }> = {
    connected: { color: "#4ade80", text: "Connected" },
    connecting: { color: "rgb(var(--muted))", text: "Connecting…" },
    "missing-tokens": { color: "#fbbf24", text: s.error ?? "Tokens missing" },
    error: { color: "#f87171", text: s.error ?? "Connection failed" },
    off: { color: "rgb(var(--muted))", text: "" },
  };
  const v = view[s.state] ?? view.off;
  if (!v.text) return null;
  return (
    <span style={{ fontSize: 12, color: v.color, display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: v.color }} />
      {v.text}
    </span>
  );
}

function ChannelsTab({ profile }: TabProps) {
  const connections = useConnectionsStore((s) => s.connections);
  const connectionTypes = useConnectionsStore((s) => s.connectionTypes);
  const loadConnections = useConnectionsStore((s) => s.load);
  const [assigned, setAssigned] = useState<Connection[]>([]);
  const [connStatus, setConnStatus] = useState<AgentConnectorStatus | null>(null);
  const [error, setError] = useState("");

  const refresh = () => fetchAgentConnections(profile.id).then(setAssigned).catch(() => {});
  const refreshStatus = () =>
    apiFetch(`/api/agents/${profile.id}/connectors`)
      .then((r) => (r.ok ? (r.json() as Promise<AgentConnectorStatus>) : null))
      .then(setConnStatus)
      .catch(() => {});

  useEffect(() => {
    void loadConnections();
    void refresh();
    void refreshStatus();
    const timer = setInterval(refreshStatus, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const typeOf = (type: string) => connectionTypes.find((t) => t.type === type);
  const isChat = (type: string) => typeOf(type)?.isChat ?? false;
  const assignedIds = new Set(assigned.map((c) => c.id));
  const assignedChatTypes = new Set(assigned.filter((c) => isChat(c.type)).map((c) => c.type));

  const chatBadge = (type: string) => {
    if (!connStatus) return undefined;
    if (type === "slack") return connStatus.slack;
    if (type === "discord") return connStatus.discord;
    if (type === "matrix") return connStatus.matrix;
    return undefined;
  };

  const doAssign = async (id: string) => {
    const res = await assignConnection(profile.id, id);
    if (!res.ok) {
      setError(res.error ?? "Could not assign.");
    } else {
      setError("");
      await refresh();
      void refreshStatus();
    }
  };
  const doUnassign = async (id: string) => {
    await unassignConnection(profile.id, id);
    await refresh();
    void refreshStatus();
  };

  // Available = not already assigned here. Chat connections taken by another
  // agent, or a second chat connection of a service this agent already has,
  // are shown disabled (v1: one chat connection per agent per service).
  const available = connections.filter((c) => !assignedIds.has(c.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={hint}>
        Assign reusable connections to this agent. Create and edit them in{" "}
        <strong>Settings → Connections</strong>.
      </p>

      <section>
        <h4 style={{ margin: "0 0 8px", fontSize: 13, opacity: 0.8 }}>Assigned</h4>
        {assigned.length === 0 && <p style={hint}>No connections assigned.</p>}
        {assigned.map((c) => (
          <div key={c.id} style={connRow}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: 600 }}>
                {c.label} <span style={connBadge}>{typeOf(c.type)?.label ?? c.type}</span>
              </span>
              {isChat(c.type) && <ConnectorBadge s={chatBadge(c.type)} />}
            </div>
            <button style={connGhostDanger} onClick={() => void doUnassign(c.id)}>
              Unassign
            </button>
          </div>
        ))}
      </section>

      <section>
        <h4 style={{ margin: "0 0 8px", fontSize: 13, opacity: 0.8 }}>Available</h4>
        {available.length === 0 && <p style={hint}>No other connections defined.</p>}
        {available.map((c) => {
          const takenElsewhere = isChat(c.type) && c.assignedAgentIds.length > 0;
          const dupService = isChat(c.type) && assignedChatTypes.has(c.type);
          const disabled = takenElsewhere || dupService;
          const note = takenElsewhere
            ? "in use by another agent"
            : dupService
              ? `already have a ${c.type} connection`
              : "";
          return (
            <div key={c.id} style={connRow}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 600, opacity: disabled ? 0.5 : 1 }}>
                  {c.label} <span style={connBadge}>{typeOf(c.type)?.label ?? c.type}</span>
                </span>
                {note && <span style={hint}>{note}</span>}
              </div>
              <button style={connGhost} disabled={disabled} onClick={() => void doAssign(c.id)}>
                Assign
              </button>
            </div>
          );
        })}
      </section>

      {error && <span style={{ fontSize: 12, color: "#f87171" }}>{error}</span>}
    </div>
  );
}

const connRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 10px",
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  marginBottom: 6,
};
const connBadge: React.CSSProperties = {
  fontSize: 11,
  padding: "1px 6px",
  borderRadius: 6,
  background: "rgb(var(--bg))",
  border: "1px solid rgb(var(--border))",
  color: "rgb(var(--muted))",
};
const connGhost: React.CSSProperties = {
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid rgb(var(--border))",
  background: "transparent",
  color: "rgb(var(--fg))",
  cursor: "pointer",
};
const connGhostDanger: React.CSSProperties = { ...connGhost, color: "tomato" };

/** Card wrapper shared by the Skills tab's tool/MCP sections. */
const channelCard: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: 12,
};

// --- Persona --------------------------------------------------------------

function PersonaTab({ profile, onSaved }: TabProps) {
  const update = useAgentsStore((s) => s.update);
  const [persona, setPersona] = useState(profile.persona);
  const [saved, setSaved] = useState(false);
  return (
    <Form>
      <Field label="Persona (SOUL.md) — the agent's identity and behaviour">
        <textarea
          value={persona}
          onChange={(e) => {
            setPersona(e.target.value);
            setSaved(false);
          }}
          rows={16}
          style={{ ...input, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
        />
      </Field>
      <SaveBar
        onSave={async () => {
          await update(profile.id, { persona });
          setSaved(true);
          onSaved();
        }}
        saved={saved}
        onDirty={() => setSaved(false)}
      />
    </Form>
  );
}

// --- Model ----------------------------------------------------------------

function ModelTab({ profile, onSaved }: TabProps) {
  const update = useAgentsStore((s) => s.update);
  const settings = useGlobalSettingsStore((s) => s.settings);
  const loadSettings = useGlobalSettingsStore((s) => s.load);
  useEffect(() => void loadSettings(), [loadSettings]);
  const models = settings.models;

  const [chat, setChat] = useState(profile.model.chat);
  const [emb, setEmb] = useState(profile.model.embedding);
  const [saved, setSaved] = useState(false);
  const dirty = () => setSaved(false);

  return (
    <Form>
      <p style={hint}>
        Pick this agent's models by name. Models and their provider accounts are managed in Global
        Settings → Models. Editing a model there updates every agent using it.
      </p>
      <Field label="Chat model">
        <ModelSelect
          models={models}
          kind="chat"
          value={chat}
          onChange={(v) => {
            setChat(v);
            dirty();
          }}
        />
      </Field>
      <Field label="Embedding model (for semantic memory)">
        <ModelSelect
          models={models}
          kind="embedding"
          value={emb}
          onChange={(v) => {
            setEmb(v);
            dirty();
          }}
          allowNone
        />
      </Field>
      <SaveBar
        onSave={async () => {
          await update(profile.id, { model: { chat, embedding: emb } });
          setSaved(true);
          onSaved();
        }}
        saved={saved}
        onDirty={dirty}
      />
    </Form>
  );
}

// --- Peers ----------------------------------------------------------------

/** Which other agents this agent may message and whose memory it may read. */
function PeersTab({ profile, onSaved }: TabProps) {
  const [peerAgents, setPeerAgents] = useState<{ id: string; displayName: string }[]>([]);
  const [incoming, setIncoming] = useState<IncomingPeer[]>([]);
  const [draft, setDraft] = useState<AgentPeerAccess[]>(profile.allowedPeers ?? []);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiFetch("/api/agents")
      .then((r) => (r.ok ? (r.json() as Promise<AgentProfileSummary[]>) : []))
      .then(async (list) => {
        if (cancelled) return;
        const others = list.filter((a) => a.id !== profile.id && a.role !== "subagent");
        setPeerAgents(others.map((a) => ({ id: a.id, displayName: a.displayName })));

        // Compute who can reach THIS agent. The COO always can (implicit, not in
        // its stored allowedPeers); every other agent that lists this one does.
        const coo = others.find((a) => a.role === "coo");
        const fromOthers = await Promise.all(
          others
            .filter((a) => a.role !== "coo")
            .map((a) =>
              apiFetch(`/api/agents/${a.id}`)
                .then((r) => (r.ok ? (r.json() as Promise<AgentProfile>) : null))
                .then((p): IncomingPeer | null => {
                  const grant = p?.allowedPeers?.find((peer) => peer.agentId === profile.id);
                  if (!grant) return null;
                  return {
                    agentId: a.id,
                    displayName: a.displayName,
                    level: grant.shareMemory ? "memory" : "message",
                  };
                })
                .catch(() => null)
            )
        );
        if (cancelled) return;
        const result = fromOthers.filter((x): x is IncomingPeer => x !== null);
        if (coo && profile.role !== "coo") {
          result.unshift({ agentId: coo.id, displayName: coo.displayName, level: "always" });
        }
        setIncoming(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [profile.id, profile.role]);

  const isCoo = profile.role === "coo";

  const save = async () => {
    const res = await apiFetch(`/api/agents/${profile.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowedPeers: draft }),
    });
    if (res.ok) {
      setSaved(true);
      onSaved();
    }
  };

  return (
    <Form>
      <p style={hint}>
        An arrow A → B means A may message B. The COO can always reach every agent.
      </p>
      <PeerAccessEditor
        agentName={profile.displayName}
        peers={draft}
        peerAgents={peerAgents}
        incoming={incoming}
        isCoo={isCoo}
        onChange={(next) => {
          setDraft(next);
          setSaved(false);
        }}
      />
      {!isCoo && peerAgents.length > 0 && (
        <SaveBar onSave={save} saved={saved} onDirty={() => setSaved(false)} />
      )}
    </Form>
  );
}

// --- Schedule -------------------------------------------------------------

function ScheduleTab({ agentId }: { agentId: string }) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [cron, setCron] = useState("0 9 * * *");
  const [prompt, setPrompt] = useState("");

  const load = () => {
    void apiFetch(`/api/agents/${agentId}/scheduled-tasks`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setTasks);
  };
  useEffect(load, [agentId]);

  const add = async () => {
    if (!prompt.trim()) return;
    const res = await apiFetch(`/api/agents/${agentId}/scheduled-tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cron, prompt }),
    });
    if (res.ok) {
      setPrompt("");
      load();
    } else {
      alert((await res.json())?.error ?? "Failed");
    }
  };

  const cancel = async (id: string) => {
    await apiFetch(`/api/scheduled-tasks/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <Form>
      <p style={hint}>
        Scheduled prompts run automatically on a cron expression — each fires a fresh turn for this
        agent. e.g. <code>0 9 * * *</code> = 9am daily.
      </p>
      {tasks.filter((t) => t.enabled).length === 0 && <div style={hint}>No scheduled tasks.</div>}
      {tasks
        .filter((t) => t.enabled)
        .map((t) => (
          <div key={t.id} style={card}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code style={{ fontSize: 12 }}>{t.cron}</code>
              <button onClick={() => cancel(t.id)} style={{ ...ghost, marginLeft: "auto", color: "#f87171" }}>
                Cancel
              </button>
            </div>
            <div style={{ fontSize: 12, marginTop: 4 }}>{t.prompt}</div>
            <div style={{ fontSize: 11, color: "rgb(var(--muted))", marginTop: 2 }}>
              next: {t.nextRunAt ?? "—"} · last: {t.lastRunAt ?? "never"}
            </div>
          </div>
        ))}
      <Row>
        <Field label="Cron">
          <input value={cron} onChange={(e) => setCron(e.target.value)} style={{ ...input, fontFamily: "monospace" }} />
        </Field>
        <Field label="Prompt">
          <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What should the agent do?" style={input} />
        </Field>
      </Row>
      <button onClick={add} style={primary}>
        Schedule task
      </button>
    </Form>
  );
}

// --- Memory ---------------------------------------------------------------

const MEMORY_CATEGORIES = ["fact", "preference", "instruction", "relationship", "general"] as const;
type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

function MemoryTab({ agentId }: { agentId: string }) {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("fact");
  const [busy, setBusy] = useState(false);
  const [transfer, setTransfer] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  const load = () => {
    void apiFetch(`/api/agents/${agentId}/memories`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setMemories);
  };
  useEffect(load, [agentId]);

  const exportMemory = async () => {
    setTransfer("");
    const res = await apiFetch(`/api/agents/${agentId}/memory/export`);
    if (!res.ok) {
      setTransfer((await res.json().catch(() => ({})))?.error ?? "Export failed.");
      return;
    }
    const blob = await res.blob();
    const match = res.headers.get("content-disposition")?.match(/filename="(.+?)"/);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = match?.[1] ?? "agent-memory.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importMemory = async (file: File) => {
    setTransfer("");
    setBusy(true);
    const body = new FormData();
    body.append("file", file);
    const res = await apiFetch(`/api/agents/${agentId}/memory/import`, { method: "POST", body });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTransfer(data?.error ?? "Import failed.");
      return;
    }
    setTransfer(
      `Imported ${data.memories} ${data.memories === 1 ? "memory" : "memories"}` +
        `, ${data.summaries} ${data.summaries === 1 ? "summary" : "summaries"}` +
        (data.profileMerged ? ", merged user profile." : ".")
    );
    load();
  };

  const del = async (id: string) => {
    await apiFetch(`/api/agents/${agentId}/memories/${id}`, { method: "DELETE" });
    load();
  };

  const add = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    const res = await apiFetch(`/api/agents/${agentId}/memories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: draft.trim(), category }),
    });
    setBusy(false);
    if (res.ok) {
      setDraft("");
      load();
    } else {
      alert((await res.json())?.error ?? "Failed to add memory");
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? memories.filter(
        (m) => m.content.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)
      )
    : memories;

  return (
    <Form>
      <p style={hint}>
        What this agent remembers across sessions. The agent saves memories as it works; you can
        also add, search, and remove them here.
      </p>

      {/* --- Export / import --- */}
      <Row>
        <button onClick={exportMemory} style={ghost}>
          Export memory
        </button>
        <button onClick={() => importRef.current?.click()} disabled={busy} style={ghost}>
          {busy ? "Importing…" : "Import memory"}
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importMemory(file);
          }}
        />
      </Row>
      {transfer && <p style={hint}>{transfer}</p>}

      {/* --- Add a memory --- */}
      <Field label="Add a memory">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="e.g. The user's name is Mike."
          style={{ ...input, resize: "vertical", fontFamily: "inherit" }}
        />
      </Field>
      <Row>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as MemoryCategory)}
          style={{ ...input, flex: "0 0 160px" }}
        >
          {MEMORY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button onClick={add} disabled={busy || !draft.trim()} style={primary}>
          {busy ? "Saving…" : "Add memory"}
        </button>
      </Row>

      {/* --- Search + list --- */}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search memories…"
        style={input}
      />
      <p style={hint}>
        {q ? `${filtered.length} of ${memories.length}` : memories.length}{" "}
        {memories.length === 1 ? "memory" : "memories"}.
      </p>
      {filtered.map((m) => (
        <div key={m.id} style={card}>
          <div style={{ display: "flex", gap: 6, fontSize: 11, color: "rgb(var(--muted))", alignItems: "center" }}>
            <span style={badge}>{m.category}</span>
            <span style={badge}>via {m.source}</span>
            <span>importance {m.importance}</span>
            <button onClick={() => del(m.id)} style={{ ...ghost, marginLeft: "auto", color: "#f87171" }}>
              Forget
            </button>
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{m.content}</div>
        </div>
      ))}
      {memories.length === 0 && <div style={hint}>No memories yet.</div>}
      {memories.length > 0 && filtered.length === 0 && <div style={hint}>No memories match.</div>}
    </Form>
  );
}

// --- Credentials ----------------------------------------------------------

interface SlackTestResult {
  ok: boolean;
  team?: string;
  user?: string;
  error?: string;
}

type ScopeKind = "direct" | "broad" | "cap";

interface CredentialRow {
  key: string;
  scope: string;
}

interface CatalogCap {
  id: string;
  name: string;
  description: string;
  credentialKeys?: string[];
}

function parseScope(scope: string): { kind: ScopeKind; capIds: string[] } {
  if (scope === "direct") return { kind: "direct", capIds: [] };
  if (scope.startsWith("cap:")) {
    return {
      kind: "cap",
      capIds: scope
        .slice(4)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }
  return { kind: "broad", capIds: [] };
}

function serializeScope(kind: ScopeKind, capIds: string[]): string {
  if (kind === "direct") return "direct";
  if (kind === "broad") return "broad";
  const ids = capIds.map((s) => s.trim()).filter(Boolean);
  return ids.length > 0 ? `cap:${ids.join(",")}` : "broad";
}

function CredentialsTab({ agentId }: { agentId: string }) {
  const [rows, setRows] = useState<CredentialRow[]>([]);
  const [catalog, setCatalog] = useState<CatalogCap[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newKind, setNewKind] = useState<ScopeKind>("broad");
  const [newCapIds, setNewCapIds] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [slackTest, setSlackTest] = useState<SlackTestResult | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = async () => {
    const res = await apiFetch(`/api/agents/${agentId}/credentials`);
    if (res.ok) setRows(((await res.json()).keys as CredentialRow[]) ?? []);
  };

  const loadCatalog = async () => {
    const res = await apiFetch("/api/skill-catalog");
    if (res.ok) setCatalog(((await res.json()) as CatalogCap[]) ?? []);
  };

  useEffect(() => {
    void load();
    void loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // Auto-suggest a scope when the user types a known key name.
  useEffect(() => {
    const key = newKey.trim().toUpperCase();
    if (!key || catalog.length === 0) return;
    const match = catalog.find((c) =>
      (c.credentialKeys ?? []).some((k) => k.toUpperCase() === key),
    );
    if (!match) return;
    // Don't override an explicit user choice already in progress.
    if (newKind === "broad" && newCapIds.length === 0) {
      setNewKind("cap");
      setNewCapIds([match.id]);
    }
  }, [newKey, catalog]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    const key = newKey.trim();
    if (!key || !newValue) return;
    setBusy(true);
    const scope = serializeScope(newKind, newCapIds);
    const res = await apiFetch(`/api/agents/${agentId}/credentials`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [key]: { value: newValue, scope } }),
    });
    if (res.ok) {
      const existed = rows.some((r) => r.key === key);
      setStatus(`${existed ? "Updated" : "Added"} ${key} — agent restarted.`);
      setNewKey("");
      setNewValue("");
      setNewKind("broad");
      setNewCapIds([]);
      await load();
    } else {
      setStatus("Failed to save.");
    }
    setBusy(false);
  };

  const remove = async (key: string) => {
    if (!confirm(`Delete credential ${key}? This only removes this one key.`)) return;
    setBusy(true);
    const res = await apiFetch(`/api/agents/${agentId}/credentials/${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setStatus(`Deleted ${key} — agent restarted.`);
      if (key === "SLACK_BOT_TOKEN") setSlackTest(null);
      await load();
    } else {
      setStatus("Failed to delete.");
    }
    setBusy(false);
  };

  const saveScope = async (key: string, nextScope: string) => {
    setBusy(true);
    const res = await apiFetch(
      `/api/agents/${agentId}/credentials/${encodeURIComponent(key)}/scope`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: nextScope }),
      },
    );
    if (res.ok) {
      setStatus(`Re-scoped ${key} → ${nextScope}.`);
      setEditing(null);
      await load();
    } else {
      setStatus("Failed to update scope.");
    }
    setBusy(false);
  };

  const testSlack = async () => {
    setBusy(true);
    setSlackTest(null);
    const res = await apiFetch(`/api/agents/${agentId}/credentials/test-slack`, { method: "POST" });
    setSlackTest((await res.json()) as SlackTestResult);
    setBusy(false);
  };

  return (
    <Form>
      <p style={hint}>
        Secrets for this agent only — API keys, GitHub token, SMTP, model endpoints. Stored
        encrypted in the database. <strong>Scope</strong> decides where each credential is
        exposed: <em>direct</em> (only structured integrations), <em>skill-bound</em>{" "}
        (only in the shell when that skill is enabled), or <em>broad shell</em> (every
        shell exec — use sparingly).
      </p>

      {rows.length === 0 && <div style={hint}>No credentials stored yet.</div>}
      {rows.map((row) => (
        <div key={row.key} style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <code style={{ fontSize: 12, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
              {row.key}
            </code>
            <span style={{ fontSize: 12, color: "rgb(var(--subtle))" }}>••••••</span>
            <ScopeChip scope={row.scope} />
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button
                onClick={() => setEditing(editing === row.key ? null : row.key)}
                disabled={busy}
                style={ghost}
              >
                {editing === row.key ? "Cancel" : "Scope"}
              </button>
              {row.key === "SLACK_BOT_TOKEN" && (
                <button onClick={testSlack} disabled={busy} style={ghost}>
                  Test
                </button>
              )}
              <button
                onClick={() => remove(row.key)}
                disabled={busy}
                style={{ ...ghost, color: "rgb(var(--danger))" }}
              >
                Delete
              </button>
            </div>
          </div>
          {editing === row.key && (
            <ScopeEditor
              current={row.scope}
              catalog={catalog}
              onCancel={() => setEditing(null)}
              onSave={(nextScope) => saveScope(row.key, nextScope)}
              busy={busy}
            />
          )}
          {row.key === "SLACK_BOT_TOKEN" && slackTest && (
            <div
              style={{
                fontSize: 12,
                color: slackTest.ok ? "rgb(var(--success))" : "rgb(var(--danger))",
              }}
            >
              {slackTest.ok
                ? `✓ valid — team '${slackTest.team}', bot '${slackTest.user}'`
                : `✗ ${slackTest.error}`}
            </div>
          )}
        </div>
      ))}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 12, color: "rgb(var(--muted))" }}>Add credential</span>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="KEY (e.g. GITHUB_TOKEN)"
            style={{ ...input, fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="value"
            type="password"
            style={{ ...input, fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
        </div>
        <ScopePicker
          kind={newKind}
          capIds={newCapIds}
          onKindChange={setNewKind}
          onCapIdsChange={setNewCapIds}
          catalog={catalog}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={add}
            disabled={busy || !newKey.trim() || !newValue || (newKind === "cap" && newCapIds.length === 0)}
            style={primary}
          >
            Add
          </button>
        </div>
      </div>

      {status && <span style={{ fontSize: 12, color: "rgb(var(--muted))" }}>{status}</span>}
    </Form>
  );
}

function ScopeChip({ scope }: { scope: string }) {
  const parsed = parseScope(scope);
  let label: string;
  let bg: string;
  let fg: string;
  let border: string;
  if (parsed.kind === "direct") {
    label = "direct";
    bg = "rgb(var(--neutral-bg))";
    fg = "rgb(var(--muted))";
    border = "rgb(var(--border))";
  } else if (parsed.kind === "broad") {
    label = "⚠ broad shell";
    bg = "rgb(var(--warning-bg))";
    fg = "rgb(var(--warning))";
    border = "rgb(var(--warning) / 0.3)";
  } else {
    label = parsed.capIds.length === 1 ? `cap:${parsed.capIds[0]}` : `cap:${parsed.capIds.length}`;
    bg = "rgb(var(--accent) / 0.15)";
    fg = "rgb(var(--accent))";
    border = "rgb(var(--accent) / 0.3)";
  }
  return (
    <span
      title={scope}
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        padding: "2px 6px",
        borderRadius: 4,
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
        fontFamily: "var(--font-mono)",
      }}
    >
      {label}
    </span>
  );
}

function ScopePicker({
  kind,
  capIds,
  onKindChange,
  onCapIdsChange,
  catalog,
}: {
  kind: ScopeKind;
  capIds: string[];
  onKindChange: (k: ScopeKind) => void;
  onCapIdsChange: (ids: string[]) => void;
  catalog: CatalogCap[];
}) {
  const toggleCap = (id: string) => {
    onCapIdsChange(capIds.includes(id) ? capIds.filter((x) => x !== id) : [...capIds, id]);
  };
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 10,
        border: "1px solid rgb(var(--border))",
        borderRadius: 7,
        background: "rgb(var(--surface-sunken))",
      }}
    >
      <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>Scope</span>
      <label style={radioRow}>
        <input
          type="radio"
          checked={kind === "direct"}
          onChange={() => onKindChange("direct")}
        />
        <span>
          <strong>Direct integrations only</strong>
          <span style={radioHint}> — never reachable from the agent's shell.</span>
        </span>
      </label>
      <label style={radioRow}>
        <input
          type="radio"
          checked={kind === "cap"}
          onChange={() => onKindChange("cap")}
        />
        <span>
          <strong>Bound to skill</strong>
          <span style={radioHint}> — exposed only when one of these skills is enabled.</span>
        </span>
      </label>
      {kind === "cap" && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginLeft: 22,
            marginBottom: 2,
          }}
        >
          {catalog.length === 0 && (
            <span style={{ fontSize: 11, color: "rgb(var(--subtle))" }}>
              Loading catalog…
            </span>
          )}
          {catalog.map((c) => {
            const on = capIds.includes(c.id);
            return (
              <button
                type="button"
                key={c.id}
                onClick={() => toggleCap(c.id)}
                title={c.description}
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  padding: "3px 8px",
                  borderRadius: 5,
                  border: `1px solid ${on ? "rgb(var(--accent))" : "rgb(var(--border))"}`,
                  background: on ? "rgb(var(--accent) / 0.15)" : "transparent",
                  color: on ? "rgb(var(--accent))" : "rgb(var(--fg))",
                  cursor: "pointer",
                }}
              >
                {c.id}
              </button>
            );
          })}
        </div>
      )}
      <label style={radioRow}>
        <input
          type="radio"
          checked={kind === "broad"}
          onChange={() => onKindChange("broad")}
        />
        <span>
          <strong style={{ color: "rgb(var(--warning))" }}>Broad shell</strong>
          <span style={radioHint}> — available in every shell exec. Use only when necessary.</span>
        </span>
      </label>
    </div>
  );
}

function ScopeEditor({
  current,
  catalog,
  onCancel,
  onSave,
  busy,
}: {
  current: string;
  catalog: CatalogCap[];
  onCancel: () => void;
  onSave: (scope: string) => void;
  busy: boolean;
}) {
  const initial = parseScope(current);
  const [kind, setKind] = useState<ScopeKind>(initial.kind);
  const [capIds, setCapIds] = useState<string[]>(initial.capIds);
  const next = serializeScope(kind, capIds);
  const dirty = next !== current && !(kind === "cap" && capIds.length === 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <ScopePicker
        kind={kind}
        capIds={capIds}
        onKindChange={setKind}
        onCapIdsChange={setCapIds}
        catalog={catalog}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <button onClick={onCancel} disabled={busy} style={ghost}>
          Cancel
        </button>
        <button onClick={() => onSave(next)} disabled={busy || !dirty} style={primary}>
          Save scope
        </button>
      </div>
    </div>
  );
}

const radioRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  fontSize: 12,
  lineHeight: 1.45,
  cursor: "pointer",
};

const radioHint: React.CSSProperties = {
  color: "rgb(var(--muted))",
};

// --- shared bits ----------------------------------------------------------

interface TabProps {
  profile: AgentProfile;
  onSaved: () => void;
}

function Form({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 620 }}>{children}</div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, flex: 1 }}>
      <span style={{ color: "rgb(var(--muted))" }}>{label}</span>
      {children}
    </label>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 10 }}>{children}</div>;
}

function SaveBar({
  onSave,
  saved,
  onDirty,
}: {
  onSave: () => void;
  saved: boolean;
  onDirty: () => void;
}) {
  void onDirty;
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <button onClick={onSave} style={primary}>
        Save
      </button>
      {saved && <span style={{ fontSize: 12, color: "#4ade80" }}>Saved ✓</span>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "rgb(var(--muted))",
        fontSize: 14,
      }}
    >
      {children}
    </div>
  );
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

const badge: React.CSSProperties = {
  fontSize: 10,
  color: "rgb(var(--muted))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 4,
  padding: "1px 5px",
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
