import { describe, it, expect, beforeEach } from "vitest";
import { MessageType, type BusMessage } from "@otterbot/shared";
import { useMessageStore } from "../message-store";

function makeMessage(overrides: Partial<BusMessage> = {}): BusMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    fromAgentId: null,
    toAgentId: "coo",
    type: MessageType.Chat,
    content: "content",
    metadata: {},
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("message-store CEO chat filtering", () => {
  beforeEach(() => {
    useMessageStore.setState({
      messages: [],
      hasMore: true,
      chatMessages: [],
      streamingContent: "",
      streamingMessageId: null,
      streamingConversationId: null,
      thinkingContent: "",
      thinkingMessageId: null,
      isThinking: false,
      agentFilter: null,
      currentConversationId: null,
      conversations: [],
    });
  });

  it("includes CEO directive messages sent to specialist agents", () => {
    const directive = makeMessage({
      id: "d1",
      type: MessageType.Directive,
      fromAgentId: null,
      toAgentId: "module-agent-dev",
    });

    useMessageStore.getState().addMessage(directive);

    expect(useMessageStore.getState().chatMessages).toEqual([directive]);
  });

  it("excludes directives that are not CEO to specialist", () => {
    const nonSpecialistDirective = makeMessage({
      id: "d2",
      type: MessageType.Directive,
      fromAgentId: null,
      toAgentId: "coo",
    });

    useMessageStore.getState().addMessage(nonSpecialistDirective);

    expect(useMessageStore.getState().chatMessages).toEqual([]);
  });

  it("filters mixed conversation history to CEO-visible chat/report/directive messages", () => {
    const visibleChat = makeMessage({ id: "c1", type: MessageType.Chat, fromAgentId: null, toAgentId: "coo" });
    const visibleReport = makeMessage({
      id: "r1",
      type: MessageType.Report,
      fromAgentId: "module-agent-dev",
      toAgentId: "coo",
    });
    const visibleDirective = makeMessage({
      id: "d3",
      type: MessageType.Directive,
      fromAgentId: null,
      toAgentId: "module-agent-dev",
    });
    const hiddenStatus = makeMessage({ id: "s1", type: MessageType.Status, fromAgentId: "coo", toAgentId: null });
    const hiddenReportNoModule = makeMessage({
      id: "r2",
      type: MessageType.Report,
      fromAgentId: "coo",
      toAgentId: null,
    });

    useMessageStore.getState().loadConversationMessages([
      visibleChat,
      visibleReport,
      visibleDirective,
      hiddenStatus,
      hiddenReportNoModule,
    ]);

    expect(useMessageStore.getState().chatMessages).toEqual([
      visibleChat,
      visibleReport,
      visibleDirective,
    ]);
  });
});
