import { useEffect, useState } from "react";
import type {
  AgentProfile,
  AgentConnectorStatus,
  AgentPeerAccess,
  AgentProfileSummary,
  ChannelConnectorStatus,
  McpServerConfig,
  McpServerStatus,
  ProviderId,
  Skill,
  ScheduledTask,
  MemoryEntry,
} from "@otterbot/shared";
import { useAgentsStore } from "../../stores/agents-store";
import { useGlobalSettingsStore } from "../../stores/global-settings-store";
import { useProvidersStore } from "../../stores/providers-store";
import { BuiltinEmbedderControls } from "../BuiltinEmbedderControls";
import { ProviderOptions } from "../ProviderOptions";
import { AvatarUpload } from "./AvatarUpload";
import { PeerAccessEditor } from "./PeerAccessEditor";
import { TerminalModal } from "./TerminalModal";

const TABS = ["Identity", "Persona", "Model", "Capabilities", "Channels", "Peers", "Schedule", "Memory", "Credentials"] as const;
type StudioTab = (typeof TABS)[number];

/** Full-screen agent management surface — identity, persona, model, skills,
 *  cron schedule, memory, and credentials for one agent. */
export function AgentStudio({ agentId }: { agentId: string | null }) {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [tab, setTab] = useState<StudioTab>("Identity");
  const reloadRoster = useAgentsStore((s) => s.load);
  const removeAgent = useAgentsStore((s) => s.remove);

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
        <div style={{ marginLeft: "auto" }}>
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
       * key={profile.id} remounts the tab subtree when the selected agent
       * changes — tab components seed local state from `profile` via useState,
       * which only runs on mount, so without this they would keep showing the
       * previously-viewed agent's settings.
       */}
      <div key={profile.id} style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {tab === "Identity" && <IdentityTab profile={profile} onSaved={onSaved} />}
        {tab === "Persona" && <PersonaTab profile={profile} onSaved={onSaved} />}
        {tab === "Model" && <ModelTab profile={profile} onSaved={onSaved} />}
        {tab === "Capabilities" && <CapabilitiesTab profile={profile} onSaved={onSaved} />}
        {tab === "Channels" && <ChannelsTab profile={profile} onSaved={onSaved} />}
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

// --- Capabilities ---------------------------------------------------------

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

/** A built-in capability catalog entry — mirrors the server's `CatalogCapability`. */
interface CatalogCapability {
  id: string;
  name: string;
  description: string;
  tools: string[];
}

/**
 * What an agent is allowed to do — installed capabilities, the core toggles
 * (shell / web / subagents), MCP servers, and the built-in capability catalog.
 */
