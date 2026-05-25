import { describe, it, expect } from "vitest";
import { allowsShell, buildShellSecrets, suggestScopeForKey } from "./shell-secrets.js";
import type { ScopedSecret } from "./secrets-store.js";

function bag(entries: Array<[string, ScopedSecret]>): Map<string, ScopedSecret> {
  return new Map(entries);
}

describe("allowsShell", () => {
  it("blocks direct-scoped credentials", () => {
    expect(allowsShell("direct", new Set())).toBe(false);
    expect(allowsShell("direct", new Set(["gh-auth"]))).toBe(false);
  });

  it("always allows broad-scoped credentials", () => {
    expect(allowsShell("broad", new Set())).toBe(true);
  });

  it("allows a single-capability scope when that capability is enabled", () => {
    expect(allowsShell("cap:gh-auth", new Set(["gh-auth"]))).toBe(true);
    expect(allowsShell("cap:gh-auth", new Set(["other"]))).toBe(false);
    expect(allowsShell("cap:gh-auth", new Set())).toBe(false);
  });

  it("allows a multi-capability scope when at least one is enabled", () => {
    expect(allowsShell("cap:gh-auth,git-tools", new Set(["git-tools"]))).toBe(true);
    expect(allowsShell("cap:gh-auth,git-tools", new Set(["gh-auth", "git-tools"]))).toBe(true);
    expect(allowsShell("cap:gh-auth,git-tools", new Set(["nope"]))).toBe(false);
  });

  it("denies unrecognised scope strings (defensive default)", () => {
    expect(allowsShell("nonsense" as never, new Set(["gh-auth"]))).toBe(false);
  });
});

describe("buildShellSecrets", () => {
  const scoped = bag([
    ["GITHUB_TOKEN", { value: "ghp_abc", scope: "cap:gh-auth" }],
    ["SMTP_HOST", { value: "smtp.example.com", scope: "direct" }],
    ["MY_API_KEY", { value: "secret", scope: "broad" }],
    ["ANTHROPIC_API_KEY", { value: "sk-anth", scope: "direct" }],
  ]);

  it("returns only the credentials whose scope matches the active context", () => {
    const out = buildShellSecrets(scoped, new Set(["gh-auth"]));
    expect(out.get("GITHUB_TOKEN")).toBe("ghp_abc");
    expect(out.get("MY_API_KEY")).toBe("secret");
    expect(out.has("SMTP_HOST")).toBe(false);
    expect(out.has("ANTHROPIC_API_KEY")).toBe(false);
  });

  it("drops capability-scoped credentials whose capability is disabled", () => {
    const out = buildShellSecrets(scoped, new Set());
    expect(out.has("GITHUB_TOKEN")).toBe(false);
    expect(out.get("MY_API_KEY")).toBe("secret"); // broad still in
  });

  it("never returns direct-scoped credentials regardless of capability state", () => {
    const out = buildShellSecrets(scoped, new Set(["gh-auth", "email", "all-the-things"]));
    expect(out.has("SMTP_HOST")).toBe(false);
    expect(out.has("ANTHROPIC_API_KEY")).toBe(false);
  });
});

describe("suggestScopeForKey", () => {
  it.each([
    ["GITHUB_TOKEN", "cap:gh-auth"],
    ["GH_TOKEN", "cap:gh-auth"],
    ["github_token", "cap:gh-auth"],
    ["SMTP_HOST", "direct"],
    ["SMTP_USER", "direct"],
    ["SLACK_BOT_TOKEN", "direct"],
    ["SLACK_APP_TOKEN", "direct"],
    ["DISCORD_BOT_TOKEN", "direct"],
    ["MATRIX_ACCESS_TOKEN", "direct"],
    ["MATRIX_HOMESERVER_URL", "direct"],
    ["MY_RANDOM_KEY", "broad"],
  ])("maps %s to %s", (key, expected) => {
    expect(suggestScopeForKey(key)).toBe(expected);
  });
});
