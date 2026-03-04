import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createTransport } from "nodemailer";
import type { EmailSummary, EmailDetail } from "@otterbot/shared";
import type { EmailConnectionConfig } from "./email-settings.js";

// ---------------------------------------------------------------------------
// Singleton IMAP connection
// ---------------------------------------------------------------------------

let imapClient: ImapFlow | null = null;
let currentConfig: EmailConnectionConfig | null = null;

export async function connectImap(config: EmailConnectionConfig): Promise<void> {
  await disconnectImap();
  currentConfig = config;
  imapClient = new ImapFlow({
    host: config.imapServer,
    port: config.imapPort,
    secure: config.imapTls,
    auth: {
      user: config.username,
      pass: config.password,
    },
    logger: false,
  });
  await imapClient.connect();
}

export async function disconnectImap(): Promise<void> {
  if (imapClient) {
    try { await imapClient.logout(); } catch { /* ignore */ }
    imapClient = null;
  }
  currentConfig = null;
}

function ensureConfig(): EmailConnectionConfig {
  if (!currentConfig) {
    throw new Error("Email not configured. Set up IMAP/SMTP in Settings > Email.");
  }
  return currentConfig;
}

async function getImapClient(): Promise<ImapFlow> {
  const config = ensureConfig();
  // Reconnect if the client was dropped
  if (!imapClient || imapClient.usable === false) {
    imapClient = new ImapFlow({
      host: config.imapServer,
      port: config.imapPort,
      secure: config.imapTls,
      auth: {
        user: config.username,
        pass: config.password,
      },
      logger: false,
    });
    await imapClient.connect();
  }
  return imapClient;
}

// ---------------------------------------------------------------------------
// List emails
// ---------------------------------------------------------------------------

export async function listEmails(opts?: {
  q?: string;
  maxResults?: string;
  pageToken?: string;
}): Promise<{ messages: EmailSummary[]; nextPageToken: string | null }> {
  const client = await getImapClient();
  const maxResults = Math.min(parseInt(opts?.maxResults ?? "20", 10), 50);
  const offset = opts?.pageToken ? parseInt(opts.pageToken, 10) : 0;

  const lock = await client.getMailboxLock("INBOX");
  try {
    const status = await client.status("INBOX", { messages: true });
    const total = status.messages ?? 0;
    if (total === 0) {
      return { messages: [], nextPageToken: null };
    }

    // IMAP sequence numbers: 1 = oldest, total = newest
    // We want newest first, so start from (total - offset) going down
    const start = Math.max(total - offset - maxResults + 1, 1);
    const end = Math.max(total - offset, 1);
    if (start > end) {
      return { messages: [], nextPageToken: null };
    }

    const range = `${start}:${end}`;
    const summaries: EmailSummary[] = [];

    for await (const msg of client.fetch(range, {
      envelope: true,
      flags: true,
      bodyStructure: true,
      source: { start: 0, maxLength: 512 }, // partial body for snippet
    })) {
      const env = msg.envelope!;
      const fromAddr = env.from?.[0];
      const toAddr = env.to?.[0];
      const fromStr = fromAddr
        ? fromAddr.name
          ? `${fromAddr.name} <${fromAddr.address}>`
          : fromAddr.address ?? ""
        : "";
      const toStr = toAddr
        ? toAddr.name
          ? `${toAddr.name} <${toAddr.address}>`
          : toAddr.address ?? ""
        : "";

      // Generate snippet from partial source
      let snippet = "";
      if (msg.source) {
        const text = msg.source.toString("utf-8");
        // Try to extract text after the header separator
        const bodyStart = text.indexOf("\r\n\r\n");
        if (bodyStart !== -1) {
          snippet = text
            .slice(bodyStart + 4, bodyStart + 204)
            .replace(/\r?\n/g, " ")
            .trim();
        }
      }

      summaries.push({
        id: String(msg.uid),
        threadId: env.messageId ?? String(msg.uid),
        subject: env.subject ?? "",
        from: fromStr,
        to: toStr,
        date: env.date?.toISOString() ?? "",
        snippet,
        labelIds: Array.from(msg.flags ?? []),
        isUnread: !msg.flags?.has("\\Seen"),
      });
    }

    // Sort newest first
    summaries.reverse();

    const nextOffset = offset + maxResults;
    const nextPageToken = nextOffset < total ? String(nextOffset) : null;

    return { messages: summaries, nextPageToken };
  } finally {
    lock.release();
  }
}

// ---------------------------------------------------------------------------
// Read single email
// ---------------------------------------------------------------------------

