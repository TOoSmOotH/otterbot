import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOllama } from "ollama-ai-provider";
import { streamText, generateText, type LanguageModel } from "ai";

export interface LLMConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
}

/** Resolve a Vercel AI SDK language model from agent config */
export function resolveModel(config: LLMConfig): LanguageModel {
  switch (config.provider) {
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
      });
      return anthropic(config.model);
    }

    case "openai": {
      const openai = createOpenAI({
        apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      return openai(config.model);
    }

    case "ollama": {
      const ollama = createOllama({
        baseURL:
          config.baseUrl ??
          process.env.OLLAMA_BASE_URL ??
          "http://localhost:11434/api",
      });
      return ollama(config.model);
    }

    case "openai-compatible": {
      if (!config.baseUrl && !process.env.OPENAI_COMPATIBLE_BASE_URL) {
        throw new Error(
          "openai-compatible provider requires a baseUrl or OPENAI_COMPATIBLE_BASE_URL env var",
        );
      }
      const compatible = createOpenAICompatible({
        name: "openai-compatible",
        baseURL:
          config.baseUrl ?? process.env.OPENAI_COMPATIBLE_BASE_URL!,
        apiKey:
          config.apiKey ?? process.env.OPENAI_COMPATIBLE_API_KEY ?? "",
      });
      return compatible(config.model);
    }

    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Generate a complete response (non-streaming) */
export async function generate(
  config: LLMConfig,
  messages: ChatMessage[],
  tools?: Record<string, unknown>,
) {
  const model = resolveModel(config);
  const result = await generateText({
    model,
    messages,
    temperature: config.temperature,
    ...(tools ? { tools: tools as any } : {}),
  });
  return result;
}

/** Generate a streaming response */
export async function stream(
  config: LLMConfig,
  messages: ChatMessage[],
  tools?: Record<string, unknown>,
) {
  const model = resolveModel(config);
  const result = streamText({
    model,
    messages,
    temperature: config.temperature,
    ...(tools ? { tools: tools as any } : {}),
  });
  return result;
}
