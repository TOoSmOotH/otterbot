import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOllama } from "ollama-ai-provider";
import { streamText, generateText, type LanguageModel, type CoreMessage } from "ai";
import { getConfig } from "../auth/auth.js";
import { getDb, schema } from "../db/index.js";
import { eq } from "drizzle-orm";

export interface LLMConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  thinkingBudget?: number;
  maxSteps?: number;
  maxRetries?: number;
}

interface ResolvedCredentials {
  type: string;
  apiKey?: string;
  baseUrl?: string;
}

/** Look up provider credentials from the providers table by ID, falling back to legacy config keys */
export function resolveProviderCredentials(providerIdOrType: string): ResolvedCredentials {
  // Try providers table first
  try {
    const db = getDb();
    const row = db
      .select()
      .from(schema.providers)
      .where(eq(schema.providers.id, providerIdOrType))
      .get();
    if (row) {
      return {
        type: row.type,
        apiKey: row.apiKey ?? undefined,
        baseUrl: row.baseUrl ?? undefined,
      };
    }
  } catch {
    // DB not yet initialized — fall through to legacy
  }

  // Legacy fallback: treat as provider type string
  return {
    type: providerIdOrType,
    apiKey: getConfig(`provider:${providerIdOrType}:api_key`) ?? undefined,
    baseUrl: getConfig(`provider:${providerIdOrType}:base_url`) ?? undefined,
  };
}

/** Returns true for Anthropic models that support extended thinking */
export function isThinkingModel(config: LLMConfig): boolean {
  const resolved = resolveProviderCredentials(config.provider);
  if (resolved.type === "anthropic") {
    return /^claude-(sonnet-4-5|opus-4)/.test(config.model);
  }
  if (resolved.type === "openrouter") {
    return /^anthropic\/claude-(sonnet-4-5|opus-4)/.test(config.model);
  }
  if (resolved.type === "bedrock") {
    return /^anthropic\.claude-(sonnet-4-5|opus-4)/.test(config.model);
  }
  return false;
}