export async function readEmail(id: string): Promise<EmailDetail | null> {
  const client = await getImapClient();
  const uid = parseInt(id, 10);

  const lock = await client.getMailboxLock("INBOX");
  try {
    const msg = await client.fetchOne(String(uid), {
      envelope: true,
      flags: true,
      source: true,
    }, { uid: true });

    if (!msg) return null;

    const env = msg.envelope!;
    const fromAddr = env.from?.[0];
    const ccAddrs = env.cc ?? [];
    const bccAddrs = env.bcc ?? [];

    const formatAddr = (a: { name?: string; address?: string }) =>
      a.name ? `${a.name} <${a.address}>` : a.address ?? "";

    const fromStr = fromAddr ? formatAddr(fromAddr) : "";
    const toStr = env.to?.map(formatAddr).join(", ") ?? "";
    const ccStr = ccAddrs.map(formatAddr).join(", ");
    const bccStr = bccAddrs.map(formatAddr).join(", ");

    // Parse the full message source with mailparser
    let body = "";
    const attachments: { filename: string; mimeType: string; size: number }[] = [];

    if (msg.source) {
      const parsed = await simpleParser(msg.source);
      body = parsed.text ?? (typeof parsed.html === "string" ? parsed.html : "");
      for (const att of parsed.attachments ?? []) {
        attachments.push({
          filename: att.filename ?? "attachment",
          mimeType: att.contentType ?? "application/octet-stream",
          size: att.size ?? 0,
        });
      }
    }

    return {
      id: String(msg.uid),
      threadId: env.messageId ?? String(msg.uid),
      subject: env.subject ?? "",
      from: fromStr,
      to: toStr,
      cc: ccStr,
      bcc: bccStr,
      date: env.date?.toISOString() ?? "",
      snippet: body.slice(0, 200).replace(/\r?\n/g, " ").trim(),
      labelIds: Array.from(msg.flags ?? []),
      isUnread: !msg.flags?.has("\\Seen"),
      body,
      attachments,
    };
  } finally {
    lock.release();
  }
}

// ---------------------------------------------------------------------------
// Send email via SMTP
// ---------------------------------------------------------------------------

export async function sendEmail(
  config: EmailConnectionConfig,
  opts: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    inReplyTo?: string;
    threadId?: string;
  },
): Promise<{ id: string; threadId: string }> {
  const transport = createTransport({
    host: config.smtpServer,
    port: config.smtpPort,
    secure: config.smtpTls && config.smtpPort === 465,
    auth: {
      user: config.username,
      pass: config.password,
    },
    ...(config.smtpTls && config.smtpPort !== 465 ? { tls: { rejectUnauthorized: true } } : {}),
  });

  const fromAddress = config.fromName
    ? `${config.fromName} <${config.username}>`
    : config.username;

  const mailOpts: Record<string, unknown> = {
    from: fromAddress,
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
  };
  if (opts.cc) mailOpts.cc = opts.cc;
  if (opts.bcc) mailOpts.bcc = opts.bcc;
  if (opts.inReplyTo) {
    mailOpts.inReplyTo = opts.inReplyTo;
    mailOpts.references = opts.inReplyTo;
  }

  const info = await transport.sendMail(mailOpts);
  return {
    id: info.messageId ?? "",
    threadId: opts.threadId ?? info.messageId ?? "",
  };
}

// ---------------------------------------------------------------------------
// Archive email (move to Archive or All Mail folder)
// ---------------------------------------------------------------------------

export async function archiveEmail(id: string): Promise<void> {
  const client = await getImapClient();
  const uid = parseInt(id, 10);

  const lock = await client.getMailboxLock("INBOX");
  try {
    // Try common archive folder names
    const archiveFolders = ["Archive", "[Gmail]/All Mail", "All Mail", "INBOX.Archive"];
    let targetFolder: string | null = null;

    const folders = await client.list();
    for (const candidate of archiveFolders) {
      if (folders.some((f) => f.path === candidate)) {
        targetFolder = candidate;
        break;
      }
    }

    if (targetFolder) {
      await client.messageMove(String(uid), targetFolder, { uid: true });
    } else {
      // No archive folder found — just mark as read and remove from inbox
      await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
    }
  } finally {
    lock.release();
  }
}

// ---------------------------------------------------------------------------
// Connection testing
// ---------------------------------------------------------------------------

export async function testImapConnection(config: EmailConnectionConfig): Promise<void> {
  const client = new ImapFlow({
    host: config.imapServer,
    port: config.imapPort,
    secure: config.imapTls,
    auth: {
      user: config.username,
      pass: config.password,
    },
    logger: false,
  });
  try {
    await client.connect();
    await client.logout();
  } catch (err) {
    try { await client.logout(); } catch { /* ignore */ }
    throw err;
  }
}

export async function testSmtpConnection(config: EmailConnectionConfig): Promise<void> {
  const transport = createTransport({
    host: config.smtpServer,
    port: config.smtpPort,
    secure: config.smtpTls && config.smtpPort === 465,
    auth: {
      user: config.username,
      pass: config.password,
    },
    ...(config.smtpTls && config.smtpPort !== 465 ? { tls: { rejectUnauthorized: true } } : {}),
  });
  await transport.verify();
}

// ---------------------------------------------------------------------------
// Lifecycle helpers (called from server init)
// ---------------------------------------------------------------------------

export async function startEmailConnection(config: EmailConnectionConfig): Promise<void> {
  await connectImap(config);
}

export async function stopEmailConnection(): Promise<void> {
  await disconnectImap();
}
