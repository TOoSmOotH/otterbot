import { useEffect, useState, useCallback } from "react";
import { useSocket } from "./hooks/use-socket";
import { useMessageStore } from "./stores/message-store";
import { useAgentStore } from "./stores/agent-store";
import { useAuthStore } from "./stores/auth-store";
import { useModelPackStore } from "./stores/model-pack-store";
import { useProjectStore } from "./stores/project-store";
import { CeoChat } from "./components/chat/CeoChat";
import { AgentGraph } from "./components/graph/AgentGraph";
import { LiveView } from "./components/live-view/LiveView";
import { MessageStream } from "./components/stream/MessageStream";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { LoginScreen } from "./components/auth/LoginScreen";
import { SetupWizard } from "./components/setup/SetupWizard";
import { CharterView } from "./components/project/CharterView";
import { ProjectList } from "./components/project/ProjectList";
import { KanbanBoard } from "./components/kanban/KanbanBoard";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { disconnectSocket, getSocket } from "./lib/socket";

export default function App() {
  const screen = useAuthStore((s) => s.screen);
  const checkStatus = useAuthStore((s) => s.checkStatus);

  useEffect(() => {
    checkStatus();
  }, []);

  if (screen === "loading") {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center animate-pulse">
            <span className="text-primary text-xs font-bold">S</span>
          </div>
          <span className="text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  if (screen === "setup") {
    return <SetupWizard />;
  }

  if (screen === "login") {
    return <LoginScreen />;
  }

  return <MainApp />;
}

// ---------------------------------------------------------------------------
// Main application (only rendered after authentication)
// ---------------------------------------------------------------------------

interface UserProfile {
  name: string | null;
  avatar: string | null;
  modelPackId?: string | null;
  gearConfig?: Record<string, boolean> | null;
  cooName?: string;
}

type CenterView = "graph" | "live3d" | "charter" | "kanban";

