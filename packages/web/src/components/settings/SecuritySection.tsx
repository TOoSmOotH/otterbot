import { useState } from "react";

export function SecuritySection() {
  const [currentPassphrase, setCurrentPassphrase] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleChangePassphrase = async () => {
    setMessage(null);

    if (!currentPassphrase || !newPassphrase) {
      setMessage({ type: "error", text: "Please fill in all fields" });
      return;
    }

    if (newPassphrase !== confirmPassphrase) {
      setMessage({ type: "error", text: "New passphrases do not match" });
      return;
    }

    if (newPassphrase.length < 6) {
      setMessage({ type: "error", text: "New passphrase must be at least 6 characters" });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/passphrase", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassphrase,
          newPassphrase,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Failed to change passphrase" });
      } else {
        setMessage({ type: "success", text: "Passphrase changed successfully" });
        setCurrentPassphrase("");
        setNewPassphrase("");
        setConfirmPassphrase("");
      }
    } catch {
      setMessage({ type: "error", text: "Failed to change passphrase" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-5 space-y-6">
      <div>
        <h3 className="text-xs font-semibold mb-1">Authentication</h3>
        <p className="text-xs text-muted-foreground">
          Manage your security settings.
        </p>
      </div>

      {/* Change Passphrase */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold">Change Passphrase</h4>

        {message && (
          <div
            className={`text-xs px-3 py-2 rounded border ${
              message.type === "success"
                ? "text-green-400 bg-green-400/10 border-green-400/20"
                : "text-red-400 bg-red-400/10 border-red-400/20"
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium mb-1 block">Current passphrase</label>
            <input
              type="password"
              value={currentPassphrase}
              onChange={(e) => setCurrentPassphrase(e.target.value)}
              className="w-full bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">New passphrase</label>
            <input
              type="password"
              value={newPassphrase}
              onChange={(e) => setNewPassphrase(e.target.value)}
              className="w-full bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Confirm new passphrase</label>
            <input
              type="password"
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              className="w-full bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <button
          onClick={handleChangePassphrase}
          disabled={saving}
          className="px-4 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Changing..." : "Change Passphrase"}
        </button>
      </div>

      {/* 2FA */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold">Two-Factor Authentication</h4>
        <div className="bg-secondary border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">2FA Setup</p>
              <p className="text-[10px] text-muted-foreground">
                Add an extra layer of security to your account
              </p>
            </div>
            <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
              Coming Soon
            </span>
          </div>
        </div>
      </div>

      {/* Active Sessions */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold">Active Sessions</h4>
        <div className="bg-secondary border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">Session Management</p>
              <p className="text-[10px] text-muted-foreground">
                View and manage your active sessions
              </p>
            </div>
            <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
              Coming Soon
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
