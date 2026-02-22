import { useState, useEffect, useMemo } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settings-store";
import { getSocket } from "../../lib/socket";

export function SlackSection() {
  const enabled = useSettingsStore((s) => s.slackEnabled);
  const botTokenSet = useSettingsStore((s) => s.slackBotTokenSet);
  const signingSecretSet = useSettingsStore((s) => s.slackSigningSecretSet);
  const appTokenSet = useSettingsStore((s) => s.slackAppTokenSet);
  const requireMention = useSettingsStore((s) => s.slackRequireMention);
  const botUsername = useSettingsStore((s) => s.slackBotUsername);
  const allowedChannels = useSettingsStore((s) => s.slackAllowedChannels);
  const availableChannels = useSettingsStore((s) => s.slackAvailableChannels);
  const pairedUsers = useSettingsStore((s) => s.slackPairedUsers);
  const pendingPairings = useSettingsStore((s) => s.slackPendingPairings);
  const testResult = useSettingsStore((s) => s.slackTestResult);
  const loadSlackSettings = useSettingsStore((s) => s.loadSlackSettings);
  const updateSlackSettings = useSettingsStore((s) => s.updateSlackSettings);
  const testSlackConnection = useSettingsStore((s) => s.testSlackConnection);
  const approveSlackPairing = useSettingsStore((s) => s.approveSlackPairing);
  const rejectSlackPairing = useSettingsStore((s) => s.rejectSlackPairing);
  const revokeSlackUser = useSettingsStore((s) => s.revokeSlackUser);

  const [localBotToken, setLocalBotToken] = useState("");
  const [localSigningSecret, setLocalSigningSecret] = useState("");
  const [localAppToken, setLocalAppToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingChannels, setSavingChannels] = useState(false);
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [botStatus, setBotStatus] = useState<"connected" | "disconnected" | "error">("disconnected");

  useEffect(() => {
    loadSlackSettings();
  }, []);

  // Listen for real-time Slack events
  useEffect(() => {
    const socket = getSocket();

    const handleStatus = (data: { status: "connected" | "disconnected" | "error"; botUsername?: string }) => {
      setBotStatus(data.status);
      if (data.status === "connected") {
        loadSlackSettings();
      }
    };

    const handlePairingRequest = () => {
      loadSlackSettings();
    };

    socket.on("slack:status", handleStatus);
    socket.on("slack:pairing-request", handlePairingRequest);

    return () => {
      socket.off("slack:status", handleStatus);
      socket.off("slack:pairing-request", handlePairingRequest);
    };
  }, []);

  // Sync local selectedChannels when allowedChannels loads
  useEffect(() => {
    setSelectedChannels(new Set(allowedChannels));
  }, [allowedChannels]);

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
    await updateSlackSettings({ allowedChannels: [...selectedChannels] });
    setSavingChannels(false);
  };

  const channelsChanged = useMemo(() => {
    if (selectedChannels.size !== allowedChannels.length) return true;
    return allowedChannels.some((id) => !selectedChannels.has(id));
  }, [selectedChannels, allowedChannels]);

  const handleSave = async () => {
    setSaving(true);
    const data: { botToken?: string; signingSecret?: string; appToken?: string } = {};
    if (localBotToken) data.botToken = localBotToken;
    if (localSigningSecret) data.signingSecret = localSigningSecret;
    if (localAppToken) data.appToken = localAppToken;
    await updateSlackSettings(data);
    setLocalBotToken("");
    setLocalSigningSecret("");
    setLocalAppToken("");
    setSaving(false);
  };

  const handleToggleEnabled = async () => {
    await updateSlackSettings({ enabled: !enabled });
  };

  const handleToggleMention = async () => {
    await updateSlackSettings({ requireMention: !requireMention });
  };

  const handleTest = () => {
    testSlackConnection();
  };

  const handleClearTokens = async () => {
    setSaving(true);
    await updateSlackSettings({ botToken: "", signingSecret: "", appToken: "" });
    setLocalBotToken("");
    setLocalSigningSecret("");
    setLocalAppToken("");
    setSaving(false);
  };

  const allTokensSet = botTokenSet && signingSecretSet && appTokenSet;

  return (
    <div className="p-5 space-y-4">
      <p className="text-xs text-muted-foreground">
        Connect Otterbot to Slack. Uses Socket Mode for real-time events. Users must pair with the bot before it responds to their messages.
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
        <span className="text-sm">Enable Slack integration</span>
      </label>

      {/* Connection section */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Bot Token (xoxb-...)
            {botTokenSet && (
              <span className="ml-2 text-green-500 normal-case tracking-normal">Set</span>
            )}
          </label>
          <input
            type="password"
            value={localBotToken}
            onChange={(e) => setLocalBotToken(e.target.value)}
            placeholder={botTokenSet ? "Enter new token to change" : "Paste your bot token"}
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
          />
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Signing Secret
            {signingSecretSet && (
              <span className="ml-2 text-green-500 normal-case tracking-normal">Set</span>
            )}
          </label>
          <input
            type="password"
            value={localSigningSecret}
            onChange={(e) => setLocalSigningSecret(e.target.value)}
            placeholder={signingSecretSet ? "Enter new secret to change" : "Paste your signing secret"}
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
          />
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            App-Level Token (xapp-...)
            {appTokenSet && (
              <span className="ml-2 text-green-500 normal-case tracking-normal">Set</span>
            )}
          </label>
          <input
            type="password"
            value={localAppToken}
            onChange={(e) => setLocalAppToken(e.target.value)}
            placeholder={appTokenSet ? "Enter new token to change" : "Paste your app-level token"}
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Create a Slack app at{" "}
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              api.slack.com/apps
            </a>
            . Enable Socket Mode and add required scopes.
          </p>
        </div>

        {botUsername && (
          <div className="text-xs text-muted-foreground">
            Bot: <span className="text-foreground font-medium">{botUsername}</span>
            {enabled && allTokensSet && (
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
            disabled={testResult?.testing || !botTokenSet}
            className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80 disabled:opacity-50"
          >
            {testResult?.testing ? "Testing..." : "Test Connection"}
          </button>
          {allTokensSet && (
            <button
              onClick={handleClearTokens}
              disabled={saving}
              className="text-xs text-red-500 hover:text-red-400 px-2 py-1.5"
            >
              Clear
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
              When enabled, the bot only responds to messages that @mention it in channels. DMs always work.
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
            Connect the bot to see available channels.
          </p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {availableChannels.map((ch) => (
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
                <span className="text-xs">#{ch.name}</span>
              </label>
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
                key={user.slackUserId}
                className="flex items-center justify-between bg-secondary rounded-md px-3 py-2"
              >
                <div>
                  <span className="text-xs font-medium">{user.slackUsername}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    Paired {new Date(user.pairedAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  onClick={() => revokeSlackUser(user.slackUserId)}
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
                  <span className="text-xs font-medium">{pairing.slackUsername}</span>
                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded ml-2 font-mono">
                    {pairing.code}
                  </code>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    {new Date(pairing.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => approveSlackPairing(pairing.code)}
                    className="text-[10px] text-green-500 hover:text-green-400 bg-green-500/10 px-2 py-1 rounded"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => rejectSlackPairing(pairing.code)}
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
          <strong>How to set up the Slack bot:</strong>
        </p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>
            Go to{" "}
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              api.slack.com/apps
            </a>{" "}
            and create a new app
          </li>
          <li>Enable Socket Mode in "Socket Mode" settings and generate an App-Level Token (xapp-...)</li>
          <li>Under "OAuth & Permissions", add bot scopes: chat:write, channels:read, groups:read, im:history, mpim:history, app_mentions:read, reactions:read, commands</li>
          <li>Under "Event Subscriptions", subscribe to: message.im, message.mpim, app_mention, reaction_added</li>
          <li>Optionally create a slash command "/otterbot" under "Slash Commands"</li>
          <li>Install the app to your workspace and copy the Bot Token (xoxb-...) and Signing Secret</li>
        </ol>
      </div>
    </div>
  );
}
