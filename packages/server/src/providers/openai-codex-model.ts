import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1Prompt,
  LanguageModelV1StreamPart,
} from "ai";
import { randomUUID } from "node:crypto";
import { CHATGPT_CODEX_BASE_URL } from "../auth/openai-oauth.js";
import type { OpenAiAuthStore } from "../auth/openai-auth-store.js";

type ResponsesInputItem =
  | { role: "user" | "assistant" | "system" | "developer"; content: unknown }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

interface ResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

interface ResponsesBody {
  model: string;
  instructions: string;
  input: ResponsesInputItem[];
  store: false;
  stream?: boolean;
  tools?: Array<{
    type: "function";
    name: string;
    description?: string;
    parameters?: unknown;
  }>;
  tool_choice?: "auto" | "none" | "required" | { type: "function"; name: string };
  reasoning?: { effort: "low" | "medium" | "high"; summary: "auto" };
  include?: string[];
}

interface CodexEvent {
  type?: string;
  delta?: string;
  item?: {
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  response?: {
    id?: string;
    model?: string;
    created_at?: number;
    usage?: ResponsesUsage;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
      call_id?: string;
      name?: string;
      arguments?: string;
    }>;
  };
  error?: { message?: string };
}

type CodexCallWarning = {
  type: "unsupported-setting";
  setting:
    | "maxTokens"
    | "temperature"
    | "topP"
    | "topK"
    | "presencePenalty"
    | "frequencyPenalty"
    | "stopSequences";
  details: string;
};
type CodexFinishReason = "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other" | "unknown";
type RegularMode = Extract<LanguageModelV1CallOptions["mode"], { type: "regular" }>;
type FunctionTool = Extract<NonNullable<RegularMode["tools"]>[number], { type: "function" }>;

/**
 * ChatGPT-account Codex transport, modeled after Hermes' openai-codex adapter:
 * build a minimal Responses payload, omit generic OpenAI SDK knobs that the
 * Codex backend rejects, and parse the SSE stream directly.
 */
export class OpenAiCodexOAuthModel implements LanguageModelV1 {
  readonly specificationVersion = "v1" as const;
  readonly provider = "openai-codex";
  readonly defaultObjectGenerationMode = undefined;
  readonly supportsStructuredOutputs = false;
  readonly supportsImageUrls = true;

  constructor(
    readonly modelId: string,
    private readonly auth: OpenAiAuthStore
  ) {}

  async doGenerate(options: LanguageModelV1CallOptions) {
    const streamed = await this.doStream(options);
    const reader = streamed.stream.getReader();
    let text = "";
    const toolCalls: Array<{
      toolCallType: "function";
      toolCallId: string;
      toolName: string;
      args: string;
    }> = [];
    let usage = { promptTokens: 0, completionTokens: 0 };
    let finishReason: CodexFinishReason = "unknown";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.type === "text-delta") text += value.textDelta;
      if (value.type === "tool-call") toolCalls.push(value);
      if (value.type === "finish") {
        usage = value.usage;
        finishReason = value.finishReason as typeof finishReason;
      }
      if (value.type === "error") throw value.error;
    }

    return {
      text: text || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
      usage,
      rawCall: streamed.rawCall,
      request: streamed.request,
      warnings: streamed.warnings,
    };
  }

  async doStream(options: LanguageModelV1CallOptions) {
    const { body, warnings } = buildResponsesBody(this.modelId, options);
    const requestBody = JSON.stringify({ ...body, stream: true });
    const res = await fetch(`${CHATGPT_CODEX_BASE_URL}/responses`, {
      method: "POST",
      headers: await this.headers(),
      body: requestBody,
      signal: options.abortSignal,
    });
    if (!res.ok) {
      throw new Error(
        `OpenAI OAuth request failed: ${res.status} ${res.statusText} ${await safeResponseText(res)}`
      );
    }
    if (!res.body) throw new Error("OpenAI OAuth response did not include a stream body");

    return {
      stream: parseCodexEventStream(res.body, this.modelId),
      rawCall: { rawPrompt: options.prompt, rawSettings: body as unknown as Record<string, unknown> },
      rawResponse: { headers: Object.fromEntries(res.headers.entries()) },
      request: { body: requestBody },
      warnings,
    };
  }

  private async headers(): Promise<Headers> {
    const token = await this.auth.accessToken();
    const headers = new Headers({
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "text/event-stream",
      "openai-beta": "responses=experimental",
      originator: "codex_cli_rs",
      "User-Agent": "codex_cli_rs/0.0.0 (Otterbot)",
      session_id: randomUUID(),
    });
    const account = this.auth.accountId() ?? accountIdFromJwt(token);
    if (account) headers.set("ChatGPT-Account-ID", account);
    return headers;
  }
}

