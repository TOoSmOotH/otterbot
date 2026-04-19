import { useEffect } from "react";
import { Chat } from "./components/chat/Chat";
import { View2D } from "./components/views/View2D";
import { View3D } from "./components/views/View3D";
import { ViewDesktop } from "./components/views/ViewDesktop";
import { useViewStore, type ViewPane } from "./stores/view-store";
import { useUserProfileStore } from "./stores/user-profile-store";
import { useSkillsStore } from "./stores/skills-store";

const TABS: Array<{ key: ViewPane; label: string }> = [
  { key: "none", label: "Chat only" },
  { key: "2d", label: "2D" },
  { key: "3d", label: "3D" },
  { key: "desktop", label: "Desktop" },
];

export default function App() {
  const pane = useViewStore((s) => s.pane);
  const setPane = useViewStore((s) => s.setPane);
  const loadProfile = useUserProfileStore((s) => s.load);
  const loadSkills = useSkillsStore((s) => s.load);

  useEffect(() => {
    void loadProfile();
    void loadSkills();
  }, [loadProfile, loadSkills]);

  const showPane = pane !== "none";

  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        gridTemplateColumns: showPane ? "380px 1fr" : "1fr",
      }}
    >
      <Chat />
      {showPane && (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <nav
            style={{
              display: "flex",
              gap: 4,
              padding: 6,
              borderBottom: "1px solid rgb(var(--border))",
            }}
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                data-testid={`tab-${t.key}`}
                onClick={() => setPane(t.key)}
                style={{
                  background: pane === t.key ? "rgb(var(--accent))" : "transparent",
                  color: pane === t.key ? "white" : "rgb(var(--fg))",
                  border: "1px solid rgb(var(--border))",
                  padding: "4px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div style={{ flex: 1, minHeight: 0 }}>
            {pane === "2d" && <View2D />}
            {pane === "3d" && <View3D />}
            {pane === "desktop" && <ViewDesktop />}
          </div>
        </div>
      )}
      {!showPane && (
        <></>
      )}
      <ViewTabsCorner />
    </div>
  );
}

/**
 * Floating tabs in the corner so users can open a pane when none is active.
 */
function ViewTabsCorner() {
  const pane = useViewStore((s) => s.pane);
  const setPane = useViewStore((s) => s.setPane);
  if (pane !== "none") return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        display: "flex",
        gap: 6,
      }}
    >
      {TABS.filter((t) => t.key !== "none").map((t) => (
        <button
          key={t.key}
          data-testid={`tab-open-${t.key}`}
          onClick={() => setPane(t.key)}
          style={{
            background: "rgb(var(--border))",
            color: "rgb(var(--fg))",
            border: "none",
            padding: "6px 10px",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
