import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  startMockLLMServer,
  stopMockLLMServer,
  getMockLLMPort,
  detectAgent,
  resetCallCounts,
  setActiveResponses,
  clearActiveResponses,
} from "../mock-llm.js";
import type { MockAgentType, MockResponse } from "../scenarios/index.js";

// Suppress console.log in tests
vi.spyOn(console, "log").mockImplementation(() => {});

describe("detectAgent", () => {
  it("detects COO from system prompt", () => {
    const messages = [
      { role: "system", content: "You are the COO (Chief Operating Officer)" },
    ];
    expect(detectAgent(messages)).toBe("coo");
  });

  it("detects team_lead from system prompt", () => {
    const messages = [
      { role: "system", content: "You are a Team Lead in Otterbot" },
    ];
    expect(detectAgent(messages)).toBe("team_lead");
  });

  it("detects admin_assistant as other", () => {
    const messages = [
      { role: "system", content: "You are Admin Assistant, the Admin Assistant in Otterbot. You help the CEO." },
    ];
    expect(detectAgent(messages)).toBe("other");
  });

  it("detects memory extractor as other", () => {
    const messages = [
      { role: "system", content: "You are a memory extraction system. Analyze conversations." },
    ];
    expect(detectAgent(messages)).toBe("other");
  });

  it("does not misdetect worker with 'extract' in environment context", () => {
    const messages = [
      { role: "system", content: "You are a developer. Extract the tarball and install Go." },
    ];
    expect(detectAgent(messages)).toBe("worker");
  });

  it("defaults to worker", () => {
    const messages = [
      { role: "system", content: "You are a developer." },
    ];
    expect(detectAgent(messages)).toBe("worker");
  });

  it("handles missing system message", () => {
    const messages = [{ role: "user", content: "hello" }];
    expect(detectAgent(messages)).toBe("worker");
  });
});

describe("mock LLM HTTP server", () => {
  let port: number;

  beforeEach(async () => {
    resetCallCounts();
    clearActiveResponses();
    process.env.MOCK_STREAM_DELAY = "0";
    port = await startMockLLMServer();
  });

  afterAll(async () => {
    delete process.env.MOCK_STREAM_DELAY;
    await stopMockLLMServer();
  });

  it("starts on a free port", () => {
    expect(port).toBeGreaterThan(0);
    expect(getMockLLMPort()).toBe(port);
  });

  it("returns SSE text response for worker text call", async () => {
    // Worker call 1 is tool call, call 2 is text
    // Make two requests
    const makeRequest = async (messages: Array<{ role: string; content: string }>) => {
      const res = await fetch(`http://127.0.0.1:${port}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "mock-model",
          messages,
          stream: true,
        }),
      });
      return res.text();
    };

    const messages = [
      { role: "system", content: "You are a developer." },
      { role: "user", content: "do something" },
    ];

    // Call 1: tool call
    const res1 = await makeRequest(messages);
    expect(res1).toContain("tool_calls");
    expect(res1).toContain("file_write");

    // Call 2: text
    const res2 = await makeRequest(messages);
    expect(res2).toContain("Done.");
    expect(res2).toContain("finish_reason");
    expect(res2).toContain("[DONE]");
  });

  it("returns SSE tool call response for COO", async () => {
    const messages = [
      { role: "system", content: "You are the COO (Chief Operating Officer)" },
      { role: "user", content: "check projects" },
    ];

    const res = await fetch(`http://127.0.0.1:${port}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "mock-model", messages, stream: true }),
    });

    const body = await res.text();
    expect(body).toContain("tool_calls");
    expect(body).toContain("get_project_status");
    expect(body).toContain("[DONE]");
  });

  it("returns model list", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/models`);
    const data = await res.json();
    expect(data.data).toHaveLength(1);
    expect(data.data[0].id).toBe("mock-model");
  });

  it("uses scenario responses when active", async () => {
    const responses = new Map<MockAgentType, MockResponse[]>([
      ["coo", [{ type: "text", content: "Custom scenario response" }]],
      ["team_lead", []],
      ["worker", []],
    ]);
    setActiveResponses(responses);

    const messages = [
      { role: "system", content: "You are the COO (Chief Operating Officer)" },
      { role: "user", content: "test" },
    ];

    const res = await fetch(`http://127.0.0.1:${port}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "mock-model", messages, stream: true }),
    });

    const body = await res.text();
    expect(body).toContain("Custom scenario response");
  });

  it("returns JSON for non-streaming requests", async () => {
    const messages = [
      { role: "system", content: "You are a memory extraction system." },
      { role: "user", content: "extract memories" },
    ];

    const res = await fetch(`http://127.0.0.1:${port}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "mock-model", messages, stream: false }),
    });

    expect(res.headers.get("content-type")).toBe("application/json");
    const data = await res.json();
    expect(data.object).toBe("chat.completion");
    expect(data.choices[0].message.content).toBe("Acknowledged.");
    expect(data.choices[0].finish_reason).toBe("stop");
  });

  it("advances through COO call sequence", async () => {
    const makeRequest = async () => {
      const messages = [
        { role: "system", content: "You are the COO (Chief Operating Officer)" },
        { role: "user", content: "go" },
      ];
      const res = await fetch(`http://127.0.0.1:${port}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "mock-model", messages, stream: true }),
      });
      return res.text();
    };

    // Call 1: get_project_status
    const r1 = await makeRequest();
    expect(r1).toContain("get_project_status");

    // Call 2: create_project
    const r2 = await makeRequest();
    expect(r2).toContain("create_project");

    // Call 3: text
    const r3 = await makeRequest();
    expect(r3).toContain("monitoring progress");
  });
});
