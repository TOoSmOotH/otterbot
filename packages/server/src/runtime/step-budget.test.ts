import { describe, expect, it } from "vitest";
import { stepBudgetMessage } from "./agent-runtime.js";

describe("stepBudgetMessage", () => {
  it("returns a diagnostic when empty text ends on a tool-call step", () => {
    const msg = stepBudgetMessage("", "tool-calls", 8);
    expect(msg).not.toBeNull();
    expect(msg).toContain("8");
    // Points the user at where to raise the limit.
    expect(msg).toContain("Max steps");
  });

  it("returns null when the model produced text", () => {
    expect(stepBudgetMessage("here is the answer", "tool-calls", 8)).toBeNull();
  });

  it("returns null when the turn stopped normally with no text", () => {
    expect(stepBudgetMessage("", "stop", 8)).toBeNull();
    expect(stepBudgetMessage("", undefined, 8)).toBeNull();
  });
});
