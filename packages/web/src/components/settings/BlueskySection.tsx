import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settings-store";
import { getSocket } from "../../lib/socket";

export function BlueskySection() {
  const enabled = useSettingsStore((s) => s.blueskyEnabled);
  const credentialsSet = useSettingsStore((s) => s.blueskyCredentialsSet);
  const handle = useSettingsStore((s) => s.blueskyHandle);
  const pairedUsers = useSettingsStore((s) => s.blueskyPairedUsers);
  const pendingPairings = useSettingsStore((s) => s.blueskyPendingPairings);
  const testResult = useSettingsStore((s) => s.blueskyTestResult);
  const loadBlueskySettings = useSettingsStore((s) => s.loadBlueskySettings);
  const updateBlueskySettings = useSettingsStore((s) => s.updateBlueskySettings);
  const testBlueskyConnection = useSettingsStore((s) => s.testBlueskyConnection);
  const approveBlueskyPairing = useSettingsStore((s) => s.approveBlueskyPairing);
  const rejectBlueskyPairing = useSettingsStore((s) => s.rejectBlueskyPairing);
  const revokeBlueskyUser = useSettingsStore((s) => s.revokeBlueskyUser);

  const [localIdentifier, setLocalIdentifier] = useState("");
  const [localAppPassword, setLocalAppPassword] = useState("");
  const [localService, setLocalService] = useState("");
  const [saving, setSaving] = useState(false);
  const [botStatus, setBotStatus] = useState<"connected" | "disconnected" | "error">("disconnected");

  useEffect(() => {
    loadBlueskySettings();
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const handleStatus = (data: { status: "connected" | "disconnected" | "error" }) => {
      setBotStatus(data.status);
      if (data.status === "connected") {
        loadBlueskySettings();
      }
    };

    const handlePairingRequest = () => {
      loadBlueskySettings();
    };

    socket.on("bluesky:status", handleStatus);
    socket.on("bluesky:pairing-request", handlePairingRequest);

    return () => {
      socket.off("bluesky:status", handleStatus);
      socket.off("bluesky:pairing-request", handlePairingRequest);
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const data: { identifier?: string; appPassword?: string; service?: string } = {};
    if (localIdentifier) data.identifier = localIdentifier;
    if (localAppPassword) data.appPassword = localAppPassword;
    if (localService) data.service = localService;
    await updateBlueskySettings(data);
    setLocalIdentifier("");
    setLocalAppPassword("");
    setLocalService("");
    setSaving(false);
  };

  const handleToggleEnabled = async () => {
    await updateBlueskySettings({ enabled: !enabled });
  };

  const handleTest = () => {
    testBlueskyConnection();
  };

  const handleClear = async () => {
    setSaving(true);
    await updateBlueskySettings({ identifier: "", appPassword: "", service: "" });
    setLocalIdentifier("");
    setLocalAppPassword("");
    setLocalService("");
    setSaving(false);
  };

  return (
    <div className="p-5 space-y-4">
      <p className="text-xs text-muted-foreground">
        Connect Otterbot to Bluesky. Users must pair with the bot before it
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
        <span className="text-sm">Enable Bluesky integration</span>
      </label>

      {/* Connection section */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Identifier (Handle or Email)
            {credentialsSet && (
              <span className="ml-2 text-green-500 normal-case tracking-normal">
                Set
              </span>
            )}
          </label>
          <input
            type="text"
            value={localIdentifier}
            onChange={(e) => setLocalIdentifier(e.target.value)}
            placeholder={
              credentialsSet ? "Enter new identifier to change" : "user.bsky.social or email"
            }
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
          />
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            App Password
          </label>
          <input
            type="password"
            value={localAppPassword}
            onChange={(e) => setLocalAppPassword(e.target.value)}
            placeholder={
              credentialsSet ? "Enter new app password to change" : "Paste your app password"
            }
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
          />
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Service URL
          </label>
          <input
            type="text"
            value={localService}
            onChange={(e) => setLocalService(e.target.value)}
            placeholder="https://bsky.social (default)"
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
          />
        </div>

        {handle && (
          <div className="text-xs text-muted-foreground">
            Account: <span className="text-foreground font-medium">@{handle}</span>
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
            No users have been paired yet. When someone mentions the bot on Bluesky, they'll receive a pairing code to approve here.
          </p>
        ) : (
          <div className="space-y-2">
            {pairedUsers.map((user) => (
              <div
                key={user.blueskyDid}
                className="flex items-center justify-between bg-secondary rounded-md px-3 py-2"
              >
                <div>
                  <span className="text-xs font-medium">{user.blueskyHandle}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    Paired {new Date(user.pairedAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  onClick={() => revokeBlueskyUser(user.blueskyDid)}
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
                  <span className="text-xs font-medium">{pairing.blueskyHandle}</span>
                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded ml-2 font-mono">
                    {pairing.code}
                  </code>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    {new Date(pairing.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => approveBlueskyPairing(pairing.code)}
                    className="text-[10px] text-green-500 hover:text-green-400 bg-green-500/10 px-2 py-1 rounded"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => rejectBlueskyPairing(pairing.code)}
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
          <strong>How to set up Bluesky:</strong>
        </p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Go to Bluesky Settings &rarr; App Passwords</li>
          <li>Create a new app password</li>
          <li>Enter your handle/email and the app password above</li>
          <li>Mention the bot's account on Bluesky to start pairing</li>
          <li>Approve the pairing code that appears in the dashboard</li>
        </ol>
      </div>
    </div>
  );
}
