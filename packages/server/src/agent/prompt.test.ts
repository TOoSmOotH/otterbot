import { describe, expect, it } from "vitest";
import type { AgentContext } from "../runtime/agent-context.js";
import { buildSystemPrompt } from "./prompt.js";

/**
 * A minimal stub context exercising only the members buildSystemPrompt reads:
 * profile.persona, memory.searchContent, skills.{listEnabled,get,recordUse},
 * userProfile.renderForPrompt, secrets, and the new projectRules thunk.
 */
function makeCtx(opts: { projectRules: string | null }): AgentContext {
  return {
    profile: { persona: "You are a helpful agent." },
    secrets: new Map<string, string>(),
    memory: { searchContent: async () => [] },
    skills: { listEnabled: () => [], get: () => null, recordUse: () => {} },
    userProfile: { renderForPrompt: () => "" },
    projectRepoPath: () => null,
    projectRules: () => opts.projectRules,
  } as unknown as AgentContext;
}

describe("buildSystemPrompt — project rules", () => {
  it("injects a Project rules section when the agent's project has rules", async () => {
    const ctx = makeCtx({ projectRules: "Always commit to dev." });
    const { system } = await buildSystemPrompt(ctx, { userMessage: "hi" });
    expect(system).toContain("## Project rules");
    expect(system).toContain("Always commit to dev.");
  });

  it("omits the section when there are no rules", async () => {
    const ctx = makeCtx({ projectRules: null });
    const { system } = await buildSystemPrompt(ctx, { userMessage: "hi" });
    expect(system).not.toContain("## Project rules");
  });

  it("omits the section when rules are only whitespace", async () => {
    const ctx = makeCtx({ projectRules: "   \n  " });
    const { system } = await buildSystemPrompt(ctx, { userMessage: "hi" });
    expect(system).not.toContain("## Project rules");
  });
});
