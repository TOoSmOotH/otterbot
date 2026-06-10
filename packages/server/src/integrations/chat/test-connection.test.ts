import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Exercises the Slack branch of {@link testChatConnection} without touching the
 * network. A fake `@slack/web-api` WebClient lets each test drive the three
 * probes (auth.test, apps.connections.open, conversations.info) so we can assert
 * the `checks[]` shape for a healthy bot, a bad Socket Mode token, and a bot
 * that's authenticated but not in the channel — the two silent-bot causes the
 * feature exists to surface.
 */

// Per-test handlers the fake WebClient delegates to. A handler may return a
// value or throw a Slack-style error ({ data: { error } }).
let authTest: () => unknown;
let connectionsOpen: () => unknown;
let conversationsInfo: (args: { channel: string }) => unknown;

vi.mock("@slack/web-api", () => ({
  WebClient: class {
    auth = { test: () => Promise.resolve(authTest()) };
    apps = { connections: { open: () => Promise.resolve(connectionsOpen()) } };
    conversations = { info: (args: { channel: string }) => Promise.resolve(conversationsInfo(args)) };
  },
}));

// discord.js is imported by the module under test; stub it so the import is cheap
// and never reaches the network (these tests only cover the Slack branch).
vi.mock("discord.js", () => ({
  REST: class {
    setToken() {
      return this;
    }
    get() {
      return Promise.resolve({});
    }
  },
  Routes: { user: () => "/users/@me", channel: (id: string) => `/channels/${id}` },
}));

const { testChatConnection } = await import("./test-connection.js");

function slackErr(code: string) {
  return () => {
    throw { data: { error: code } };
  };
}

describe("testChatConnection — slack", () => {
  beforeEach(() => {
    authTest = () => ({ user: "otterbot", team: "Acme" });
    connectionsOpen = () => ({ url: "wss://example" });
    conversationsInfo = () => ({ channel: { name: "general", is_member: true } });
  });

  it("passes when bot token, app token, and channel membership are all good", async () => {
    const secrets = new Map([
      ["SLACK_BOT_TOKEN", "xoxb-good"],
      ["SLACK_APP_TOKEN", "xapp-good"],
    ]);
    const res = await testChatConnection("slack", secrets, "C123");
    expect(res.ok).toBe(true);
    expect(res.checks.map((c) => c.name)).toEqual(["Bot token", "Socket Mode token", "Channel"]);
    expect(res.checks.every((c) => c.ok)).toBe(true);
  });

  it("fails the Socket Mode check when the app token is rejected", async () => {
    connectionsOpen = slackErr("invalid_auth");
    const secrets = new Map([
      ["SLACK_BOT_TOKEN", "xoxb-good"],
      ["SLACK_APP_TOKEN", "xapp-bad"],
    ]);
    const res = await testChatConnection("slack", secrets, "C123");
    expect(res.ok).toBe(false);
    const socket = res.checks.find((c) => c.name === "Socket Mode token");
    expect(socket?.ok).toBe(false);
    expect(socket?.error).toBe("invalid_auth");
    // The bot token check still passes — proving the failure is isolated.
    expect(res.checks.find((c) => c.name === "Bot token")?.ok).toBe(true);
  });

  it("flags when the bot is authenticated but not a member of the channel", async () => {
    conversationsInfo = () => ({ channel: { name: "general", is_member: false } });
    const secrets = new Map([
      ["SLACK_BOT_TOKEN", "xoxb-good"],
      ["SLACK_APP_TOKEN", "xapp-good"],
    ]);
    const res = await testChatConnection("slack", secrets, "C123");
    expect(res.ok).toBe(false);
    const channel = res.checks.find((c) => c.name === "Channel");
    expect(channel?.ok).toBe(false);
    expect(channel?.detail).toMatch(/NOT in it/i);
  });

  it("fails fast when the app token is missing entirely", async () => {
    const secrets = new Map([["SLACK_BOT_TOKEN", "xoxb-good"]]);
    const res = await testChatConnection("slack", secrets, "C123");
    expect(res.ok).toBe(false);
    const socket = res.checks.find((c) => c.name === "Socket Mode token");
    expect(socket?.ok).toBe(false);
    expect(socket?.error).toMatch(/no SLACK_APP_TOKEN/);
  });
});
