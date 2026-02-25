import { useEffect, useRef } from "react";
import { getSocket } from "../lib/socket";
import { useMessageStore } from "../stores/message-store";
import { useAgentStore } from "../stores/agent-store";
import { useProjectStore } from "../stores/project-store";
import { useAgentActivityStore } from "../stores/agent-activity-store";
import { useEnvironmentStore } from "../stores/environment-store";
import { useCodingAgentStore } from "../stores/coding-agent-store";
import { useTodoStore } from "../stores/todo-store";

export function useSocket() {
  const initialized = useRef(false);
  const addMessage = useMessageStore((s) => s.addMessage);
  const setCooResponse = useMessageStore((s) => s.setCooResponse);
  const appendCooStream = useMessageStore((s) => s.appendCooStream);
  const appendCooThinking = useMessageStore((s) => s.appendCooThinking);
  const endCooThinking = useMessageStore((s) => s.endCooThinking);
  const addConversation = useMessageStore((s) => s.addConversation);
  const loadConversationMessages = useMessageStore((s) => s.loadConversationMessages);
  const setCurrentConversation = useMessageStore((s) => s.setCurrentConversation);
  const addAgent = useAgentStore((s) => s.addAgent);
  const updateAgentStatus = useAgentStore((s) => s.updateAgentStatus);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const addProject = useProjectStore((s) => s.addProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const removeProject = useProjectStore((s) => s.removeProject);
  const addTask = useProjectStore((s) => s.addTask);
  const updateTask = useProjectStore((s) => s.updateTask);
  const removeTask = useProjectStore((s) => s.removeTask);
  const addProjectConversation = useProjectStore((s) => s.addProjectConversation);
  const appendAgentStream = useAgentActivityStore((s) => s.appendStream);
  const appendAgentThinking = useAgentActivityStore((s) => s.appendThinking);
  const endAgentThinking = useAgentActivityStore((s) => s.endThinking);
  const addAgentToolCall = useAgentActivityStore((s) => s.addToolCall);
  const loadWorld = useEnvironmentStore((s) => s.loadWorld);
  const startCodingAgentSession = useCodingAgentStore((s) => s.startSession);
  const endCodingAgentSession = useCodingAgentStore((s) => s.endSession);
  const addCodingAgentMessage = useCodingAgentStore((s) => s.addMessage);
  const appendCodingAgentPartDelta = useCodingAgentStore((s) => s.appendPartDelta);
  const setAwaitingInput = useCodingAgentStore((s) => s.setAwaitingInput);
  const clearAwaitingInput = useCodingAgentStore((s) => s.clearAwaitingInput);
  const setPendingPermission = useCodingAgentStore((s) => s.setPendingPermission);
  const clearPendingPermission = useCodingAgentStore((s) => s.clearPendingPermission);
  const addTodo = useTodoStore((s) => s.addTodo);
  const patchTodo = useTodoStore((s) => s.patchTodo);
  const removeTodo = useTodoStore((s) => s.removeTodo);

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

    socket.on("coo:stream", ({ token, messageId, conversationId }) => {
      appendCooStream(token, messageId, conversationId);
    });

    socket.on("coo:thinking", ({ token, messageId, conversationId }) => {
      appendCooThinking(token, messageId, conversationId);
    });

    socket.on("coo:thinking-end", ({ messageId, conversationId }) => {
      endCooThinking(messageId, conversationId);
    });

    socket.on("coo:audio", ({ audio, contentType }) => {
      // Only play if speaker is toggled on
      if (localStorage.getItem("otterbot:speaker") !== "true") return;
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

    socket.on("conversation:switched", ({ conversationId, messages }) => {
      loadConversationMessages(messages);
      setCurrentConversation(conversationId);
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

    socket.on("project:deleted", ({ projectId }) => {
      removeProject(projectId);
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

    socket.on("todo:created", (todo) => {
      addTodo(todo);
    });

    socket.on("todo:updated", (todo) => {
      patchTodo(todo);
    });

    socket.on("todo:deleted", ({ todoId }) => {
      removeTodo(todoId);
    });

    socket.on("reminder:fired", () => {
      // The COO chat message already shows via coo:response broadcast
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

    socket.on("world:zone-added", () => {
      loadWorld();
    });

    socket.on("world:zone-removed", () => {
      loadWorld();
    });

    socket.on("codeagent:session-start", (data) => {
      startCodingAgentSession(data);
    });

    socket.on("codeagent:session-end", (data) => {
      endCodingAgentSession(data.agentId, data.sessionId, data.status, data.diff);
      clearAwaitingInput(data.agentId);
      clearPendingPermission(data.agentId);
    });

    socket.on("codeagent:message", (data) => {
      addCodingAgentMessage(data.agentId, data.sessionId, data.message);
    });

    socket.on("codeagent:part-delta", (data) => {
      appendCodingAgentPartDelta(
        data.agentId,
        data.sessionId,
        data.messageId,
        data.partId,
        data.type,
        data.delta,
        data.toolName,
        data.toolState,
      );
    });

    socket.on("codeagent:awaiting-input", (data) => {
      setAwaitingInput(data.agentId, { sessionId: data.sessionId, prompt: data.prompt });
    });

    socket.on("codeagent:permission-request", (data) => {
      setPendingPermission(data.agentId, { sessionId: data.sessionId, permission: data.permission });
    });

    return () => {
      socket.off("bus:message");
      socket.off("coo:response");
      socket.off("coo:stream");
      socket.off("coo:thinking");
      socket.off("coo:thinking-end");
      socket.off("coo:audio");
      socket.off("conversation:created");
      socket.off("conversation:switched");
      socket.off("agent:spawned");
      socket.off("agent:status");
      socket.off("agent:destroyed");
      socket.off("project:created");
      socket.off("project:updated");
      socket.off("project:deleted");
      socket.off("kanban:task-created");
      socket.off("kanban:task-updated");
      socket.off("kanban:task-deleted");
      socket.off("todo:created");
      socket.off("todo:updated");
      socket.off("todo:deleted");
      socket.off("reminder:fired");
      socket.off("agent:stream");
      socket.off("agent:thinking");
      socket.off("agent:thinking-end");
      socket.off("agent:tool-call");
      socket.off("world:zone-added");
      socket.off("world:zone-removed");
      socket.off("codeagent:session-start");
      socket.off("codeagent:session-end");
      socket.off("codeagent:message");
      socket.off("codeagent:part-delta");
      socket.off("codeagent:awaiting-input");
      socket.off("codeagent:permission-request");
    };
  }, []);

  return getSocket();
}