function buildResponsesBody(
  model: string,
  options: LanguageModelV1CallOptions
): { body: ResponsesBody; warnings: CodexCallWarning[] } {
  const { instructions, input } = convertPrompt(options.prompt);
  const body: ResponsesBody = {
    model,
    instructions: instructions || "You are a helpful assistant.",
    input: input.length > 0 ? input : [{ role: "user", content: "" }],
    store: false,
  };
  const warnings: CodexCallWarning[] = [];

  if (options.maxTokens != null) warnings.push(unsupported("maxTokens"));
  if (options.temperature != null) warnings.push(unsupported("temperature"));
  if (options.topP != null) warnings.push(unsupported("topP"));
  if (options.topK != null) warnings.push(unsupported("topK"));
  if (options.presencePenalty != null) warnings.push(unsupported("presencePenalty"));
  if (options.frequencyPenalty != null) warnings.push(unsupported("frequencyPenalty"));
  if (options.stopSequences != null) warnings.push(unsupported("stopSequences"));

  if (options.mode.type === "regular") {
    const tools = (options.mode.tools ?? []).filter(
      (tool): tool is FunctionTool => tool.type === "function"
    );
    if (tools.length > 0) {
      body.tools = tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
      const choice = options.mode.toolChoice;
      if (choice?.type === "tool") {
        body.tool_choice = { type: "function", name: choice.toolName };
      } else if (choice?.type === "required") {
        body.tool_choice = "required";
      } else if (choice?.type === "none") {
        body.tool_choice = "none";
      } else {
        body.tool_choice = "auto";
      }
    }
  }

  const reasoning = options.providerMetadata?.openai?.reasoning as
    | { effort?: string; enabled?: boolean }
    | undefined;
  if (reasoning?.enabled !== false) {
    const effort = reasoning?.effort === "high" || reasoning?.effort === "low" ? reasoning.effort : "medium";
    body.reasoning = { effort, summary: "auto" };
    body.include = ["reasoning.encrypted_content"];
  }

  return { body, warnings };
}

function convertPrompt(prompt: LanguageModelV1Prompt): {
  instructions: string;
  input: ResponsesInputItem[];
} {
  const instructions: string[] = [];
  const input: ResponsesInputItem[] = [];

  for (const message of prompt) {
    if (message.role === "system") {
      instructions.push(message.content);
      continue;
    }
    if (message.role === "user") {
      input.push({ role: "user", content: message.content.map(convertUserPart) });
      continue;
    }
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type === "text") {
          input.push({ role: "assistant", content: [{ type: "output_text", text: part.text }] });
        } else if (part.type === "tool-call") {
          input.push({
            type: "function_call",
            call_id: part.toolCallId,
            name: part.toolName,
            arguments: JSON.stringify(part.args),
          });
        }
      }
      continue;
    }
    if (message.role === "tool") {
      for (const part of message.content) {
        input.push({
          type: "function_call_output",
          call_id: part.toolCallId,
          output: JSON.stringify(part.result),
        });
      }
    }
  }

  return { instructions: instructions.join("\n\n"), input };
}

