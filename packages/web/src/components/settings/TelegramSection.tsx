import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settings-store";
import { getSocket } from "../../lib/socket";

export function TelegramSection() {
  const enabled = useSettingsStore((s) => s.telegramEnabled);
  const tokenSet = useSettingsStore((s) => s.telegramTokenSet);
  const botUsername = useSettingsStore((s) => s.telegramBotUsername);
  const pairedUsers = useSettingsStore((s) => s.telegramPairedUsers);
  const pendingPairings = useSettingsStore((s) => s.telegramPendingPairings);
  const testResult = useSettingsStore((s) => s.telegramTestResult);
  const loadTelegramSettings = useSettingsStore((s) => s.loadTelegramSettings);
  const updateTelegramSettings = useSettingsStore((s) => s.updateTelegramSettings);
  const testTelegramConnection = useSettingsStore((s) => s.testTelegramConnection);
  const approveTelegramPairing = useSettingsStore((s) => s.approveTelegramPairing);
  const rejectTelegramPairing = useSettingsStore((s) => s.rejectTelegramPairing);
  const revokeTelegramUser = useSettingsStore((s) => s.revokeTelegramUser);

  const [localToken, setLocalToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [botStatus, setBotStatus] = useState<"connected" | "disconnected" | "error">("disconnected");

  useEffect(() => {
    loadTelegramSettings();
  }, []);

  // Listen for real-time Telegram events
  useEffect(() => {
    const socket = getSocket();

    const handleStatus = (data: { status: "connected" | "disconnected" | "error"; botUsername?: string }) => {
      setBotStatus(data.status);
      if (data.status === "connected") {
        loadTelegramSettings();
      }
    };

    const handlePairingRequest = () => {
      loadTelegramSettings();
    };

    socket.on("telegram:status", handleStatus);
    socket.on("telegram:pairing-request", handlePairingRequest);

    return () => {
      socket.off("telegram:status", handleStatus);
      socket.off("telegram:pairing-request", handlePairingRequest);
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const data: { enabled?: boolean; botToken?: string } = {};
    if (localToken) {
      data.botToken = localToken;
    }
    await updateTelegramSettings(data);
    setLocalToken("");
    setSaving(false);
  };

  const handleToggleEnabled = async () => {
    await updateTelegramSettings({ enabled: !enabled });
  };

  const handleTest = () => {
    testTelegramConnection();
  };

  const handleClearToken = async () => {
    setSaving(true);
    await updateTelegramSettings({ botToken: "" });
    setLocalToken("");
    setSaving(false);
  };

  return (
    <div className="p-5 space-y-4">
      <p className="text-xs text-muted-foreground">
        Connect Otterbot to Telegram. Users must pair with the bot before it
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
        <span className="text-sm">Enable Telegram integration</span>
      </label>

      {/* Connection section */}
      <div className="border border-border rounded-lg p-4 space-y-3">
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
          <p className="text-[10px] text-muted-foreground mt-1">
            Create a bot via{" "}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              @BotFather
            </a>{" "}
            on Telegram and paste the token here.
          </p>
        </div>

        {botUsername && (
          <div className="text-xs text-muted-foreground">
            Bot: <span className="text-foreground font-medium">@{botUsername}</span>
            {enabled && tokenSet && (
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
            disabled={testResult?.testing || !tokenSet}
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
            No users have been paired yet. When someone messages the bot, they'll receive a pairing code to approve here.
          </p>
        ) : (
          <div className="space-y-2">
            {pairedUsers.map((user) => (
              <div
                key={user.telegramUserId}
                className="flex items-center justify-between bg-secondary rounded-md px-3 py-2"
              >
                <div>
                  <span className="text-xs font-medium">{user.telegramUsername}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    Paired {new Date(user.pairedAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  onClick={() => revokeTelegramUser(user.telegramUserId)}
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
                  <span className="text-xs font-medium">{pairing.telegramUsername}</span>
                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded ml-2 font-mono">
                    {pairing.code}
                  </code>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    {new Date(pairing.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => approveTelegramPairing(pairing.code)}
                    className="text-[10px] text-green-500 hover:text-green-400 bg-green-500/10 px-2 py-1 rounded"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => rejectTelegramPairing(pairing.code)}
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
          <strong>How to set up the Telegram bot:</strong>
        </p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>
            Open Telegram and search for{" "}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              @BotFather
            </a>
          </li>
          <li>Send /newbot and follow the prompts to create a new bot</li>
          <li>Copy the bot token and paste it above</li>
          <li>Start a conversation with your new bot on Telegram</li>
          <li>Approve the pairing code that appears in the dashboard</li>
        </ol>
      </div>
    </div>
  );
}
