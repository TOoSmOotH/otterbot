import { useState, useEffect, useMemo } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settings-store";
import { getSocket } from "../../lib/socket";

export function MattermostSection() {
  const enabled = useSettingsStore((s) => s.mattermostEnabled);
  const tokenSet = useSettingsStore((s) => s.mattermostTokenSet);
  const serverUrlSet = useSettingsStore((s) => s.mattermostServerUrlSet);
  const serverUrl = useSettingsStore((s) => s.mattermostServerUrl);
  const defaultTeam = useSettingsStore((s) => s.mattermostDefaultTeam);
  const requireMention = useSettingsStore((s) => s.mattermostRequireMention);
  const botUsername = useSettingsStore((s) => s.mattermostBotUsername);
  const allowedChannels = useSettingsStore((s) => s.mattermostAllowedChannels);
  const availableChannels = useSettingsStore((s) => s.mattermostAvailableChannels);
  const pairedUsers = useSettingsStore((s) => s.mattermostPairedUsers);
  const pendingPairings = useSettingsStore((s) => s.mattermostPendingPairings);
  const testResult = useSettingsStore((s) => s.mattermostTestResult);
  const loadMattermostSettings = useSettingsStore((s) => s.loadMattermostSettings);
  const updateMattermostSettings = useSettingsStore((s) => s.updateMattermostSettings);
  const testMattermostConnection = useSettingsStore((s) => s.testMattermostConnection);
  const approveMattermostPairing = useSettingsStore((s) => s.approveMattermostPairing);
  const rejectMattermostPairing = useSettingsStore((s) => s.rejectMattermostPairing);
  const revokeMattermostUser = useSettingsStore((s) => s.revokeMattermostUser);

  const [localToken, setLocalToken] = useState("");
  const [localServerUrl, setLocalServerUrl] = useState("");
  const [localDefaultTeam, setLocalDefaultTeam] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingChannels, setSavingChannels] = useState(false);
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [botStatus, setBotStatus] = useState<"connected" | "disconnected" | "error">("disconnected");

  useEffect(() => {
    loadMattermostSettings();
  }, []);

  // Listen for real-time Mattermost events
  useEffect(() => {
    const socket = getSocket();

    const handleStatus = (data: { status: "connected" | "disconnected" | "error"; botUsername?: string }) => {
      setBotStatus(data.status);
      if (data.status === "connected") {
        loadMattermostSettings();
      }
    };

    const handlePairingRequest = () => {
      loadMattermostSettings();
    };

    socket.on("mattermost:status", handleStatus);
    socket.on("mattermost:pairing-request", handlePairingRequest);

    return () => {
      socket.off("mattermost:status", handleStatus);
      socket.off("mattermost:pairing-request", handlePairingRequest);
    };
  }, []);

  // Sync local state from store
  useEffect(() => {
    setSelectedChannels(new Set(allowedChannels));
  }, [allowedChannels]);

  useEffect(() => {
    if (serverUrl && !localServerUrl) setLocalServerUrl(serverUrl);
  }, [serverUrl]);

  useEffect(() => {
    if (defaultTeam && !localDefaultTeam) setLocalDefaultTeam(defaultTeam);
  }, [defaultTeam]);

  // Group available channels by team
  const channelsByTeam = useMemo(() => {
    const groups = new Map<string, Array<{ id: string; name: string; displayName: string }>>();
    for (const ch of availableChannels) {
      let list = groups.get(ch.teamName);
      if (!list) {
        list = [];
        groups.set(ch.teamName, list);
      }
      list.push({ id: ch.id, name: ch.name, displayName: ch.displayName });
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return groups;
  }, [availableChannels]);

  const handleToggleChannel = (channelId: string) => {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) {
        next.delete(channelId);
      } else {
        next.add(channelId);
      }
      return next;
    });
  };

  const handleSaveChannels = async () => {
    setSavingChannels(true);
    await updateMattermostSettings({ allowedChannels: [...selectedChannels] });
    setSavingChannels(false);
  };

  const channelsChanged = useMemo(() => {
    if (selectedChannels.size !== allowedChannels.length) return true;
    return allowedChannels.some((id) => !selectedChannels.has(id));
  }, [selectedChannels, allowedChannels]);

  const handleSave = async () => {
    setSaving(true);
    const data: { botToken?: string; serverUrl?: string; defaultTeam?: string } = {};
    if (localToken) data.botToken = localToken;
    if (localServerUrl) data.serverUrl = localServerUrl;
    if (localDefaultTeam !== (defaultTeam ?? "")) data.defaultTeam = localDefaultTeam;
    await updateMattermostSettings(data);
    setLocalToken("");
    setSaving(false);
  };

  const handleToggleEnabled = async () => {
    await updateMattermostSettings({ enabled: !enabled });
  };

  const handleToggleMention = async () => {
    await updateMattermostSettings({ requireMention: !requireMention });
  };

  const handleTest = () => {
    testMattermostConnection();
  };

  const handleClearToken = async () => {
    setSaving(true);
    await updateMattermostSettings({ botToken: "" });
    setLocalToken("");
    setSaving(false);
  };

  return (
    <div className="p-5 space-y-4">
      <p className="text-xs text-muted-foreground">
        Connect Otterbot to Mattermost. Users must pair with the bot before it
        responds to their messages.
      </p>

      {/* Enable toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <button
          onClick={handleToggleEnabled}
          className={cn(
            "relative w-9 h-5 rounded-full transition-colors",
            enabled ? "bg-primary" : "bg-secondary",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform",
              enabled && "translate-x-4",
            )}
          />
        </button>
        <span className="text-sm">Enable Mattermost integration</span>
      </label>

      {/* Connection section */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Server URL
            {serverUrlSet && (
              <span className="ml-2 text-green-500 normal-case tracking-normal">
                Set
              </span>
            )}
          </label>
          <input
            type="text"
            value={localServerUrl}
            onChange={(e) => setLocalServerUrl(e.target.value)}
            placeholder="https://your-mattermost-server.com"
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
          />
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Bot Token
            {tokenSet && (
              <span className="ml-2 text-green-500 normal-case tracking-normal">
                Set
              </span>
            )}
          </label>
          <input
            type="password"
            value={localToken}
            onChange={(e) => setLocalToken(e.target.value)}
            placeholder={
              tokenSet ? "Enter new token to change" : "Paste your bot token"
            }
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
          />
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Default Team
          </label>
          <input
            type="text"
            value={localDefaultTeam}
            onChange={(e) => setLocalDefaultTeam(e.target.value)}
            placeholder="team-name"
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            The team name (URL slug) used for channel discovery.
          </p>
        </div>

        {botUsername && (
          <div className="text-xs text-muted-foreground">
            Bot: <span className="text-foreground font-medium">{botUsername}</span>
            {enabled && tokenSet && serverUrlSet && (
              <span className={cn(
                "ml-2 text-[10px] px-1.5 py-0.5 rounded",
                botStatus === "connected"
                  ? "text-green-500 bg-green-500/10"
                  : botStatus === "error"
                    ? "text-red-500 bg-red-500/10"
                    : "text-muted-foreground bg-muted",
              )}>
                {botStatus === "connected" ? "Online" : botStatus === "error" ? "Error" : "Offline"}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={handleTest}
            disabled={testResult?.testing || !tokenSet || !serverUrlSet}
            className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80 disabled:opacity-50"
          >
            {testResult?.testing ? "Testing..." : "Test Connection"}
          </button>
          {tokenSet && (
            <button
              onClick={handleClearToken}
              disabled={saving}
              className="text-xs text-red-500 hover:text-red-400 px-2 py-1.5"
            >
              Clear Token
            </button>
          )}

          {testResult && !testResult.testing && (
            <span
              className={cn(
                "text-xs",
                testResult.ok ? "text-green-500" : "text-red-500",
              )}
            >
              {testResult.ok
                ? "\u2713 Connected"
                : `\u2717 ${testResult.error ?? "Failed"}`}
            </span>
          )}
        </div>
      </div>

      {/* Behavior section */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
          Behavior
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <button
            onClick={handleToggleMention}
            className={cn(
              "relative w-9 h-5 rounded-full transition-colors",
              requireMention ? "bg-primary" : "bg-secondary",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform",
                requireMention && "translate-x-4",
              )}
            />
          </button>
          <div>
            <span className="text-sm">Require @mention in channels</span>
            <p className="text-[10px] text-muted-foreground">
              When enabled, the bot only responds to messages that @mention it in public channels. DMs always work.
            </p>
          </div>
        </label>
      </div>

      {/* Allowed Channels section */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
          Allowed Channels
          {selectedChannels.size > 0 && (
            <span className="ml-2 normal-case tracking-normal text-foreground">
              {selectedChannels.size}
            </span>
          )}
        </label>
        <p className="text-[10px] text-muted-foreground">
          When set, the bot only responds in these channels. DMs are always allowed.
        </p>

        {availableChannels.length === 0 ? (
          <p className="text-[10px] text-muted-foreground italic">
            Connect the bot and set a default team to see available channels.
          </p>
        ) : (
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {[...channelsByTeam.entries()].map(([teamName, channels]) => (
              <div key={teamName}>
                <div className="text-[10px] text-muted-foreground font-medium mb-1">
                  {teamName}
                </div>
                <div className="space-y-1">
                  {channels.map((ch) => (
                    <label
                      key={ch.id}
                      className="flex items-center gap-2 cursor-pointer hover:bg-secondary/50 rounded px-2 py-1"
                    >
                      <input
                        type="checkbox"
                        checked={selectedChannels.has(ch.id)}
                        onChange={() => handleToggleChannel(ch.id)}
                        className="rounded border-border"
                      />
                      <span className="text-xs">~{ch.name}</span>
                      {ch.displayName !== ch.name && (
                        <span className="text-[10px] text-muted-foreground">({ch.displayName})</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {availableChannels.length > 0 && channelsChanged && (
          <button
            onClick={handleSaveChannels}
            disabled={savingChannels}
            className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {savingChannels ? "Saving..." : "Save"}
          </button>
        )}
      </div>

      {/* Paired Users section */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
          Paired Users
          <span className="ml-2 normal-case tracking-normal text-foreground">
            {pairedUsers.length}
          </span>
        </label>

        {pairedUsers.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">
            No users have been paired yet. When someone messages the bot, they'll receive a pairing code to approve here.
          </p>
        ) : (
          <div className="space-y-2">
            {pairedUsers.map((user) => (
              <div
                key={user.mattermostUserId}
                className="flex items-center justify-between bg-secondary rounded-md px-3 py-2"
              >
                <div>
                  <span className="text-xs font-medium">{user.mattermostUsername}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    Paired {new Date(user.pairedAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  onClick={() => revokeMattermostUser(user.mattermostUserId)}
                  className="text-[10px] text-red-500 hover:text-red-400 px-2 py-1"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending Pairings section */}
      {pendingPairings.length > 0 && (
        <div className="border border-border rounded-lg p-4 space-y-3">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Pending Pairings
            <span className="ml-2 normal-case tracking-normal text-yellow-500">
              {pendingPairings.length}
            </span>
          </label>

          <div className="space-y-2">
            {pendingPairings.map((pairing) => (
              <div
                key={pairing.code}
                className="flex items-center justify-between bg-secondary rounded-md px-3 py-2"
              >
                <div>
                  <span className="text-xs font-medium">{pairing.mattermostUsername}</span>
                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded ml-2 font-mono">
                    {pairing.code}
                  </code>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    {new Date(pairing.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => approveMattermostPairing(pairing.code)}
                    className="text-[10px] text-green-500 hover:text-green-400 bg-green-500/10 px-2 py-1 rounded"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => rejectMattermostPairing(pairing.code)}
                    className="text-[10px] text-red-500 hover:text-red-400 px-2 py-1"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Setup instructions */}
      <div className="text-[10px] text-muted-foreground space-y-1">
        <p>
          <strong>How to set up the Mattermost bot:</strong>
        </p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Go to your Mattermost System Console &gt; Integrations &gt; Bot Accounts</li>
          <li>Enable bot account creation if not already enabled</li>
          <li>Go to Integrations &gt; Bot Accounts and create a new bot</li>
          <li>Copy the generated access token and paste it above</li>
          <li>Enter your Mattermost server URL (e.g., https://mattermost.example.com)</li>
          <li>Enter the default team name (the URL slug, e.g., "myteam")</li>
          <li>Add the bot to the channels you want it to listen in</li>
        </ol>
      </div>
    </div>
  );
}
