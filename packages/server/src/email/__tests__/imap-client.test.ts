import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock ImapFlow
// ---------------------------------------------------------------------------

interface MockMailbox {
  path: string;
  name: string;
  specialUse?: string;
  status?: { messages?: number; unseen?: number };
}

const mockMailboxes: MockMailbox[] = [];
let mockMessages: Array<{
  uid: number;
  envelope: Record<string, unknown>;
  flags: Set<string>;
  source?: Buffer;
  bodyStructure?: Record<string, unknown>;
}> = [];

let mockStatusResult: { messages?: number } = { messages: 0 };
let lockMailbox: string | undefined;
let statusMailbox: string | undefined;

const mockRelease = vi.fn();

const mockImapClient = {
  usable: true,
  connect: vi.fn(),
  logout: vi.fn(),
  on: vi.fn(),
  list: vi.fn(async () => mockMailboxes),
  getMailboxLock: vi.fn(async (mailbox: string) => {
    lockMailbox = mailbox;
    return { release: mockRelease };
  }),
  status: vi.fn(async (mailbox: string) => {
    statusMailbox = mailbox;
    return mockStatusResult;
  }),
  fetch: vi.fn(function* () {
    for (const msg of mockMessages) {
      yield msg;
    }
  }),
  fetchOne: vi.fn(async (uid: string) => {
    return mockMessages.find((m) => String(m.uid) === uid) ?? null;
  }),
};

vi.mock("imapflow", () => ({
  ImapFlow: class {
    constructor() {
      return mockImapClient;
    }
  },
}));

vi.mock("mailparser", () => ({
  simpleParser: vi.fn(async (source: Buffer) => ({
    text: source.toString("utf-8").replace(/.*\r\n\r\n/s, ""),
    attachments: [],
  })),
}));

vi.mock("nodemailer", () => ({
  createTransport: vi.fn(),
}));

// We need to mock the email-settings to provide a config
vi.mock("../email-settings.js", () => ({
  getEmailConnectionConfig: vi.fn(() => null),
}));