function CapabilitiesTab({ profile, onSaved }: TabProps) {
  const update = useAgentsStore((s) => s.update);
  const [canSpawn, setCanSpawn] = useState(profile.canSpawnSubagents);
  const [limit, setLimit] = useState(profile.subagentLimit);
  const [canRunShell, setCanRunShell] = useState(profile.canRunShell);
  const [canWebSearch, setCanWebSearch] = useState(profile.canWebSearch);
  const [autoLearn, setAutoLearn] = useState(profile.autoLearn);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(profile.mcpServers);
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus[]>([]);
  const [saved, setSaved] = useState(false);
  const [termOpen, setTermOpen] = useState(false);

  // --- Installed capabilities + catalog ---
  const [skills, setSkills] = useState<Skill[]>([]);
  const [catalog, setCatalog] = useState<CatalogCapability[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);
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

  const installCapability = async (id: string) => {
    setAddingId(id);
    setSkillError(null);
    const res = await apiFetch(`/api/agents/${profile.id}/skills/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ catalogId: id }),
    });
    setAddingId(null);
    if (res.ok) loadSkills();
    else setSkillError((await res.json())?.error ?? `Failed to install ${id}`);
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

  const addCustomCapability = async () => {
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
      alert((await res.json())?.error ?? "Failed to add capability");
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
        Capabilities bundle the tools an agent needs with a prompt that drives them. Enabled
        capabilities are always active — their tools are granted and their prompt is injected
        every turn.
      </p>

      {/* --- Installed capabilities --- */}
      <strong style={{ fontSize: 13 }}>Installed capabilities ({skills.length})</strong>
      {skills.length === 0 && <div style={hint}>No capabilities installed yet.</div>}
      {skillError && <div style={{ ...hint, color: "#f87171" }}>{skillError}</div>}
      {skills.map((s) => (
        <InstalledCapability
          key={s.id}
          skill={s}
          onToggle={(en) => void toggleSkill(s.id, en)}
          onSaveBody={(body) => void saveSkillBody(s.id, body)}
          onRemove={() => void delSkill(s.id)}
        />
      ))}

      {/* --- Core toggles --- */}
      <strong style={{ fontSize: 13, marginTop: 8 }}>Core tools</strong>
      <p style={{ ...hint, marginTop: 0 }}>
        Always-available toggles, independent of installed capabilities.
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
          capability. Turn this off to keep the agent's memory and capabilities frozen.
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

      {/* --- Built-in capability catalog --- */}
      <strong style={{ fontSize: 13, marginTop: 8 }}>
        Capability catalog{catalog.length > 0 ? ` (${catalog.length})` : ""}
      </strong>
      <p style={{ ...hint, marginTop: 0 }}>
        First-party capabilities bundled with Otterbot. Installing one copies its definition onto
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
                onClick={() => void installCapability(c.id)}
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

      {/* --- Custom capability --- */}
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          Add a custom capability
        </summary>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <Field label="Capability markdown (YAML frontmatter + body)">
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={8}
              placeholder={
                "---\nname: My capability\ndescription: ...\ntools: [shell_exec]\ntags: [custom]\n---\n\n## Setup\n...\n\n## Usage\n..."
              }
              style={{ ...input, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
            />
          </Field>
          <button onClick={addCustomCapability} disabled={busy} style={primary}>
            {busy ? "Adding…" : "Add capability"}
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

/** One installed capability: enable/disable toggle, editable body, tool + MCP badges. */
function InstalledCapability({
  skill,
  onToggle,
  onSaveBody,
  onRemove,
}: {
  skill: Skill;
  onToggle: (enabled: boolean) => void;
  onSaveBody: (body: string) => void;
  onRemove: () => void;
}) {
  const [body, setBody] = useState(skill.body);
  const dirty = body !== skill.body;
  return (
    <details style={card}>
      <summary style={{ cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }}>
        <strong style={{ fontSize: 13 }}>{skill.meta.name}</strong>
        <span style={badge}>{skill.source}</span>
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
        <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>used {skill.useCount}×</span>
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

function ChannelsTab({ profile, onSaved }: TabProps) {
  const update = useAgentsStore((s) => s.update);

  const [connStatus, setConnStatus] = useState<AgentConnectorStatus | null>(null);
  const refreshStatus = () =>
    apiFetch(`/api/agents/${profile.id}/connectors`)
      .then((r) => (r.ok ? (r.json() as Promise<AgentConnectorStatus>) : null))
      .then(setConnStatus)
      .catch(() => {});
  useEffect(() => {
    void refreshStatus();
    // Poll — a connector takes a moment to connect after a save / restart.
    const timer = setInterval(refreshStatus, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const [slackEnabled, setSlackEnabled] = useState(profile.slack?.enabled ?? false);
  const [slackChannel, setSlackChannel] = useState(profile.slack?.channelId ?? "");
  const [slackPublic, setSlackPublic] = useState(profile.slack?.publicBot ?? false);
  const [slackUsers, setSlackUsers] = useState((profile.slack?.allowedUserIds ?? []).join("\n"));
  const [slackMentionOnly, setSlackMentionOnly] = useState(profile.slack?.mentionOnly ?? true);
  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackAppToken, setSlackAppToken] = useState("");

  const [discordEnabled, setDiscordEnabled] = useState(profile.discord?.enabled ?? false);
  const [discordChannel, setDiscordChannel] = useState(profile.discord?.channelId ?? "");
  const [discordPublic, setDiscordPublic] = useState(profile.discord?.publicBot ?? false);
  const [discordUsers, setDiscordUsers] = useState(
    (profile.discord?.allowedUserIds ?? []).join("\n")
  );
  const [discordMentionOnly, setDiscordMentionOnly] = useState(
    profile.discord?.mentionOnly ?? true
  );
  const [discordBotToken, setDiscordBotToken] = useState("");

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    // 1. Channel config (channel id + access gate) lives on the profile.
    await update(profile.id, {
      slack: slackEnabled
        ? {
            enabled: true,
            channelId: slackChannel.trim(),
            publicBot: slackPublic,
            allowedUserIds: parseIds(slackUsers),
            mentionOnly: slackMentionOnly,
          }
        : null,
      discord: discordEnabled
        ? {
            enabled: true,
            channelId: discordChannel.trim(),
            publicBot: discordPublic,
            allowedUserIds: parseIds(discordUsers),
            mentionOnly: discordMentionOnly,
          }
        : null,
    });
    // 2. Tokens are secrets — merge in only the ones that were entered.
    const secrets: Record<string, string> = {};
    if (slackBotToken.trim()) secrets.SLACK_BOT_TOKEN = slackBotToken.trim();
    if (slackAppToken.trim()) secrets.SLACK_APP_TOKEN = slackAppToken.trim();
    if (discordBotToken.trim()) secrets.DISCORD_BOT_TOKEN = discordBotToken.trim();
    if (Object.keys(secrets).length > 0) {
      const res = await apiFetch(`/api/agents/${profile.id}/credentials`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(secrets),
      });
      if (!res.ok) {
        setError("Channel settings saved, but storing the tokens failed.");
        return;
      }
    }
    setSlackBotToken("");
    setSlackAppToken("");
    setDiscordBotToken("");
    setSaved(true);
    onSaved();
    void refreshStatus();
  };

  return (
    <Form>
      <p style={hint}>
        Connect this agent to a Slack or Discord channel. Tokens are stored encrypted alongside the
        agent's other credentials — leave a token blank to keep the one already saved.
      </p>

      <div style={channelCard}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <label style={checkboxRow}>
            <input
              type="checkbox"
              checked={slackEnabled}
              onChange={(e) => setSlackEnabled(e.target.checked)}
            />
            Enable Slack
          </label>
          <ConnectorBadge s={connStatus?.slack} />
        </div>
        {slackEnabled && (
          <>
            {connStatus?.slack.state === "connected" && (
              <p style={{ ...hint, marginTop: 0 }}>
                Connected. If the agent doesn't reply: invite the bot to the channel, and make
                sure whoever messages it is allowed — enable "Public bot" or list their Slack
                user ID below.
              </p>
            )}
            <Field label="Bot OAuth token (xoxb-…)">
              <input
                type="password"
                value={slackBotToken}
                onChange={(e) => setSlackBotToken(e.target.value)}
                placeholder={profile.slack ? "Leave blank to keep the saved token" : "xoxb-…"}
                style={input}
              />
            </Field>
            <Field label="App-level / Socket Mode token (xapp-…)">
              <input
                type="password"
                value={slackAppToken}
                onChange={(e) => setSlackAppToken(e.target.value)}
                placeholder={profile.slack ? "Leave blank to keep the saved token" : "xapp-…"}
                style={input}
              />
            </Field>
            <Field label="Channel ID to join">
              <input
                value={slackChannel}
                onChange={(e) => setSlackChannel(e.target.value)}
                placeholder="C0123456789"
                style={input}
              />
            </Field>
            <label style={checkboxRow}>
              <input
                type="checkbox"
                checked={slackMentionOnly}
                onChange={(e) => setSlackMentionOnly(e.target.checked)}
              />
              Only respond when @mentioned
            </label>
            <p style={{ ...hint, marginTop: 0 }}>
              {slackMentionOnly
                ? "The agent replies only when its Slack bot is @mentioned — triggers on the bot's handle, whatever the agent is named here."
                : "The agent replies to every message in the channel."}
            </p>
            <label style={checkboxRow}>
              <input
                type="checkbox"
                checked={slackPublic}
                onChange={(e) => setSlackPublic(e.target.checked)}
              />
              Public bot — anyone in the channel may talk to this agent
            </label>
            {!slackPublic && (
              <Field label="Allowed Slack user IDs (one per line)">
                <textarea
                  value={slackUsers}
                  onChange={(e) => setSlackUsers(e.target.value)}
                  rows={3}
                  style={{ ...input, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                />
              </Field>
            )}
          </>
        )}
      </div>

      <div style={channelCard}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <label style={checkboxRow}>
            <input
              type="checkbox"
              checked={discordEnabled}
              onChange={(e) => setDiscordEnabled(e.target.checked)}
            />
            Enable Discord
          </label>
          <ConnectorBadge s={connStatus?.discord} />
        </div>
        {discordEnabled && (
          <>
            {connStatus?.discord.state === "connected" && (
              <p style={{ ...hint, marginTop: 0 }}>
                Connected. If the agent doesn't reply: invite the bot to the channel, and make
                sure whoever messages it is allowed — enable "Public bot" or list their user ID
                below.
              </p>
            )}
            <Field label="Bot token">
              <input
                type="password"
                value={discordBotToken}
                onChange={(e) => setDiscordBotToken(e.target.value)}
                placeholder={
                  profile.discord ? "Leave blank to keep the saved token" : "Discord bot token"
                }
                style={input}
              />
            </Field>
            <Field label="Channel ID to join">
              <input
                value={discordChannel}
                onChange={(e) => setDiscordChannel(e.target.value)}
                style={input}
              />
            </Field>
            <label style={checkboxRow}>
              <input
                type="checkbox"
                checked={discordMentionOnly}
                onChange={(e) => setDiscordMentionOnly(e.target.checked)}
              />
              Only respond when @mentioned
            </label>
            <label style={checkboxRow}>
              <input
                type="checkbox"
                checked={discordPublic}
                onChange={(e) => setDiscordPublic(e.target.checked)}
              />
              Public bot — anyone in the channel may talk to this agent
            </label>
            {!discordPublic && (
              <Field label="Allowed Discord user IDs (one per line)">
                <textarea
                  value={discordUsers}
                  onChange={(e) => setDiscordUsers(e.target.value)}
                  rows={3}
                  style={{ ...input, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                />
              </Field>
            )}
          </>
        )}
      </div>

      {error && <span style={{ fontSize: 12, color: "#f87171" }}>{error}</span>}
      <SaveBar onSave={save} saved={saved} onDirty={() => setSaved(false)} />
    </Form>
  );
}

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
  const providers = useProvidersStore((s) => s.providers);
  const loadProviders = useProvidersStore((s) => s.load);
  const settings = useGlobalSettingsStore((s) => s.settings);
  const loadSettings = useGlobalSettingsStore((s) => s.load);
  useEffect(() => void loadProviders(), [loadProviders]);
  useEffect(() => void loadSettings(), [loadSettings]);
  const chatProviders = providers.filter((p) => p.supportsChat);
  const embeddingProviders = providers.filter((p) => p.supportsEmbeddings);

  const [cp, setCp] = useState<ProviderId>(profile.model.chat.provider);
  const [ca, setCa] = useState(profile.model.chat.account || "default");
  const [cm, setCm] = useState(profile.model.chat.modelId);
  const [ep, setEp] = useState<ProviderId>(profile.model.embedding.provider);
  const [ea, setEa] = useState(profile.model.embedding.account || "default");
  const [em, setEm] = useState(profile.model.embedding.modelId);
  const [saved, setSaved] = useState(false);
  const dirty = () => setSaved(false);

  const chatAccounts = settings.providers[cp] ?? [];
  const embAccounts = settings.providers[ep] ?? [];

  /** The model config to save. */
  const modelConfig = (chatModelId: string) => ({
    chat: { provider: cp, account: ca || "default", modelId: chatModelId },
    embedding: { provider: ep, account: ea || "default", modelId: em.trim() },
  });

  return (
    <Form>
      <p style={hint}>
        Each agent picks its own model + provider account. Configure provider credentials in
        Global Settings → Providers; this picker chooses which account this agent uses.
      </p>
      <Field label="Chat model">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            value={cp}
            onChange={(e) => {
              const next = e.target.value;
              setCp(next);
              const accounts = settings.providers[next] ?? [];
              setCa(accounts[0]?.account ?? "default");
              dirty();
            }}
            style={{ ...input, flex: "0 0 130px" }}
          >
            <ProviderOptions list={chatProviders} current={cp} />
          </select>
          {cp !== "builtin" && (
            <select
              value={ca}
              onChange={(e) => { setCa(e.target.value); dirty(); }}
              style={{ ...input, flex: "0 0 130px" }}
              title="Provider account"
            >
              {chatAccounts.length === 0 && <option value="default">default</option>}
              {chatAccounts.map((a) => (
                <option key={a.account} value={a.account}>
                  {a.account}
                </option>
              ))}
            </select>
          )}
          <input
            value={cm}
            onChange={(e) => { setCm(e.target.value); dirty(); }}
            style={{ ...input, flex: 1, minWidth: 160 }}
          />
        </div>
      </Field>
      {cp === "openai" && (
        <OpenAiAuthPanel
          account={ca}
          chatModel={cm}
          onPickModel={(m) => {
            setCm(m);
            dirty();
          }}
          onUseCodexModel={async (m) => {
            setCm(m);
            await update(profile.id, {
              model: modelConfig(m),
              allowedModels: [
                { provider: cp, account: "*", modelId: "*" },
                { provider: ep, account: "*", modelId: "*" },
              ],
            });
            setSaved(true);
            onSaved();
          }}
        />
      )}
      <Field label="Embedding model (for semantic memory)">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            value={ep}
            onChange={(e) => {
              const next = e.target.value;
              setEp(next);
              const accounts = settings.providers[next] ?? [];
              setEa(accounts[0]?.account ?? "default");
              if (next === "builtin") setEm("all-MiniLM-L6-v2");
              dirty();
            }}
            style={{ ...input, flex: "0 0 130px" }}
          >
            <ProviderOptions list={embeddingProviders} current={ep} />
          </select>
          {ep !== "builtin" && (
            <select
              value={ea}
              onChange={(e) => { setEa(e.target.value); dirty(); }}
              style={{ ...input, flex: "0 0 130px" }}
              title="Provider account"
            >
              {embAccounts.length === 0 && <option value="default">default</option>}
              {embAccounts.map((a) => (
                <option key={a.account} value={a.account}>
                  {a.account}
                </option>
              ))}
            </select>
          )}
          <input
            value={em}
            onChange={(e) => { setEm(e.target.value); dirty(); }}
            readOnly={ep === "builtin"}
            placeholder="leave blank to disable semantic memory"
            style={{ ...input, flex: 1, minWidth: 160 }}
          />
        </div>
      </Field>
      {ep === "builtin" && <BuiltinEmbedderControls />}
      <SaveBar
        onSave={async () => {
          await update(profile.id, {
            model: modelConfig(cm.trim()),
            allowedModels: [
              { provider: cp, account: "*", modelId: "*" },
              { provider: ep, account: "*", modelId: "*" },
            ],
          });
          setSaved(true);
          onSaved();
        }}
        saved={saved}
        onDirty={dirty}
      />
    </Form>
  );
}

/** Connect a ChatGPT subscription (OpenAI OAuth) — account-wide, not per-agent. */
function OpenAiAuthPanel({
  account,
  chatModel,
  onPickModel,
  onUseCodexModel,
}: {
  /** Which OpenAI account to flip into OAuth mode on connect. */
  account: string;
  chatModel: string;
  onPickModel: (id: string) => void;
  onUseCodexModel: (id: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<{ connected: boolean; accountId: string | null } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState("");
  const [completing, setCompleting] = useState(false);
  const settings = useGlobalSettingsStore((s) => s.settings);
  const settingsLoaded = useGlobalSettingsStore((s) => s.loaded);
  const loadSettings = useGlobalSettingsStore((s) => s.load);
  const saveSettings = useGlobalSettingsStore((s) => s.save);
  const openaiAccounts = settings.providers.openai ?? [];
  const activeAccount =
    openaiAccounts.find((a) => a.account === account) ?? openaiAccounts[0];
  const openAiUsesOAuth = activeAccount?.authMethod === "oauth";
  const [autoSavedModel, setAutoSavedModel] = useState("");

  const refresh = () =>
    apiFetch("/api/auth/openai/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  useEffect(() => void refresh(), []);
  useEffect(() => void loadSettings(), [loadSettings]);

  useEffect(() => {
    if (!status?.connected || !settingsLoaded || openAiUsesOAuth) return;
    // Flip the active OpenAI account to OAuth so resolution uses ChatGPT tokens.
    const list = openaiAccounts.length > 0 ? [...openaiAccounts] : [
      {
        account: account || "default",
        baseUrl: "https://api.openai.com/v1",
        apiKeyConfigured: false,
        authMethod: "api-key" as const,
      },
    ];
    const idx = list.findIndex((a) => a.account === account);
    if (idx >= 0) list[idx] = { ...list[idx], authMethod: "oauth" };
    else list.push({ ...list[0], account: account || "default", authMethod: "oauth" });
    void saveSettings({
      ...settings,
      providers: { ...settings.providers, openai: list },
    });
  }, [
    account,
    openAiUsesOAuth,
    openaiAccounts,
    saveSettings,
    settings,
    settingsLoaded,
    status?.connected,
  ]);

  // Once connected, discover the Codex model catalogue for this subscription.
  useEffect(() => {
    if (!status?.connected) {
      setModels([]);
      return;
    }
    void apiFetch("/api/provider-models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "openai", secrets: { OPENAI_AUTH_METHOD: "oauth" } }),
    })
      .then((r) => r.json())
      .then((d: { ok: boolean; models?: string[] }) => {
        const list = d.ok && d.models ? d.models : [];
        setModels(list);
        const first = list[0];
        if (first && !list.includes(chatModel) && autoSavedModel !== first) {
          setAutoSavedModel(first);
          void onUseCodexModel(first);
        }
      })
      .catch(() => setModels([]));
  }, [autoSavedModel, chatModel, onUseCodexModel, status?.connected]);

  const signIn = async () => {
    setBusy(true);
    try {
      const res = await apiFetch("/api/auth/openai/login", { method: "POST" });
      const data = (await res.json()) as { authUrl?: string; error?: string };
      if (!data.authUrl) {
        alert(data.error ?? "Could not start sign-in.");
        setBusy(false);
        return;
      }
      window.open(data.authUrl, "_blank", "noopener");
      // Poll until the loopback callback completes (or 5 min timeout).
      const started = Date.now();
      const timer = setInterval(async () => {
        const s = await apiFetch("/api/auth/openai/status")
          .then((r) => r.json())
          .catch(() => null);
        if (s?.connected || Date.now() - started > 300_000) {
          clearInterval(timer);
          if (s) setStatus(s);
          setBusy(false);
        }
      }, 2000);
    } catch {
      setBusy(false);
    }
  };

  // Manual completion: paste the redirect URL when the loopback callback
  // can't be reached (otterbot running on a remote box).
  const completeManual = async () => {
    setCompleting(true);
    try {
      const res = await apiFetch("/api/auth/openai/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: paste.trim() }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        status?: { connected: boolean; accountId: string | null };
        error?: string;
      };
      if (data.ok && data.status) {
        setStatus(data.status);
        setPaste("");
      } else {
        alert(data.error ?? "Could not complete sign-in.");
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCompleting(false);
    }
  };

  const signOut = async () => {
    await apiFetch("/api/auth/openai/signout", { method: "POST" });
    setModels([]);
    setPaste("");
    void refresh();
  };

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 6 }}>
      <strong style={{ fontSize: 12 }}>ChatGPT subscription</strong>
      {status?.connected ? (
        <>
          <div style={{ fontSize: 12, color: "#4ade80" }}>
            ✓ Connected{status.accountId ? ` · account ${status.accountId}` : ""}
          </div>
          <div style={hint}>
            {openAiUsesOAuth
              ? "OpenAI chats are using ChatGPT OAuth."
              : "Switching OpenAI chats to ChatGPT OAuth..."}
          </div>
          {models.length > 0 && (
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <span style={{ color: "rgb(var(--muted))" }}>Codex model</span>
              <select
                value={models.includes(chatModel) ? chatModel : ""}
                onChange={(e) => onPickModel(e.target.value)}
                style={input}
              >
                {!models.includes(chatModel) && <option value="">Pick a Codex model…</option>}
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button onClick={signOut} style={{ ...ghost, alignSelf: "flex-start" }}>
            Sign out
          </button>
        </>
      ) : (
        <>
          <div style={hint}>
            Use a ChatGPT Plus/Pro subscription instead of an API key. Sign-in is account-wide —
            it applies to every agent whose chat provider is OpenAI. Unofficial route; it may stop
            working if OpenAI changes it.
          </div>
          <button onClick={signIn} disabled={busy} style={{ ...primary, alignSelf: "flex-start" }}>
            {busy ? "Waiting for sign-in…" : "Sign in with ChatGPT"}
          </button>
          <div
            style={{
              borderTop: "1px solid rgb(var(--border))",
              paddingTop: 6,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={hint}>
              Running otterbot on a remote box? Your browser can't reach <code>localhost:1455</code>
              . After approving, copy the URL it was redirected to (the page won't load) and paste
              it here.
            </div>
            <input
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="http://localhost:1455/auth/callback?code=…"
              style={input}
            />
            <button
              onClick={completeManual}
              disabled={completing || !paste.trim()}
              style={{ ...ghost, alignSelf: "flex-start" }}
            >
              {completing ? "Completing…" : "Complete sign-in"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// --- Schedule -------------------------------------------------------------

// --- Peers ----------------------------------------------------------------

/** Which other agents this agent may message and whose memory it may read. */
function PeersTab({ profile, onSaved }: TabProps) {
  const [peerAgents, setPeerAgents] = useState<{ id: string; displayName: string }[]>([]);
  const [draft, setDraft] = useState<AgentPeerAccess[]>(profile.allowedPeers ?? []);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void apiFetch("/api/agents")
      .then((r) => (r.ok ? (r.json() as Promise<AgentProfileSummary[]>) : []))
      .then((list) =>
        setPeerAgents(
          list
            .filter((a) => a.id !== profile.id && a.role !== "subagent")
            .map((a) => ({ id: a.id, displayName: a.displayName }))
        )
      )
      .catch(() => {});
  }, [profile.id]);

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
        Control which agents this agent may message and whose memory it may read. The COO can
        always reach every agent.
      </p>
      <PeerAccessEditor
        peers={draft}
        peerAgents={peerAgents}
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

  const load = () => {
    void apiFetch(`/api/agents/${agentId}/memories`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setMemories);
  };
  useEffect(load, [agentId]);

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

function CredentialsTab({ agentId }: { agentId: string }) {
  const [keys, setKeys] = useState<string[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [slackTest, setSlackTest] = useState<SlackTestResult | null>(null);

  const load = async () => {
    const res = await apiFetch(`/api/agents/${agentId}/credentials`);
    if (res.ok) setKeys(((await res.json()).keys as string[]) ?? []);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const add = async () => {
    const key = newKey.trim();
    if (!key || !newValue) return;
    setBusy(true);
    const res = await apiFetch(`/api/agents/${agentId}/credentials`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [key]: newValue }),
    });
    if (res.ok) {
      setStatus(keys.includes(key) ? `Updated ${key} — agent restarted.` : `Added ${key} — agent restarted.`);
      setNewKey("");
      setNewValue("");
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
        encrypted in the database. Each credential is independent — adding or deleting one never
        affects the others.
      </p>

      {keys.length === 0 && <div style={hint}>No credentials stored yet.</div>}
      {keys.map((key) => (
        <div key={key} style={{ ...card, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <code style={{ fontSize: 12, fontWeight: 600 }}>{key}</code>
            <span style={{ fontSize: 12, color: "rgb(var(--muted))" }}>••••••</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {key === "SLACK_BOT_TOKEN" && (
                <button onClick={testSlack} disabled={busy} style={ghost}>
                  Test
                </button>
              )}
              <button
                onClick={() => remove(key)}
                disabled={busy}
                style={{ ...ghost, color: "#f87171" }}
              >
                Delete
              </button>
            </div>
          </div>
          {key === "SLACK_BOT_TOKEN" && slackTest && (
            <div
              style={{
                fontSize: 12,
                color: slackTest.ok ? "#4ade80" : "#f87171",
              }}
            >
              {slackTest.ok
                ? `✓ valid — team '${slackTest.team}', bot '${slackTest.user}'`
                : `✗ ${slackTest.error}`}
            </div>
          )}
        </div>
      ))}

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
        <span style={{ fontSize: 12, color: "rgb(var(--muted))" }}>Add credential</span>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="KEY (e.g. GITHUB_TOKEN)"
            style={{ ...input, fontFamily: "monospace", fontSize: 12 }}
          />
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="value"
            type="password"
            style={{ ...input, fontFamily: "monospace", fontSize: 12 }}
          />
          <button onClick={add} disabled={busy || !newKey.trim() || !newValue} style={primary}>
            Add
          </button>
        </div>
      </div>

      {status && <span style={{ fontSize: 12, color: "rgb(var(--muted))" }}>{status}</span>}
    </Form>
  );
}

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

const pre: React.CSSProperties = {
  background: "rgb(var(--bg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: 8,
  fontSize: 11,
  marginTop: 6,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 220,
  overflowY: "auto",
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
