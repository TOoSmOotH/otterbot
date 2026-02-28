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
import { ProjectDashboard } from "./components/project/ProjectDashboard";
import { GlobalDashboard } from "./components/dashboard/GlobalDashboard";
import { DesktopView } from "./components/desktop/DesktopView";
import { UsageDashboard } from "./components/usage/UsageDashboard";
import { TodoView } from "./components/todos/TodoView";
import { InboxView } from "./components/inbox/InboxView";
import { CalendarView } from "./components/calendar/CalendarView";
import { CodeView } from "./components/code/CodeView";
import { SshView } from "./components/ssh/SshView";
import { ProjectSettings } from "./components/project/ProjectSettings";
import { MergeQueueView } from "./components/project/MergeQueueView";
import { DetachedLiveView } from "./components/live-view/DetachedLiveView";
import { DetachedCeoChat } from "./components/chat/DetachedCeoChat";
import { useDesktopStore } from "./stores/desktop-store";
import { useOpenCodeStore } from "./stores/opencode-store";
import { useSettingsStore } from "./stores/settings-store";
import { initMovementTriggers } from "./lib/movement-triggers";
import { initBreakRoomRoaming } from "./lib/break-room-roaming";
import { getCenterTabs, centerViewLabels } from "./lib/get-center-tabs";
import type { CenterView } from "./lib/get-center-tabs";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { disconnectSocket, getSocket } from "./lib/socket";
import { Tooltip } from "./components/ui/Tooltip";

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

  // Detached 3D view mode
  const isDetached3D = new URLSearchParams(window.location.search).has("detached-3d");
  if (isDetached3D && screen === "app") {
    return <DetachedLiveView />;
  }

  // Detached chat mode
  const isDetachedChat = new URLSearchParams(window.location.search).has("detached-chat");
  if (isDetachedChat && screen === "app") {
    return <DetachedCeoChat />;
  }

  if (screen === "loading") {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-muted-foreground">
          <img src="/logo.jpeg" alt="Otterbot" className="w-6 h-6 rounded-md animate-pulse" />
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
  const [centerView, setCenterView] = useState<CenterView>("dashboard");

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

    // Load coding agent settings so project dropdowns reflect enabled state
    useSettingsStore.getState().loadOpenCodeSettings();
    useSettingsStore.getState().loadClaudeCodeSettings();
    useSettingsStore.getState().loadCodexSettings();
    useSettingsStore.getState().loadGeminiCliSettings();

    // Hydrate coding agent session list (metadata only — details fetched on demand)
    fetch("/api/codeagent/sessions?limit=20")
      .then((r) => r.json())
      .then((data: { sessions: Array<{ id: string; sessionId: string; agentId: string; projectId: string | null; task: string; agentType?: string; status: string; startedAt: string; completedAt?: string }>; hasMore: boolean }) => {
        const mapped = data.sessions.map((s) => ({
          id: s.sessionId || s.id,
          dbId: s.id,
          agentId: s.agentId,
          projectId: s.projectId,
          task: s.task,
          agentType: (s.agentType || "opencode") as import("@otterbot/shared").CodingAgentType,
          status: s.status as import("@otterbot/shared").CodingAgentSession["status"],
          startedAt: s.startedAt,
          completedAt: s.completedAt,
        }));
        useOpenCodeStore.getState().loadSessionList({ sessions: mapped, hasMore: data.hasMore });
      })
      .catch(console.error);

    // Check desktop environment status
    useDesktopStore.getState().checkStatus();

    // Initialize movement trigger system
    initMovementTriggers();
    initBreakRoomRoaming();
  }, []);

  const clearChat = useMessageStore((s) => s.clearChat);
  const loadConversationMessages = useMessageStore((s) => s.loadConversationMessages);
  const setCurrentConversation = useMessageStore((s) => s.setCurrentConversation);

  const handleEnterProject = useCallback(
    (projectId: string) => {
      clearChat();
      // Optimistically switch view using the already-loaded project data
      // so the UI responds immediately even if the server event loop is busy.
      const cached = useProjectStore.getState().projects.find((p) => p.id === projectId);
      if (cached) {
        enterProject(projectId, cached, [], []);
        setCenterView("dashboard");
      }
      // Then fetch full data (conversations + tasks) from the server
      const socket = getSocket();
      socket.emit("project:enter", { projectId }, (result) => {
        if (result.project) {
          enterProject(projectId, result.project, result.conversations, result.tasks);
          if (!cached) setCenterView("dashboard");
          // Auto-load most recent project conversation
          if (result.conversations.length > 0) {
            const latest = result.conversations[0];
            socket.emit("ceo:load-conversation", { conversationId: latest.id }, (convResult) => {
              loadConversationMessages(convResult.messages);
              setCurrentConversation(latest.id);
            });
          }
        }
      });
    },
    [enterProject, setCenterView, clearChat, loadConversationMessages, setCurrentConversation],
  );

  const handleExitProject = useCallback(() => {
    clearChat();
    exitProject();
    setCenterView("dashboard");
    // Reload global conversations and auto-load the most recent one
    const socket = getSocket();
    socket.emit("ceo:list-conversations", undefined, (conversations) => {
      setConversations(conversations);
      if (conversations.length > 0) {
        const latest = conversations[0];
        socket.emit("ceo:load-conversation", { conversationId: latest.id }, (result) => {
          loadConversationMessages(result.messages);
          setCurrentConversation(latest.id);
        });
      }
    });
  }, [exitProject, setConversations, clearChat, loadConversationMessages, setCurrentConversation]);

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
            <img src="/logo.jpeg" alt="Otterbot" className="w-6 h-6 rounded-md" />
            <h1 className="text-sm font-semibold tracking-tight">Otterbot</h1>
            <span className="text-[10px] text-muted-foreground">v{__APP_VERSION__}</span>
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
        <div className="flex items-center gap-0.5">
          <Tooltip label="Desktop">
            <button
              onClick={() => {
                setCenterView("desktop");
                setSettingsOpen(false);
              }}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                !settingsOpen && centerView === "desktop"
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Agent Graph">
            <button
              onClick={() => {
                setCenterView("graph");
                setSettingsOpen(false);
              }}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                !settingsOpen && centerView === "graph"
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><line x1="8.59" y1="7.41" x2="15.42" y2="14.59" /><line x1="15.41" y1="7.41" x2="8.59" y2="14.59" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="3D View">
            <button
              onClick={() => {
                setCenterView("live3d");
                setSettingsOpen(false);
              }}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                !settingsOpen && centerView === "live3d"
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </button>
          </Tooltip>

          <div className="w-px h-4 bg-border mx-1" />

          <Tooltip label="Settings">
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                settingsOpen
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Logout">
            <button
              onClick={handleLogout}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </Tooltip>
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
            onOpenSettings={() => setSettingsOpen(true)}
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
      title="Expand Activity"
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
        Activity
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
  onOpenSettings,
}: {
  userProfile?: UserProfile;
  activeProjectId: string | null;
  activeProject: import("@otterbot/shared").Project | null;
  projects: import("@otterbot/shared").Project[];
  centerView: CenterView;
  setCenterView: (view: CenterView) => void;
  onEnterProject: (projectId: string) => void;
  cooName?: string;
  onOpenSettings?: () => void;
}) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "otterbot-layout",
    storage: localStorage,
    panelIds: PANEL_IDS,
  });

  const desktopEnabled = useDesktopStore((s) => s.enabled);
  const streamPanelRef = usePanelRef();
  const [streamCollapsed, setStreamCollapsed] = useState(true);

  // Start with Activity panel collapsed
  useEffect(() => {
    streamPanelRef.current?.collapse();
  }, []);

  // Reset to graph from project-only views when no project is active
  useEffect(() => {
    if (!activeProjectId && (centerView === "charter" || centerView === "kanban" || centerView === "files" || centerView === "settings")) {
      setCenterView("dashboard");
    }
  }, [activeProjectId, centerView]);

  const renderCenterContent = () => {
    switch (centerView) {
      case "dashboard":
        return activeProjectId ? (
          <ProjectDashboard projectId={activeProjectId} />
        ) : (
          <GlobalDashboard projects={projects} onEnterProject={onEnterProject} onOpenSettings={onOpenSettings} />
        );
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
        return <CodeView projectId={activeProjectId} />;
      case "ssh":
        return <SshView />;
      case "settings":
        return activeProjectId ? (
          <ProjectSettings projectId={activeProjectId} />
        ) : null;
      case "merge-queue":
        return activeProjectId ? (
          <MergeQueueView projectId={activeProjectId} />
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

      {/* Center: Graph / Live View / Charter / Kanban / Desktop */}
      <Panel id="graph" minSize="20%">
        <div className="h-full flex flex-col">
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-card">
              {getCenterTabs(activeProjectId).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setCenterView(tab)}
                    className={`text-xs px-2.5 py-1 rounded transition-colors ${
                      centerView === tab
                        ? "bg-primary/20 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                    }`}
                  >
                    {centerViewLabels[tab]}
                  </button>
              ))}
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
