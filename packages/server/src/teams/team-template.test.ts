import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestStack, type TestStack } from "../test/harness.js";
import { teamAgentId } from "./team-template.js";

/**
 * M1 provisioning: creating a project spins up the shared service agents and a
 * dedicated per-project specialist team with the right capabilities, pins, and
 * peer links.
 */
describe("coding team provisioning", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await createTestStack();
  }, 30_000);

  afterAll(async () => {
    await stack.cleanup();
  });

  it("creates shared service agents on boot/ensure", () => {
    stack.orch.ensureServiceAgents();
    expect(stack.orch.getContext("svc-proxmox")).toBeTruthy();
    expect(stack.orch.getContext("svc-ssh")).toBeTruthy();
    // Idempotent — a second call doesn't throw or duplicate.
    stack.orch.ensureServiceAgents();
  });

  it("provisions a per-project team with members, pins, and peer links", () => {
    const project = stack.orch.createProject("Demo");
    const team = stack.orch.getProjectTeam(project.id);
    const roles = team.map((t) => t.role).sort();
    expect(roles).toEqual(["coder", "pm", "security-reviewer", "test-writer", "tester"]);

    // Each specialist is an actual running agent and a member of the project.
    const members = stack.orch.listProjects().find((p) => p.id === project.id)?.members ?? [];
    for (const { role, agentId } of team) {
      expect(agentId).toBe(teamAgentId(project.id, role));
      expect(stack.orch.getContext(agentId)).toBeTruthy();
      expect(members).toContain(agentId);
    }

    // Coder is pinned to claude and has the coding-cli capability granted.
    const coderId = stack.orch.agentForRole(project.id, "coder")!;
    const coderCtx = stack.orch.getContext(coderId)!;
    expect(coderCtx.skills.effectiveTools().has("coding_cli_run")).toBe(true);
    expect(coderCtx.shellSecrets().get("CODING_CLI_PINNED_TOOL")).toBe("claude");
    expect(stack.orch.getContext(stack.orch.agentForRole(project.id, "security-reviewer")!)!
      .shellSecrets().get("CODING_CLI_PINNED_TOOL")).toBe("gemini");
    expect(stack.orch.getContext(stack.orch.agentForRole(project.id, "test-writer")!)!
      .shellSecrets().get("CODING_CLI_PINNED_TOOL")).toBe("opencode");

    // Tester delegates to the shared service agents (allowedPeers).
    const testerCtx = stack.orch.getContext(stack.orch.agentForRole(project.id, "tester")!)!;
    const peerIds = testerCtx.profile.allowedPeers.map((p) => p.agentId).sort();
    expect(peerIds).toEqual(["svc-proxmox", "svc-ssh"]);
  });

  it("tears down the team when the project is deleted", async () => {
    const project = stack.orch.createProject("Throwaway");
    const coderId = stack.orch.agentForRole(project.id, "coder")!;
    expect(stack.orch.getContext(coderId)).toBeTruthy();

    await stack.orch.deleteProject(project.id);
    expect(stack.orch.getContext(coderId)).toBeFalsy();
    expect(stack.orch.getProjectTeam(project.id)).toEqual([]);
    expect(stack.orch.listProjects().some((p) => p.id === project.id)).toBe(false);
  });
});
