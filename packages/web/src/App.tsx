import { useEffect, useState } from "react";
import { LayoutGroup, motion } from "motion/react";
import { Activity, MessageSquare, Settings, Sliders } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AgentRoster } from "./components/agents/AgentRoster";
import { AgentChat } from "./components/chat/AgentChat";
import { AgentEditor } from "./components/agents/AgentEditor";
import { AgentStudio } from "./components/agents/AgentStudio";
import { ActivityView } from "./components/agents/ActivityView";
import { GlobalSettings } from "./components/settings/GlobalSettings";
import { OnboardingWizard } from "./components/agents/OnboardingWizard";
import { AuthGate } from "./components/AuthGate";
import { Icon } from "./components/ui/Icon";
import { useAgentsStore } from "./stores/agents-store";
import { useChatStore } from "./stores/chat-store";
import { useGlobalSettingsStore } from "./stores/global-settings-store";
import { useSetupStore } from "./stores/setup-store";

type MainView = "chat" | "studio" | "activity" | "settings";

const VIEWS: { id: MainView; label: string; icon: LucideIcon }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "studio", label: "Agent Studio", icon: Sliders },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function App() {
  return (
    <AuthGate>
      <AuthedApp />
    </AuthGate>
  );
}

function AuthedApp() {
  const loadAgents = useAgentsStore((s) => s.load);
  const bindSocket = useAgentsStore((s) => s.bindSocket);
  const setActive = useAgentsStore((s) => s.setActive);
  const activeAgentId = useAgentsStore((s) => s.activeAgentId);
  const connect = useChatStore((s) => s.connect);
  const loadSetup = useSetupStore((s) => s.load);
  const loadSettings = useGlobalSettingsStore((s) => s.load);
  const setupChecked = useSetupStore((s) => s.checked);
  const onboardingComplete = useSetupStore((s) => s.onboardingComplete);

  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<MainView>("chat");

  useEffect(() => {
    connect();
    bindSocket();
    void loadAgents();
    void loadSetup();
    void loadSettings();
  }, [connect, bindSocket, loadAgents, loadSetup, loadSettings]);

  const showOnboarding = setupChecked && !onboardingComplete;

  const openStudio = (id: string) => {
    setActive(id);
    setView("studio");
  };

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateColumns: "260px 1fr" }}>
      <AgentRoster onNewAgent={() => setCreateOpen(true)} />

      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <nav
          style={{
            display: "flex",
            gap: 2,
            padding: "0 12px",
            borderBottom: "1px solid rgb(var(--border))",
            background: "rgb(var(--bg))",
          }}
        >
          <LayoutGroup id="view-tabs">
            {VIEWS.map((v) => {
              const active = view === v.id;
              return (
                <button
                  key={v.id}
                  data-testid={`view-${v.id}`}
                  onClick={() => setView(v.id)}
                  style={{
                    position: "relative",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "transparent",
                    color: active ? "rgb(var(--fg))" : "rgb(var(--muted))",
                    border: "none",
                    padding: "10px 12px",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    letterSpacing: "-0.005em",
                  }}
                >
                  <Icon icon={v.icon} size={14} />
                  {v.label}
                  {active && (
                    <motion.span
                      layoutId="view-tab-indicator"
                      transition={{ type: "spring", stiffness: 480, damping: 38 }}
                      style={{
                        position: "absolute",
                        left: 8,
                        right: 8,
                        bottom: -1,
                        height: 2,
                        background: "rgb(var(--accent))",
                        borderRadius: 2,
                      }}
                    />
                  )}
                </button>
              );
            })}
          </LayoutGroup>
        </nav>
        <div style={{ flex: 1, minHeight: 0 }}>
          {view === "chat" && <AgentChat onEditAgent={openStudio} />}
          {view === "studio" && <AgentStudio agentId={activeAgentId} />}
          {view === "activity" && <ActivityView />}
          {view === "settings" && <GlobalSettings />}
        </div>
      </div>

      {createOpen && <AgentEditor agentId={null} onClose={() => setCreateOpen(false)} />}
      {showOnboarding && <OnboardingWizard />}
    </div>
  );
}
