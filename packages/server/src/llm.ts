import type { LanguageModelV1 } from "ai";
import { getDefaultContext, hasDefaultContext } from "./runtime/default-agent.js";
import { resolveChatModel } from "./providers/registry.js";

/**
 * @deprecated Compatibility shim for legacy single-agent code (extractor,
 * summarizer, skill-author, user-profile rebuild). Resolves the default (COO)
 * agent's chat model. New code should resolve a model from an explicit
 * `AgentContext` via `resolveChatModel`.
 */
export function llm(): LanguageModelV1 {
  const ctx = getDefaultContext();
  return resolveChatModel(ctx.chatModelRef, ctx.secrets);
}

/** Whether a default agent context is available to resolve a model from. */
export function hasLlm(): boolean {
  return hasDefaultContext();
}