/** Resolve a Vercel AI SDK language model from agent config */
export function resolveModel(config: LLMConfig): LanguageModel {
  const resolved = resolveProviderCredentials(config.provider);

  switch (resolved.type) {
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: config.apiKey ?? resolved.apiKey ?? "",
      });
      return anthropic(config.model);
    }

    case "openai": {
      const baseUrl = config.baseUrl ?? resolved.baseUrl;
      const openai = createOpenAI({
        apiKey: config.apiKey ?? resolved.apiKey ?? "",
        ...(baseUrl ? { baseURL: baseUrl } : {}),
      });
      return openai(config.model);
    }

    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey ?? resolved.apiKey ?? "",
      });
      return google(config.model) as unknown as LanguageModel;
    }

    case "ollama": {
      const ollama = createOllama({
        baseURL:
          config.baseUrl ??
          resolved.baseUrl ??
          "http://localhost:11434/api",
      });
      return ollama(config.model);
    }

    case "openrouter": {
      const openrouter = createOpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: config.apiKey ?? resolved.apiKey ?? "",
      });
      return openrouter(config.model, { structuredOutputs: false });
    }

    case "openai-compatible": {
      const baseUrl = config.baseUrl ?? resolved.baseUrl;
      if (!baseUrl) {
        throw new Error(
          "openai-compatible provider requires a baseUrl configured in settings",
        );
      }
      const compatible = createOpenAICompatible({
        name: "openai-compatible",
        baseURL: baseUrl,
        apiKey: config.apiKey ?? resolved.apiKey ?? "",
      });
      return compatible(config.model);
    }

    case "github-copilot": {
      const copilot = createOpenAI({
        baseURL: config.baseUrl ?? resolved.baseUrl ?? "https://api.githubcopilot.com",
        apiKey: config.apiKey ?? resolved.apiKey ?? "",
      });
      return copilot(config.model);
    }

    case "huggingface": {
      const hf = createOpenAICompatible({
        name: "huggingface",
        baseURL: config.baseUrl ?? resolved.baseUrl ?? "https://api-inference.huggingface.co/v1",
        apiKey: config.apiKey ?? resolved.apiKey ?? "",
      });
      return hf(config.model);
    }

    case "nvidia": {
      const nvidia = createOpenAI({
        baseURL: config.baseUrl ?? resolved.baseUrl ?? "https://integrate.api.nvidia.com/v1",
        apiKey: config.apiKey ?? resolved.apiKey ?? "",
      });
      return nvidia(config.model);
    }

    case "xai": {
      const xai = createOpenAI({
        baseURL: config.baseUrl ?? resolved.baseUrl ?? "https://api.x.ai/v1",
        apiKey: config.apiKey ?? resolved.apiKey ?? "",
      });
      return xai(config.model);
    }

    case "zai": {
      const zai = createOpenAI({
        baseURL: config.baseUrl ?? resolved.baseUrl ?? "https://api.z.ai/api/paas/v4",
        apiKey: config.apiKey ?? resolved.apiKey ?? "",
      });
      return zai(config.model);
    }

    case "perplexity": {
      const perplexity = createOpenAI({
        baseURL: config.baseUrl ?? resolved.baseUrl ?? "https://api.perplexity.ai",
        apiKey: config.apiKey ?? resolved.apiKey ?? "",
      });
      return perplexity(config.model);
    }

    case "bedrock": {
      // apiKey is stored as "accessKeyId:secretAccessKey" for Bedrock
      // baseUrl is used to store the AWS region (e.g. "us-east-1")
      const bedrockApiKey = config.apiKey ?? resolved.apiKey ?? "";
      const [accessKeyId, secretAccessKey] = bedrockApiKey.includes(":")
        ? bedrockApiKey.split(":", 2)
        : ["", ""];
      const region = config.baseUrl ?? resolved.baseUrl ?? "us-east-1";
      const bedrock = createAmazonBedrock({
        region,
        accessKeyId,
        secretAccessKey,
      });
      return bedrock(config.model) as unknown as LanguageModel;
    }

    case "deepgram":
      throw new Error(
        "Deepgram is a speech provider (STT/TTS) and does not support text generation. " +
        "Configure it under TTS or STT settings instead.",
      );

    case "lmstudio": {
      const lmstudio = createOpenAI({
        baseURL: config.baseUrl ?? resolved.baseUrl ?? "http://localhost:1234/v1",
        apiKey: config.apiKey ?? resolved.apiKey ?? "lm-studio",
      });
      return lmstudio(config.model);
    }

    default:
      throw new Error(`Unknown LLM provider: ${config.provider} (type: ${resolved.type})`);
  }
}

/**
 * ChatMessage is an alias for the Vercel AI SDK's CoreMessage type.
 * This supports the standard system/user/assistant roles with string content,
 * as well as richer message types needed for tool-call and tool-result
 * round-trips (e.g. assistant messages with tool-call parts, tool messages
 * with results).
 */
export type ChatMessage = CoreMessage;

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
    maxRetries: config.maxRetries ?? 8,
    ...(tools ? { tools: tools as any } : {}),
  });
  return result;
}

/** Generate a streaming response */
export async function stream(
  config: LLMConfig,
  messages: ChatMessage[],
  tools?: Record<string, unknown>,
  options?: {
    abortSignal?: AbortSignal;
    onStepFinish?: (event: { toolCalls: unknown[] }) => void | Promise<void>;
  },
) {
  const model = resolveModel(config);
  const thinking = isThinkingModel(config);
  const result = streamText({
    model,
    messages,
    temperature: config.temperature,
    maxRetries: config.maxRetries ?? 8,
    ...(tools ? { tools: tools as any, maxSteps: config.maxSteps ?? 20 } : {}),
    ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
    ...(options?.onStepFinish ? { onStepFinish: options.onStepFinish } : {}),
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