type UserContentPart = Extract<LanguageModelV1Prompt[number], { role: "user" }>["content"][number];

function convertUserPart(part: UserContentPart) {
  if (typeof part !== "object" || part === null || !("type" in part)) return { type: "input_text", text: "" };
  if (part.type === "text") return { type: "input_text", text: part.text };
  if (part.type === "image") {
    const image = part.image instanceof URL
      ? part.image.toString()
      : `data:${part.mimeType ?? "image/jpeg"};base64,${Buffer.from(part.image).toString("base64")}`;
    return { type: "input_image", image_url: image };
  }
  if (part.type === "file") {
    return { type: "input_text", text: `[file: ${part.mimeType}]` };
  }
  return { type: "input_text", text: "" };
}

function parseCodexEventStream(
  body: ReadableStream<Uint8Array>,
  modelId: string
): ReadableStream<LanguageModelV1StreamPart> {
  const decoder = new TextDecoder();
  let buffer = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let finishReason: "stop" | "tool-calls" | "error" | "unknown" = "unknown";

  return new ReadableStream<LanguageModelV1StreamPart>({
    async start(controller) {
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          for (const event of takeSseEvents()) {
            handleEvent(event, controller);
          }
        }
        buffer += decoder.decode();
        for (const event of takeSseEvents(true)) handleEvent(event, controller);
        controller.enqueue({
          type: "finish",
          finishReason,
          usage: { promptTokens, completionTokens },
        });
        controller.close();
      } catch (error) {
        controller.enqueue({ type: "error", error });
        controller.close();
      }
    },
  });

  function takeSseEvents(flush = false): string[] {
    const events: string[] = [];
    while (true) {
      const idx = buffer.indexOf("\n\n");
      if (idx === -1) break;
      events.push(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
    if (flush && buffer.trim()) {
      events.push(buffer);
      buffer = "";
    }
    return events;
  }

  function handleEvent(raw: string, controller: ReadableStreamDefaultController<LanguageModelV1StreamPart>) {
    const data = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as CodexEvent;
    if (event.type === "response.output_text.delta" && event.delta) {
      controller.enqueue({ type: "text-delta", textDelta: event.delta });
      return;
    }
    if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
      finishReason = "tool-calls";
      controller.enqueue({
        type: "tool-call",
        toolCallType: "function",
        toolCallId: event.item.call_id ?? randomUUID(),
        toolName: event.item.name ?? "",
        args: event.item.arguments ?? "{}",
      });
      return;
    }
    if (event.type === "response.completed" && event.response) {
      if (event.response.id) {
        controller.enqueue({
          type: "response-metadata",
          id: event.response.id,
          modelId: event.response.model ?? modelId,
          timestamp: event.response.created_at
            ? new Date(event.response.created_at * 1000)
            : undefined,
        });
      }
      promptTokens = event.response.usage?.input_tokens ?? promptTokens;
      completionTokens = event.response.usage?.output_tokens ?? completionTokens;
      finishReason = finishReason === "tool-calls" ? "tool-calls" : "stop";
      for (const item of event.response.output ?? []) {
        if (item.type === "message") {
          for (const part of item.content ?? []) {
            const text = part.text;
            if (text) controller.enqueue({ type: "text-delta", textDelta: text });
          }
        }
      }
      return;
    }
    if (event.type === "response.failed") {
      finishReason = "error";
      throw new Error(event.error?.message ?? "OpenAI OAuth response failed");
    }
  }
}

function unsupported(setting: CodexCallWarning["setting"]): CodexCallWarning {
  return {
    type: "unsupported-setting",
    setting,
    details: "ChatGPT Codex OAuth omits this setting to match the Hermes/Codex transport.",
  };
}

function accountIdFromJwt(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64").toString("utf8")) as {
      "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
    };
    return payload["https://api.openai.com/auth"]?.chatgpt_account_id ?? null;
  } catch {
    return null;
  }
}

async function safeResponseText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
