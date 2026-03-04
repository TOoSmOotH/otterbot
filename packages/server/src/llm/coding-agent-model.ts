/**
 * LanguageModelV1 adapter that wraps coding-agent CLIs (Claude Code, OpenCode,
 * Codex, Gemini CLI) as "dumb LLM proxies".
 *
 * Each CLI's own tool system is disabled — otterbot injects tools via text
 * (the Kimi/text-tool-calling path) and parses tool calls from the response.
 */

import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1StreamPart,
  LanguageModelV1Prompt,
} from "ai";
import { spawn } from "node:child_process";
import { getConfig } from "../auth/auth.js";

/** Provider types handled by this adapter */
export type CodingAgentProviderType =
  | "claude-code"
  | "opencode"
  | "codex"
  | "gemini-cli";

export interface CodingAgentModelConfig {
  agentType: CodingAgentProviderType;
  modelId: string;
}

/** Message part with a text field */
interface TextPart {
  type: "text";
  text: string;
}

/**
 * Convert a LanguageModelV1Prompt (system/user/assistant/tool messages)
 * into a single plain-text string suitable for CLI input.
 */
export function convertPromptToString(prompt: LanguageModelV1Prompt): {
  systemText: string;
  userPrompt: string;
} {
  const systemParts: string[] = [];
  const conversationParts: string[] = [];

  for (const msg of prompt) {
    switch (msg.role) {
      case "system":
        systemParts.push(msg.content);
        break;

      case "user": {
        const parts = Array.isArray(msg.content) ? msg.content : [];
        const textParts = parts
          .filter((p: any): p is TextPart => p.type === "text")
          .map((p: TextPart) => p.text);
        if (textParts.length > 0) {
          conversationParts.push(`[User]: ${textParts.join("\n")}`);
        }
        break;
      }

      case "assistant": {
        const parts = Array.isArray(msg.content) ? msg.content : [];
        const textParts = parts
          .filter((p: any): p is TextPart => p.type === "text")
          .map((p: TextPart) => p.text);
        if (textParts.length > 0) {
          conversationParts.push(`[Assistant]: ${textParts.join("\n")}`);
        }
        break;
      }

      case "tool": {
        // Serialize tool results so the model sees them
        const results = msg.content.map((r: any) => {
          const val =
            typeof r.result === "string"
              ? r.result
              : JSON.stringify(r.result);
          return `${r.toolName}: ${val}`;
        });
        conversationParts.push(`[Tool Results]: ${results.join("\n")}`);
        break;
      }
    }
  }

  return {
    systemText: systemParts.join("\n\n"),
    userPrompt: conversationParts.join("\n\n"),
  };
}

// -----------------------------------------------------------------------
// Per-agent execution helpers
// -----------------------------------------------------------------------

async function executeClaudeCode(
  prompt: string,
  systemText: string,
  modelId: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const env: Record<string, string | undefined> = { ...process.env };
  const apiKey = getConfig("claude-code:api_key");
  if (apiKey) {
    env.ANTHROPIC_API_KEY = apiKey;
  }

  const fullPrompt = systemText
    ? `${systemText}\n\n${prompt}`
    : prompt;

  const abortController = new AbortController();
  if (abortSignal) {
    abortSignal.addEventListener("abort", () => abortController.abort(), {
      once: true,
    });
  }

  const result = query({
    prompt: fullPrompt,
    options: {
      abortController,
      tools: [],
      model: modelId || undefined,
      maxTurns: 1,
      persistSession: false,
      env,
    },
  });

  let output = "";
  for await (const msg of result) {
    if (msg.type === "assistant") {
      // Extract text from BetaMessage content blocks
      for (const block of (msg.message as any).content ?? []) {
        if (block.type === "text") {
          output += block.text;
        }
      }
    } else if (msg.type === "result") {
      if ("result" in msg && (msg as any).result) {
        // Use the final result text if we didn't get assistant messages
        if (!output) output = (msg as any).result;
      }
      if ((msg as any).is_error) {
        throw new Error(`Claude Code error: ${(msg as any).errors?.join(", ") ?? "unknown"}`);
      }
    }
  }

  return output;
}

async function executeCliAgent(
  agentType: "opencode" | "codex" | "gemini-cli",
  prompt: string,
  systemText: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const fullPrompt = systemText
    ? `${systemText}\n\n${prompt}`
    : prompt;

  const { command, args } = getCli(agentType, fullPrompt);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn ${command}: ${err.message}`));
    });
    child.on("close", (code) => {
      if (code !== 0 && !stdout) {
        reject(
          new Error(
            `${command} exited with code ${code}: ${stderr.slice(0, 500)}`,
          ),
        );
      } else {
        resolve(stdout);
      }
    });

    if (abortSignal) {
      abortSignal.addEventListener(
        "abort",
        () => {
          child.kill("SIGTERM");
        },
        { once: true },
      );
    }
  });
}

function getCli(
  agentType: "opencode" | "codex" | "gemini-cli",
  prompt: string,
): { command: string; args: string[] } {
  switch (agentType) {
    case "opencode":
      return { command: "opencode", args: ["run", prompt] };
    case "codex":
      return { command: "codex", args: ["exec", "--quiet", prompt] };
    case "gemini-cli":
      return { command: "gemini", args: ["-p", prompt] };
  }
}

// -----------------------------------------------------------------------
// LanguageModelV1 implementation
// -----------------------------------------------------------------------

export class CodingAgentModel implements LanguageModelV1 {
  readonly specificationVersion = "v1" as const;
  readonly provider: string;
  readonly modelId: string;
  readonly defaultObjectGenerationMode = undefined;

  private agentType: CodingAgentProviderType;

  constructor(config: CodingAgentModelConfig) {
    this.agentType = config.agentType;
    this.provider = config.agentType;
    this.modelId = config.modelId;
  }

  async doGenerate(options: LanguageModelV1CallOptions): Promise<{
    text?: string;
    finishReason: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other" | "unknown";
    usage: { promptTokens: number; completionTokens: number };
    rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> };
  }> {
    const { systemText, userPrompt } = convertPromptToString(options.prompt);

    let text: string;
    if (this.agentType === "claude-code") {
      text = await executeClaudeCode(
        userPrompt,
        systemText,
        this.modelId,
        options.abortSignal,
      );
    } else {
      text = await executeCliAgent(
        this.agentType,
        userPrompt,
        systemText,
        options.abortSignal,
      );
    }

    return {
      text,
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0 },
      rawCall: {
        rawPrompt: userPrompt,
        rawSettings: { agentType: this.agentType, modelId: this.modelId },
      },
    };
  }

  async doStream(options: LanguageModelV1CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV1StreamPart>;
    rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> };
  }> {
    // For coding agents we generate the full response then wrap as a stream.
    const result = await this.doGenerate(options);

    const stream = new ReadableStream<LanguageModelV1StreamPart>({
      start(controller) {
        if (result.text) {
          controller.enqueue({
            type: "text-delta",
            textDelta: result.text,
          });
        }
        controller.enqueue({
          type: "finish",
          finishReason: result.finishReason,
          usage: result.usage,
          logprobs: undefined,
          providerMetadata: undefined,
        });
        controller.close();
      },
    });

    return {
      stream,
      rawCall: result.rawCall,
    };
  }
}
