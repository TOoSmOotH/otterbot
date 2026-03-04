import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRole, MessageType, type BusMessage } from "@otterbot/shared";
import { migrateDb, resetDb } from "../../db/index.js";

vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn(() => null),
  setConfig: vi.fn(),
  deleteConfig: vi.fn(),
}));

import { COO } from "../coo.js";

function createMockBus() {
  return {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    send: vi.fn((msg) => ({
      id: "msg-1",
      ...msg,
      timestamp: new Date().toISOString(),
    })),
    getHistory: vi.fn(() => ({ messages: [], hasMore: false })),
    request: vi.fn(),
    onBroadcast: vi.fn(),
    offBroadcast: vi.fn(),
  };
}

function createCoo(mockBus: ReturnType<typeof createMockBus>) {
  const workspace = {
    repoPath: vi.fn(() => "/tmp/repo"),
    projectPath: vi.fn(() => "/tmp/project"),
  };

  return new COO({
    bus: mockBus as any,
    workspace: workspace as any,
  });
}

function createChatMessage(content: string, metadata: Record<string, unknown>): BusMessage {
  return {
    id: "in-1",
    fromAgentId: null,
    toAgentId: "coo",
    type: MessageType.Chat,
    content,
    metadata,
    conversationId: "conv-1",
    timestamp: new Date().toISOString(),
  };
}

describe("COO chat attachments", () => {
  let tmpDir: string;
  let uploadsDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-coo-attachments-"));
    uploadsDir = join(tmpDir, "data", "uploads");
    mkdirSync(uploadsDir, { recursive: true });

    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    process.env.WORKSPACE_ROOT = tmpDir;
    await migrateDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    delete process.env.WORKSPACE_ROOT;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds imageParts from image attachments and passes them to think", async () => {
    writeFileSync(join(uploadsDir, "img.png"), "fake-image");
    const bus = createMockBus();
    const coo = createCoo(bus);

    const thinkSpy = vi
      .spyOn(coo as any, "think")
      .mockResolvedValue({ text: "ok", thinking: undefined, hadToolCalls: false });

    await coo.handleMessage(
      createChatMessage("Describe this image", {
        attachments: [
          {
            id: "att-1",
            filename: "img.png",
            mimeType: "image/png",
            size: 10,
            url: "/uploads/img.png",
          },
        ],
      }),
    );

    expect(thinkSpy).toHaveBeenCalledTimes(1);
    const options = thinkSpy.mock.calls[0][4];
    expect(options).toBeDefined();
    expect(options.imageParts).toHaveLength(1);
    expect(options.imageParts[0].type).toBe("image");
    expect(String(options.imageParts[0].image)).toContain("data:image/png;base64,");

    coo.destroy();
  });

  it("does not pass imageParts when attachments are non-image", async () => {
    const bus = createMockBus();
    const coo = createCoo(bus);

    const thinkSpy = vi
      .spyOn(coo as any, "think")
      .mockResolvedValue({ text: "ok", thinking: undefined, hadToolCalls: false });

    await coo.handleMessage(
      createChatMessage("Read this pdf", {
        attachments: [
          {
            id: "att-2",
            filename: "doc.pdf",
            mimeType: "application/pdf",
            size: 100,
            url: "/uploads/doc.pdf",
          },
        ],
      }),
    );

    expect(thinkSpy).toHaveBeenCalledTimes(1);
    expect(thinkSpy.mock.calls[0][4]).toBeUndefined();

    coo.destroy();
  });

  it("caps image attachments at five and strips image payloads from conversation history", async () => {
    for (let i = 1; i <= 6; i++) {
      writeFileSync(join(uploadsDir, `img-${i}.png`), `img-${i}`);
    }

    const bus = createMockBus();
    const coo = createCoo(bus);

    const thinkSpy = vi
      .spyOn(coo as any, "think")
      .mockImplementation(async (_msg: string, _a: unknown, _b: unknown, _c: unknown, options?: { imageParts?: Array<{ type: "image"; image: URL }> }) => {
        (coo as any).conversationHistory.push({
          role: "user",
          content: [
            { type: "text", text: "Analyze all images" },
            ...(options?.imageParts ?? []),
          ],
        });
        return { text: "done", thinking: undefined, hadToolCalls: false };
      });

    await coo.handleMessage(
      createChatMessage("Analyze all images", {
        attachments: Array.from({ length: 6 }, (_, i) => ({
          id: `att-${i + 1}`,
          filename: `img-${i + 1}.png`,
          mimeType: "image/png",
          size: 10,
          url: `/uploads/img-${i + 1}.png`,
        })),
      }),
    );

    const options = thinkSpy.mock.calls[0][4];
    expect(options).toBeDefined();
    expect(options.imageParts).toHaveLength(5);

    const history = (coo as any).conversationHistory as Array<{ role: string; content: unknown }>;
    const userMessage = [...history].reverse().find((m) => m.role === "user");
    expect(userMessage?.content).toBe("Analyze all images [5 image(s) attached]");

    coo.destroy();
  });

  it("skips oversized image attachments and does not pass imageParts", async () => {
    // 6 MB file exceeds the 5 MB LLM image-processing limit in COO
    writeFileSync(join(uploadsDir, "too-large.png"), Buffer.alloc(6 * 1024 * 1024, 1));
    const bus = createMockBus();
    const coo = createCoo(bus);

    const thinkSpy = vi
      .spyOn(coo as any, "think")
      .mockResolvedValue({ text: "ok", thinking: undefined, hadToolCalls: false });

    await coo.handleMessage(
      createChatMessage("Please analyze this", {
        attachments: [
          {
            id: "att-large",
            filename: "too-large.png",
            mimeType: "image/png",
            size: 6 * 1024 * 1024,
            url: "/uploads/too-large.png",
          },
        ],
      }),
    );

    expect(thinkSpy).toHaveBeenCalledTimes(1);
    expect(thinkSpy.mock.calls[0][4]).toBeUndefined();

    coo.destroy();
  });
});
