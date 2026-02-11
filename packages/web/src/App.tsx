import { useEffect, useState } from "react";
import { useSocket } from "./hooks/use-socket";
import { useMessageStore } from "./stores/message-store";
import { useAgentStore } from "./stores/agent-store";
import { CeoChat } from "./components/chat/CeoChat";
import { AgentGraph } from "./components/graph/AgentGraph";
import { MessageStream } from "./components/stream/MessageStream";
import { RegistryPanel } from "./components/registry/RegistryPanel";

export default function App() {
  const socket = useSocket();
  const loadHistory = useMessageStore((s) => s.loadHistory);
  const loadAgents = useAgentStore((s) => s.loadAgents);
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
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-secondary"
        >
          Settings
        </button>
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

      {/* Settings / Registry modal */}
      {settingsOpen && (
        <RegistryPanel onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
