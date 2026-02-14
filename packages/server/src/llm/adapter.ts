import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOllama } from "ollama-ai-provider";
import { streamText, generateText, type LanguageModel } from "ai";
import { getConfig } from "../auth/auth.js";

export interface LLMConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  thinkingBudget?: number;
}

/** Returns true for Anthropic models that support extended thinking */
export function isThinkingModel(config: LLMConfig): boolean {
  if (config.provider !== "anthropic") return false;
  return /^claude-(sonnet-4-5|opus-4)/.test(config.model);
}

/** Resolve a Vercel AI SDK language model from agent config */
export function resolveModel(config: LLMConfig): LanguageModel {
  switch (config.provider) {
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey:
          config.apiKey ?? getConfig("provider:anthropic:api_key") ?? "",
      });
      return anthropic(config.model);
    }

    case "openai": {
      const baseUrl =
        config.baseUrl ?? getConfig("provider:openai:base_url");
      const openai = createOpenAI({
        apiKey:
          config.apiKey ?? getConfig("provider:openai:api_key") ?? "",
        ...(baseUrl ? { baseURL: baseUrl } : {}),
      });
      return openai(config.model);
    }

    case "ollama": {
      const ollama = createOllama({
        baseURL:
          config.baseUrl ??
          getConfig("provider:ollama:base_url") ??
          "http://localhost:11434/api",
      });
      return ollama(config.model);
    }

    case "openai-compatible": {
      const baseUrl =
        config.baseUrl ??
        getConfig("provider:openai-compatible:base_url");
      if (!baseUrl) {
        throw new Error(
          "openai-compatible provider requires a baseUrl configured in settings",
        );
      }
      const compatible = createOpenAICompatible({
        name: "openai-compatible",
        baseURL: baseUrl,
        apiKey:
          config.apiKey ??
          getConfig("provider:openai-compatible:api_key") ??
          "",
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
  const thinking = isThinkingModel(config);
  const result = streamText({
    model,
    messages,
    temperature: config.temperature,
    ...(tools ? { tools: tools as any, maxSteps: 10 } : {}),
    ...(thinking
      ? {
          providerOptions: {
            anthropic: {
              thinking: {
                type: "enabled",
                budgetTokens: config.thinkingBudget ?? 10_000,
              },
            },
          },
        }
      : {}),
  });
  return result;
}
