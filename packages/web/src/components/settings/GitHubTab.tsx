import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settings-store";

function AccountCard({ accountId }: { accountId: string }) {
  const accounts = useSettingsStore((s) => s.gitHubAccounts);
  const account = accounts.find((a) => a.id === accountId);
  const updateGitHubAccount = useSettingsStore((s) => s.updateGitHubAccount);
  const deleteGitHubAccount = useSettingsStore((s) => s.deleteGitHubAccount);
  const setDefaultGitHubAccount = useSettingsStore((s) => s.setDefaultGitHubAccount);
  const testGitHubAccount = useSettingsStore((s) => s.testGitHubAccount);
  const generateAccountSSHKey = useSettingsStore((s) => s.generateAccountSSHKey);
  const importAccountSSHKey = useSettingsStore((s) => s.importAccountSSHKey);
  const getAccountSSHPublicKey = useSettingsStore((s) => s.getAccountSSHPublicKey);
  const removeAccountSSHKey = useSettingsStore((s) => s.removeAccountSSHKey);
  const testAccountSSHConnection = useSettingsStore((s) => s.testAccountSSHConnection);

  const [expanded, setExpanded] = useState(false);
  const [editLabel, setEditLabel] = useState("");
  const [editToken, setEditToken] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importKey, setImportKey] = useState("");
  const [importing, setImporting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemoveSSH, setConfirmRemoveSSH] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (expanded && account?.sshKeySet && !account.sshPublicKey) {
      getAccountSSHPublicKey(accountId);
    }
  }, [expanded, account?.sshKeySet]);

  if (!account) return null;

  const handleSave = async () => {
    setSaving(true);
    const data: { label?: string; token?: string; email?: string } = {};
    if (editLabel && editLabel !== account.label) data.label = editLabel;
    if (editToken) data.token = editToken;
    if (editEmail !== undefined) data.email = editEmail;
    if (Object.keys(data).length > 0) {
      await updateGitHubAccount(accountId, data);
    }
    setEditToken("");
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    await deleteGitHubAccount(accountId);
    setDeleting(false);
    setConfirmDelete(false);
  };

  const handleCopyPublicKey = async () => {
    if (!account.sshPublicKey) return;
    await navigator.clipboard.writeText(account.sshPublicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors text-left"
      >
        <span className={cn("text-xs transition-transform", expanded && "rotate-90")}>&#9654;</span>
        <span className="text-sm font-medium flex-1">{account.label}</span>
        {account.username && (
          <span className="text-xs text-muted-foreground">@{account.username}</span>
        )}
        {account.isDefault && (
          <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
            Default
          </span>
        )}
        {account.tokenSet && (
          <span className="w-2 h-2 rounded-full bg-green-500" title="Token set" />
        )}
        {account.sshKeySet && (
          <span className="text-[10px] text-muted-foreground">SSH</span>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border pt-3">
          {/* Edit fields */}
          <div className="space-y-2">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">Label</label>
              <input
                type="text"
                defaultValue={account.label}
                onChange={(e) => setEditLabel(e.target.value)}
                className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">
                Personal Access Token
                {account.tokenSet && <span className="ml-2 text-green-500 normal-case tracking-normal">Set</span>}
              </label>
              <input
                type="password"
                value={editToken}
                onChange={(e) => setEditToken(e.target.value)}
                placeholder={account.tokenSet ? "Enter new token to change" : "ghp_xxxxxxxxxxxxxxxxxxxx"}
                className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">
                Email <span className="normal-case tracking-normal">(for commits)</span>
              </label>
              <input
                type="email"
                defaultValue={account.email ?? ""}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="user@example.com (defaults to noreply)"
                className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
              />
            </div>
          </div>

          {/* Actions row */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => testGitHubAccount(accountId)}
              disabled={account.testResult?.testing || !account.tokenSet}
              className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80 disabled:opacity-50"
            >
              {account.testResult?.testing ? "Testing..." : "Test Connection"}
            </button>
            {!account.isDefault && (
              <button
                onClick={() => setDefaultGitHubAccount(accountId)}
                className="text-xs text-primary hover:underline px-2 py-1.5"
              >
                Set as Default
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={cn(
                "text-xs px-2 py-1.5",
                confirmDelete
                  ? "bg-red-500/10 text-red-500 rounded-md"
                  : "text-red-500 hover:text-red-400",
              )}
            >
              {deleting ? "Deleting..." : confirmDelete ? "Confirm Delete" : "Delete"}
            </button>
            {confirmDelete && (
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Test result */}
          {account.testResult && !account.testResult.testing && (
            <div className={cn("text-xs", account.testResult.ok ? "text-green-500" : "text-red-500")}>
              {account.testResult.ok
                ? account.testResult.username
                  ? `\u2713 Connected as @${account.testResult.username}`
                  : "\u2713 Connected"
                : `\u2717 ${account.testResult.error ?? "Failed"}`}
            </div>
          )}

          {/* SSH Key section */}
          <div className="border-t border-border pt-3 space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider block">
              SSH Key
              {account.sshKeySet && <span className="ml-2 text-green-500 normal-case tracking-normal">Configured</span>}
            </label>

            {!account.sshKeySet ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => { setGenerating(true); await generateAccountSSHKey(accountId); setGenerating(false); }}
                    disabled={generating}
                    className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
                  >
                    {generating ? "Generating..." : "Generate Key"}
                  </button>
                  <button
                    onClick={() => setShowImport(!showImport)}
                    className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80"
                  >
                    {showImport ? "Cancel" : "Import Key"}
                  </button>
                </div>
                {showImport && (
                  <div className="space-y-2">
                    <textarea
                      value={importKey}
                      onChange={(e) => setImportKey(e.target.value)}
                      placeholder="Paste your private key here..."
                      className="w-full bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 ring-primary font-mono h-28 resize-none"
                    />
                    <button
                      onClick={async () => { setImporting(true); await importAccountSSHKey(accountId, importKey); setImportKey(""); setShowImport(false); setImporting(false); }}
                      disabled={importing || !importKey.trim()}
                      className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
                    >
                      {importing ? "Importing..." : "Import"}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {account.sshKeyType && (
                  <div className="flex items-center gap-3 text-xs">
                    <span className="bg-secondary px-2 py-0.5 rounded font-mono uppercase">{account.sshKeyType}</span>
                    {account.sshFingerprint && (
                      <span className="text-muted-foreground font-mono text-[11px]">{account.sshFingerprint}</span>
                    )}
                  </div>
                )}
                {account.sshPublicKey && (
                  <div className="relative">
                    <pre className="bg-secondary rounded-md px-3 py-2 text-[10px] font-mono break-all whitespace-pre-wrap max-h-20 overflow-auto">
                      {account.sshPublicKey}
                    </pre>
                    <button
                      onClick={handleCopyPublicKey}
                      className="absolute top-1.5 right-1.5 text-[10px] bg-background/80 px-2 py-0.5 rounded hover:bg-background"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => testAccountSSHConnection(accountId)}
                    disabled={account.sshTestResult?.testing}
                    className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80 disabled:opacity-50"
                  >
                    {account.sshTestResult?.testing ? "Testing..." : "Test SSH"}
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirmRemoveSSH) { setConfirmRemoveSSH(true); return; }
                      setRemoving(true);
                      await removeAccountSSHKey(accountId);
                      setRemoving(false);
                      setConfirmRemoveSSH(false);
                    }}
                    disabled={removing}
                    className={cn(
                      "text-xs px-2 py-1.5",
                      confirmRemoveSSH ? "bg-red-500/10 text-red-500 rounded-md" : "text-red-500 hover:text-red-400",
                    )}
                  >
                    {removing ? "Removing..." : confirmRemoveSSH ? "Confirm Remove" : "Remove Key"}
                  </button>
                  {confirmRemoveSSH && (
                    <button onClick={() => setConfirmRemoveSSH(false)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5">
                      Cancel
                    </button>
                  )}
                  {account.sshTestResult && !account.sshTestResult.testing && (
                    <span className={cn("text-xs", account.sshTestResult.ok ? "text-green-500" : "text-red-500")}>
                      {account.sshTestResult.ok
                        ? account.sshTestResult.username
                          ? `\u2713 @${account.sshTestResult.username}`
                          : "\u2713 OK"
                        : `\u2717 ${account.sshTestResult.error ?? "Failed"}`}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function GitHubTab() {
  const enabled = useSettingsStore((s) => s.gitHubEnabled);
  const updateGitHubSettings = useSettingsStore((s) => s.updateGitHubSettings);
  const accounts = useSettingsStore((s) => s.gitHubAccounts);
  const createGitHubAccount = useSettingsStore((s) => s.createGitHubAccount);
  const loadGitHubAccounts = useSettingsStore((s) => s.loadGitHubAccounts);

  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newToken, setNewToken] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadGitHubAccounts();
  }, []);

  const handleToggleEnabled = async () => {
    await updateGitHubSettings({ enabled: !enabled });
  };

  const handleCreate = async () => {
    if (!newLabel.trim() || !newToken.trim()) return;
    setCreating(true);
    await createGitHubAccount({
      label: newLabel.trim(),
      token: newToken.trim(),
      email: newEmail.trim() || undefined,
    });
    setNewLabel("");
    setNewToken("");
    setNewEmail("");
    setShowAdd(false);
    setCreating(false);
  };

  return (
    <div className="p-5 space-y-4">
      <p className="text-xs text-muted-foreground">
        Configure GitHub accounts for interacting with repositories, issues, pull requests, and releases.
        Each project can be assigned a specific account.
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

      {/* Account list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Accounts ({accounts.length})
          </label>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="text-xs text-primary hover:underline"
          >
            {showAdd ? "Cancel" : "+ Add Account"}
          </button>
        </div>

        {/* Add account form */}
        {showAdd && (
          <div className="border border-border rounded-lg p-4 space-y-3">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">Label</label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Personal, Work, Bot"
                className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">
                Personal Access Token
              </label>
              <input
                type="password"
                value={newToken}
                onChange={(e) => setNewToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Required scopes: <code className="bg-secondary px-1 rounded">repo</code>,{" "}
                <code className="bg-secondary px-1 rounded">read:org</code>,{" "}
                <code className="bg-secondary px-1 rounded">workflow</code>
              </p>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">
                Email <span className="normal-case tracking-normal">(optional, for commits)</span>
              </label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={creating || !newLabel.trim() || !newToken.trim()}
              className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Account"}
            </button>
          </div>
        )}

        {/* Account cards */}
        {accounts.map((account) => (
          <AccountCard key={account.id} accountId={account.id} />
        ))}

        {accounts.length === 0 && !showAdd && (
          <p className="text-xs text-muted-foreground text-center py-4">
            No GitHub accounts configured. Click &quot;+ Add Account&quot; to get started.
          </p>
        )}
      </div>

      <div className="text-[10px] text-muted-foreground space-y-1">
        <p><strong>How to create a PAT:</strong></p>
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
          <li>Add it as an account above</li>
        </ol>
      </div>
    </div>
  );
}
