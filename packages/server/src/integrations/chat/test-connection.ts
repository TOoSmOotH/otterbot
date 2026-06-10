import { WebClient } from "@slack/web-api";
import { REST, Routes } from "discord.js";
import type { ConnCheck, ConnTestResult } from "@otterbot/shared";
import type { ChatProviderId } from "./providers.js";

/**
 * Non-destructive health checks for a chat connection — the diagnostic behind the
 * Integrations "Test" button. Validates the credential's tokens and (where the
 * platform allows) the configured channel WITHOUT sending any message or opening
 * a long-lived gateway/socket connection.
 *
 * The key value over a bare bot-token check: a bot can be silent in chat even
 * though its bot token is valid, because the inbound path (Slack Socket Mode app
 * token, channel membership) is what actually breaks. Each branch surfaces those
 * causes as individual {@link ConnCheck}s.
 */
export async function testChatConnection(
  provider: ChatProviderId,
  secrets: Map<string, string>,
  channelId: string | null
): Promise<ConnTestResult> {
  let checks: ConnCheck[];
  switch (provider) {
    case "slack":
      checks = await testSlack(secrets, channelId);
      break;
    case "discord":
      checks = await testDiscord(secrets, channelId);
      break;
    case "matrix":
      checks = await testMatrix(secrets, channelId);
      break;
    default:
      return { ok: false, checks: [], error: `unsupported chat provider: ${provider}` };
  }
  return { ok: checks.every((c) => c.ok), checks };
}

/** Normalize a Slack Web API error into its short reason string. */
function slackError(err: unknown): string {
  const e = err as { data?: { error?: string }; message?: string };
  return e.data?.error ?? e.message ?? "unknown error";
}

async function testSlack(
  secrets: Map<string, string>,
  channelId: string | null
): Promise<ConnCheck[]> {
  const checks: ConnCheck[] = [];
  const botToken = secrets.get("SLACK_BOT_TOKEN");
  const appToken = secrets.get("SLACK_APP_TOKEN");

  // 1. Bot token — can the bot authenticate / post at all.
  if (!botToken) {
    checks.push({ name: "Bot token", ok: false, error: "no SLACK_BOT_TOKEN set" });
  } else {
    try {
      const res = await new WebClient(botToken).auth.test();
      checks.push({
        name: "Bot token",
        ok: true,
        detail: `authenticated as ${res.user ?? "?"} in ${res.team ?? "?"}`,
      });
    } catch (err) {
      checks.push({ name: "Bot token", ok: false, error: slackError(err) });
    }
  }

  // 2. App-level / Socket Mode token — the inbound path. Without a valid xapp
  // token (and connections:write) the bot never receives messages, so it stays
  // silent even with a perfect bot token. apps.connections.open validates it and
  // returns a WSS URL we deliberately do NOT connect to.
  if (!appToken) {
    checks.push({
      name: "Socket Mode token",
      ok: false,
      error: "no SLACK_APP_TOKEN set — the bot can't receive messages",
    });
  } else {
    try {
      await new WebClient(appToken).apps.connections.open();
      checks.push({
        name: "Socket Mode token",
        ok: true,
        detail: "app token is valid for Socket Mode (inbound events)",
      });
    } catch (err) {
      checks.push({ name: "Socket Mode token", ok: false, error: slackError(err) });
    }
  }

  // 3. Channel — exists and the bot is a member (so it can post). Membership is
  // the other common cause of a silent bot.
  if (channelId && botToken) {
    try {
      const res = await new WebClient(botToken).conversations.info({ channel: channelId });
      const ch = res.channel as { name?: string; is_member?: boolean } | undefined;
      const member = ch?.is_member ?? false;
      checks.push({
        name: "Channel",
        ok: member,
        detail: member
          ? `bot is a member of #${ch?.name ?? channelId}`
          : `found #${ch?.name ?? channelId}, but the bot is NOT in it — invite the bot to the channel`,
        error: member ? undefined : "bot is not a member of the channel",
      });
    } catch (err) {
      checks.push({ name: "Channel", ok: false, error: slackError(err) });
    }
  } else if (!channelId) {
    checks.push({ name: "Channel", ok: false, error: "no channel ID configured" });
  }

  return checks;
}

