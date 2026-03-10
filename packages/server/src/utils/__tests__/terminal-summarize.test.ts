import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

vi.mock("../../auth/auth.js", () => {
  const store = new Map<string, string>();
  return {
    getConfig: (key: string) => store.get(key) ?? null,
    setConfig: (key: string, val: string) => store.set(key, val),
    deleteConfig: (key: string) => store.delete(key),
    configStore: store,
  };
});

vi.mock("../../llm/adapter.js", () => ({
  resolveModel: vi.fn(() => "mock-model"),
}));

import { generateText } from "ai";
import { summarizeForGitHub } from "../terminal.js";

const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("summarizeForGitHub", () => {
  it("returns null for short input (<100 chars)", async () => {
    const result = await summarizeForGitHub("short output", "coder");
    expect(result).toBeNull();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("returns LLM text on success", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "## Summary\n- Fixed the login bug",
    });

    const input = "a]".repeat(60); // 120 chars
    const result = await summarizeForGitHub(input, "coder");

    expect(result).toBe("## Summary\n- Fixed the login bug");
    expect(mockGenerateText).toHaveBeenCalledOnce();
  });

  it("returns null when generateText throws", async () => {
    mockGenerateText.mockRejectedValueOnce(new Error("API error"));

    const input = "x".repeat(200);
    const result = await summarizeForGitHub(input, "tester");

    expect(result).toBeNull();
  });

  it("returns null when generateText returns empty text", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: "" });

    const input = "x".repeat(200);
    const result = await summarizeForGitHub(input, "coder");

    expect(result).toBeNull();
  });

  it("includes stage name in the prompt", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: "summary" });

    const input = "x".repeat(200);
    await summarizeForGitHub(input, "security");

    const call = mockGenerateText.mock.calls[0][0];
    expect(call.system).toContain("security");
    expect(call.system).toContain("severity");
  });

  it("uses a generic hint for unknown stages", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: "summary" });

    const input = "x".repeat(200);
    await summarizeForGitHub(input, "custom-stage");

    const call = mockGenerateText.mock.calls[0][0];
    expect(call.system).toContain("custom-stage");
  });
});
