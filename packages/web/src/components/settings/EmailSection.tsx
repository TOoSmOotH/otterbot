import { useSettingsStore } from "../../stores/settings-store";

export function EmailSection() {
  const googleConnected = useSettingsStore((s) => s.googleConnected);
  const googleConnectedEmail = useSettingsStore((s) => s.googleConnectedEmail);

  return (
    <div className="p-5 space-y-4">
      <div>
        <h3 className="text-xs font-semibold mb-1">Email Setup</h3>
        <p className="text-xs text-muted-foreground">
          Email integration is powered by Gmail through Google OAuth.
        </p>
      </div>

      {googleConnected ? (
        <div className="rounded-lg border border-green-500/30 p-4 bg-green-500/5 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-400 font-medium">Gmail Connected</span>
          </div>
          {googleConnectedEmail && (
            <p className="text-[10px] text-muted-foreground">
              Connected as {googleConnectedEmail}. You can use Gmail through the Inbox
              view or ask the Admin Assistant to manage your emails.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border p-6 bg-secondary flex flex-col items-center justify-center text-center">
          <p className="text-xs text-muted-foreground max-w-sm">
            Connect your Google account in{" "}
            <strong>Settings &rarr; Google</strong> to enable Gmail integration.
            Once connected, you can view and manage emails in the Inbox tab
            or through the Admin Assistant.
          </p>
        </div>
      )}
    </div>
  );
}
