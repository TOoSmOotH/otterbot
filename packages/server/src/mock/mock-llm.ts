/**
 * Mock LLM for MOCK_MODE.
 *
 * Starts an in-process OpenAI-compatible HTTP server that returns scripted
 * SSE streaming responses. The adapter's `stream()` / `generate()` functions
 * call the real Vercel AI SDK `streamText()` / `generateText()` which hit
 * this server — preserving multi-step tool execution.
 *
 * The mock-seed module points the mock provider's baseUrl at this server.
 */
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type {
  MockAgentType,
  MockResponse,
  MockTextResponse,
  MockToolCallResponse,
} from "./scenarios/index.js";

// ---------------------------------------------------------------------------
// Agent detection (mirrors e2e/helpers/mock-llm-server.ts:detectAgent)
// ---------------------------------------------------------------------------

export function detectAgent(
  messages: Array<{ role: string; content?: string | unknown }>,
): MockAgentType {
  const systemMsg = messages.find((m) => m.role === "system");
  const content =
    typeof systemMsg?.content === "string"
      ? systemMsg.content.toLowerCase()
      : "";
  if (content.includes("you are the coo")) return "coo";
  if (content.includes("you are a team lead")) return "team_lead";
  // Admin Assistant and memory extractor — these are not real workers
  if (content.includes("admin assistant in otterbot")) return "other";
  if (content.includes("memory extraction system")) return "other";
  return "worker";
}

// ---------------------------------------------------------------------------
// Per-agent call counters
// ---------------------------------------------------------------------------

const callCounts: Record<MockAgentType, number> = {
  coo: 0,
  team_lead: 0,
  worker: 0,
  other: 0,
};

export function resetCallCounts(): void {
  callCounts.coo = 0;
  callCounts.team_lead = 0;
  callCounts.worker = 0;
  callCounts.other = 0;
}

// ---------------------------------------------------------------------------
// Active scenario responses (set by scenario-runner or at startup)
// ---------------------------------------------------------------------------

let activeResponses: Map<MockAgentType, MockResponse[]> | null = null;

export function setActiveResponses(
  responses: Map<MockAgentType, MockResponse[]>,
): void {
  activeResponses = responses;
}

export function clearActiveResponses(): void {
  activeResponses = null;
}

// ---------------------------------------------------------------------------
// Default responses (used when no scenario is active)
// ---------------------------------------------------------------------------

function defaultCooResponse(
  call: number,
  _messages: Array<{ role: string; content?: string }>,
): MockTextResponse | MockToolCallResponse {
  if (call === 1) {
    return {
      type: "tool-call",
      toolCalls: [{ name: "get_project_status", arguments: {} }],
    };
  }
  if (call === 2) {
    return {
      type: "tool-call",
      toolCalls: [
        {
          name: "create_project",
          arguments: {
            name: "Test App",
            description: "A test application",
            charter: "# Test App\n\nBuild a test application.",
            directive: "Build a test application with at least one file.",
          },
        },
      ],
    };
  }
  return { type: "text", content: "Understood. I'm monitoring progress." };
}

