import { google } from "googleapis";
import { getAuthenticatedClient } from "./google-auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getGmail() {
  const auth = await getAuthenticatedClient();
  if (!auth) throw new Error("Google account not connected. Connect in Settings > Google.");
  return google.gmail({ version: "v1", auth });
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function encodeBase64Url(data: string): string {
  return Buffer.from(data).toString("base64url");
}

function getHeader(headers: { name?: string | null; value?: string | null }[], name: string): string {
  const h = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function extractBody(payload: any): string {
  // Simple text/plain or text/html body
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Multipart — find text/plain first, fall back to text/html
  if (payload.parts) {
    const textPart = payload.parts.find((p: any) => p.mimeType === "text/plain");
    if (textPart?.body?.data) return decodeBase64Url(textPart.body.data);

    const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html");
    if (htmlPart?.body?.data) return decodeBase64Url(htmlPart.body.data);

    // Nested multipart
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }

  return "";
}

function extractAttachments(payload: any): { filename: string; mimeType: string; size: number }[] {
  const attachments: { filename: string; mimeType: string; size: number }[] = [];

  function walk(parts: any[]) {
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType ?? "application/octet-stream",
          size: part.body.size ?? 0,
        });
      }
      if (part.parts) walk(part.parts);
    }
  }

  if (payload.parts) walk(payload.parts);
  return attachments;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listEmails(opts?: {
  q?: string;
  maxResults?: string;
  pageToken?: string;
}) {
  const gmail = await getGmail();
  const maxResults = Math.min(parseInt(opts?.maxResults ?? "20"), 50);

  const res = await gmail.users.messages.list({
    userId: "me",
    q: opts?.q ?? "in:inbox",
    maxResults,
    pageToken: opts?.pageToken,
  });

  const messages = res.data.messages ?? [];
  const summaries = await Promise.all(
    messages.map(async (m) => {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: m.id!,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
      });

      const headers = msg.data.payload?.headers ?? [];
      return {
        id: msg.data.id!,
        threadId: msg.data.threadId!,
        subject: getHeader(headers, "Subject"),
        from: getHeader(headers, "From"),
        to: getHeader(headers, "To"),
        date: getHeader(headers, "Date"),
        snippet: msg.data.snippet ?? "",
        labelIds: msg.data.labelIds ?? [],
        isUnread: (msg.data.labelIds ?? []).includes("UNREAD"),
      };
    }),
  );

  return {
    messages: summaries,
    nextPageToken: res.data.nextPageToken ?? null,
  };
}

export async function readEmail(messageId: string) {
  const gmail = await getGmail();
  const msg = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  if (!msg.data.payload) return null;

  const headers = msg.data.payload.headers ?? [];
  return {
    id: msg.data.id!,
    threadId: msg.data.threadId!,
    subject: getHeader(headers, "Subject"),
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    cc: getHeader(headers, "Cc"),
    bcc: getHeader(headers, "Bcc"),
    date: getHeader(headers, "Date"),
    snippet: msg.data.snippet ?? "",
    labelIds: msg.data.labelIds ?? [],
    isUnread: (msg.data.labelIds ?? []).includes("UNREAD"),
    body: extractBody(msg.data.payload),
    attachments: extractAttachments(msg.data.payload),
  };
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  threadId?: string;
}) {
  const gmail = await getGmail();
  const lines = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
  ];
  if (opts.cc) lines.push(`Cc: ${opts.cc}`);
  if (opts.bcc) lines.push(`Bcc: ${opts.bcc}`);
  if (opts.inReplyTo) {
    lines.push(`In-Reply-To: ${opts.inReplyTo}`);
    lines.push(`References: ${opts.inReplyTo}`);
  }
  lines.push("", opts.body);

  const raw = encodeBase64Url(lines.join("\r\n"));
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      threadId: opts.threadId,
    },
  });

  return { id: res.data.id, threadId: res.data.threadId };
}

export async function archiveEmail(messageId: string) {
  const gmail = await getGmail();
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      removeLabelIds: ["INBOX"],
    },
  });
}

export async function applyLabel(messageId: string, labelId: string) {
  const gmail = await getGmail();
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: [labelId],
    },
  });
}

export async function removeLabel(messageId: string, labelId: string) {
  const gmail = await getGmail();
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      removeLabelIds: [labelId],
    },
  });
}

export async function listLabels() {
  const gmail = await getGmail();
  const res = await gmail.users.labels.list({ userId: "me" });
  return (res.data.labels ?? []).map((l) => ({
    id: l.id!,
    name: l.name!,
    type: l.type!,
  }));
}
