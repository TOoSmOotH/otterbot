import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiFetch,
  changePassword,
  listSessions,
  logout,
  revokeSession,
  type SessionInfo,
  type SessionList,
} from "../../lib/api";
import type { GlobalSettings as GlobalSettingsShape, ThemeId } from "@otterbot/shared";
import { THEMES, useGlobalSettingsStore, applyTheme } from "../../stores/global-settings-store";
import { useProvidersStore } from "../../stores/providers-store";
import { CodeReferenceTab } from "./CodeReferenceTab";
import { CodingModelsTab } from "./CodingModelsTab";
import { CredentialsTab } from "./CredentialsTab";
import { ConnectionsTab } from "./ConnectionsTab";
import { ModelsProvidersTab } from "./ModelsProvidersTab";
import { CodingCliSetup } from "../agents/CodingCliSetup";
import type { CodingTool } from "../../lib/coding-cli";
import { ghostButton, h2, hint, primary, section } from "./settings-styles";

const TABS = [
  "Models & Providers",
  "Code Reference",
  "Coding CLIs",
  "Coding Models",
  "Credentials",
  "Connections",
  "Appearance",
  "Account",
] as const;
type SettingsTab = (typeof TABS)[number];

type PatchFn = (p: Partial<GlobalSettingsShape>) => void;

/** Map a (possibly legacy) initial tab name onto a current tab. */
function resolveInitialTab(t?: string): SettingsTab {
  if (t === "Providers" || t === "Models") return "Models & Providers";
  return TABS.includes(t as SettingsTab) ? (t as SettingsTab) : "Models & Providers";
}

