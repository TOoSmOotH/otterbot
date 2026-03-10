import { useEffect, useState } from "react";
import { useSettingsStore } from "../../stores/settings-store";

export function EmailSection() {
  const emailEnabled = useSettingsStore((s) => s.emailEnabled);
  const emailImapServer = useSettingsStore((s) => s.emailImapServer);
  const emailImapPort = useSettingsStore((s) => s.emailImapPort);
  const emailImapTls = useSettingsStore((s) => s.emailImapTls);
  const emailSmtpServer = useSettingsStore((s) => s.emailSmtpServer);
  const emailSmtpPort = useSettingsStore((s) => s.emailSmtpPort);
  const emailSmtpTls = useSettingsStore((s) => s.emailSmtpTls);
  const emailUsername = useSettingsStore((s) => s.emailUsername);
  const emailPasswordSet = useSettingsStore((s) => s.emailPasswordSet);
  const emailFromName = useSettingsStore((s) => s.emailFromName);
  const emailTestResult = useSettingsStore((s) => s.emailTestResult);
  const loadEmailSettings = useSettingsStore((s) => s.loadEmailSettings);
  const updateEmailSettings = useSettingsStore((s) => s.updateEmailSettings);
  const testEmailConnection = useSettingsStore((s) => s.testEmailConnection);

  const [enabled, setEnabled] = useState(false);
  const [imapServer, setImapServer] = useState("");
  const [imapPort, setImapPort] = useState(993);
  const [imapTls, setImapTls] = useState(true);
  const [smtpServer, setSmtpServer] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpTls, setSmtpTls] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromName, setFromName] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    loadEmailSettings();
  }, []);

  useEffect(() => {
    setEnabled(emailEnabled);
    setImapServer(emailImapServer ?? "");
    setImapPort(emailImapPort);
    setImapTls(emailImapTls);
    setSmtpServer(emailSmtpServer ?? "");
    setSmtpPort(emailSmtpPort);
    setSmtpTls(emailSmtpTls);
    setUsername(emailUsername ?? "");
    setFromName(emailFromName ?? "");
  }, [emailEnabled, emailImapServer, emailImapPort, emailImapTls, emailSmtpServer, emailSmtpPort, emailSmtpTls, emailUsername, emailFromName]);

  const handleSave = async () => {
    setSaving(true);
    await updateEmailSettings({
      enabled,
      imapServer,
      imapPort,
      imapTls,
      smtpServer,
      smtpPort,
      smtpTls,
      username,
      ...(password ? { password } : {}),
      fromName,
    });
    setPassword("");
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    await testEmailConnection();
    setTesting(false);
  };

  const inputCls = "w-full bg-secondary rounded px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary";
  const labelCls = "text-[10px] text-muted-foreground font-medium uppercase tracking-wider";

  return (
    <div className="p-5 space-y-4">
      <div>
        <h3 className="text-xs font-semibold mb-1">Email Setup</h3>
        <p className="text-xs text-muted-foreground">
          Connect any email provider via IMAP/SMTP.
        </p>
      </div>

      {/* Enable toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="accent-primary"
        />
        <span className="text-xs">Enable email integration</span>
      </label>

      {/* IMAP section */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold">IMAP (Incoming)</h4>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Server</label>
            <input
              type="text"
              value={imapServer}
              onChange={(e) => setImapServer(e.target.value)}
              placeholder="imap.gmail.com"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Port</label>
            <input
              type="number"
              value={imapPort}
              onChange={(e) => setImapPort(parseInt(e.target.value) || 993)}
              className={inputCls}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={imapTls}
            onChange={(e) => setImapTls(e.target.checked)}
            className="accent-primary"
          />
          <span className="text-xs">Use TLS/SSL</span>
        </label>
      </div>

      {/* SMTP section */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold">SMTP (Outgoing)</h4>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Server</label>
            <input
              type="text"
              value={smtpServer}
              onChange={(e) => setSmtpServer(e.target.value)}
              placeholder="smtp.gmail.com"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Port</label>
            <input
              type="number"
              value={smtpPort}
              onChange={(e) => setSmtpPort(parseInt(e.target.value) || 587)}
              className={inputCls}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={smtpTls}
            onChange={(e) => setSmtpTls(e.target.checked)}
            className="accent-primary"
          />
          <span className="text-xs">Use TLS/STARTTLS</span>
        </label>
      </div>

      {/* Credentials */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold">Credentials</h4>
        <div>
          <label className={labelCls}>Username / Email</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="you@example.com"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Password {emailPasswordSet && "(set)"}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={emailPasswordSet ? "Leave blank to keep current" : "App password or account password"}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>From Name (optional)</label>
          <input
            type="text"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="Your Name"
            className={inputCls}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={handleTest}
          disabled={testing}
          className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded hover:bg-secondary/80 disabled:opacity-50"
        >
          {testing ? "Testing..." : "Test Connection"}
        </button>
      </div>

      {/* Test result */}
      {emailTestResult && (
        <div className={`rounded-lg border p-3 text-xs ${
          emailTestResult.ok
            ? "border-green-500/30 bg-green-500/5 text-green-400"
            : "border-red-500/30 bg-red-500/5 text-red-400"
        }`}>
          {emailTestResult.ok ? (
            "IMAP and SMTP connections successful."
          ) : (
            <div className="space-y-1">
              {emailTestResult.imap && emailTestResult.imap !== "ok" && (
                <div>IMAP: {emailTestResult.imap}</div>
              )}
              {emailTestResult.smtp && emailTestResult.smtp !== "ok" && (
                <div>SMTP: {emailTestResult.smtp}</div>
              )}
              {emailTestResult.error && <div>{emailTestResult.error}</div>}
            </div>
          )}
        </div>
      )}

      {/* Hint */}
      <p className="text-[10px] text-muted-foreground">
        For Gmail: use imap.gmail.com:993, smtp.gmail.com:587, and an{" "}
        <a
          href="https://support.google.com/accounts/answer/185833"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          App Password
        </a>.
      </p>
    </div>
  );
}
