import { useEffect, useRef } from "react";
import { getSocket } from "../lib/socket";
import { useMessageStore } from "../stores/message-store";
import { useAgentStore } from "../stores/agent-store";
import { useProjectStore } from "../stores/project-store";
import { useAgentActivityStore } from "../stores/agent-activity-store";

export function useSocket() {
  const initialized = useRef(false);
  const addMessage = useMessageStore((s) => s.addMessage);
  const setCooResponse = useMessageStore((s) => s.setCooResponse);
  const appendCooStream = useMessageStore((s) => s.appendCooStream);
  const appendCooThinking = useMessageStore((s) => s.appendCooThinking);
  const endCooThinking = useMessageStore((s) => s.endCooThinking);
  const addConversation = useMessageStore((s) => s.addConversation);
  const addAgent = useAgentStore((s) => s.addAgent);
  const updateAgentStatus = useAgentStore((s) => s.updateAgentStatus);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const addProject = useProjectStore((s) => s.addProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const addTask = useProjectStore((s) => s.addTask);
  const updateTask = useProjectStore((s) => s.updateTask);
  const removeTask = useProjectStore((s) => s.removeTask);
  const addProjectConversation = useProjectStore((s) => s.addProjectConversation);
  const appendAgentStream = useAgentActivityStore((s) => s.appendStream);
  const appendAgentThinking = useAgentActivityStore((s) => s.appendThinking);
  const endAgentThinking = useAgentActivityStore((s) => s.endThinking);
  const addAgentToolCall = useAgentActivityStore((s) => s.addToolCall);

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

    socket.on("coo:thinking", ({ token, messageId }) => {
      appendCooThinking(token, messageId);
    });

    socket.on("coo:thinking-end", ({ messageId }) => {
      endCooThinking(messageId);
    });

    socket.on("coo:audio", ({ audio, contentType }) => {
      // Only play if speaker is toggled on
      if (localStorage.getItem("smoothbot:speaker") !== "true") return;
      try {
        const bytes = atob(audio);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob = new Blob([arr], { type: contentType });
        const url = URL.createObjectURL(blob);
        const player = new Audio(url);
        player.addEventListener("ended", () => URL.revokeObjectURL(url));
        player.play().catch(() => URL.revokeObjectURL(url));
      } catch {
        // Best-effort audio playback
      }
    });

    socket.on("conversation:created", (conversation) => {
      addConversation(conversation);
      if (conversation.projectId) {
        addProjectConversation(conversation);
      }
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

    socket.on("project:created", (project) => {
      addProject(project);
    });

    socket.on("project:updated", (project) => {
      updateProject(project);
    });

    socket.on("kanban:task-created", (task) => {
      addTask(task);
    });

    socket.on("kanban:task-updated", (task) => {
      updateTask(task);
    });

    socket.on("kanban:task-deleted", ({ taskId }) => {
      removeTask(taskId);
    });

    socket.on("agent:stream", ({ agentId, token, messageId }) => {
      appendAgentStream(agentId, token, messageId);
    });

    socket.on("agent:thinking", ({ agentId, token, messageId }) => {
      appendAgentThinking(agentId, token, messageId);
    });

    socket.on("agent:thinking-end", ({ agentId, messageId }) => {
      endAgentThinking(agentId, messageId);
    });

    socket.on("agent:tool-call", ({ agentId, toolName, args }) => {
      addAgentToolCall(agentId, toolName, args);
    });

    return () => {
      socket.off("bus:message");
      socket.off("coo:response");
      socket.off("coo:stream");
      socket.off("coo:thinking");
      socket.off("coo:thinking-end");
      socket.off("coo:audio");
      socket.off("conversation:created");
      socket.off("agent:spawned");
      socket.off("agent:status");
      socket.off("agent:destroyed");
      socket.off("project:created");
      socket.off("project:updated");
      socket.off("kanban:task-created");
      socket.off("kanban:task-updated");
      socket.off("kanban:task-deleted");
      socket.off("agent:stream");
      socket.off("agent:thinking");
      socket.off("agent:thinking-end");
      socket.off("agent:tool-call");
    };
  }, []);

  return getSocket();
}
