import { useEffect, useMemo, useState } from "react";
import { AgentRoster } from "./components/agents/AgentRoster";
import { AgentChat } from "./components/chat/AgentChat";
import { CODING_LOGIN_CMDS, CODING_TOOL_LABELS, type CodingTool } from "./lib/coding-cli";
import { AgentWizard } from "./components/agents/AgentWizard";
import { AgentStudio } from "./components/agents/AgentStudio";
import { ActivityView } from "./components/agents/ActivityView";
import { ProjectsView } from "./components/agents/ProjectsView";
import { ProjectDashboard } from "./components/agents/ProjectDashboard";
import { BuildRunsView } from "./components/agents/BuildRunsView";
import { TerminalModal } from "./components/agents/TerminalModal";
import { getSocket } from "./lib/socket";
import { NetworkView } from "./components/agents/NetworkView";
import { GlobalSettings } from "./components/settings/GlobalSettings";
import { OnboardingWizard } from "./components/agents/OnboardingWizard";
import { AuthGate } from "./components/AuthGate";
import { useAgentsStore } from "./stores/agents-store";
import { useProjectsStore } from "./stores/projects-store";
import { useActivityStore } from "./stores/activity-store";
import { useChatStore } from "./stores/chat-store";
import { useGlobalSettingsStore } from "./stores/global-settings-store";
import { useSetupStore } from "./stores/setup-store";
import { CommandPalette } from "./components/CommandPalette";
import { buildCommands } from "./lib/commands";
import { OfficeFloor } from "./components/agents/OfficeFloor";

type MainView = "chat" | "studio" | "projects" | "project" | "builds" | "activity" | "network" | "settings";

const VIEWS: { id: MainView; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "studio", label: "Agent Studio" },
  { id: "projects", label: "Projects" },
  { id: "builds", label: "Build Runs" },
  { id: "activity", label: "Activity" },
  { id: "network", label: "Network" },
  { id: "settings", label: "Settings" },
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
  const loadProjects = useProjectsStore((s) => s.load);
  const loadSetup = useSetupStore((s) => s.load);
  const loadSettings = useGlobalSettingsStore((s) => s.load);
  const setupChecked = useSetupStore((s) => s.checked);
  const onboardingComplete = useSetupStore((s) => s.onboardingComplete);

  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<MainView>("chat");
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const agents = useAgentsStore((s) => s.agents);
  const projects = useProjectsStore((s) => s.projects);
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
    void loadProjects();
  }, [connect, bindSocket, bindActivity, loadAgents, loadActivity, loadSetup, loadSettings, loadProjects]);

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

  const openProject = (id: string) => {
    setSelectedProjectId(id);
    setView("project");
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

  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = useMemo(
    () =>
      buildCommands({
        views: VIEWS.map((v) => ({ id: v.id, label: v.label })),
        agents: agents.map((a) => ({ id: a.id, displayName: a.displayName })),
        projects: projects.map((p) => ({ id: p.id, name: p.name })),
        setView: (id) => setView(id as MainView),
        setActive,
        openSettings: () => openSettings(),
        openProject,
        onNewAgent: () => setCreateOpen(true),
      }),
    [agents, projects, setActive]
  );

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateColumns: "260px 1fr" }}>
      <AgentRoster onNewAgent={() => setCreateOpen(true)} onOpenSettings={() => openSettings()} onOpenProject={openProject} />

      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "8px 12px",
            borderBottom: "1px solid rgb(var(--border))",
            background: "rgb(var(--bg))",
          }}
        >
          <button
            data-testid="command-trigger"
            onClick={() => setPaletteOpen(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              background: "rgb(var(--surface))",
              border: "1px solid rgb(var(--border))",
              borderRadius: 10,
              color: "rgb(var(--subtle))",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Jump to… <kbd style={{ fontSize: 10 }}>⌘K</kbd>
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          {view === "chat" && (
            <AgentChat
              onEditAgent={openStudio}
              onOpenSettings={openSettings}
              onOpenLoginTerminal={openLoginTerminal}
            />
          )}
          {view === "studio" && <AgentStudio agentId={activeAgentId} onOpenSettings={openSettings} />}
          {view === "projects" && <ProjectsView onOpenProject={openProject} />}
          {view === "project" && (
            <ProjectDashboard
              projectId={selectedProjectId}
              onChatPM={(id) => { setActive(id); setView("chat"); }}
              onOpenBuilds={() => setView("builds")}
              onOpenSettings={openSettings}
            />
          )}
          {view === "builds" && <BuildRunsView />}
          {view === "activity" && <ActivityView />}
          {view === "network" && <NetworkView />}
          {view === "settings" && (
            <GlobalSettings initialTab={settingsTab} onOpenLoginTerminal={openLoginTerminal} />
          )}
        </div>
        <OfficeFloor onOpenOffice={() => setView("network")} />
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
      <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />
      {showOnboarding && <OnboardingWizard />}
    </div>
  );
}
