import { useEffect, useState } from "react";
import type {
  AgentProfile,
  AgentConnectorStatus,
  ChannelConnectorStatus,
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

const TABS = ["Identity", "Persona", "Model", "Channels", "Skills", "Schedule", "Memory", "Credentials"] as const;
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
    void fetch(`/api/agents/${agentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p: AgentProfile | null) => setProfile(p));
  };

  useEffect(loadProfile, [agentId]);

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

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {tab === "Identity" && <IdentityTab profile={profile} onSaved={onSaved} />}
        {tab === "Persona" && <PersonaTab profile={profile} onSaved={onSaved} />}
        {tab === "Model" && <ModelTab profile={profile} onSaved={onSaved} />}
        {tab === "Channels" && <ChannelsTab profile={profile} onSaved={onSaved} />}
        {tab === "Skills" && <SkillsTab agentId={profile.id} />}
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
  const [canSpawn, setCanSpawn] = useState(profile.canSpawnSubagents);
  const [limit, setLimit] = useState(profile.subagentLimit);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await update(profile.id, {
      displayName,
      email: email.trim() || null,
      transport,
      canSpawnSubagents: canSpawn,
      subagentLimit: limit,
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
      <label style={checkboxRow}>
        <input type="checkbox" checked={canSpawn} onChange={(e) => setCanSpawn(e.target.checked)} />
        Can spawn subagents
      </label>
      <Field label="Subagent limit">
        <input
          type="number"
          min={0}
          max={20}
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          style={{ ...input, width: 90 }}
        />
      </Field>
      <SaveBar onSave={save} saved={saved} onDirty={() => setSaved(false)} />
    </Form>
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
    fetch(`/api/agents/${profile.id}/connectors`)
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
  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackAppToken, setSlackAppToken] = useState("");

  const [discordEnabled, setDiscordEnabled] = useState(profile.discord?.enabled ?? false);
  const [discordChannel, setDiscordChannel] = useState(profile.discord?.channelId ?? "");
  const [discordPublic, setDiscordPublic] = useState(profile.discord?.publicBot ?? false);
  const [discordUsers, setDiscordUsers] = useState(
    (profile.discord?.allowedUserIds ?? []).join("\n")
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
          }
        : null,
      discord: discordEnabled
        ? {
            enabled: true,
            channelId: discordChannel.trim(),
            publicBot: discordPublic,
            allowedUserIds: parseIds(discordUsers),
          }
        : null,
    });
    // 2. Tokens are secrets — merge in only the ones that were entered.
    const secrets: Record<string, string> = {};
    if (slackBotToken.trim()) secrets.SLACK_BOT_TOKEN = slackBotToken.trim();
    if (slackAppToken.trim()) secrets.SLACK_APP_TOKEN = slackAppToken.trim();
    if (discordBotToken.trim()) secrets.DISCORD_BOT_TOKEN = discordBotToken.trim();
    if (Object.keys(secrets).length > 0) {
      const res = await fetch(`/api/agents/${profile.id}/credentials`, {
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
  useEffect(() => void loadProviders(), [loadProviders]);
  const chatProviders = providers.filter((p) => p.supportsChat);
  const embeddingProviders = providers.filter((p) => p.supportsEmbeddings);

  const [cp, setCp] = useState<ProviderId>(profile.model.chat.provider);
  const [cm, setCm] = useState(profile.model.chat.modelId);
  const [ep, setEp] = useState<ProviderId>(profile.model.embedding.provider);
  const [em, setEm] = useState(profile.model.embedding.modelId);
  const [saved, setSaved] = useState(false);
  const dirty = () => setSaved(false);

  return (
    <Form>
      <p style={hint}>
        Each agent picks its own models. Cloud providers read their API key from this agent's
        Credentials; local providers (LM Studio / Ollama) use the endpoint configured there or the
        global default.
      </p>
      <Field label="Chat model">
        <div style={{ display: "flex", gap: 8 }}>
          <select value={cp} onChange={(e) => { setCp(e.target.value); dirty(); }} style={{ ...input, flex: "0 0 130px" }}>
            <ProviderOptions list={chatProviders} current={cp} />
          </select>
          <input value={cm} onChange={(e) => { setCm(e.target.value); dirty(); }} style={input} />
        </div>
      </Field>
      {cp === "openai" && (
        <OpenAiAuthPanel
          chatModel={cm}
          onPickModel={(m) => {
            setCm(m);
            dirty();
          }}
          onUseCodexModel={async (m) => {
            setCm(m);
            await update(profile.id, {
              model: {
                chat: { provider: cp, modelId: m },
                embedding: { provider: ep, modelId: em.trim() },
              },
              allowedModels: [
                { provider: cp, modelId: "*" },
                { provider: ep, modelId: "*" },
              ],
            });
            setSaved(true);
            onSaved();
          }}
        />
      )}
      <Field label="Embedding model (for semantic memory)">
        <div style={{ display: "flex", gap: 8 }}>
          <select
            value={ep}
            onChange={(e) => {
              const next = e.target.value;
              setEp(next);
              if (next === "builtin") setEm("all-MiniLM-L6-v2");
              dirty();
            }}
            style={{ ...input, flex: "0 0 130px" }}
          >
            <ProviderOptions list={embeddingProviders} current={ep} />
          </select>
          <input
            value={em}
            onChange={(e) => { setEm(e.target.value); dirty(); }}
            readOnly={ep === "builtin"}
            placeholder="leave blank to disable semantic memory"
            style={input}
          />
        </div>
      </Field>
      {ep === "builtin" && <BuiltinEmbedderControls />}
      <SaveBar
        onSave={async () => {
          await update(profile.id, {
            model: {
              chat: { provider: cp, modelId: cm.trim() },
              embedding: { provider: ep, modelId: em.trim() },
            },
            allowedModels: [
              { provider: cp, modelId: "*" },
              { provider: ep, modelId: "*" },
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
  chatModel,
  onPickModel,
  onUseCodexModel,
}: {
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
  const openAiUsesOAuth = settings.providers.openai.authMethod === "oauth";
  const [autoSavedModel, setAutoSavedModel] = useState("");

  const refresh = () =>
    fetch("/api/auth/openai/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  useEffect(() => void refresh(), []);
  useEffect(() => void loadSettings(), [loadSettings]);

  useEffect(() => {
    if (!status?.connected || !settingsLoaded || openAiUsesOAuth) return;
    void saveSettings({
      ...settings,
      providers: {
        ...settings.providers,
        openai: { ...settings.providers.openai, authMethod: "oauth" },
      },
    });
  }, [openAiUsesOAuth, saveSettings, settings, settingsLoaded, status?.connected]);

  // Once connected, discover the Codex model catalogue for this subscription.
  useEffect(() => {
    if (!status?.connected) {
      setModels([]);
      return;
    }
    void fetch("/api/provider-models", {
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
      const res = await fetch("/api/auth/openai/login", { method: "POST" });
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
        const s = await fetch("/api/auth/openai/status")
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
      const res = await fetch("/api/auth/openai/complete", {
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
    await fetch("/api/auth/openai/signout", { method: "POST" });
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

// --- Skills ---------------------------------------------------------------

/** A skill catalog entry — mirrors the server's `CatalogSkill`. */
interface CatalogSkill {
  id: string;
  category: string;
  description: string;
  pack: "builtin" | "optional";
  requires?: "macos" | "heavy";
}

const REQUIRES_LABEL: Record<NonNullable<CatalogSkill["requires"]>, string> = {
  macos: "macOS only",
  heavy: "Heavy deps",
};

/** Lowercase-slug a skill name so installed skills can be matched to the catalog. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function SkillsTab({ agentId }: { agentId: string }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [catalog, setCatalog] = useState<CatalogSkill[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [packFilter, setPackFilter] = useState<"all" | "builtin" | "optional">("all");
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    void fetch(`/api/agents/${agentId}/skills`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setSkills);
  };
  useEffect(load, [agentId]);
  useEffect(() => {
    void fetch("/api/skill-catalog")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCatalog);
  }, []);

  // Skills already on the agent, matched to catalog ids by slugified name.
  const installedSlugs = new Set(skills.map((s) => slugify(s.meta.name)));

  const install = async (id: string) => {
    setAddingId(id);
    setError(null);
    const res = await fetch(`/api/agents/${agentId}/skills/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ catalogId: id }),
    });
    setAddingId(null);
    if (res.ok) {
      load();
    } else {
      setError((await res.json())?.error ?? `Failed to install ${id}`);
    }
  };

  const addSkill = async () => {
    if (!raw.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/agents/${agentId}/skills`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    setBusy(false);
    if (res.ok) {
      setRaw("");
      load();
    } else {
      alert((await res.json())?.error ?? "Failed to add skill");
    }
  };

  const del = async (id: string) => {
    await fetch(`/api/agents/${agentId}/skills/${id}`, { method: "DELETE" });
    load();
  };

  const categories = ["all", ...[...new Set(catalog.map((c) => c.category))].sort()];
  const q = query.trim().toLowerCase();
  const filtered = catalog.filter((c) => {
    if (category !== "all" && c.category !== category) return false;
    if (packFilter !== "all" && c.pack !== packFilter) return false;
    if (!q) return true;
    return c.id.includes(q) || c.description.toLowerCase().includes(q) || c.category.includes(q);
  });

  return (
    <Form>
      <p style={hint}>
        Skills are reusable procedures the agent recalls on relevant tasks. Install built-in skills
        from the Hermes catalog below, paste your own, or let the agent author its own.
      </p>

      {/* --- Installed --- */}
      <strong style={{ fontSize: 13 }}>Installed ({skills.length})</strong>
      {skills.length === 0 && <div style={hint}>No skills installed yet.</div>}
      {skills.map((s) => (
        <details key={s.id} style={card}>
          <summary style={{ cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }}>
            <strong style={{ fontSize: 13 }}>{s.meta.name}</strong>
            <span style={badge}>{s.source}</span>
            <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>used {s.useCount}×</span>
            <button onClick={() => del(s.id)} style={{ ...ghost, marginLeft: "auto", color: "#f87171" }}>
              Remove
            </button>
          </summary>
          <div style={{ fontSize: 12, color: "rgb(var(--muted))", marginTop: 6 }}>
            {s.meta.description}
          </div>
          <pre style={pre}>{s.body}</pre>
        </details>
      ))}

      {/* --- Hermes catalog --- */}
      <strong style={{ fontSize: 13, marginTop: 8 }}>
        Skill catalog{catalog.length > 0 ? ` (${catalog.length})` : ""}
      </strong>
      <p style={hint}>
        Built-in skills from the{" "}
        <a
          href="https://hermes-agent.nousresearch.com/docs/skills/"
          target="_blank"
          rel="noreferrer"
          style={{ color: "rgb(var(--accent))" }}
        >
          Hermes Agent catalog
        </a>
        . Each skill's definition is fetched from GitHub and security-scanned when you add it.
        Skills tagged <em>macOS only</em> or <em>Heavy deps</em> may not run in this environment.
      </p>
      <Row>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills…"
          style={input}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...input, flex: "0 0 160px" }}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === "all" ? "All categories" : c}
            </option>
          ))}
        </select>
        <select
          value={packFilter}
          onChange={(e) => setPackFilter(e.target.value as typeof packFilter)}
          style={{ ...input, flex: "0 0 120px" }}
        >
          <option value="all">Both packs</option>
          <option value="builtin">Built-in</option>
          <option value="optional">Optional</option>
        </select>
      </Row>
      {error && <div style={{ ...hint, color: "#f87171" }}>{error}</div>}
      {catalog.length === 0 && <div style={hint}>Loading catalog…</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {filtered.map((c) => {
          const installed = installedSlugs.has(c.id);
          return (
            <div key={c.id} style={{ ...card, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 12 }}>{c.id}</strong>
                <span style={badge}>{c.category}</span>
                {c.pack === "optional" && <span style={badge}>optional</span>}
                {c.requires && (
                  <span style={{ ...badge, color: "#fbbf24", borderColor: "#fbbf24" }}>
                    {REQUIRES_LABEL[c.requires]}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "rgb(var(--muted))", flex: 1 }}>{c.description}</div>
              <button
                onClick={() => void install(c.id)}
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
      {catalog.length > 0 && filtered.length === 0 && <div style={hint}>No skills match.</div>}

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
              rows={6}
              placeholder={"---\nname: Summarize a repo\ndescription: ...\ntags: [research]\n---\n\n1. ...\n2. ..."}
              style={{ ...input, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
            />
          </Field>
          <button onClick={addSkill} disabled={busy} style={primary}>
            {busy ? "Adding…" : "Add skill"}
          </button>
        </div>
      </details>
    </Form>
  );
}

// --- Schedule -------------------------------------------------------------

function ScheduleTab({ agentId }: { agentId: string }) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [cron, setCron] = useState("0 9 * * *");
  const [prompt, setPrompt] = useState("");

  const load = () => {
    void fetch(`/api/agents/${agentId}/scheduled-tasks`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setTasks);
  };
  useEffect(load, [agentId]);

  const add = async () => {
    if (!prompt.trim()) return;
    const res = await fetch(`/api/agents/${agentId}/scheduled-tasks`, {
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
    await fetch(`/api/scheduled-tasks/${id}`, { method: "DELETE" });
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
    void fetch(`/api/agents/${agentId}/memories`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setMemories);
  };
  useEffect(load, [agentId]);

  const del = async (id: string) => {
    await fetch(`/api/agents/${agentId}/memories/${id}`, { method: "DELETE" });
    load();
  };

  const add = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/agents/${agentId}/memories`, {
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

function CredentialsTab({ agentId }: { agentId: string }) {
  const [creds, setCreds] = useState("");
  const [status, setStatus] = useState("");

  const save = async () => {
    const record: Record<string, string> = {};
    for (const line of creds.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) record[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    const res = await fetch(`/api/agents/${agentId}/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
    });
    setStatus(res.ok ? `Saved ${Object.keys(record).length} secret(s) — agent restarted.` : "Failed.");
  };

  return (
    <Form>
      <p style={hint}>
        Secrets for this agent only — API keys, GitHub token, SMTP, model endpoints. Stored
        encrypted in the database. KEY=VALUE per line; saving replaces all of this agent's secrets.
      </p>
      <textarea
        value={creds}
        onChange={(e) => setCreds(e.target.value)}
        rows={8}
        placeholder={"ANTHROPIC_API_KEY=...\nOPENAI_API_KEY=...\nGITHUB_TOKEN=...\nSMTP_HOST=...\nSMTP_USER=...\nSMTP_PASS=...\nLMSTUDIO_BASE_URL=..."}
        style={{ ...input, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={save} style={primary}>
          Save credentials
        </button>
        {status && <span style={{ fontSize: 12, color: "rgb(var(--muted))" }}>{status}</span>}
      </div>
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