// Import after mocking
const {
  listFolders,
  listEmails,
  readEmail,
  connectImap,
} = await import("../imap-client.js");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("imap-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMailboxes.length = 0;
    mockMessages = [];
    mockStatusResult = { messages: 0 };
    lockMailbox = undefined;
    statusMailbox = undefined;
    mockImapClient.usable = true;
  });

  // Connect once so ensureConfig doesn't throw
  beforeEach(async () => {
    await connectImap({
      imapServer: "imap.example.com",
      imapPort: 993,
      imapTls: true,
      smtpServer: "smtp.example.com",
      smtpPort: 587,
      smtpTls: true,
      username: "user@example.com",
      password: "password",
    });
  });

  // -------------------------------------------------------------------------
  // listFolders
  // -------------------------------------------------------------------------

  describe("listFolders", () => {
    it("returns folders from IMAP server", async () => {
      mockMailboxes.push(
        { path: "INBOX", name: "INBOX", specialUse: "\\Inbox", status: { messages: 10, unseen: 3 } },
        { path: "Sent", name: "Sent", specialUse: "\\Sent", status: { messages: 50, unseen: 0 } },
      );

      const folders = await listFolders();

      expect(folders).toHaveLength(2);
      expect(folders[0]).toEqual({
        path: "INBOX",
        name: "INBOX",
        specialUse: "\\Inbox",
        totalMessages: 10,
        unseenMessages: 3,
      });
      expect(folders[1]).toEqual({
        path: "Sent",
        name: "Sent",
        specialUse: "\\Sent",
        totalMessages: 50,
        unseenMessages: 0,
      });
    });

    it("sorts special-use folders first in defined order", async () => {
      mockMailboxes.push(
        { path: "Custom", name: "Custom", status: { messages: 5, unseen: 0 } },
        { path: "Trash", name: "Trash", specialUse: "\\Trash", status: { messages: 2, unseen: 0 } },
        { path: "INBOX", name: "INBOX", specialUse: "\\Inbox", status: { messages: 10, unseen: 1 } },
        { path: "Drafts", name: "Drafts", specialUse: "\\Drafts", status: { messages: 3, unseen: 0 } },
        { path: "Sent", name: "Sent", specialUse: "\\Sent", status: { messages: 20, unseen: 0 } },
      );

      const folders = await listFolders();

      expect(folders.map((f) => f.path)).toEqual([
        "INBOX",  // \Inbox
        "Sent",   // \Sent
        "Drafts", // \Drafts
        "Trash",  // \Trash
        "Custom", // alphabetical
      ]);
    });

    it("sorts non-special folders alphabetically", async () => {
      mockMailboxes.push(
        { path: "Zebra", name: "Zebra", status: { messages: 1, unseen: 0 } },
        { path: "Alpha", name: "Alpha", status: { messages: 2, unseen: 0 } },
        { path: "Mango", name: "Mango", status: { messages: 3, unseen: 0 } },
      );

      const folders = await listFolders();
      expect(folders.map((f) => f.path)).toEqual(["Alpha", "Mango", "Zebra"]);
    });

    it("handles folders with no status", async () => {
      mockMailboxes.push(
        { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
      );

      const folders = await listFolders();
      expect(folders[0]!.totalMessages).toBe(0);
      expect(folders[0]!.unseenMessages).toBe(0);
    });

    it("handles empty folder list", async () => {
      const folders = await listFolders();
      expect(folders).toEqual([]);
    });

    it("passes statusQuery to client.list", async () => {
      await listFolders();
      expect(mockImapClient.list).toHaveBeenCalledWith({
        statusQuery: { messages: true, unseen: true },
      });
    });
  });

  // -------------------------------------------------------------------------
  // listEmails — folder parameter
  // -------------------------------------------------------------------------

  describe("listEmails", () => {
    it("defaults to INBOX when no folder specified", async () => {
      await listEmails();

      expect(lockMailbox).toBe("INBOX");
      expect(statusMailbox).toBe("INBOX");
    });

    it("uses specified folder for mailbox lock and status", async () => {
      await listEmails({ folder: "Sent" });

      expect(lockMailbox).toBe("Sent");
      expect(statusMailbox).toBe("Sent");
    });

    it("uses folder with nested path", async () => {
      await listEmails({ folder: "[Gmail]/All Mail" });

      expect(lockMailbox).toBe("[Gmail]/All Mail");
      expect(statusMailbox).toBe("[Gmail]/All Mail");
    });

    it("returns empty array when folder is empty", async () => {
      mockStatusResult = { messages: 0 };

      const result = await listEmails({ folder: "Drafts" });

      expect(result.messages).toEqual([]);
      expect(result.nextPageToken).toBeNull();
    });

    it("returns messages from the folder", async () => {
      mockStatusResult = { messages: 1 };
      mockMessages = [{
        uid: 42,
        envelope: {
          from: [{ name: "Alice", address: "alice@example.com" }],
          to: [{ address: "bob@example.com" }],
          subject: "Hello from Sent",
          date: new Date("2026-01-01"),
          messageId: "<msg-42@example.com>",
        },
        flags: new Set(["\\Seen"]),
        source: Buffer.from("Subject: Hello\r\n\r\nHello body"),
      }];

      const result = await listEmails({ folder: "Sent" });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]!.subject).toBe("Hello from Sent");
      expect(result.messages[0]!.isUnread).toBe(false);
    });

    it("releases the lock even on error", async () => {
      mockImapClient.status.mockRejectedValueOnce(new Error("fail"));

      await expect(listEmails({ folder: "INBOX" })).rejects.toThrow("fail");
      expect(mockRelease).toHaveBeenCalled();
    });

    it("computes pagination correctly", async () => {
      mockStatusResult = { messages: 30 };
      mockMessages = [];

      const result = await listEmails({ maxResults: "10" });

      expect(result.nextPageToken).toBe("10");
    });
  });

  // -------------------------------------------------------------------------
  // readEmail — folder parameter
  // -------------------------------------------------------------------------

  describe("readEmail", () => {
    it("defaults to INBOX when no folder specified", async () => {
      mockMessages = [{
        uid: 1,
        envelope: {
          from: [{ name: "Alice", address: "alice@example.com" }],
          to: [{ address: "bob@example.com" }],
          subject: "Test",
          date: new Date("2026-01-01"),
          messageId: "<msg-1@example.com>",
        },
        flags: new Set(),
        source: Buffer.from("Subject: Test\r\n\r\nTest body"),
      }];

      await readEmail("1");

      expect(lockMailbox).toBe("INBOX");
    });

    it("uses specified folder for mailbox lock", async () => {
      mockMessages = [{
        uid: 5,
        envelope: {
          from: [{ address: "sender@example.com" }],
          to: [{ address: "me@example.com" }],
          subject: "Sent item",
          date: new Date("2026-01-01"),
          messageId: "<msg-5@example.com>",
        },
        flags: new Set(["\\Seen"]),
        source: Buffer.from("Subject: Sent\r\n\r\nSent body"),
      }];

      const email = await readEmail("5", "Sent");

      expect(lockMailbox).toBe("Sent");
      expect(email).not.toBeNull();
      expect(email!.subject).toBe("Sent item");
    });

    it("uses nested folder paths", async () => {
      mockMessages = [{
        uid: 10,
        envelope: {
          from: [{ address: "a@b.com" }],
          to: [{ address: "c@d.com" }],
          subject: "Archived",
          date: new Date("2026-01-01"),
          messageId: "<msg-10@b.com>",
        },
        flags: new Set(["\\Seen"]),
        source: Buffer.from("Subject: Archived\r\n\r\nArchived body"),
      }];

      await readEmail("10", "[Gmail]/All Mail");

      expect(lockMailbox).toBe("[Gmail]/All Mail");
    });

    it("returns null when message not found", async () => {
      mockMessages = [];
      mockImapClient.fetchOne.mockResolvedValueOnce(null);

      const email = await readEmail("999", "Trash");

      expect(email).toBeNull();
      expect(lockMailbox).toBe("Trash");
    });

    it("releases the lock even on error", async () => {
      mockImapClient.fetchOne.mockRejectedValueOnce(new Error("fetch error"));

      await expect(readEmail("1", "Drafts")).rejects.toThrow("fetch error");
      expect(mockRelease).toHaveBeenCalled();
    });
  });
});
