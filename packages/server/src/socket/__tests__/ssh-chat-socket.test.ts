import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockHandleSshChat = vi.fn();
const mockAnalyzeCommandOutput = vi.fn();

vi.mock("../../ssh/ssh-chat.js", () => ({
  handleSshChat: (...args: any[]) => mockHandleSshChat(...args),
  analyzeCommandOutput: (...args: any[]) => mockAnalyzeCommandOutput(...args),
  clearSshChatHistory: vi.fn(),
}));

vi.mock("../../ssh/ssh-pty-client.js", () => ({
  SshPtyClient: class MockSshPtyClient {
    private listeners: Array<(data: string) => void> = [];
    writeInput = vi.fn();
    gracefulExit = vi.fn();
    getReplayBuffer = vi.fn(() => "recent terminal output");

    addDataListener(cb: (data: string) => void): () => void {
      this.listeners.push(cb);
      return () => {
        this.listeners = this.listeners.filter((listener) => listener !== cb);
      };
    }

    emitData(data: string): void {
      for (const listener of this.listeners) listener(data);
    }
  },
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
    mockAnalyzeCommandOutput.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  async function createPtyClient() {
    const { SshPtyClient } = await import("../../ssh/ssh-pty-client.js");
    return new SshPtyClient({} as any) as any;
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
    expect(mockAnalyzeCommandOutput).not.toHaveBeenCalled();
  });

  it("auto-analyzes confirmed command output after settle timeout", async () => {
    vi.useFakeTimers();
    const { mockIo } = setupHandler();
    const ptyClient = await createPtyClient();
    ptyClient.getReplayBuffer.mockReturnValue("command output");
    registerPtySession("ssh-sess-1", ptyClient as any);
    mockAnalyzeCommandOutput.mockResolvedValue("msg-analysis");

    const handler = socketHandlers.get("ssh:chat-confirm");
    const callback = vi.fn();

    await handler!({ sessionId: "sess-1", messageId: "m1", command: "df -h" }, callback);

    expect(callback).toHaveBeenCalledWith({ ok: true });
    expect(ptyClient.writeInput).toHaveBeenCalledWith("df -h\n");
    expect(mockAnalyzeCommandOutput).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1499);
    expect(mockAnalyzeCommandOutput).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockIo.emit).toHaveBeenCalledWith("ssh:chat-analyzing", {
      sessionId: "sess-1",
      command: "df -h",
    });
    expect(mockAnalyzeCommandOutput).toHaveBeenCalledWith(
      { sessionId: "sess-1", command: "df -h", terminalBuffer: "command output" },
      expect.objectContaining({
        onStream: expect.any(Function),
        onComplete: expect.any(Function),
        onError: expect.any(Function),
      }),
    );

    const callbacks = mockAnalyzeCommandOutput.mock.calls[0][1];
    callbacks.onStream("tok", "msg-analysis");
    callbacks.onComplete("msg-analysis", "Looks good", "df -h");

    expect(mockIo.emit).toHaveBeenCalledWith("ssh:chat-stream", {
      sessionId: "sess-1",
      token: "tok",
      messageId: "msg-analysis",
    });
    expect(mockIo.emit).toHaveBeenCalledWith("ssh:chat-response", {
      sessionId: "sess-1",
      messageId: "msg-analysis",
      content: "Looks good",
      command: "df -h",
    });
  });

  it("resets settle timer on PTY data and analyzes only once after output settles", async () => {
    vi.useFakeTimers();
    setupHandler();
    const ptyClient = await createPtyClient();
    registerPtySession("ssh-sess-1", ptyClient as any);
    mockAnalyzeCommandOutput.mockResolvedValue("msg-analysis");

    const handler = socketHandlers.get("ssh:chat-confirm");
    await handler!({ sessionId: "sess-1", messageId: "m1", command: "ls -la" }, vi.fn());

    await vi.advanceTimersByTimeAsync(1000);
    ptyClient.emitData("line 1");
    await vi.advanceTimersByTimeAsync(1000);
    ptyClient.emitData("line 2");
    await vi.advanceTimersByTimeAsync(1499);
    expect(mockAnalyzeCommandOutput).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockAnalyzeCommandOutput).toHaveBeenCalledTimes(1);

    ptyClient.emitData("line 3");
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockAnalyzeCommandOutput).toHaveBeenCalledTimes(1);
  });

  it("triggers analysis at max wait timeout when output keeps streaming", async () => {
    vi.useFakeTimers();
    setupHandler();
    const ptyClient = await createPtyClient();
    registerPtySession("ssh-sess-1", ptyClient as any);
    mockAnalyzeCommandOutput.mockResolvedValue("msg-analysis");

    const handler = socketHandlers.get("ssh:chat-confirm");
    await handler!({ sessionId: "sess-1", messageId: "m1", command: "tail -f app.log" }, vi.fn());

    for (let second = 0; second < 29; second++) {
      await vi.advanceTimersByTimeAsync(1000);
      ptyClient.emitData(`tick-${second}`);
    }
    expect(mockAnalyzeCommandOutput).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockAnalyzeCommandOutput).toHaveBeenCalledTimes(1);
  });
});
