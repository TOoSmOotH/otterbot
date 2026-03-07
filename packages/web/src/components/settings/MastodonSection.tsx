import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settings-store";
import { getSocket } from "../../lib/socket";

export function MastodonSection() {
  const enabled = useSettingsStore((s) => s.mastodonEnabled);
  const credentialsSet = useSettingsStore((s) => s.mastodonCredentialsSet);
  const acct = useSettingsStore((s) => s.mastodonAcct);
  const instanceUrl = useSettingsStore((s) => s.mastodonInstanceUrl);
  const pairedUsers = useSettingsStore((s) => s.mastodonPairedUsers);
  const pendingPairings = useSettingsStore((s) => s.mastodonPendingPairings);
  const testResult = useSettingsStore((s) => s.mastodonTestResult);
  const loadMastodonSettings = useSettingsStore((s) => s.loadMastodonSettings);
  const updateMastodonSettings = useSettingsStore((s) => s.updateMastodonSettings);
  const testMastodonConnection = useSettingsStore((s) => s.testMastodonConnection);
  const approveMastodonPairing = useSettingsStore((s) => s.approveMastodonPairing);
  const rejectMastodonPairing = useSettingsStore((s) => s.rejectMastodonPairing);
  const revokeMastodonUser = useSettingsStore((s) => s.revokeMastodonUser);

  const [localInstanceUrl, setLocalInstanceUrl] = useState("");
  const [localAccessToken, setLocalAccessToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [botStatus, setBotStatus] = useState<"connected" | "disconnected" | "error">("disconnected");

  useEffect(() => {
    loadMastodonSettings();
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const handleStatus = (data: { status: "connected" | "disconnected" | "error" }) => {
      setBotStatus(data.status);
      if (data.status === "connected") {
        loadMastodonSettings();
      }
    };

    const handlePairingRequest = () => {
      loadMastodonSettings();
    };

    socket.on("mastodon:status", handleStatus);
    socket.on("mastodon:pairing-request", handlePairingRequest);

    return () => {
      socket.off("mastodon:status", handleStatus);
      socket.off("mastodon:pairing-request", handlePairingRequest);
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const data: { instanceUrl?: string; accessToken?: string } = {};
    if (localInstanceUrl) data.instanceUrl = localInstanceUrl;
    if (localAccessToken) data.accessToken = localAccessToken;
    await updateMastodonSettings(data);
    setLocalInstanceUrl("");
    setLocalAccessToken("");
    setSaving(false);
  };

  const handleToggleEnabled = async () => {
    await updateMastodonSettings({ enabled: !enabled });
  };

  const handleTest = () => {
    testMastodonConnection();
  };

  const handleClear = async () => {
    setSaving(true);
    await updateMastodonSettings({ instanceUrl: "", accessToken: "" });
    setLocalInstanceUrl("");
    setLocalAccessToken("");
    setSaving(false);
  };

  return (
    <div className="p-5 space-y-4">
      <p className="text-xs text-muted-foreground">
        Connect Otterbot to Mastodon. Users must pair with the bot before it
        responds to their mentions.
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
        <span className="text-sm">Enable Mastodon integration</span>
      </label>

      {/* Connection section */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Instance URL
            {credentialsSet && (
              <span className="ml-2 text-green-500 normal-case tracking-normal">
                Set
              </span>
            )}
          </label>
          <input
            type="text"
            value={localInstanceUrl}
            onChange={(e) => setLocalInstanceUrl(e.target.value)}
            placeholder={
              instanceUrl || "https://mastodon.social"
            }
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
          />
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Access Token
          </label>
          <input
            type="password"
            value={localAccessToken}
            onChange={(e) => setLocalAccessToken(e.target.value)}
            placeholder={
              credentialsSet ? "Enter new token to change" : "Paste your access token"
            }
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
          />
        </div>

        {acct && (
          <div className="text-xs text-muted-foreground">
            Account: <span className="text-foreground font-medium">@{acct}</span>
            {enabled && credentialsSet && (
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
            disabled={testResult?.testing || !credentialsSet}
            className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80 disabled:opacity-50"
          >
            {testResult?.testing ? "Testing..." : "Test Connection"}
          </button>
          {credentialsSet && (
            <button
              onClick={handleClear}
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
            No users have been paired yet. When someone mentions the bot on Mastodon, they'll receive a pairing code to approve here.
          </p>
        ) : (
          <div className="space-y-2">
            {pairedUsers.map((user) => (
              <div
                key={user.mastodonId}
                className="flex items-center justify-between bg-secondary rounded-md px-3 py-2"
              >
                <div>
                  <span className="text-xs font-medium">@{user.mastodonAcct}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    Paired {new Date(user.pairedAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  onClick={() => revokeMastodonUser(user.mastodonId)}
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
                  <span className="text-xs font-medium">@{pairing.mastodonAcct}</span>
                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded ml-2 font-mono">
                    {pairing.code}
                  </code>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    {new Date(pairing.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => approveMastodonPairing(pairing.code)}
                    className="text-[10px] text-green-500 hover:text-green-400 bg-green-500/10 px-2 py-1 rounded"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => rejectMastodonPairing(pairing.code)}
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
          <strong>How to set up Mastodon:</strong>
        </p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Go to your Mastodon instance's Settings &rarr; Development</li>
          <li>Create a new application with read/write permissions</li>
          <li>Copy the access token and paste it above</li>
          <li>Enter your instance URL (e.g. https://mastodon.social)</li>
          <li>Mention the bot's account on Mastodon to start pairing</li>
          <li>Approve the pairing code that appears in the dashboard</li>
        </ol>
      </div>
    </div>
  );
}
