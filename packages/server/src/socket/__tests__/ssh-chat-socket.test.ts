import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockHandleSshChat = vi.fn();

vi.mock("../../ssh/ssh-chat.js", () => ({
  handleSshChat: (...args: any[]) => mockHandleSshChat(...args),
  clearSshChatHistory: vi.fn(),
}));

import {
  setupSocketHandlers,
  registerPtySession,
  unregisterPtySession,
} from "../handlers.js";

type SocketHandler = (...args: any[]) => void | Promise<void>;

const socketHandlers = new Map<string, SocketHandler>();

function createMockSocket() {
  return {
    id: "socket-1",
    on: vi.fn((event: string, handler: SocketHandler) => {
      socketHandlers.set(event, handler);
    }),
    emit: vi.fn(),
  };
}

function createMockIo() {
  const sockets: any[] = [];
  return {
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (socket: any) => void) => {
      if (event === "connection") {
        for (const socket of sockets) {
          handler(socket);
        }
      }
    }),
    _addSocket: (s: any) => sockets.push(s),
  };
}

function createMockBus() {
  return {
    onBroadcast: vi.fn(),
    offBroadcast: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    send: vi.fn(),
    getHistory: vi.fn(),
    request: vi.fn(),
  };
}

function createMockCoo() {
  return {
    getCurrentConversationId: vi.fn(() => null),
    resetConversation: vi.fn(),
    startNewConversation: vi.fn(),
    toData: vi.fn(() => ({ model: "test", provider: "test" })),
    getTeamLeads: vi.fn(() => new Map()),
    destroy: vi.fn(),
  };
}

function createMockRegistry() {
  return {
    list: vi.fn(() => []),
    get: vi.fn(() => null),
  };
}

describe("SSH chat socket handlers", () => {
  beforeEach(() => {
    socketHandlers.clear();
    mockHandleSshChat.mockReset();
  });

  afterEach(() => {
    unregisterPtySession("ssh-sess-1");
  });

  function setupHandler() {
    const mockSocket = createMockSocket();
    const mockIo = createMockIo();
    mockIo._addSocket(mockSocket);

    setupSocketHandlers(
      mockIo as any,
      createMockBus() as any,
      createMockCoo() as any,
      createMockRegistry() as any,
    );

    return { mockIo };
  }

  it("handles ssh:chat by passing terminal buffer and emitting stream + response", async () => {
    const { mockIo } = setupHandler();
    const ptyClient = {
      getReplayBuffer: vi.fn(() => "recent terminal output"),
      writeInput: vi.fn(),
      gracefulExit: vi.fn(),
    };
    registerPtySession("ssh-sess-1", ptyClient as any);

    mockHandleSshChat.mockImplementation(async (_req, callbacks) => {
      callbacks.onStream("token-a", "msg-1");
      callbacks.onComplete("msg-1", "Disk is 40% free", "df -h");
      return "msg-1";
    });

    const handler = socketHandlers.get("ssh:chat");
    expect(handler).toBeDefined();

    const callback = vi.fn();
    await handler!({ sessionId: "sess-1", message: "show free disk" }, callback);

    expect(mockHandleSshChat).toHaveBeenCalledWith(
      {
        sessionId: "sess-1",
        message: "show free disk",
        terminalBuffer: "recent terminal output",
      },
      expect.objectContaining({
        onStream: expect.any(Function),
        onComplete: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    expect(mockIo.emit).toHaveBeenCalledWith("ssh:chat-stream", {
      sessionId: "sess-1",
      token: "token-a",
      messageId: "msg-1",
    });
    expect(mockIo.emit).toHaveBeenCalledWith("ssh:chat-response", {
      sessionId: "sess-1",
      messageId: "msg-1",
      content: "Disk is 40% free",
      command: "df -h",
    });
    expect(callback).toHaveBeenCalledWith({ ok: true, messageId: "msg-1" });
  });

  it("returns error ack when ssh:chat throws", async () => {
    setupHandler();
    mockHandleSshChat.mockRejectedValue(new Error("upstream failed"));
    const handler = socketHandlers.get("ssh:chat");
    const callback = vi.fn();

    await handler!({ sessionId: "sess-1", message: "hi" }, callback);

    expect(callback).toHaveBeenCalledWith({ ok: false, error: "upstream failed" });
  });

  it("does not send success ack after onError callback", async () => {
    setupHandler();
    mockHandleSshChat.mockImplementation(async (_req, callbacks) => {
      callbacks.onError("No LLM provider configured");
      return "msg-err";
    });
    const handler = socketHandlers.get("ssh:chat");
    const callback = vi.fn();

    await handler!({ sessionId: "sess-1", message: "show disk" }, callback);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ ok: false, error: "No LLM provider configured" });
  });

  it("rejects ssh:chat-confirm when no active SSH session exists", async () => {
    setupHandler();
    const handler = socketHandlers.get("ssh:chat-confirm");
    const callback = vi.fn();

    await handler!({ sessionId: "sess-1", messageId: "m1", command: "df -h" }, callback);

    expect(callback).toHaveBeenCalledWith({ ok: false, error: "No active SSH session" });
  });

  it("writes confirmed command to active PTY", async () => {
    setupHandler();
    const ptyClient = {
      getReplayBuffer: vi.fn(() => ""),
      writeInput: vi.fn(),
      gracefulExit: vi.fn(),
    };
    registerPtySession("ssh-sess-1", ptyClient as any);
    const handler = socketHandlers.get("ssh:chat-confirm");
    const callback = vi.fn();

    await handler!({ sessionId: "sess-1", messageId: "m1", command: "df -h" }, callback);

    expect(ptyClient.writeInput).toHaveBeenCalledWith("df -h\n");
    expect(callback).toHaveBeenCalledWith({ ok: true });
  });
});
