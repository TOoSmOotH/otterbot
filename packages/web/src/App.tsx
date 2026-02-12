import { useEffect, useState } from "react";
import { useSocket } from "./hooks/use-socket";
import { useMessageStore } from "./stores/message-store";
import { useAgentStore } from "./stores/agent-store";
import { useAuthStore } from "./stores/auth-store";
import { useModelPackStore } from "./stores/model-pack-store";
import { CeoChat } from "./components/chat/CeoChat";
import { AgentGraph } from "./components/graph/AgentGraph";
import { LiveView } from "./components/live-view/LiveView";
import { MessageStream } from "./components/stream/MessageStream";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { LoginScreen } from "./components/auth/LoginScreen";
import { SetupWizard } from "./components/setup/SetupWizard";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { disconnectSocket } from "./lib/socket";

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
}

type CenterView = "graph" | "live3d";

function MainApp() {
  const socket = useSocket();
  const loadHistory = useMessageStore((s) => s.loadHistory);
  const setConversations = useMessageStore((s) => s.setConversations);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const loadPacks = useModelPackStore((s) => s.loadPacks);
  const logout = useAuthStore((s) => s.logout);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | undefined>();

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

    // Pre-load model packs so Live View has them ready
    loadPacks();
  }, []);

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
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center">
            <span className="text-primary text-xs font-bold">S</span>
          </div>
          <h1 className="text-sm font-semibold tracking-tight">Smoothbot</h1>
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
        <ResizableLayout userProfile={userProfile} />
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

function ResizableLayout({ userProfile }: { userProfile?: UserProfile; }) {
  const [centerView, setCenterView] = useState<CenterView>("graph");
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "smoothbot-layout",
    storage: localStorage,
    panelIds: PANEL_IDS,
  });

  return (
    <Group
      orientation="horizontal"
      defaultLayout={defaultLayout ?? { chat: 20, graph: 50, stream: 30 }}
      onLayoutChanged={onLayoutChanged}
    >
      {/* Left: CEO Chat */}
      <Panel id="chat" minSize="15%" maxSize="40%">
        <div className="h-full flex flex-col">
          <CeoChat />
        </div>
      </Panel>

      <Separator className="panel-resize-handle" />

      {/* Center: Agent Graph / Live View */}
      <Panel id="graph" minSize="20%">
        <div className="h-full">
          {centerView === "graph" ? (
            <AgentGraph userProfile={userProfile} onToggleView={() => setCenterView("live3d")} />
          ) : (
            <LiveView userProfile={userProfile} onToggleView={() => setCenterView("graph")} />
          )}
        </div>
      </Panel>

      <Separator className="panel-resize-handle" />

      {/* Right: Message Stream */}
      <Panel id="stream" minSize="15%" maxSize="40%">
        <div className="h-full relative">
          <MessageStream />
        </div>
      </Panel>
    </Group>
  );
}