function defaultTeamLeadResponse(
  call: number,
  messages: Array<{ role: string; content?: string }>,
): MockTextResponse | MockToolCallResponse {
  if (call === 1) {
    return {
      type: "tool-call",
      toolCalls: [
        { name: "search_registry", arguments: { capability: "code" } },
      ],
    };
  }
  if (call === 2) {
    return {
      type: "tool-call",
      toolCalls: [
        {
          name: "create_task",
          arguments: {
            title: "Implement feature",
            description: "Build the requested feature",
            column: "backlog",
          },
        },
      ],
    };
  }
  if (call === 3) {
    const taskIds: string[] = [];
    for (const m of messages) {
      if (m.role === "tool" && typeof m.content === "string") {
        const match = m.content.match(/\(ID=([^)]+)\)/i) || m.content.match(/created\s+\(([^)]+)\)/i);
        if (match) taskIds.push(match[1]);
      }
    }
    return {
      type: "tool-call",
      toolCalls: [
        {
          name: "spawn_worker",
          arguments: {
            registryEntryId: "mock-full-stack-dev",
            task: "Build the feature as specified.",
            taskId: taskIds[0] || undefined,
          },
        },
      ],
    };
  }
  if (call === 4) {
    const taskIds: string[] = [];
    for (const m of messages) {
      if (m.role === "tool" && typeof m.content === "string") {
        const match = m.content.match(/\(ID=([^)]+)\)/i) || m.content.match(/created\s+\(([^)]+)\)/i);
        if (match) taskIds.push(match[1]);
      }
    }
    return {
      type: "tool-call",
      toolCalls: [
        {
          name: "update_task",
          arguments: {
            taskId: taskIds[0] || "task-1",
            column: "done",
          },
        },
      ],
    };
  }
  if (call === 5) {
    return {
      type: "tool-call",
      toolCalls: [
        {
          name: "report_to_coo",
          arguments: { content: "All tasks completed successfully." },
        },
      ],
    };
  }
  return { type: "text", content: "All tasks are done." };
}

function defaultWorkerResponse(
  call: number,
  _messages: Array<{ role: string; content?: string }>,
): MockTextResponse | MockToolCallResponse {
  if (call === 1) {
    return {
      type: "tool-call",
      toolCalls: [
        {
          name: "file_write",
          arguments: {
            path: "README.md",
            content: "# Mock Project\n\nGenerated by mock mode.\n",
          },
        },
      ],
    };
  }
  return { type: "text", content: "Done. All files written." };
}

// ---------------------------------------------------------------------------
// Resolve the response for a given agent + call number
// ---------------------------------------------------------------------------

function resolveResponse(
  agentType: MockAgentType,
  callNumber: number,
  messages: Array<{ role: string; content?: string }>,
): MockTextResponse | MockToolCallResponse {
  if (activeResponses) {
    const responses = activeResponses.get(agentType);
    if (responses && callNumber - 1 < responses.length) {
      const r = responses[callNumber - 1];
      if (r.type === "dynamic") {
        return r.fn(messages);
      }
      return r;
    }
    return { type: "text", content: "Acknowledged." };
  }

  switch (agentType) {
    case "coo":
      return defaultCooResponse(callNumber, messages);
    case "team_lead":
      return defaultTeamLeadResponse(callNumber, messages);
    case "worker":
      return defaultWorkerResponse(callNumber, messages);
    case "other":
      return { type: "text", content: "Acknowledged." };
  }
}

// ---------------------------------------------------------------------------
// SSE helpers (OpenAI-compatible streaming format)
// ---------------------------------------------------------------------------

let _seq = 0;

function sseToolCall(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
): string {
  const id = `mock-${++_seq}`;
  const deltaToolCalls = toolCalls.map((tc, index) => ({
    index,
    id: `call_${id}_${index}`,
    type: "function" as const,
    function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
  }));

  const chunk1 = JSON.stringify({
    id,
    object: "chat.completion.chunk",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", tool_calls: deltaToolCalls },
        finish_reason: null,
      },
    ],
  });

  const chunk2 = JSON.stringify({
    id,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
  });

  return `data: ${chunk1}\n\ndata: ${chunk2}\n\ndata: [DONE]\n\n`;
}

