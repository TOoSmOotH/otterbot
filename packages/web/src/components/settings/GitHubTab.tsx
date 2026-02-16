import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settings-store";

export function GitHubTab() {
  const enabled = useSettingsStore((s) => s.gitHubEnabled);
  const tokenSet = useSettingsStore((s) => s.gitHubTokenSet);
  const username = useSettingsStore((s) => s.gitHubUsername);
  const testResult = useSettingsStore((s) => s.gitHubTestResult);
  const loadGitHubSettings = useSettingsStore((s) => s.loadGitHubSettings);
  const updateGitHubSettings = useSettingsStore((s) => s.updateGitHubSettings);
  const testGitHubConnection = useSettingsStore((s) => s.testGitHubConnection);

  const [localToken, setLocalToken] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadGitHubSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const data: { enabled?: boolean; token?: string } = {};
    if (localToken) {
      data.token = localToken;
    }
    await updateGitHubSettings(data);
    setLocalToken("");
    setSaving(false);
  };

  const handleToggleEnabled = async () => {
    await updateGitHubSettings({ enabled: !enabled });
  };

  const handleTest = () => {
    testGitHubConnection();
  };

  const handleClearToken = async () => {
    setSaving(true);
    await updateGitHubSettings({ token: "" });
    setLocalToken("");
    setSaving(false);
  };

  return (
    <div className="p-5 space-y-4">
      <p className="text-xs text-muted-foreground">
        Configure GitHub access for the COO to interact with repositories, issues,
        pull requests, and releases.
      </p>

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
        <span className="text-sm">Enable GitHub integration</span>
      </label>

      <div className="border border-border rounded-lg p-4 space-y-3">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Personal Access Token{" "}
            <span className="normal-case tracking-normal">(PAT)</span>
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
              tokenSet ? "Enter new token to change" : "ghp_xxxxxxxxxxxxxxxxxxxx"
            }
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Required scopes: <code className="bg-secondary px-1 rounded">repo</code>,{" "}
            <code className="bg-secondary px-1 rounded">read:org</code>,{" "}
            <code className="bg-secondary px-1 rounded">workflow</code>
          </p>
        </div>

        {username && (
          <div className="text-xs text-muted-foreground">
            Authenticated as{" "}
            <a
              href={`https://github.com/${username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              @{username}
            </a>
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
                ? username
                  ? `\u2713 Connected as @${username}`
                  : "\u2713 Connected"
                : `\u2717 ${testResult.error ?? "Failed"}`}
            </span>
          )}
        </div>
      </div>

      <div className="text-[10px] text-muted-foreground space-y-1">
        <p>
          <strong>How to create a PAT:</strong>
        </p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>
            Go to{" "}
            <a
              href="https://github.com/settings/tokens/new"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              GitHub Settings → Tokens → New token
            </a>
          </li>
          <li>Select the scopes mentioned above</li>
          <li>Generate and copy the token</li>
          <li>Paste it in the field above and save</li>
        </ol>
      </div>
    </div>
  );
}
