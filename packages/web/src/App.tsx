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
import { SettingsPage } from "./components/settings/SettingsPage";
import { LoginScreen } from "./components/auth/LoginScreen";
import { ChangeTemporaryPassphraseScreen } from "./components/auth/ChangeTemporaryPassphraseScreen";
import { SetupWizard } from "./components/setup/SetupWizard";
import { CharterView } from "./components/project/CharterView";
import { ProjectList } from "./components/project/ProjectList";
import { KanbanBoard } from "./components/kanban/KanbanBoard";
import { FileBrowser } from "./components/project/FileBrowser";
import { DesktopView } from "./components/desktop/DesktopView";
import { UsageDashboard } from "./components/usage/UsageDashboard";
import { TodoView } from "./components/todos/TodoView";
import { InboxView } from "./components/inbox/InboxView";
import { CalendarView } from "./components/calendar/CalendarView";
import { CodeView } from "./components/code/CodeView";
import { useDesktopStore } from "./stores/desktop-store";
import { initMovementTriggers } from "./lib/movement-triggers";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { disconnectSocket, getSocket } from "./lib/socket";

export default function App() {
  const screen = useAuthStore((s) => s.screen);
  const checkStatus = useAuthStore((s) => s.checkStatus);

  useEffect(() => {
    checkStatus();
  }, []);

  // Desktop pop-out mode — render only the desktop viewer
  const isDesktopPopout = new URLSearchParams(window.location.search).has("desktop-popout");
  if (isDesktopPopout && screen === "app") {
    return (
      <div className="h-screen bg-black">
        <DesktopView />
      </div>
    );
  }

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

  if (screen === "change-passphrase") {
    return <ChangeTemporaryPassphraseScreen />;
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

type CenterView = "graph" | "live3d" | "charter" | "kanban" | "desktop" | "files" | "usage" | "todos" | "inbox" | "calendar" | "code";

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
    fetch("/api/messages?limit=50")
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

    // Check desktop environment status
    useDesktopStore.getState().checkStatus();

    // Initialize movement trigger system
    initMovementTriggers();
  }, []);

  const handleEnterProject = useCallback(
    (projectId: string) => {
      // Optimistically switch view using the already-loaded project data
      // so the UI responds immediately even if the server event loop is busy.
      const cached = useProjectStore.getState().projects.find((p) => p.id === projectId);
      if (cached) {
        enterProject(projectId, cached, [], []);
        setCenterView("kanban");
      }
      // Then fetch full data (conversations + tasks) from the server
      const socket = getSocket();
      socket.emit("project:enter", { projectId }, (result) => {
        if (result.project) {
          enterProject(projectId, result.project, result.conversations, result.tasks);
          if (!cached) setCenterView("kanban");
        }
      });
    },
    [enterProject, setCenterView],
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
            <h1 className="text-sm font-semibold tracking-tight">Otterbot</h1>
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
            className={`text-xs transition-colors px-2 py-1 rounded ${
              settingsOpen
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
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

      {/* Full-page settings or three-panel layout */}
      {settingsOpen ? (
        <SettingsPage onClose={handleSettingsClose} />
      ) : (
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
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resizable three-panel layout
// ---------------------------------------------------------------------------

const PANEL_IDS = ["chat", "graph", "stream"];

function CollapsedStreamStrip({ onExpand }: { onExpand: () => void }) {
  return (
    <button
      onClick={onExpand}
      className="h-full w-full flex flex-col items-center justify-center gap-2 bg-card hover:bg-secondary/50 transition-colors cursor-pointer border-l border-border"
      title="Expand Message Bus"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-muted-foreground rotate-180"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
      <span
        className="text-[10px] text-muted-foreground font-medium tracking-wide"
        style={{ writingMode: "vertical-rl" }}
      >
        Message Bus
      </span>
    </button>
  );
}

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
  activeProject: import("@otterbot/shared").Project | null;
  projects: import("@otterbot/shared").Project[];
  centerView: CenterView;
  setCenterView: (view: CenterView) => void;
  onEnterProject: (projectId: string) => void;
  cooName?: string;
}) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "otterbot-layout",
    storage: localStorage,
    panelIds: PANEL_IDS,
  });

  const desktopEnabled = useDesktopStore((s) => s.enabled);
  const streamPanelRef = usePanelRef();
  const [streamCollapsed, setStreamCollapsed] = useState(false);

  // Reset to graph from project-only views when no project is active
  useEffect(() => {
    if (!activeProjectId && (centerView === "charter" || centerView === "kanban" || centerView === "files")) {
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
      case "files":
        return activeProjectId ? (
          <FileBrowser projectId={activeProjectId} />
        ) : null;
      case "usage":
        return <UsageDashboard />;
      case "todos":
        return <TodoView />;
      case "inbox":
        return <InboxView />;
      case "calendar":
        return <CalendarView />;
      case "desktop":
        return <DesktopView />;
      case "code":
        return <CodeView />;
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

      {/* Center: Graph / Live View / Charter / Kanban / Desktop */}
      <Panel id="graph" minSize="20%">
        <div className="h-full flex flex-col">
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-card">
              {(
                [
                  "graph",
                  ...(activeProjectId ? (["charter", "kanban", "files"] as CenterView[]) : []),
                  "todos" as CenterView,
                  "inbox" as CenterView,
                  "calendar" as CenterView,
                  "code" as CenterView,
                  "usage" as CenterView,
                  "desktop" as CenterView,
                ] as CenterView[]
              ).map((tab) => {
                const labels: Record<CenterView, string> = {
                  graph: "Graph",
                  live3d: "Live",
                  charter: "Charter",
                  kanban: "Board",
                  files: "Files",
                  todos: "Todos",
                  inbox: "Inbox",
                  calendar: "Calendar",
                  code: "Code",
                  usage: "Usage",
                  desktop: "Desktop",
                };
                return (
                  <button
                    key={tab}
                    onClick={() => setCenterView(tab)}
                    className={`text-xs px-2.5 py-1 rounded transition-colors ${
                      centerView === tab
                        ? "bg-primary/20 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                    }`}
                  >
                    {labels[tab]}
                  </button>
                );
              })}
          </div>
          <div className="flex-1 overflow-hidden">
            {renderCenterContent()}
          </div>
        </div>
      </Panel>

      <Separator className="panel-resize-handle" />

      {/* Right: Message Stream (collapsible) */}
      <Panel
        id="stream"
        minSize="15%"
        maxSize="40%"
        collapsible
        collapsedSize="40px"
        panelRef={streamPanelRef}
        onResize={() => {
          const collapsed = streamPanelRef.current?.isCollapsed() ?? false;
          setStreamCollapsed(collapsed);
        }}
      >
        {streamCollapsed ? (
          <CollapsedStreamStrip onExpand={() => streamPanelRef.current?.expand()} />
        ) : (
          <div className="h-full relative">
            <MessageStream
              userProfile={userProfile}
              onCollapse={() => streamPanelRef.current?.collapse()}
            />
          </div>
        )}
      </Panel>
    </Group>
  );
}
