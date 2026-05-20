import { useEffect, useState, type ReactNode } from "react";
import {
  checkAuth,
  loginWithPassword,
  setupPassword,
  onAuthInvalid,
  clearToken,
  type AuthState,
} from "../lib/api";

const MIN_PASSWORD = 8;

/**
 * Wraps the app and gates it behind the server's shared-secret API token.
 * On first load we ask the server about its state and render one of three
 * screens: the app itself, a "create a password" form (first-run setup), or
 * a "enter your password" form. On any `apiFetch` 401 we drop the saved
 * token and re-prompt.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"checking" | AuthState>("checking");

  const refresh = async () => {
    const result = await checkAuth();
    setStatus(result);
  };

  useEffect(() => {
    void refresh();
    const unsub = onAuthInvalid(() => {
      clearToken();
      setStatus("needs-token");
    });
    return () => unsub();
  }, []);

  if (status === "checking") {
    return (
      <div style={center}>
        <div style={{ fontSize: 13, color: "rgb(var(--muted))" }}>Checking auth…</div>
      </div>
    );
  }

  if (status === "needs-setup") {
    return <SetupForm onDone={() => setStatus("ok")} />;
  }
  if (status === "needs-token") {
    return <LoginForm onDone={() => setStatus("ok")} />;
  }

  return <>{children}</>;
}

function SetupForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const result = await setupPassword(password);
      if (!result.ok) {
        setError(result.error ?? "Setup failed.");
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={center}>
      <form onSubmit={submit} style={card}>
        <h1 style={{ margin: 0, fontSize: 16 }}>Welcome to Otterbot</h1>
        <p style={{ margin: 0, fontSize: 12, color: "rgb(var(--muted))", lineHeight: 1.5 }}>
          Pick a password to protect this Otterbot instance. You'll use the same password on
          every device that connects to it. It's saved to <code>data/.api-token</code> on the
          server (mode 0600). Choose something memorable — you can't recover it, only reset by
          deleting that file.
        </p>
        <input
          autoFocus
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={`Password (≥ ${MIN_PASSWORD} chars)`}
          style={input}
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm password"
          style={input}
        />
        <button
          type="submit"
          disabled={busy || password.length < MIN_PASSWORD || !confirm}
          style={primary}
        >
          {busy ? "Setting up…" : "Create password"}
        </button>
        {error && <span style={{ fontSize: 12, color: "#f87171" }}>{error}</span>}
      </form>
    </div>
  );
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const [token, setTokenInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;
    setBusy(true);
    setError("");
    try {
      const result = await loginWithPassword(trimmed);
      if (!result.ok) {
        setError(result.error ?? "Invalid password.");
        return;
      }
      onDone();
      setTokenInput("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={center}>
      <form onSubmit={submit} style={card}>
        <h1 style={{ margin: 0, fontSize: 16 }}>Otterbot</h1>
        <p style={{ margin: 0, fontSize: 12, color: "rgb(var(--muted))", lineHeight: 1.5 }}>
          Enter the password you set when first running this Otterbot instance. If you've lost
          it, you can reset by deleting <code>data/.api-token</code> on the server.
        </p>
        <input
          autoFocus
          type="password"
          value={token}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="Password"
          style={input}
        />
        <button type="submit" disabled={busy || !token.trim()} style={primary}>
          {busy ? "Checking…" : "Unlock"}
        </button>
        {error && <span style={{ fontSize: 12, color: "#f87171" }}>{error}</span>}
      </form>
    </div>
  );
}

const center: React.CSSProperties = {
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  width: 360,
  padding: 20,
  border: "1px solid rgb(var(--border))",
  borderRadius: 10,
  background: "rgb(var(--bg))",
};

const input: React.CSSProperties = {
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 13,
};

const primary: React.CSSProperties = {
  background: "rgb(var(--accent))",
  color: "white",
  border: "none",
  padding: "8px 14px",
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
