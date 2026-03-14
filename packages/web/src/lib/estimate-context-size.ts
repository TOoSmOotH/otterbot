import type { BusMessage, ConversationContextSize } from "@otterbot/shared";

const APPROX_CHARACTERS_PER_TOKEN = 4;

export const EMPTY_CONTEXT_SIZE: ConversationContextSize = {
  messageCount: 0,
  estimatedTokens: 0,
  compacted: false,
};

export function isCeoChatMessage(message: BusMessage): boolean {
  const isModuleAgent =
    message.fromAgentId?.startsWith("module-agent-") ||
    message.toAgentId?.startsWith("module-agent-");
  const isCeoDirective =
    message.type === "directive" &&
    message.fromAgentId === null &&
    message.toAgentId?.startsWith("module-agent-");
  return (
    (message.type === "chat" || (message.type === "report" && isModuleAgent) || isCeoDirective) &&
    (message.fromAgentId === null ||
      message.fromAgentId === "coo" ||
      message.fromAgentId?.startsWith("module-agent-")) &&
    (message.toAgentId === null ||
      message.toAgentId === "coo" ||
      message.toAgentId?.startsWith("module-agent-"))
  );
}

export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.max(0, Math.ceil(text.length / APPROX_CHARACTERS_PER_TOKEN));
}

export function estimateConversationContextSize(messages: BusMessage[]): ConversationContextSize {
  const chatMessages = messages.filter(isCeoChatMessage);
  const compactedMessage = chatMessages.some((message) => message.metadata?.compacted === true);
  return {
    messageCount: chatMessages.length,
    estimatedTokens: chatMessages.reduce((acc, message) => acc + estimateTokenCount(message.content), 0),
    compacted: compactedMessage,
  };
}
