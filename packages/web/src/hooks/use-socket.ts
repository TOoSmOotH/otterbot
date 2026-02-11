import { useEffect, useRef } from "react";
import { getSocket } from "../lib/socket";
import { useMessageStore } from "../stores/message-store";
import { useAgentStore } from "../stores/agent-store";

export function useSocket() {
  const initialized = useRef(false);
  const addMessage = useMessageStore((s) => s.addMessage);
  const setCooResponse = useMessageStore((s) => s.setCooResponse);
  const appendCooStream = useMessageStore((s) => s.appendCooStream);
  const addConversation = useMessageStore((s) => s.addConversation);
  const addAgent = useAgentStore((s) => s.addAgent);
  const updateAgentStatus = useAgentStore((s) => s.updateAgentStatus);
  const removeAgent = useAgentStore((s) => s.removeAgent);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const socket = getSocket();

    socket.on("bus:message", (message) => {
      addMessage(message);
    });

    socket.on("coo:response", (message) => {
      setCooResponse(message);
    });

    socket.on("coo:stream", ({ token, messageId }) => {
      appendCooStream(token, messageId);
    });

    socket.on("conversation:created", (conversation) => {
      addConversation(conversation);
    });

    socket.on("agent:spawned", (agent) => {
      addAgent(agent);
    });

    socket.on("agent:status", ({ agentId, status }) => {
      updateAgentStatus(agentId, status);
    });

    socket.on("agent:destroyed", ({ agentId }) => {
      removeAgent(agentId);
    });

    return () => {
      socket.off("bus:message");
      socket.off("coo:response");
      socket.off("coo:stream");
      socket.off("conversation:created");
      socket.off("agent:spawned");
      socket.off("agent:status");
      socket.off("agent:destroyed");
    };
  }, []);

  return getSocket();
}
