import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SshChat } from "./SshChat";

vi.mock("../../lib/socket", () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }),
}));

vi.mock("../chat/MarkdownContent", () => ({
  MarkdownContent: ({ content }: { content: string }) => <span>{content}</span>,
}));

describe("SshChat layout", () => {
  it("uses full-height container instead of fixed inline height", () => {
    const html = renderToStaticMarkup(<SshChat sessionId="session-1" />);

    expect(html).toContain('class="flex flex-col border-t border-border bg-card h-full"');
    expect(html).not.toContain('style="height:260px"');
  });
});
