import { useEffect, useState } from "react";
import { useSettingsStore } from "../../stores/settings-store";

export function GoogleSection() {
  const {
    googleConnected,
    googleConnectedEmail,
    googleClientIdSet,
    googleClientSecretSet,
    googleRedirectBaseUrl,
    loadGoogleSettings,
    updateGoogleCredentials,
    beginGoogleOAuth,
    disconnectGoogle,
  } = useSettingsStore();

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectBaseUrl, setRedirectBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadGoogleSettings();
  }, []);

  useEffect(() => {
    setRedirectBaseUrl(googleRedirectBaseUrl ?? "");
  }, [googleRedirectBaseUrl]);

  const handleSave = async () => {
    setSaving(true);
    await updateGoogleCredentials({
      clientId: clientId || undefined,
      clientSecret: clientSecret || undefined,
      redirectBaseUrl,
    });
    setClientId("");
    setClientSecret("");
    setSaving(false);
  };

  const handleConnect = async () => {
    const url = await beginGoogleOAuth();
    if (!url) return;

    // Open popup
    const popup = window.open(url, "google-oauth", "width=600,height=700");

    // Listen for postMessage from the callback page
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "google-oauth-callback") {
        window.removeEventListener("message", handler);
        popup?.close();
        // Reload settings to reflect the new connection
        loadGoogleSettings();
      }
    };
    window.addEventListener("message", handler);
  };

  const handleDisconnect = async () => {
    await disconnectGoogle();
  };

  return (
    <div className="p-5 space-y-4">
      <div>
        <h3 className="text-xs font-semibold mb-1">Google Integration</h3>
        <p className="text-xs text-muted-foreground">
          Connect your Google account to use Gmail and Google Calendar features.
        </p>
      </div>

      {/* Connection status */}
      {googleConnected && (
        <div className="border border-green-500/30 rounded-lg p-4 bg-green-500/5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-green-400">Connected</div>
              {googleConnectedEmail && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {googleConnectedEmail}
                </div>
              )}
            </div>
            <button
              onClick={handleDisconnect}
              className="text-xs text-red-500 hover:text-red-400 px-2 py-1"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      {/* Credentials */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Client ID
            {googleClientIdSet && (
              <span className="ml-2 text-green-500 normal-case tracking-normal">Set</span>
            )}
          </label>
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={googleClientIdSet ? "••••••••" : "Enter Google OAuth Client ID"}
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary"
          />
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Client Secret
            {googleClientSecretSet && (
              <span className="ml-2 text-green-500 normal-case tracking-normal">Set</span>
            )}
          </label>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={googleClientSecretSet ? "••••••••" : "Enter Google OAuth Client Secret"}
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary"
          />
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Redirect Base URL
          </label>
          <input
            type="text"
            value={redirectBaseUrl}
            onChange={(e) => setRedirectBaseUrl(e.target.value)}
            placeholder="https://your-otterbot-url:62626"
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary"
          />
          <p className="text-[9px] text-muted-foreground mt-1">
            The base URL where Otterbot is accessible. Used for the OAuth callback redirect.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Credentials"}
          </button>
          {googleClientIdSet && googleClientSecretSet && !googleConnected && (
            <button
              onClick={handleConnect}
              className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80"
            >
              Connect Google Account
            </button>
          )}
        </div>
      </div>

      <div className="text-[10px] text-muted-foreground space-y-1">
        <p><strong>How to set up Google OAuth:</strong></p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Go to the <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Google Cloud Console</a></li>
          <li>Create a new project or select an existing one</li>
          <li>Enable the Gmail API and Google Calendar API</li>
          <li>Create OAuth 2.0 credentials (Web application type)</li>
          <li>Add <code className="bg-secondary px-1 rounded">{redirectBaseUrl || "https://your-url"}/api/oauth/google/callback</code> as an authorized redirect URI</li>
          <li>Copy the Client ID and Client Secret here</li>
        </ol>
      </div>
    </div>
  );
}
