import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestStack, type TestStack } from "../test/harness.js";
import { teamAgentId } from "./team-template.js";

/**
 * Provisioning: service agents are created on demand (not on boot), and a
 * project's team is provisioned explicitly with optional per-role model/tool
 * overrides from the wizard.
 */
describe("coding team provisioning", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await createTestStack();
  }, 30_000);

  afterAll(async () => {
    await stack.cleanup();
  });

  it("does not auto-create service agents", () => {
    expect(stack.orch.getContext("svc-proxmox")).toBeFalsy();
    expect(stack.orch.getContext("svc-ssh")).toBeFalsy();
    expect(stack.orch.listServiceAgents()).toEqual([]);
  });

  it("creates a service agent on demand, idempotently", () => {
    const a = stack.orch.createServiceAgent("proxmox");
    expect(a.id).toBe("svc-proxmox");
    expect(stack.orch.getContext("svc-proxmox")?.skills.effectiveTools().has("proxmox_list_vms")).toBe(true);
    // Idempotent — returns the same agent.
    expect(stack.orch.createServiceAgent("proxmox").id).toBe("svc-proxmox");
    expect(stack.orch.listServiceAgents().map((s) => s.id)).toContain("svc-proxmox");
  });

  it("creating a project does NOT provision a team", () => {
    const project = stack.orch.createProject("Bare");
    expect(stack.orch.getProjectTeam(project.id)).toEqual([]);
  });

  it("provisions a team with custom models and pinned tools", () => {
    const modelId = stack.orch.getGlobalSettings().defaultChatModelId;
    const project = stack.orch.createProject("Custom");
    stack.orch.provisionProjectTeam(project.id, {
      coder: { modelId, tool: "codex" }, // override the claude default
      "security-reviewer": { tool: "claude" },
    });
    const team = stack.orch.getProjectTeam(project.id);
    expect(team.map((t) => t.role).sort()).toEqual([
      "coder",
      "pm",
      "security-reviewer",
      "test-writer",
      "tester",
    ]);
    for (const { role, agentId } of team) {
      expect(agentId).toBe(teamAgentId(project.id, role));
      expect(stack.orch.getContext(agentId)).toBeTruthy();
    }
    const coder = stack.orch.getContext(stack.orch.agentForRole(project.id, "coder")!)!;
    expect(coder.shellSecrets().get("CODING_CLI_PINNED_TOOL")).toBe("codex");
    expect(coder.profile.model.chat).toBe(modelId);
    const sec = stack.orch.getContext(stack.orch.agentForRole(project.id, "security-reviewer")!)!;
    expect(sec.shellSecrets().get("CODING_CLI_PINNED_TOOL")).toBe("claude");
    // test-writer keeps its template default (opencode) when not overridden.
    const tw = stack.orch.getContext(stack.orch.agentForRole(project.id, "test-writer")!)!;
    expect(tw.shellSecrets().get("CODING_CLI_PINNED_TOOL")).toBe("opencode");
  });

  it("wires the tester to service agents that already exist", () => {
    // svc-proxmox exists (created above); svc-ssh does not.
    const project = stack.orch.createProject("Peers");
    stack.orch.provisionProjectTeam(project.id);
    const tester = stack.orch.getContext(stack.orch.agentForRole(project.id, "tester")!)!;
    const peers = tester.profile.allowedPeers.map((p) => p.agentId);
    expect(peers).toContain("svc-proxmox");
    expect(peers).not.toContain("svc-ssh");
  });

  it("wires the PM to every other agent in its team", () => {
    const project = stack.orch.createProject("PMReach");
    stack.orch.provisionProjectTeam(project.id);
    const pm = stack.orch.getContext(stack.orch.agentForRole(project.id, "pm")!)!;
    const peers = pm.profile.allowedPeers.map((p) => p.agentId).sort();
    expect(peers).toEqual(
      ["coder", "security-reviewer", "test-writer", "tester"]
        .map((role) => teamAgentId(project.id, role))
        .sort()
    );
    // The PM does not list itself as a peer.
    expect(peers).not.toContain(teamAgentId(project.id, "pm"));
  });

  it("tears down the team when the project is deleted", async () => {
    const project = stack.orch.createProject("Throwaway");
    stack.orch.provisionProjectTeam(project.id);
    const coderId = stack.orch.agentForRole(project.id, "coder")!;
    expect(stack.orch.getContext(coderId)).toBeTruthy();
    await stack.orch.deleteProject(project.id);
    expect(stack.orch.getContext(coderId)).toBeFalsy();
    expect(stack.orch.getProjectTeam(project.id)).toEqual([]);
  });
});
