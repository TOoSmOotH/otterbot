import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settings-store";

export function OpenCodeTab() {
  const enabled = useSettingsStore((s) => s.openCodeEnabled);
  const apiUrl = useSettingsStore((s) => s.openCodeApiUrl);
  const username = useSettingsStore((s) => s.openCodeUsername);
  const passwordSet = useSettingsStore((s) => s.openCodePasswordSet);
  const timeoutMs = useSettingsStore((s) => s.openCodeTimeoutMs);
  const maxIterations = useSettingsStore((s) => s.openCodeMaxIterations);
  const testResult = useSettingsStore((s) => s.openCodeTestResult);
  const loadOpenCodeSettings = useSettingsStore((s) => s.loadOpenCodeSettings);
  const updateOpenCodeSettings = useSettingsStore(
    (s) => s.updateOpenCodeSettings,
  );
  const testOpenCodeConnection = useSettingsStore(
    (s) => s.testOpenCodeConnection,
  );

  const [localApiUrl, setLocalApiUrl] = useState(apiUrl);
  const [localUsername, setLocalUsername] = useState(username);
  const [localPassword, setLocalPassword] = useState("");
  const [localTimeoutMs, setLocalTimeoutMs] = useState(String(timeoutMs));
  const [localMaxIterations, setLocalMaxIterations] = useState(
    String(maxIterations),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadOpenCodeSettings();
  }, []);

  // Sync local state when store updates
  useEffect(() => {
    setLocalApiUrl(apiUrl);
    setLocalUsername(username);
    setLocalTimeoutMs(String(timeoutMs));
    setLocalMaxIterations(String(maxIterations));
  }, [apiUrl, username, timeoutMs, maxIterations]);

  const handleSave = async () => {
    setSaving(true);
    const data: Record<string, unknown> = {
      apiUrl: localApiUrl,
      username: localUsername,
      timeoutMs: parseInt(localTimeoutMs, 10) || 180000,
      maxIterations: parseInt(localMaxIterations, 10) || 50,
    };
    if (localPassword) {
      data.password = localPassword;
    }
    await updateOpenCodeSettings(data);
    setLocalPassword("");
    setSaving(false);
  };

  const handleToggleEnabled = async () => {
    await updateOpenCodeSettings({ enabled: !enabled });
  };

  const handleTest = () => {
    testOpenCodeConnection();
  };

  return (
    <div className="p-5 space-y-4">
      <p className="text-xs text-muted-foreground">
        Connect to an{" "}
        <a
          href="https://opencode.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          OpenCode
        </a>{" "}
        server to delegate complex coding tasks. Start the server with{" "}
        <code className="bg-secondary px-1 py-0.5 rounded text-[11px]">
          opencode serve
        </code>
        .
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
        <span className="text-sm">Enable OpenCode integration</span>
      </label>

      <div className="border border-border rounded-lg p-4 space-y-3">
        {/* API URL */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            API URL
          </label>
          <input
            type="text"
            value={localApiUrl}
            onChange={(e) => setLocalApiUrl(e.target.value)}
            placeholder="http://127.0.0.1:4096"
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
          />
        </div>

        {/* Username */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Username{" "}
            <span className="normal-case tracking-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={localUsername}
            onChange={(e) => setLocalUsername(e.target.value)}
            placeholder="Leave empty if no auth"
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
          />
        </div>

        {/* Password */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Password{" "}
            <span className="normal-case tracking-normal">(optional)</span>
            {passwordSet && (
              <span className="ml-2 text-green-500 normal-case tracking-normal">
                Set
              </span>
            )}
          </label>
          <input
            type="password"
            value={localPassword}
            onChange={(e) => setLocalPassword(e.target.value)}
            placeholder={
              passwordSet ? "Enter new password to change" : "OPENCODE_SERVER_PASSWORD"
            }
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
          />
        </div>

        {/* Timeout */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Timeout (ms)
          </label>
          <input
            type="number"
            value={localTimeoutMs}
            onChange={(e) => setLocalTimeoutMs(e.target.value)}
            placeholder="180000"
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            How long to wait for OpenCode to finish a task (default: 180000ms /
            3 minutes)
          </p>
        </div>

        {/* Max Iterations */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Max Iterations
          </label>
          <input
            type="number"
            value={localMaxIterations}
            onChange={(e) => setLocalMaxIterations(e.target.value)}
            placeholder="50"
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Maximum number of OpenCode tool-use iterations per task (default:
            50)
          </p>
        </div>

        {/* Actions */}
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
            disabled={testResult?.testing}
            className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80 disabled:opacity-50"
          >
            {testResult?.testing ? "Testing..." : "Test Connection"}
          </button>

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
    </div>
  );
}