function sseText(content: string): string {
  const id = `mock-${++_seq}`;
  const delay = getStreamDelay();

  if (delay <= 0) {
    // No delay — send all at once
    const chunk1 = JSON.stringify({
      id,
      object: "chat.completion.chunk",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content },
          finish_reason: null,
        },
      ],
    });
    const chunk2 = JSON.stringify({
      id,
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
    return `data: ${chunk1}\n\ndata: ${chunk2}\n\ndata: [DONE]\n\n`;
  }

  // With delay, we still send all at once in the HTTP response
  // (the delay is more for the demo visual effect with actual streaming,
  // but SSE is text-based and the SDK buffers the entire response anyway)
  const chunks: string[] = [];
  const words = content.split(/(\s+)/);
  for (const word of words) {
    if (word) {
      const chunk = JSON.stringify({
        id,
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: word },
            finish_reason: null,
          },
        ],
      });
      chunks.push(`data: ${chunk}\n\n`);
    }
  }
  const finish = JSON.stringify({
    id,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });
  chunks.push(`data: ${finish}\n\n`);
  chunks.push(`data: [DONE]\n\n`);
  return chunks.join("");
}

// ---------------------------------------------------------------------------
// Non-streaming JSON helpers (for generateText() calls)
// ---------------------------------------------------------------------------

function jsonToolCall(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
): object {
  const id = `mock-${++_seq}`;
  return {
    id,
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: toolCalls.map((tc, index) => ({
            index,
            id: `call_${id}_${index}`,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  };
}

function jsonText(content: string): object {
  const id = `mock-${++_seq}`;
  return {
    id,
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  };
}

// ---------------------------------------------------------------------------
// Stream delay
// ---------------------------------------------------------------------------

function getStreamDelay(): number {
  const env = process.env.MOCK_STREAM_DELAY;
  if (env !== undefined) return parseInt(env, 10) || 0;
  return 30;
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: string;
  content?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    let parsed: { messages: ChatMessage[]; tools?: unknown[]; stream?: boolean };
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const agent = detectAgent(parsed.messages);
    const isStreaming = parsed.stream === true;
    const call = ++callCounts[agent];

    console.log(
      `[mock-llm] agent=${agent} call#=${call} stream=${isStreaming} msgs=${parsed.messages.length}`,
    );

    const response = resolveResponse(agent, call, parsed.messages);

    if (!isStreaming) {
      // Non-streaming: return standard JSON chat completion
      const jsonPayload = response.type === "tool-call"
        ? jsonToolCall(response.toolCalls)
        : jsonText(response.content);

      console.log(
        `[mock-llm] → responding JSON (${response.type})`,
      );

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(jsonPayload));
      return;
    }

    // Streaming: return SSE
    let ssePayload: string;

    if (response.type === "tool-call") {
      ssePayload = sseToolCall(response.toolCalls);
    } else {
      ssePayload = sseText(response.content);
    }

    console.log(
      `[mock-llm] → responding SSE (${response.type}, ${ssePayload.length} bytes)`,
    );

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.end(ssePayload);
  });
}

function handleModels(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      data: [{ id: "mock-model", object: "model", owned_by: "mock" }],
    }),
  );
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let _server: Server | null = null;
let _port: number | null = null;

/**
 * Start the embedded mock LLM HTTP server.
 * Returns the port it's listening on.
 */
export async function startMockLLMServer(): Promise<number> {
  if (_server && _port) return _port;

  resetCallCounts();
  _seq = 0;

  return new Promise((resolve, reject) => {
    _server = createServer((req, res) => {
      const url = req.url ?? "";

      if (req.method === "POST" && url.includes("/chat/completions")) {
        handleChatCompletions(req, res);
        return;
      }

      if (req.method === "GET" && url.includes("/models")) {
        handleModels(req, res);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    _server.listen(0, "127.0.0.1", () => {
      const addr = _server!.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }
      _port = addr.port;
      console.log(`[mock-llm] HTTP server listening on http://127.0.0.1:${_port}`);
      resolve(_port);
    });

    _server.on("error", reject);
  });
}

export async function stopMockLLMServer(): Promise<void> {
  if (!_server) return;
  return new Promise((res, rej) => {
    _server!.close((err) => {
      _server = null;
      _port = null;
      err ? rej(err) : res();
    });
  });
}

export function getMockLLMPort(): number | null {
  return _port;
}
