import { useEffect, useState } from "react";
import { LiveView } from "./LiveView";
import { useSocket } from "../../hooks/use-socket";
import { useAgentStore } from "../../stores/agent-store";

interface UserProfile {
  name: string | null;
  avatar: string | null;
  modelPackId?: string | null;
  cooName?: string;
}

export function DetachedLiveView() {
  const [userProfile, setUserProfile] = useState<UserProfile | undefined>();
  const loadAgents = useAgentStore((s) => s.loadAgents);

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
  }, [loadAgents]);

  if (!userProfile) {
    return (
      <div className="h-screen w-screen bg-black text-white flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center animate-pulse">
            <span className="text-primary text-xs font-bold">S</span>
          </div>
          <span className="text-sm">Loading 3D View...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-black">
      <LiveView userProfile={userProfile} />
    </div>
  );
}
