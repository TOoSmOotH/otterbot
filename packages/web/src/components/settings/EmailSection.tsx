export function EmailSection() {
  return (
    <div className="p-5 space-y-4">
      <div>
        <h3 className="text-xs font-semibold mb-1">Email Setup</h3>
        <p className="text-xs text-muted-foreground">
          Connect email accounts so Otterbot can send and receive messages on your behalf.
        </p>
      </div>

      <div className="rounded-lg border border-border p-6 bg-secondary flex flex-col items-center justify-center text-center">
        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded mb-2">
          Coming Soon
        </span>
        <p className="text-xs text-muted-foreground max-w-sm">
          Configure SMTP and IMAP credentials, manage connected mailboxes, and set up
          email-based automations.
        </p>
      </div>
    </div>
  );
}
