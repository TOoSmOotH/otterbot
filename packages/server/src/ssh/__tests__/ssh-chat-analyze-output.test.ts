import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveModel = vi.fn(() => "model");
const mockGetConfig = vi.fn((key: string) => {
  if (key === "coo_provider") return "anthropic";
  if (key === "coo_model") return "test-model";
  return "";
});
const mockStreamText = vi.fn();

vi.mock("../../llm/adapter.js", () => ({
  resolveModel: (...args: any[]) => mockResolveModel(...args),
}));

vi.mock("../../auth/auth.js", () => ({
  getConfig: (...args: any[]) => mockGetConfig(...args),
}));

vi.mock("ai", () => ({
  streamText: (...args: any[]) => mockStreamText(...args),
}));

import { analyzeCommandOutput, clearSshChatHistory } from "../ssh-chat.js";

describe("analyzeCommandOutput", () => {
  beforeEach(() => {
    mockResolveModel.mockClear();
    mockGetConfig.mockClear();
    mockStreamText.mockReset();
    clearSshChatHistory("sess-1");
  });

  it("injects the synthetic analysis prompt and streams model output", async () => {
    mockStreamText.mockReturnValue({
      textStream: (async function* () {
        yield "Found ";
        yield "an error";
      })(),
    });

    const onStream = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();

    const messageId = await analyzeCommandOutput(
      { sessionId: "sess-1", command: "cat app.log", terminalBuffer: "EADDRINUSE at startup" },
      { onStream, onComplete, onError },
    );

    expect(messageId).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
    expect(onStream).toHaveBeenCalledTimes(2);
    expect(onStream).toHaveBeenNthCalledWith(1, "Found ", messageId);
    expect(onStream).toHaveBeenNthCalledWith(2, "an error", messageId);
    expect(onComplete).toHaveBeenCalledWith(messageId, "Found an error", undefined);

    const streamCall = mockStreamText.mock.calls[0][0];
    const userMessage = streamCall.messages.find((msg: any) => msg.role === "user")?.content;
    expect(userMessage).toContain("The command `cat app.log` was just executed.");
    expect(userMessage).toContain("EADDRINUSE at startup");
  });
});
