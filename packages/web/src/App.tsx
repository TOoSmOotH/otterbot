import { useEffect, useState } from "react";
import { useSocket } from "./hooks/use-socket";
import { useMessageStore } from "./stores/message-store";
import { useAgentStore } from "./stores/agent-store";
import { useAuthStore } from "./stores/auth-store";
import { CeoChat } from "./components/chat/CeoChat";
import { AgentGraph } from "./components/graph/AgentGraph";
import { MessageStream } from "./components/stream/MessageStream";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { LoginScreen } from "./components/auth/LoginScreen";
import { SetupWizard } from "./components/setup/SetupWizard";
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

function MainApp() {
  const socket = useSocket();
  const loadHistory = useMessageStore((s) => s.loadHistory);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const logout = useAuthStore((s) => s.logout);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
  }, []);

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
      <main className="flex-1 flex overflow-hidden">
        {/* Left: CEO Chat */}
        <div className="w-[320px] min-w-[280px] border-r border-border flex flex-col">
          <CeoChat />
        </div>

        {/* Center: Agent Graph */}
        <div className="flex-1 min-w-[300px] border-r border-border">
          <AgentGraph />
        </div>

        {/* Right: Message Stream */}
        <div className="w-[360px] min-w-[280px] relative">
          <MessageStream />
        </div>
      </main>

      {/* Settings modal */}
      {settingsOpen && (
        <SettingsPanel onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
