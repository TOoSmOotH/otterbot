import { useEffect, useState } from "react";
import { LayoutGroup, motion } from "motion/react";
import { Activity, FolderGit2, GitBranch, MessageSquare, Network, Settings, Sliders } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AgentRoster } from "./components/agents/AgentRoster";
import { AgentChat } from "./components/chat/AgentChat";
import { CODING_LOGIN_CMDS, CODING_TOOL_LABELS, type CodingTool } from "./lib/coding-cli";
import { AgentWizard } from "./components/agents/AgentWizard";
import { AgentStudio } from "./components/agents/AgentStudio";
import { ActivityView } from "./components/agents/ActivityView";
import { ProjectsView } from "./components/agents/ProjectsView";
import { BuildRunsView } from "./components/agents/BuildRunsView";
import { TerminalModal } from "./components/agents/TerminalModal";
import { getSocket } from "./lib/socket";
import { NetworkView } from "./components/agents/NetworkView";
import { GlobalSettings } from "./components/settings/GlobalSettings";
import { OnboardingWizard } from "./components/agents/OnboardingWizard";
import { AuthGate } from "./components/AuthGate";
import { Icon } from "./components/ui/Icon";
import { useAgentsStore } from "./stores/agents-store";
import { useActivityStore } from "./stores/activity-store";
import { useChatStore } from "./stores/chat-store";
import { useGlobalSettingsStore } from "./stores/global-settings-store";
import { useSetupStore } from "./stores/setup-store";

type MainView = "chat" | "studio" | "projects" | "builds" | "activity" | "network" | "settings";

const VIEWS: { id: MainView; label: string; icon: LucideIcon }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "studio", label: "Agent Studio", icon: Sliders },
  { id: "projects", label: "Projects", icon: FolderGit2 },
  { id: "builds", label: "Build Runs", icon: GitBranch },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "network", label: "Network", icon: Network },
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
  const bindActivity = useActivityStore((s) => s.bindSocket);
  const loadActivity = useActivityStore((s) => s.load);
  const loadSetup = useSetupStore((s) => s.load);
  const loadSettings = useGlobalSettingsStore((s) => s.load);
  const setupChecked = useSetupStore((s) => s.checked);
  const onboardingComplete = useSetupStore((s) => s.onboardingComplete);

  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<MainView>("chat");
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const agents = useAgentsStore((s) => s.agents);
  const [codingView, setCodingView] = useState<{ agentId: string; tool: string } | null>(null);
  const [loginTerminal, setLoginTerminal] = useState<{ agentId: string; tool: CodingTool } | null>(
    null
  );

  useEffect(() => {
    connect();
    bindSocket();
    bindActivity();
    void loadAgents();
    void loadActivity();
    void loadSetup();
    void loadSettings();
  }, [connect, bindSocket, bindActivity, loadAgents, loadActivity, loadSetup, loadSettings]);

  // Auto-pop a terminal whenever an agent launches an *interactive* coding
  // session. Headless runs also emit `coding:started` but are discovered (and
  // watched) via the Activity view's live-sessions list, not a popup.
  useEffect(() => {
    const socket = getSocket();
    const onStarted = (p: { agentId: string; tool: string; mode?: string }) => {
      if (p.mode === "interactive") setCodingView({ agentId: p.agentId, tool: p.tool });
    };
    socket.on("coding:started", onStarted);
    return () => {
      socket.off("coding:started", onStarted);
    };
  }, []);

  const showOnboarding = setupChecked && !onboardingComplete;

  const openStudio = (id: string) => {
    setActive(id);
    setView("studio");
  };

  const openSettings = (tab?: string) => {
    setSettingsTab(tab);
    setView("settings");
  };

  // Open a shell to log a coding CLI in. Logins are shared across agents, so any
  // shell-capable agent works; prefer the active one, else the COO, else any.
  const openLoginTerminal = (tool: CodingTool) => {
    const active = agents.find((a) => a.id === activeAgentId);
    const host =
      (active?.canRunShell ? active : undefined) ??
      agents.find((a) => a.role === "coo" && a.canRunShell) ??
      agents.find((a) => a.canRunShell);
    if (!host) {
      alert(
        "No shell-capable agent is available. Enable shell access on an agent (Agent Studio → Skills) to log in to the coding CLIs."
      );
      return;
    }
    setLoginTerminal({ agentId: host.id, tool });
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
          {view === "chat" && (
            <AgentChat
              onEditAgent={openStudio}
              onOpenSettings={openSettings}
              onOpenLoginTerminal={openLoginTerminal}
            />
          )}
          {view === "studio" && <AgentStudio agentId={activeAgentId} onOpenSettings={openSettings} />}
          {view === "projects" && <ProjectsView onOpenSettings={openSettings} />}
          {view === "builds" && <BuildRunsView />}
          {view === "activity" && <ActivityView />}
          {view === "network" && <NetworkView />}
          {view === "settings" && (
            <GlobalSettings initialTab={settingsTab} onOpenLoginTerminal={openLoginTerminal} />
          )}
        </div>
      </div>

      {createOpen && <AgentWizard onClose={() => setCreateOpen(false)} />}
      {codingView && (
        <TerminalModal
          kind="coding"
          agentId={codingView.agentId}
          agentName={agents.find((a) => a.id === codingView.agentId)?.displayName ?? codingView.agentId}
          toolLabel={codingView.tool}
          onClose={() => setCodingView(null)}
        />
      )}
      {loginTerminal && (
        <TerminalModal
          kind="shell"
          agentId={loginTerminal.agentId}
          agentName={`Log in to ${CODING_TOOL_LABELS[loginTerminal.tool]}`}
          initialCommand={CODING_LOGIN_CMDS[loginTerminal.tool]}
          onClose={() => setLoginTerminal(null)}
        />
      )}
      {showOnboarding && <OnboardingWizard />}
    </div>
  );
}