async function testDiscord(
  secrets: Map<string, string>,
  channelId: string | null
): Promise<ConnCheck[]> {
  const checks: ConnCheck[] = [];
  const botToken = secrets.get("DISCORD_BOT_TOKEN");
  if (!botToken) {
    checks.push({ name: "Bot token", ok: false, error: "no DISCORD_BOT_TOKEN set" });
    return checks;
  }

  // REST-only validation: GET /users/@me confirms the token without opening the
  // (privileged) gateway connection the live client uses.
  const rest = new REST({ version: "10" }).setToken(botToken);
  try {
    const me = (await rest.get(Routes.user())) as { username?: string; discriminator?: string };
    const tag = me.discriminator && me.discriminator !== "0"
      ? `${me.username}#${me.discriminator}`
      : (me.username ?? "?");
    checks.push({ name: "Bot token", ok: true, detail: `authenticated as ${tag}` });
  } catch (err) {
    checks.push({ name: "Bot token", ok: false, error: discordError(err) });
    return checks; // a bad token makes the channel check meaningless
  }

  // Channel — the bot can see it (GET /channels/:id). A 403/10003 means the bot
  // isn't in the guild or lacks access.
  if (channelId) {
    try {
      const ch = (await rest.get(Routes.channel(channelId))) as { name?: string; type?: number };
      checks.push({
        name: "Channel",
        ok: true,
        detail: `bot can see #${ch.name ?? channelId}`,
      });
    } catch (err) {
      checks.push({ name: "Channel", ok: false, error: discordError(err) });
    }
  } else {
    checks.push({ name: "Channel", ok: false, error: "no channel ID configured" });
  }

  // The Message Content intent can't be verified without a gateway connection;
  // call it out so a missing intent isn't mistaken for a passing test.
  checks.push({
    name: "Message Content intent",
    ok: true,
    detail:
      "can't be verified without connecting — ensure it's enabled in the Discord Developer Portal if the bot can't read messages",
  });

  return checks;
}

/** Normalize a discord.js REST error (DiscordAPIError or HTTPError) to a string. */
function discordError(err: unknown): string {
  const e = err as { rawError?: { message?: string }; message?: string; status?: number };
  return e.rawError?.message ?? e.message ?? (e.status ? `HTTP ${e.status}` : "unknown error");
}

async function testMatrix(
  secrets: Map<string, string>,
  roomId: string | null
): Promise<ConnCheck[]> {
  const checks: ConnCheck[] = [];
  const homeserver = secrets.get("MATRIX_HOMESERVER_URL");
  const token = secrets.get("MATRIX_ACCESS_TOKEN");
  if (!homeserver) {
    checks.push({ name: "Homeserver", ok: false, error: "no MATRIX_HOMESERVER_URL set" });
    return checks;
  }
  const base = homeserver.replace(/\/+$/, "");

  // 1. Homeserver reachable + speaks the Matrix client API.
  try {
    const res = await fetch(`${base}/_matrix/client/versions`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    checks.push({ name: "Homeserver", ok: true, detail: `reachable at ${base}` });
  } catch (err) {
    checks.push({
      name: "Homeserver",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    return checks;
  }

  // Credentials are a login (user + password); the connector mints a dedicated
  // device on first connect. We deliberately don't log in here (it would mint a
  // device on every test click), so full credential validation happens then.
  if (!token) {
    checks.push({
      name: "Credentials",
      ok: true,
      detail: "verified on first connect — login mints a dedicated device, so it's not done on a test click",
    });
    return checks;
  }

  // 2. If a token was already minted, validate it and the room membership.
  let userId = "";
  try {
    const res = await fetch(`${base}/_matrix/client/v3/account/whoami`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as { user_id?: string; error?: string };
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    userId = body.user_id ?? "";
    checks.push({ name: "Access token", ok: true, detail: `authenticated as ${userId || "?"}` });
  } catch (err) {
    checks.push({
      name: "Access token",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    return checks;
  }

  if (roomId) {
    try {
      const res = await fetch(`${base}/_matrix/client/v3/joined_rooms`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = (await res.json().catch(() => ({}))) as { joined_rooms?: string[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const joined = (body.joined_rooms ?? []).includes(roomId);
      checks.push({
        name: "Room",
        ok: joined,
        detail: joined ? `bot has joined ${roomId}` : `bot has NOT joined ${roomId} — invite it to the room`,
        error: joined ? undefined : "bot is not in the room",
      });
    } catch (err) {
      checks.push({
        name: "Room",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    checks.push({ name: "Room", ok: false, error: "no room ID configured" });
  }

  return checks;
}
