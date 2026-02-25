import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settings-store";
import { getSocket } from "../../lib/socket";

export function NextcloudTalkSection() {
  const enabled = useSettingsStore((s) => s.nextcloudTalkEnabled);
  const serverUrlSet = useSettingsStore((s) => s.nextcloudTalkServerUrlSet);
  const usernameSet = useSettingsStore((s) => s.nextcloudTalkUsernameSet);
  const appPasswordSet = useSettingsStore((s) => s.nextcloudTalkAppPasswordSet);
  const botUsername = useSettingsStore((s) => s.nextcloudTalkBotUsername);
  const requireMention = useSettingsStore((s) => s.nextcloudTalkRequireMention);
  const testResult = useSettingsStore((s) => s.nextcloudTalkTestResult);
  const pairedUsers = useSettingsStore((s) => s.nextcloudTalkPairedUsers);
  const pendingPairings = useSettingsStore((s) => s.nextcloudTalkPendingPairings);
  const loadNextcloudTalkSettings = useSettingsStore((s) => s.loadNextcloudTalkSettings);
  const updateNextcloudTalkSettings = useSettingsStore((s) => s.updateNextcloudTalkSettings);
  const testNextcloudTalkConnection = useSettingsStore((s) => s.testNextcloudTalkConnection);
  const approveNextcloudTalkPairing = useSettingsStore((s) => s.approveNextcloudTalkPairing);
  const rejectNextcloudTalkPairing = useSettingsStore((s) => s.rejectNextcloudTalkPairing);
  const revokeNextcloudTalkUser = useSettingsStore((s) => s.revokeNextcloudTalkUser);

  const [localServerUrl, setLocalServerUrl] = useState("");
  const [localUsername, setLocalUsername] = useState("");
  const [localAppPassword, setLocalAppPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [botStatus, setBotStatus] = useState<"connected" | "disconnected" | "error">("disconnected");

  useEffect(() => {
    loadNextcloudTalkSettings();
  }, []);

  // Listen for real-time Nextcloud Talk events
  useEffect(() => {
    const socket = getSocket();

    const handleStatus = (data: { status: "connected" | "disconnected" | "error"; botUsername?: string }) => {
      setBotStatus(data.status);
      if (data.status === "connected") {
        loadNextcloudTalkSettings();
      }
    };

    const handlePairingRequest = () => {
      loadNextcloudTalkSettings();
    };

    socket.on("nextcloud-talk:status", handleStatus);
    socket.on("nextcloud-talk:pairing-request", handlePairingRequest);

    return () => {
      socket.off("nextcloud-talk:status", handleStatus);
      socket.off("nextcloud-talk:pairing-request", handlePairingRequest);
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const data: { serverUrl?: string; username?: string; appPassword?: string } = {};
    if (localServerUrl) data.serverUrl = localServerUrl;
    if (localUsername) data.username = localUsername;
    if (localAppPassword) data.appPassword = localAppPassword;
    await updateNextcloudTalkSettings(data);
    setLocalServerUrl("");
    setLocalUsername("");
    setLocalAppPassword("");
    setSaving(false);
  };

  const handleToggleEnabled = async () => {
    await updateNextcloudTalkSettings({ enabled: !enabled });
  };

  const handleToggleMention = async () => {
    await updateNextcloudTalkSettings({ requireMention: !requireMention });
  };

  const handleTest = () => {
    testNextcloudTalkConnection();
  };

  const handleClearCredentials = async () => {
    setSaving(true);
    await updateNextcloudTalkSettings({ username: "", appPassword: "" });
    setLocalUsername("");
    setLocalAppPassword("");
    setSaving(false);
  };

  return (
    <div className="p-5 space-y-4">
      <p className="text-xs text-muted-foreground">
        Connect Otterbot to Nextcloud Talk. Users must pair with the bot before it
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
        <span className="text-sm">Enable Nextcloud Talk integration</span>
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
            placeholder="https://your-nextcloud-server.com"
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
          />
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Username
            {usernameSet && (
              <span className="ml-2 text-green-500 normal-case tracking-normal">
                Set
              </span>
            )}
          </label>
          <input
            type="text"
            value={localUsername}
            onChange={(e) => setLocalUsername(e.target.value)}
            placeholder={
              usernameSet ? "Enter new username to change" : "Nextcloud username"
            }
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
          />
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            App Password
            {appPasswordSet && (
              <span className="ml-2 text-green-500 normal-case tracking-normal">
                Set
              </span>
            )}
          </label>
          <input
            type="password"
            value={localAppPassword}
            onChange={(e) => setLocalAppPassword(e.target.value)}
            placeholder={
              appPasswordSet ? "Enter new password to change" : "Paste your app password"
            }
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Generate an app password in Nextcloud under Settings &gt; Security &gt; Devices &amp; sessions.
          </p>
        </div>

        {botUsername && (
          <div className="text-xs text-muted-foreground">
            Bot: <span className="text-foreground font-medium">{botUsername}</span>
            {enabled && usernameSet && appPasswordSet && serverUrlSet && (
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
            disabled={testResult?.testing || !usernameSet || !appPasswordSet || !serverUrlSet}
            className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80 disabled:opacity-50"
          >
            {testResult?.testing ? "Testing..." : "Test Connection"}
          </button>
          {(usernameSet || appPasswordSet) && (
            <button
              onClick={handleClearCredentials}
              disabled={saving}
              className="text-xs text-red-500 hover:text-red-400 px-2 py-1.5"
            >
              Clear Credentials
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
            <span className="text-sm">Require @mention in group conversations</span>
            <p className="text-[10px] text-muted-foreground">
              When enabled, the bot only responds to messages that @mention it in group conversations. One-to-one chats always work.
            </p>
          </div>
        </label>
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
                key={user.nextcloudUserId}
                className="flex items-center justify-between bg-secondary rounded-md px-3 py-2"
              >
                <div>
                  <span className="text-xs font-medium">{user.nextcloudDisplayName}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    Paired {new Date(user.pairedAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  onClick={() => revokeNextcloudTalkUser(user.nextcloudUserId)}
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
                  <span className="text-xs font-medium">{pairing.nextcloudDisplayName}</span>
                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded ml-2 font-mono">
                    {pairing.code}
                  </code>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    {new Date(pairing.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => approveNextcloudTalkPairing(pairing.code)}
                    className="text-[10px] text-green-500 hover:text-green-400 bg-green-500/10 px-2 py-1 rounded"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => rejectNextcloudTalkPairing(pairing.code)}
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
          <strong>How to set up Nextcloud Talk:</strong>
        </p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Create a dedicated Nextcloud user account for the bot (or use an existing one)</li>
          <li>Log in as that user and go to Settings &gt; Security &gt; Devices &amp; sessions</li>
          <li>Create a new app password and copy it</li>
          <li>Enter the Nextcloud server URL, username, and app password above</li>
          <li>Add the bot user to the Talk conversations you want it to participate in</li>
          <li>Users who message the bot will receive a pairing code to approve here</li>
        </ol>
      </div>
    </div>
  );
}