export function GlobalSettings({
  initialTab,
  onOpenLoginTerminal,
}: {
  initialTab?: string;
  onOpenLoginTerminal?: (tool: CodingTool) => void;
} = {}) {
  const savedSettings = useGlobalSettingsStore((s) => s.settings);
  const loaded = useGlobalSettingsStore((s) => s.loaded);
  const load = useGlobalSettingsStore((s) => s.load);
  const saveSettings = useGlobalSettingsStore((s) => s.save);
  const providers = useProvidersStore((s) => s.providers);
  const loadProviders = useProvidersStore((s) => s.load);
  const [draft, setDraft] = useState<GlobalSettingsShape>(savedSettings);
  const [tab, setTab] = useState<SettingsTab>(resolveInitialTab(initialTab));
  // Autosave status shown in the footer; "" until the first save fires.
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "error">("");
  // Passive "a coding CLI has an update" indicator (powered by the daily check).
  const [codingUpdate, setCodingUpdate] = useState(false);

  // Refs backing the debounced autosave so handlers/effects see live values.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // JSON of the last settings we successfully sent — autosave compares against
  // this (not the store) so a normalized server echo can't trigger a save loop.
  const savedSnapshotRef = useRef(JSON.stringify(savedSettings));
  const hydratedRef = useRef(false);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => void load(), [load]);
  useEffect(() => void loadProviders(), [loadProviders]);

  // Hydrate the draft from the store once settings have loaded. After that the
  // draft is authoritative and autosave keeps the server in sync — re-copying
  // on every store change would clobber edits made while a save is in flight.
  useEffect(() => {
    if (hydratedRef.current || !loaded) return;
    setDraft(savedSettings);
    savedSnapshotRef.current = JSON.stringify(savedSettings);
    hydratedRef.current = true;
  }, [loaded, savedSettings]);

  useEffect(() => {
    void apiFetch("/api/coding-cli/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s) setCodingUpdate(Object.values(s).some((t) => (t as { updateAvailable?: boolean }).updateAvailable));
      })
      .catch(() => {});
  }, []);

  // Persist a settings payload, coalescing overlapping saves: if one is already
  // in flight, queue a re-save (with the latest draft) for when it finishes.
  const persist = useCallback(
    async (payload: GlobalSettingsShape) => {
      if (savingRef.current) {
        pendingRef.current = true;
        return;
      }
      savingRef.current = true;
      setSaveState("saving");
      const saved = await saveSettings(payload);
      savingRef.current = false;
      if (saved) {
        savedSnapshotRef.current = JSON.stringify(payload);
        setSaveState("saved");
      } else {
        setSaveState("error");
      }
      if (pendingRef.current) {
        pendingRef.current = false;
        void persist(draftRef.current);
      }
    },
    [saveSettings]
  );

  const patch: PatchFn = (p) => setDraft((current) => ({ ...current, ...p }));

  // Debounced autosave: whenever the draft diverges from what we last saved,
  // push it after a short idle so rapid typing coalesces into a single PUT.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (JSON.stringify(draft) === savedSnapshotRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void persist(draftRef.current), 600);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [draft, persist]);

  // Flush any pending change immediately when leaving the settings page, so a
  // tweak made within the debounce window isn't lost on navigate-away.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (JSON.stringify(draftRef.current) !== savedSnapshotRef.current) {
        void saveSettings(draftRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Some actions (e.g. adding a provider account) must reach the server before
  // the next step — persist the explicit next-settings immediately.
  const commit = async (next: GlobalSettingsShape) => {
    setDraft(next);
    await persist(next);
  };

  return (
    <div data-testid="global-settings" style={page}>
      <header style={header}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Global Settings</h1>
        <p style={hint}>Defaults used across otterbot. Per-agent credentials still override these.</p>
      </header>

      <nav style={tabBar}>
        {TABS.map((t) => (
          <button
            key={t}
            data-testid={`settings-tab-${t}`}
            onClick={() => setTab(t)}
            style={{
              ...tabButton,
              background: tab === t ? "rgb(var(--accent))" : "transparent",
              color: tab === t ? "white" : "rgb(var(--fg))",
            }}
          >
            {t}
            {t === "Coding CLIs" && codingUpdate && (
              <span
                title="A coding CLI has an update available"
                style={{
                  marginLeft: 6,
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: tab === t ? "white" : "rgb(var(--accent))",
                  display: "inline-block",
                }}
              />
            )}
          </button>
        ))}
      </nav>

      <div style={tabBody}>
        {tab === "Models & Providers" && (
          <ModelsProvidersTab draft={draft} patch={patch} providers={providers} onCommit={commit} />
        )}
        {tab === "Code Reference" && <CodeReferenceTab />}
        {tab === "Coding CLIs" && (
          <section style={section}>
            <h2 style={h2}>Coding CLIs</h2>
            <p style={hint}>
              Install and log in to the command-line coding agents (Claude Code, Codex, Gemini
              CLI, OpenCode) once — every agent shares the same install and login.
            </p>
            <CodingCliSetup onOpenLoginTerminal={onOpenLoginTerminal} />
          </section>
        )}
        {tab === "Coding Models" && (
          <CodingModelsTab draft={draft} patch={patch} providers={providers} />
        )}
        {tab === "Credentials" && <CredentialsTab />}
        {tab === "Connections" && <ConnectionsTab />}
        {tab === "Appearance" && <AppearanceTab draft={draft} patch={patch} />}
        {tab === "Account" && <AccountTab />}
      </div>

      {saveState && (
        <div style={saveBar}>
          {saveState === "saving" && <span style={hint}>Saving…</span>}
          {saveState === "saved" && <span style={hint}>All changes saved</span>}
          {saveState === "error" && (
            <>
              <span style={{ fontSize: 13, color: "#f87171" }}>Save failed</span>
              <button
                onClick={() => void persist(draftRef.current)}
                style={{ ...ghostButton, marginLeft: "auto" }}
              >
                Retry
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- Account tab ----------------------------------------------------------

const MIN_PASSWORD = 8;

function AccountTab() {
  const [sessions, setSessions] = useState<SessionList | null>(null);
  const [error, setError] = useState("");

  const refresh = async () => {
    setSessions(await listSessions());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const revoke = async (id: string) => {
    setError("");
    const wasCurrent = sessions?.sessions.find((s) => s.id === id)?.current;
    const ok = await revokeSession(id);
    if (!ok) {
      setError("Could not revoke that session.");
      return;
    }
    if (wasCurrent) {
      // Server cleared our cookie + invalidated our token; reload so the
      // AuthGate sends us back to the login screen.
      window.location.reload();
      return;
    }
    void refresh();
  };

  const signOut = async () => {
    await logout();
    window.location.reload();
  };

  if (!sessions) {
    return (
      <section style={section}>
        <h2 style={h2}>Account</h2>
        <p style={hint}>Loading…</p>
      </section>
    );
  }

  if (sessions.mode === "env") {
    return (
      <section style={section}>
        <h2 style={h2}>Account</h2>
        <p style={hint}>
          API auth is pinned by the <code>OTTERBOT_API_TOKEN</code> environment variable on the
          server. Sessions and password change are disabled in this mode — manage credentials by
          updating the env var and restarting otterbot.
        </p>
      </section>
    );
  }

  return (
    <section style={section}>
      <h2 style={h2}>Active sessions</h2>
      <p style={hint}>
        Every device that's logged in gets its own session token. Revoking a session immediately
        signs that device out.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sessions.sessions.length === 0 && <p style={hint}>No active sessions.</p>}
        {sessions.sessions.map((s) => (
          <SessionRow key={s.id} session={s} onRevoke={() => void revoke(s.id)} />
        ))}
      </div>
      {error && <span style={{ fontSize: 12, color: "#f87171" }}>{error}</span>}

      <div style={{ height: 12 }} />
      <ChangePasswordCard onChanged={() => void refresh()} />

      <div style={{ height: 12 }} />
      <button onClick={() => void signOut()} style={ghostButton}>
        Sign out this device
      </button>
    </section>
  );
}

function SessionRow({
  session,
  onRevoke,
}: {
  session: SessionInfo;
  onRevoke: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid rgb(var(--border))",
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {session.label}
          {session.current && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                color: "#4ade80",
                border: "1px solid #4ade80",
                borderRadius: 4,
                padding: "1px 6px",
              }}
            >
              this device
            </span>
          )}
        </span>
        <span style={{ ...hint, fontSize: 11 }}>
          last used {formatRelative(session.lastUsedAt)} · created {formatRelative(session.createdAt)}
        </span>
      </div>
      <button onClick={onRevoke} style={{ ...ghostButton, color: "#f87171" }}>
        {session.current ? "Sign out" : "Revoke"}
      </button>
    </div>
  );
}

function ChangePasswordCard({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setOk(false);
    if (next.length < MIN_PASSWORD) {
      setError(`New password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("New passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const result = await changePassword(current, next);
      if (!result.ok) {
        setError(result.error ?? "Could not change password.");
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setOk(true);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        border: "1px solid rgb(var(--border))",
        borderRadius: 8,
        padding: 12,
      }}
    >
      <h2 style={h2}>Change password</h2>
      <p style={hint}>
        Changing the password signs out every other device — only this session keeps working.
      </p>
      <input
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        placeholder="Current password"
        style={inputStyle}
      />
      <input
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder={`New password (≥ ${MIN_PASSWORD} chars)`}
        style={inputStyle}
      />
      <input
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Confirm new password"
        style={inputStyle}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="submit"
          disabled={busy || !current || next.length < MIN_PASSWORD || !confirm}
          style={primary}
        >
          {busy ? "Saving…" : "Change password"}
        </button>
        {ok && <span style={{ fontSize: 12, color: "#4ade80" }}>Password updated ✓</span>}
        {error && <span style={{ fontSize: 12, color: "#f87171" }}>{error}</span>}
      </div>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "7px 9px",
  fontSize: 13,
};

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

// --- Appearance tab -------------------------------------------------------

function AppearanceTab({ draft, patch }: { draft: GlobalSettingsShape; patch: PatchFn }) {
  const themeOptions = useMemo(() => Object.keys(THEMES) as ThemeId[], []);
  return (
    <section style={section}>
      <h2 style={h2}>Theme</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {themeOptions.map((theme) => (
          <button
            key={theme}
            data-testid={`theme-${theme}`}
            onClick={() => {
              patch({ theme });
              applyTheme(theme);
            }}
            style={{
              ...themeButton,
              borderColor: draft.theme === theme ? "rgb(var(--accent))" : "rgb(var(--border))",
            }}
          >
            <span style={{ ...swatch, background: `rgb(${THEMES[theme].vars["--accent"]})` }} />
            {THEMES[theme].label}
          </button>
        ))}
      </div>
    </section>
  );
}

// --- shell styles ---------------------------------------------------------

const page: React.CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

const header: React.CSSProperties = {
  padding: "14px 18px 0",
};

const tabBar: React.CSSProperties = {
  display: "flex",
  gap: 4,
  padding: "10px 18px",
  borderBottom: "1px solid rgb(var(--border))",
  flexWrap: "wrap",
};

const tabButton: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  padding: "4px 12px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
};

const tabBody: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: 18,
};

const saveBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 18px",
  borderTop: "1px solid rgb(var(--border))",
  background: "rgb(var(--bg))",
};

const themeButton: React.CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 7,
  padding: "7px 10px",
  cursor: "pointer",
  fontSize: 13,
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const swatch: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: 999,
  border: "1px solid rgb(var(--border))",
};
