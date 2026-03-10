import { useEffect, useState } from "react";
import { CeoChat } from "./CeoChat";
import { useSocket } from "../../hooks/use-socket";
import { useMessageStore } from "../../stores/message-store";
import { useAgentStore } from "../../stores/agent-store";
import { useProjectStore } from "../../stores/project-store";
import { useSettingsStore } from "../../stores/settings-store";
import { getSocket } from "../../lib/socket";

interface UserProfile {
  name: string | null;
  avatar: string | null;
  modelPackId?: string | null;
  cooName?: string;
}

export function DetachedCeoChat() {
  const [userProfile, setUserProfile] = useState<UserProfile | undefined>();
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const loadHistory = useMessageStore((s) => s.loadHistory);
  const setConversations = useMessageStore((s) => s.setConversations);
  const loadConversationMessages = useMessageStore((s) => s.loadConversationMessages);
  const setCurrentConversation = useMessageStore((s) => s.setCurrentConversation);
  const setProjects = useProjectStore((s) => s.setProjects);

  // Initialize socket listeners
  useSocket();

  useEffect(() => {
    // Load profile
    fetch("/api/profile")
      .then((r) => r.json())
      .then(setUserProfile)
      .catch(console.error);

    // Load agents
    fetch("/api/agents")
      .then((r) => r.json())
      .then(loadAgents)
      .catch(console.error);

    // Load message history
    fetch("/api/messages?limit=50")
      .then((r) => r.json())
      .then(loadHistory)
      .catch(console.error);

    // Load conversations
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((convs) => {
        setConversations(convs);
        // Auto-load most recent conversation
        if (convs.length > 0) {
          const latest = convs[0];
          const socket = getSocket();
          socket.emit("ceo:load-conversation", { conversationId: latest.id }, (result) => {
            loadConversationMessages(result.messages);
            setCurrentConversation(latest.id);
          });
        }
      })
      .catch(console.error);

    // Load projects (for project switching)
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects)
      .catch(console.error);

    // Load module agents (for specialist selector)
    useSettingsStore.getState().loadModuleAgents();

    // Load STT settings
    useSettingsStore.getState().loadOpenCodeSettings();
  }, [loadAgents, loadHistory, setConversations, loadConversationMessages, setCurrentConversation, setProjects]);

  if (!userProfile) {
    return (
      <div className="h-screen w-screen bg-background text-foreground flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <img src="/logo.jpeg" alt="Otterbot" className="w-6 h-6 rounded-md animate-pulse" />
          <span className="text-sm">Loading Chat...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background flex flex-col">
      <CeoChat cooName={userProfile.cooName} detached />
    </div>
  );
}
