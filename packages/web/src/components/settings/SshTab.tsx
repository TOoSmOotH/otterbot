import { useState, useEffect } from "react";
import { useSshStore } from "../../stores/ssh-store";
import type { SshKeyInfo, SshKeyType } from "@otterbot/shared";

type ViewMode = "list" | "generate" | "import" | "edit";

export function SshTab() {
  const {
    sshKeys,
    sshKeysLoading,
    loadKeys,
    generateKey,
    importKey,
    updateKey,
    deleteKey,
    getPublicKey,
    testConnection,
  } = useSshStore();

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingKey, setEditingKey] = useState<SshKeyInfo | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [publicKeyModal, setPublicKeyModal] = useState<{ id: string; publicKey: string } | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string; testing: boolean }>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadKeys();
  }, []);

  const handleCopyPublicKey = async (id: string) => {
    const pubKey = await getPublicKey(id);
    if (pubKey) {
      await navigator.clipboard.writeText(pubKey);
      setPublicKeyModal({ id, publicKey: pubKey });
    }
  };

  const handleTestConnection = async (keyId: string, host: string) => {
    const testKey = `${keyId}:${host}`;
    setTestResults((prev) => ({ ...prev, [testKey]: { ok: false, testing: true } }));
    const result = await testConnection(keyId, host);
    setTestResults((prev) => ({ ...prev, [testKey]: { ...result, testing: false } }));
  };

  const handleDelete = async (id: string) => {
    await deleteKey(id);
    setConfirmDelete(null);
  };

  if (viewMode === "generate") {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-2">
          <button onClick={() => setViewMode("list")} className="text-xs text-muted-foreground hover:text-foreground">&larr; Back</button>
          <h2 className="text-lg font-semibold">Generate SSH Key</h2>
        </div>
        <GenerateKeyForm
          onGenerate={async (data) => {
            const result = await generateKey(data);
            if (result.error) {
              setError(result.error);
            } else {
              setViewMode("list");
              setError(null);
            }
          }}
          error={error}
        />
      </div>
    );
  }

  if (viewMode === "import") {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-2">
          <button onClick={() => setViewMode("list")} className="text-xs text-muted-foreground hover:text-foreground">&larr; Back</button>
          <h2 className="text-lg font-semibold">Import SSH Key</h2>
        </div>
        <ImportKeyForm
          onImport={async (data) => {
            const result = await importKey(data);
            if (result.error) {
              setError(result.error);
            } else {
              setViewMode("list");
              setError(null);
            }
          }}
          error={error}
        />
      </div>
    );
  }

  if (viewMode === "edit" && editingKey) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-2">
          <button onClick={() => { setViewMode("list"); setEditingKey(null); }} className="text-xs text-muted-foreground hover:text-foreground">&larr; Back</button>
          <h2 className="text-lg font-semibold">Edit Key: {editingKey.name}</h2>
        </div>
        <EditKeyForm
          keyInfo={editingKey}
          onSave={async (data) => {
            const result = await updateKey(editingKey.id, data);
            if (result.error) {
              setError(result.error);
            } else {
              setViewMode("list");
              setEditingKey(null);
              setError(null);
            }
          }}
          error={error}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">SSH Keys</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage SSH keys for remote server access. Keys are stored locally with restricted permissions.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setViewMode("generate"); setError(null); }}
            className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            Generate Key
          </button>
          <button
            onClick={() => { setViewMode("import"); setError(null); }}
            className="text-xs px-3 py-1.5 bg-secondary text-foreground rounded hover:bg-secondary/80"
          >
            Import Key
          </button>
        </div>
      </div>

      {sshKeysLoading ? (
        <div className="text-sm text-muted-foreground">Loading keys...</div>
      ) : sshKeys.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
          No SSH keys configured. Generate or import a key to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {sshKeys.map((key) => (
            <div key={key.id} className="border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">{key.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {key.username} &middot; {key.keyType.toUpperCase()} &middot; Port {key.port}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono mt-1 truncate max-w-md">
                    {key.fingerprint}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleCopyPublicKey(key.id)}
                    className="text-xs px-2 py-1 rounded bg-secondary hover:bg-secondary/80"
                    title="Copy public key"
                  >
                    Copy Pub Key
                  </button>
                  <button
                    onClick={() => { setEditingKey(key); setViewMode("edit"); setError(null); }}
                    className="text-xs px-2 py-1 rounded bg-secondary hover:bg-secondary/80"
                  >
                    Edit
                  </button>
                  {confirmDelete === key.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(key.id)}
                        className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-xs px-2 py-1 rounded bg-secondary hover:bg-secondary/80"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(key.id)}
                      className="text-xs px-2 py-1 rounded text-red-400 hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {/* Allowed hosts */}
              {key.allowedHosts.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Allowed Hosts:</div>
                  <div className="flex flex-wrap gap-1">
                    {key.allowedHosts.map((host) => {
                      const testKey = `${key.id}:${host}`;
                      const testResult = testResults[testKey];
                      return (
                        <div key={host} className="flex items-center gap-1">
                          <span className="text-xs px-2 py-0.5 bg-secondary rounded font-mono">
                            {host}
                          </span>
                          <button
                            onClick={() => handleTestConnection(key.id, host)}
                            disabled={testResult?.testing}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-secondary hover:bg-secondary/80 disabled:opacity-50"
                          >
                            {testResult?.testing ? "..." : "Test"}
                          </button>
                          {testResult && !testResult.testing && (
                            <span className={`text-[10px] ${testResult.ok ? "text-green-400" : "text-red-400"}`}>
                              {testResult.ok ? "OK" : testResult.error?.slice(0, 30) || "Failed"}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Public key modal */}
      {publicKeyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setPublicKeyModal(null)}>
          <div className="bg-card border border-border rounded-lg p-6 max-w-lg w-full mx-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold">Public Key (copied to clipboard)</h3>
            <pre className="text-xs bg-secondary p-3 rounded overflow-x-auto font-mono whitespace-pre-wrap break-all">
              {publicKeyModal.publicKey}
            </pre>
            <p className="text-xs text-muted-foreground">
              Add this key to the remote host's ~/.ssh/authorized_keys file.
            </p>
            <button
              onClick={() => setPublicKeyModal(null)}
              className="text-xs px-3 py-1.5 bg-secondary rounded hover:bg-secondary/80"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-forms ────────────────────────────────────────────────────

function GenerateKeyForm({
  onGenerate,
  error,
}: {
  onGenerate: (data: { name: string; username: string; allowedHosts: string[]; keyType?: SshKeyType; port?: number }) => Promise<void>;
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("root");
  const [keyType, setKeyType] = useState<SshKeyType>("ed25519");
  const [port, setPort] = useState(22);
  const [hostsInput, setHostsInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !username.trim()) return;
    const allowedHosts = hostsInput.split(/[,\n]/).map((h) => h.trim()).filter(Boolean);
    setSubmitting(true);
    await onGenerate({ name: name.trim(), username: username.trim(), allowedHosts, keyType, port });
    setSubmitting(false);
  };

  return (
    <div className="space-y-4 max-w-md">
      <div>
        <label className="text-xs font-medium block mb-1">Key Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. production-server"
          className="w-full text-sm px-3 py-2 bg-secondary border border-border rounded"
        />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">SSH Username</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. root"
          className="w-full text-sm px-3 py-2 bg-secondary border border-border rounded"
        />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">Key Type</label>
        <select
          value={keyType}
          onChange={(e) => setKeyType(e.target.value as SshKeyType)}
          className="text-sm px-3 py-2 bg-secondary border border-border rounded"
        >
          <option value="ed25519">Ed25519 (recommended)</option>
          <option value="rsa">RSA</option>
        </select>
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">Port</label>
        <input
          type="number"
          value={port}
          onChange={(e) => setPort(parseInt(e.target.value, 10) || 22)}
          className="w-24 text-sm px-3 py-2 bg-secondary border border-border rounded"
        />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">Allowed Hosts (one per line or comma-separated)</label>
        <textarea
          value={hostsInput}
          onChange={(e) => setHostsInput(e.target.value)}
          placeholder="192.168.1.100&#10;myserver.example.com"
          rows={3}
          className="w-full text-sm px-3 py-2 bg-secondary border border-border rounded font-mono"
        />
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}
      <button
        onClick={handleSubmit}
        disabled={submitting || !name.trim() || !username.trim()}
        className="text-xs px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
      >
        {submitting ? "Generating..." : "Generate Key"}
      </button>
    </div>
  );
}

function ImportKeyForm({
  onImport,
  error,
}: {
  onImport: (data: { name: string; username: string; privateKey: string; allowedHosts: string[]; port?: number }) => Promise<void>;
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("root");
  const [privateKey, setPrivateKey] = useState("");
  const [port, setPort] = useState(22);
  const [hostsInput, setHostsInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !username.trim() || !privateKey.trim()) return;
    const allowedHosts = hostsInput.split(/[,\n]/).map((h) => h.trim()).filter(Boolean);
    setSubmitting(true);
    await onImport({ name: name.trim(), username: username.trim(), privateKey: privateKey.trim(), allowedHosts, port });
    setSubmitting(false);
  };

  return (
    <div className="space-y-4 max-w-md">
      <div>
        <label className="text-xs font-medium block mb-1">Key Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. production-server"
          className="w-full text-sm px-3 py-2 bg-secondary border border-border rounded"
        />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">SSH Username</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. root"
          className="w-full text-sm px-3 py-2 bg-secondary border border-border rounded"
        />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">Private Key (paste contents)</label>
        <textarea
          value={privateKey}
          onChange={(e) => setPrivateKey(e.target.value)}
          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
          rows={6}
          className="w-full text-sm px-3 py-2 bg-secondary border border-border rounded font-mono"
        />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">Port</label>
        <input
          type="number"
          value={port}
          onChange={(e) => setPort(parseInt(e.target.value, 10) || 22)}
          className="w-24 text-sm px-3 py-2 bg-secondary border border-border rounded"
        />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">Allowed Hosts (one per line or comma-separated)</label>
        <textarea
          value={hostsInput}
          onChange={(e) => setHostsInput(e.target.value)}
          placeholder="192.168.1.100&#10;myserver.example.com"
          rows={3}
          className="w-full text-sm px-3 py-2 bg-secondary border border-border rounded font-mono"
        />
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}
      <button
        onClick={handleSubmit}
        disabled={submitting || !name.trim() || !username.trim() || !privateKey.trim()}
        className="text-xs px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
      >
        {submitting ? "Importing..." : "Import Key"}
      </button>
    </div>
  );
}

function EditKeyForm({
  keyInfo,
  onSave,
  error,
}: {
  keyInfo: SshKeyInfo;
  onSave: (data: { name?: string; username?: string; allowedHosts?: string[]; port?: number }) => Promise<void>;
  error: string | null;
}) {
  const [name, setName] = useState(keyInfo.name);
  const [username, setUsername] = useState(keyInfo.username);
  const [port, setPort] = useState(keyInfo.port);
  const [hostsInput, setHostsInput] = useState(keyInfo.allowedHosts.join("\n"));
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !username.trim()) return;
    const allowedHosts = hostsInput.split(/[,\n]/).map((h) => h.trim()).filter(Boolean);
    setSubmitting(true);
    await onSave({ name: name.trim(), username: username.trim(), allowedHosts, port });
    setSubmitting(false);
  };

  return (
    <div className="space-y-4 max-w-md">
      <div>
        <label className="text-xs font-medium block mb-1">Key Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full text-sm px-3 py-2 bg-secondary border border-border rounded"
        />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">SSH Username</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full text-sm px-3 py-2 bg-secondary border border-border rounded"
        />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">Port</label>
        <input
          type="number"
          value={port}
          onChange={(e) => setPort(parseInt(e.target.value, 10) || 22)}
          className="w-24 text-sm px-3 py-2 bg-secondary border border-border rounded"
        />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">Allowed Hosts (one per line or comma-separated)</label>
        <textarea
          value={hostsInput}
          onChange={(e) => setHostsInput(e.target.value)}
          rows={4}
          className="w-full text-sm px-3 py-2 bg-secondary border border-border rounded font-mono"
        />
      </div>
      <div className="text-xs text-muted-foreground">
        <span className="font-medium">Type:</span> {keyInfo.keyType.toUpperCase()} &middot;{" "}
        <span className="font-medium">Fingerprint:</span>{" "}
        <span className="font-mono">{keyInfo.fingerprint}</span>
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}
      <button
        onClick={handleSubmit}
        disabled={submitting || !name.trim() || !username.trim()}
        className="text-xs px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
      >
        {submitting ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}
