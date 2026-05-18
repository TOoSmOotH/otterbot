import { useEffect, useState } from "react";
import { AgentRoster } from "./components/agents/AgentRoster";
import { AgentChat } from "./components/chat/AgentChat";
import { AgentEditor } from "./components/agents/AgentEditor";
import { AgentStudio } from "./components/agents/AgentStudio";
import { ActivityView } from "./components/agents/ActivityView";
import { GlobalSettings } from "./components/settings/GlobalSettings";
import { OnboardingWizard } from "./components/agents/OnboardingWizard";
import { useAgentsStore } from "./stores/agents-store";
import { useChatStore } from "./stores/chat-store";
import { useGlobalSettingsStore } from "./stores/global-settings-store";
import { useSetupStore } from "./stores/setup-store";

type MainView = "chat" | "studio" | "activity" | "settings";

const VIEWS: MainView[] = ["chat", "studio", "activity", "settings"];

const VIEW_LABELS: Record<MainView, string> = {
  chat: "Chat",
  studio: "Agent Studio",
  activity: "Activity",
  settings: "Settings",
};

export default function App() {
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
        <nav style={{ display: "flex", gap: 4, padding: 6, borderBottom: "1px solid rgb(var(--border))" }}>
          {VIEWS.map((v) => (
            <button
              key={v}
              data-testid={`view-${v}`}
              onClick={() => setView(v)}
              style={{
                background: view === v ? "rgb(var(--accent))" : "transparent",
                color: view === v ? "white" : "rgb(var(--fg))",
                border: "1px solid rgb(var(--border))",
                padding: "4px 12px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
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