function MainApp() {
  const socket = useSocket();
  const loadHistory = useMessageStore((s) => s.loadHistory);
  const setConversations = useMessageStore((s) => s.setConversations);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const loadPacks = useModelPackStore((s) => s.loadPacks);
  const logout = useAuthStore((s) => s.logout);
  const setProjects = useProjectStore((s) => s.setProjects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeProject = useProjectStore((s) => s.activeProject);
  const enterProject = useProjectStore((s) => s.enterProject);
  const exitProject = useProjectStore((s) => s.exitProject);
  const projects = useProjectStore((s) => s.projects);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | undefined>();
  const [centerView, setCenterView] = useState<CenterView>("graph");

  // Load initial data
  useEffect(() => {
    fetch("/api/messages")
      .then((r) => r.json())
      .then(loadHistory)
      .catch(console.error);

    fetch("/api/agents")
      .then((r) => r.json())
      .then(loadAgents)
      .catch(console.error);

    fetch("/api/conversations")
      .then((r) => r.json())
      .then(setConversations)
      .catch(console.error);

    fetch("/api/profile")
      .then((r) => r.json())
      .then(setUserProfile)
      .catch(console.error);

    // Load projects
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects)
      .catch(console.error);

    // Pre-load model packs so Live View has them ready
    loadPacks();
  }, []);

  const handleEnterProject = useCallback(
    (projectId: string) => {
      const socket = getSocket();
      socket.emit("project:enter", { projectId }, (result) => {
        if (result.project) {
          enterProject(projectId, result.project, result.conversations, result.tasks);
          setCenterView("kanban");
        }
      });
    },
    [enterProject],
  );

  const handleExitProject = useCallback(() => {
    exitProject();
    setCenterView("graph");
    // Reload global conversations
    const socket = getSocket();
    socket.emit("ceo:list-conversations", undefined, (conversations) => {
      setConversations(conversations);
    });
  }, [exitProject, setConversations]);

  const handleSettingsClose = () => {
    setSettingsOpen(false);
    // Re-fetch profile in case settings changed it (e.g. model pack, gear config)
    fetch("/api/profile")
      .then((r) => r.json())
      .then(setUserProfile)
      .catch(console.error);
  };

  const handleLogout = () => {
    disconnectSocket();
    logout();
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center">
              <span className="text-primary text-xs font-bold">S</span>
            </div>
            <h1 className="text-sm font-semibold tracking-tight">Smoothbot</h1>
          </div>
          {/* Project breadcrumb */}
          {activeProjectId && activeProject && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="text-border">/</span>
              <button
                onClick={handleExitProject}
                className="hover:text-foreground transition-colors px-1 py-0.5 rounded hover:bg-secondary"
              >
                &larr; Back
              </button>
              <span className="text-border">/</span>
              <span className="text-foreground font-medium truncate max-w-[200px]">
                {activeProject.name}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-secondary"
          >
            Settings
          </button>
          <button
            onClick={handleLogout}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-secondary"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Three-panel layout */}
      <main className="flex-1 overflow-hidden">
        <ResizableLayout
          userProfile={userProfile}
          activeProjectId={activeProjectId}
          activeProject={activeProject}
          projects={projects}
          centerView={centerView}
          setCenterView={setCenterView}
          onEnterProject={handleEnterProject}
          cooName={userProfile?.cooName}
        />
      </main>

      {/* Settings modal - rendered outside the resizable layout */}
      {settingsOpen && (
        <SettingsPanel onClose={handleSettingsClose} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resizable three-panel layout
// ---------------------------------------------------------------------------

const PANEL_IDS = ["chat", "graph", "stream"];

function ResizableLayout({
  userProfile,
  activeProjectId,
  activeProject,
  projects,
  centerView,
  setCenterView,
  onEnterProject,
  cooName,
}: {
  userProfile?: UserProfile;
  activeProjectId: string | null;
  activeProject: import("@smoothbot/shared").Project | null;
  projects: import("@smoothbot/shared").Project[];
  centerView: CenterView;
  setCenterView: (view: CenterView) => void;
  onEnterProject: (projectId: string) => void;
  cooName?: string;
}) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "smoothbot-layout",
    storage: localStorage,
    panelIds: PANEL_IDS,
  });

  // Reset to graph from project-only views when no project is active
  useEffect(() => {
    if (!activeProjectId && (centerView === "charter" || centerView === "kanban")) {
      setCenterView("graph");
    }
  }, [activeProjectId, centerView]);

  const renderCenterContent = () => {
    switch (centerView) {
      case "charter":
        return activeProject ? (
          <CharterView project={activeProject} />
        ) : null;
      case "kanban":
        return activeProjectId ? (
          <KanbanBoard projectId={activeProjectId} />
        ) : null;
      case "live3d":
        return (
          <LiveView userProfile={userProfile} onToggleView={() => setCenterView("graph")} />
        );
      case "graph":
      default:
        return (
          <AgentGraph userProfile={userProfile} onToggleView={() => setCenterView("live3d")} />
        );
    }
  };

  return (
    <Group
      orientation="horizontal"
      defaultLayout={defaultLayout ?? { chat: 20, graph: 50, stream: 30 }}
      onLayoutChanged={onLayoutChanged}
    >
      {/* Left: Project List + CEO Chat */}
      <Panel id="chat" minSize="15%" maxSize="40%">
        <div className="h-full flex flex-col">
          {/* Project list — compact, scrollable */}
          {!activeProjectId && (
            <div className="shrink-0 max-h-[40%] border-b border-border overflow-y-auto">
              <ProjectList projects={projects} onEnterProject={onEnterProject} cooName={cooName} />
            </div>
          )}
          {/* CEO Chat fills remaining space */}
          <div className="flex-1 min-h-0">
            <CeoChat cooName={userProfile?.cooName} />
          </div>
        </div>
      </Panel>

      <Separator className="panel-resize-handle" />

      {/* Center: Graph / Live View / Charter / Kanban */}
      <Panel id="graph" minSize="20%">
        <div className="h-full flex flex-col">
          {/* Tab bar when project is active */}
          {activeProjectId && (
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-card">
              {(["graph", "charter", "kanban"] as CenterView[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setCenterView(tab)}
                  className={`text-xs px-2.5 py-1 rounded transition-colors ${
                    centerView === tab
                      ? "bg-primary/20 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  {tab === "graph" ? "Graph" : tab === "charter" ? "Charter" : "Board"}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            {renderCenterContent()}
          </div>
        </div>
      </Panel>

      <Separator className="panel-resize-handle" />

      {/* Right: Message Stream */}
      <Panel id="stream" minSize="15%" maxSize="40%">
        <div className="h-full relative">
          <MessageStream userProfile={userProfile} />
        </div>
      </Panel>
    </Group>
  );
}
