/**
 * Mock OpenAI-compatible HTTP server for team orchestration E2E tests.
 *
 * Returns scripted SSE streaming responses based on which agent is calling
 * (detected via system prompt keywords) and a global call counter per agent.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Agent = "coo" | "team_lead" | "worker";

interface ChatMessage {
  role: string;
  content?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  tools?: unknown[];
  stream?: boolean;
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

let _seq = 0;

function sseToolCall(
  toolCalls: Array<{ name: string; arguments: string }>,
): string {
  const id = `mock-${++_seq}`;
  const deltaToolCalls = toolCalls.map((tc, index) => ({
    index,
    id: `call_${id}_${index}`,
    type: "function" as const,
    function: { name: tc.name, arguments: tc.arguments },
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

// ---------------------------------------------------------------------------
// Agent detection
// ---------------------------------------------------------------------------

function detectAgent(messages: ChatMessage[]): Agent {
  const systemMsg = messages.find((m) => m.role === "system");
  const content = (systemMsg?.content ?? "").toLowerCase();
  // Both the COO and Team Lead prompts mention each other, so we use
  // unique phrases from each prompt's self-identification:
  // - COO: "you are the coo" (from "You are the COO (Chief Operating Officer)")
  // - Team Lead: "you are a team lead" (from "You are a Team Lead in Otterbot")
  if (content.includes("you are the coo")) {
    return "coo";
  }
  if (content.includes("you are a team lead")) {
    return "team_lead";
  }
  return "worker";
}

// ---------------------------------------------------------------------------
// Global state — use call counters per agent type
// ---------------------------------------------------------------------------

/** Stored registryEntryId for the Team Lead to reference */
let _registryEntryId = "full-stack-dev";

export function setRegistryEntryId(id: string): void {
  _registryEntryId = id;
}

const _callCount: Record<Agent, number> = { coo: 0, team_lead: 0, worker: 0 };

// ---------------------------------------------------------------------------
// COO response strategy
//
// Call 1 (no tool results): get_project_status
// Call 2 (has tool results): create_project
// Call 3+: text response (ack reports, do nothing)
// ---------------------------------------------------------------------------

function cooResponse(messages: ChatMessage[]): string {
  const call = ++_callCount.coo;

  if (call === 1) {
    return sseToolCall([
      {
        name: "get_project_status",
        arguments: JSON.stringify({}),
      },
    ]);
  }

  if (call === 2) {
    return sseToolCall([
      {
        name: "create_project",
        arguments: JSON.stringify({
          name: "Todo Web App",
          description:
            "Create a todo web application using React frontend and Go + SQLite backend",
          charter:
            "# Todo Web App\n\nBuild a full-stack todo application with React frontend (port 3335) and Go + SQLite backend (port 3336). Include Playwright E2E tests.",
          directive:
            "Build a todo web application with React frontend on port 3335 and Go + SQLite backend on port 3336. Include full E2E tests via Playwright. Set up both services and ensure they are running.",
        }),
      },
    ]);
  }

  // All subsequent calls: just return text acknowledgment
  return sseText(
    "Project created and Team Lead assigned. Monitoring progress.",
  );
}

// ---------------------------------------------------------------------------
// Team Lead response strategy
//
// Call 1: search_registry
// Call 2: create_task ×2
// Call 3: spawn_worker
// Call 4: update_task (done)
// Call 5: report_to_coo
// Call 6+: text (done)
// ---------------------------------------------------------------------------

function teamLeadResponse(messages: ChatMessage[]): string {
  const call = ++_callCount.team_lead;

  if (call === 1) {
    return sseToolCall([
      {
        name: "search_registry",
        arguments: JSON.stringify({ capability: "code" }),
      },
    ]);
  }

  if (call === 2) {
    return sseToolCall([
      {
        name: "create_task",
        arguments: JSON.stringify({
          title: "Build Go + SQLite backend",
          description: "Create Go backend with SQLite database serving on port 3336",
          column: "backlog",
        }),
      },
      {
        name: "create_task",
        arguments: JSON.stringify({
          title: "Build React frontend",
          description: "Create React frontend serving on port 3335",
          column: "backlog",
        }),
      },
    ]);
  }

  if (call === 3) {
    // Extract task IDs from create_task tool results in conversation
    const taskIds: string[] = [];
    for (const m of messages) {
      if (m.role === "tool" && typeof m.content === "string") {
        const match = m.content.match(/created\s+\(([^)]+)\)/i);
        if (match) taskIds.push(match[1]);
      }
    }

    return sseToolCall([
      {
        name: "spawn_worker",
        arguments: JSON.stringify({
          registryEntryId: _registryEntryId,
          task: "Build the Go + SQLite backend on port 3336 and React frontend on port 3335.",
          taskId: taskIds[0] || undefined,
        }),
      },
    ]);
  }

  if (call === 4) {
    // Extract a task ID to mark as done
    const taskIds: string[] = [];
    for (const m of messages) {
      if (m.role === "tool" && typeof m.content === "string") {
        const match = m.content.match(/created\s+\(([^)]+)\)/i);
        if (match) taskIds.push(match[1]);
      }
    }

    return sseToolCall([
      {
        name: "update_task",
        arguments: JSON.stringify({
          taskId: taskIds[0] || "task-1",
          column: "done",
        }),
      },
    ]);
  }

  if (call === 5) {
    return sseToolCall([
      {
        name: "report_to_coo",
        arguments: JSON.stringify({
          content: "All tasks completed. Backend on port 3336, frontend on port 3335.",
        }),
      },
    ]);
  }

  // All subsequent calls: text
  return sseText("All tasks completed successfully.");
}

// ---------------------------------------------------------------------------
// Worker response strategy
//
// Call 1: file_write
// Call 2+: text (done)
// ---------------------------------------------------------------------------

function workerResponse(messages: ChatMessage[]): string {
  const call = ++_callCount.worker;

  if (call === 1) {
    return sseToolCall([
      {
        name: "file_write",
        arguments: JSON.stringify({
          path: "main.go",
          content: '// Mock Go backend\npackage main\n\nfunc main() {\n\t// TODO\n}\n',
        }),
      },
    ]);
  }

  return sseText("Backend and frontend set up. All files written.");
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

function handleChatCompletions(req: IncomingMessage, res: ServerResponse): void {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    let parsed: ChatRequest;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const agent = detectAgent(parsed.messages);
    console.log(
      `[mock-llm] agent=${agent} call#=${_callCount[agent] + 1} msgs=${parsed.messages.length}`,
    );

    let ssePayload: string;

    switch (agent) {
      case "coo":
        ssePayload = cooResponse(parsed.messages);
        break;
      case "team_lead":
        ssePayload = teamLeadResponse(parsed.messages);
        break;
      case "worker":
        ssePayload = workerResponse(parsed.messages);
        break;
    }

    console.log(`[mock-llm] → responding (${ssePayload.length} bytes)`);

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

export async function startMockLLMServer(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  // Reset state
  _callCount.coo = 0;
  _callCount.team_lead = 0;
  _callCount.worker = 0;
  _seq = 0;

  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const url = req.url ?? "";

      // POST /chat/completions (no /v1 prefix — used by @ai-sdk/openai-compatible)
      if (req.method === "POST" && url.includes("/chat/completions")) {
        handleChatCompletions(req, res);
        return;
      }

      // GET /v1/models (used by model discovery)
      if (req.method === "GET" && url.includes("/models")) {
        handleModels(req, res);
        return;
      }

      // Fallback
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    server.listen(0, "0.0.0.0", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });

    server.on("error", reject);
  });
}
