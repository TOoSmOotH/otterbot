import { describe, it, expect } from "vitest";
import {
  buildCodingArgv,
  presetToArgs,
  stripAnsi,
  summarizeOutput,
  isCodingTool,
  codingLockKey,
  withCodingLock,
} from "./coding-cli.js";

describe("presetToArgs", () => {
  it("maps each tool's model + reasoning knobs to its flags", () => {
    // claude: model alias + reasoning effort
    expect(presetToArgs("claude", { model: "opus", effort: "high" })).toEqual([
      "--model",
      "opus",
      "--effort",
      "high",
    ]);
    expect(presetToArgs("claude", { model: "sonnet" })).toEqual(["--model", "sonnet"]);
    // codex: model + reasoning effort via -c TOML override
    expect(presetToArgs("codex", { model: "gpt-5", effort: "high" })).toEqual([
      "-m",
      "gpt-5",
      "-c",
      'model_reasoning_effort="high"',
    ]);
    expect(presetToArgs("codex", { effort: "medium" })).toEqual([
      "-c",
      'model_reasoning_effort="medium"',
    ]);
    // antigravity: model only, as a `--model` display name
    expect(presetToArgs("antigravity", { model: "Gemini 3.1 Pro (High)" })).toEqual([
      "--model",
      "Gemini 3.1 Pro (High)",
    ]);
    // opencode: provider/model string
    expect(presetToArgs("opencode", { providerModel: "ollama/llama3" })).toEqual([
      "-m",
      "ollama/llama3",
    ]);
  });

  it("emits no flags for an empty config", () => {
    expect(presetToArgs("claude", {})).toEqual([]);
    expect(presetToArgs("opencode", {})).toEqual([]);
  });
});

describe("buildCodingArgv", () => {
  it("builds headless argv per tool", () => {
    expect(buildCodingArgv("claude", "do it")).toEqual([
      "claude",
      "-p",
      "do it",
      "--dangerously-skip-permissions",
    ]);
    expect(buildCodingArgv("codex", "do it")).toEqual([
      "codex",
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "do it",
    ]);
    expect(buildCodingArgv("antigravity", "do it")).toEqual([
      "agy",
      "-p",
      "do it",
      "--dangerously-skip-permissions",
    ]);
    expect(buildCodingArgv("opencode", "do it")).toEqual(["opencode", "run", "do it"]);
  });

  it("threads a structured model config into the argv", () => {
    expect(
      buildCodingArgv("claude", "task", { interactive: true, model: { model: "opus", effort: "high" } })
    ).toEqual(["claude", "--model", "opus", "--effort", "high", "task", "--dangerously-skip-permissions"]);
    expect(buildCodingArgv("codex", "do it", { model: { model: "gpt-5", effort: "high" } })).toEqual([
      "codex",
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "-m",
      "gpt-5",
      "-c",
      'model_reasoning_effort="high"',
      "do it",
    ]);
    expect(
      buildCodingArgv("opencode", "do it", { model: { providerModel: "anthropic/claude-sonnet-4-6" } })
    ).toEqual(["opencode", "run", "-m", "anthropic/claude-sonnet-4-6", "do it"]);
    expect(buildCodingArgv("antigravity", "task", { interactive: true })).toEqual([
      "agy",
      "-i",
      "task",
      "--dangerously-skip-permissions",
    ]);
  });
});

describe("isCodingTool", () => {
  it("recognizes the four supported tools and nothing else", () => {
    expect(isCodingTool("claude")).toBe(true);
    expect(isCodingTool("opencode")).toBe(true);
    expect(isCodingTool("aider")).toBe(false);
  });
});

describe("stripAnsi / summarizeOutput", () => {
  it("removes color codes and cursor moves", () => {
    const raw = "\x1b[31mred\x1b[0m\x1b[2Jclean";
    expect(stripAnsi(raw)).toBe("redclean");
  });

  it("collapses carriage returns and blank runs, keeping a tail", () => {
    expect(summarizeOutput("line1\r\nline2\n\n\n\nline3")).toBe("line1\nline2\n\nline3");
    const big = "x".repeat(7000);
    const out = summarizeOutput(big, 6000);
    expect(out.startsWith("…[earlier output truncated]")).toBe(true);
    expect(out.length).toBeLessThan(6100);
  });
});

describe("withCodingLock", () => {
  it("serializes runs on the same key", async () => {
    const key = codingLockKey("agentA", "/tmp/repo");
    const order: string[] = [];
    const run = (label: string, ms: number) =>
      withCodingLock(key, async () => {
        order.push(`${label}:start`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`${label}:end`);
      });
    await Promise.all([run("first", 30), run("second", 1)]);
    // second must not start until first finishes — no interleaving.
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("runs different keys concurrently", async () => {
    const order: string[] = [];
    const run = (key: string, label: string, ms: number) =>
      withCodingLock(key, async () => {
        order.push(`${label}:start`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`${label}:end`);
      });
    await Promise.all([run("agent:a", "a", 30), run("agent:b", "b", 1)]);
    // b finishes before a since they don't share a lock.
    expect(order).toEqual(["a:start", "b:start", "b:end", "a:end"]);
  });

  it("keys by project when present, else by agent", () => {
    expect(codingLockKey("a", "/tmp/repo")).toBe("project:/tmp/repo");
    expect(codingLockKey("a", null)).toBe("agent:a");
  });
});
