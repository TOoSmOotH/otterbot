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

  // SSH state
  const sshKeySet = useSettingsStore((s) => s.sshKeySet);
  const sshKeyFingerprint = useSettingsStore((s) => s.sshKeyFingerprint);
  const sshKeyType = useSettingsStore((s) => s.sshKeyType);
  const sshPublicKey = useSettingsStore((s) => s.sshPublicKey);
  const sshTestResult = useSettingsStore((s) => s.sshTestResult);
  const generateSSHKey = useSettingsStore((s) => s.generateSSHKey);
  const importSSHKey = useSettingsStore((s) => s.importSSHKey);
  const getSSHPublicKey = useSettingsStore((s) => s.getSSHPublicKey);
  const removeSSHKey = useSettingsStore((s) => s.removeSSHKey);
  const testSSHConnection = useSettingsStore((s) => s.testSSHConnection);

  const [localToken, setLocalToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [importKey, setImportKey] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadGitHubSettings();
  }, []);

  useEffect(() => {
    if (sshKeySet && !sshPublicKey) {
      getSSHPublicKey();
    }
  }, [sshKeySet]);

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

  const handleGenerate = async () => {
    setGenerating(true);
    await generateSSHKey();
    setGenerating(false);
  };

  const handleImport = async () => {
    if (!importKey.trim()) return;
    setImporting(true);
    await importSSHKey(importKey);
    setImportKey("");
    setShowImport(false);
    setImporting(false);
  };

  const handleRemove = async () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setRemoving(true);
    await removeSSHKey();
    setRemoving(false);
    setConfirmRemove(false);
  };

  const handleCopyPublicKey = async () => {
    if (!sshPublicKey) return;
    await navigator.clipboard.writeText(sshPublicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

      {/* PAT Section */}
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

      {/* SSH Key Section */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            SSH Key
            {sshKeySet && (
              <span className="ml-2 text-green-500 normal-case tracking-normal">
                Configured
              </span>
            )}
          </label>
          <p className="text-[10px] text-muted-foreground">
            SSH key for git operations (clone, push, pull) and automatic commit signing.
            The key is stored at <code className="bg-secondary px-1 rounded">~/.ssh/otterbot_github</code> and
            auto-configures <code className="bg-secondary px-1 rounded">.gitconfig</code> for SSH commit signing.
          </p>
        </div>

        {!sshKeySet ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
              >
                {generating ? "Generating..." : "Generate New Key"}
              </button>
              <button
                onClick={() => setShowImport(!showImport)}
                className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80"
              >
                {showImport ? "Cancel" : "Import Existing Key"}
              </button>
            </div>

            {showImport && (
              <div className="space-y-2">
                <textarea
                  value={importKey}
                  onChange={(e) => setImportKey(e.target.value)}
                  placeholder="Paste your private key here (-----BEGIN OPENSSH PRIVATE KEY-----...)"
                  className="w-full bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 ring-primary font-mono h-28 resize-none"
                />
                <button
                  onClick={handleImport}
                  disabled={importing || !importKey.trim()}
                  className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
                >
                  {importing ? "Importing..." : "Import Key"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Key info */}
            <div className="flex items-center gap-3 text-xs">
              {sshKeyType && (
                <span className="bg-secondary px-2 py-0.5 rounded font-mono uppercase">
                  {sshKeyType}
                </span>
              )}
              {sshKeyFingerprint && (
                <span className="text-muted-foreground font-mono text-[11px]">
                  {sshKeyFingerprint}
                </span>
              )}
            </div>

            {/* Public key display */}
            {sshPublicKey && (
              <div className="relative">
                <pre className="bg-secondary rounded-md px-3 py-2 text-[10px] font-mono break-all whitespace-pre-wrap max-h-20 overflow-auto">
                  {sshPublicKey}
                </pre>
                <button
                  onClick={handleCopyPublicKey}
                  className="absolute top-1.5 right-1.5 text-[10px] bg-background/80 px-2 py-0.5 rounded hover:bg-background"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              Add this public key to{" "}
              <a
                href="https://github.com/settings/ssh/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                GitHub Settings &rarr; SSH Keys
              </a>{" "}
              to enable SSH operations and commit verification.
            </p>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => testSSHConnection()}
                disabled={sshTestResult?.testing}
                className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80 disabled:opacity-50"
              >
                {sshTestResult?.testing ? "Testing..." : "Test SSH Connection"}
              </button>
              <button
                onClick={handleRemove}
                disabled={removing}
                className={cn(
                  "text-xs px-2 py-1.5",
                  confirmRemove
                    ? "bg-red-500/10 text-red-500 rounded-md"
                    : "text-red-500 hover:text-red-400",
                )}
              >
                {removing
                  ? "Removing..."
                  : confirmRemove
                    ? "Confirm Remove"
                    : "Remove Key"}
              </button>
              {confirmRemove && (
                <button
                  onClick={() => setConfirmRemove(false)}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5"
                >
                  Cancel
                </button>
              )}

              {sshTestResult && !sshTestResult.testing && (
                <span
                  className={cn(
                    "text-xs",
                    sshTestResult.ok ? "text-green-500" : "text-red-500",
                  )}
                >
                  {sshTestResult.ok
                    ? sshTestResult.username
                      ? `\u2713 Authenticated as @${sshTestResult.username}`
                      : "\u2713 SSH connection successful"
                    : `\u2717 ${sshTestResult.error ?? "Failed"}`}
                </span>
              )}
            </div>
          </div>
        )}
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
              GitHub Settings &rarr; Tokens &rarr; New token
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
