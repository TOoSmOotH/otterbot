import { describe, it, expect } from "vitest";
import { formatRelative } from "./format-relative";

describe("formatRelative", () => {
  const now = new Date("2026-02-20T12:00:00Z").getTime();

  it("returns 'just now' for timestamps less than a minute ago", () => {
    const date = new Date(now - 30_000).toISOString(); // 30s ago
    expect(formatRelative(date, now)).toBe("just now");
  });

  it("returns 'just now' for the exact same timestamp", () => {
    const date = new Date(now).toISOString();
    expect(formatRelative(date, now)).toBe("just now");
  });

  it("returns minutes ago for timestamps under an hour", () => {
    const date = new Date(now - 5 * 60_000).toISOString(); // 5m ago
    expect(formatRelative(date, now)).toBe("5m ago");
  });

  it("returns 59m ago at the boundary before switching to hours", () => {
    const date = new Date(now - 59 * 60_000).toISOString();
    expect(formatRelative(date, now)).toBe("59m ago");
  });

  it("returns hours ago for timestamps under a day", () => {
    const date = new Date(now - 3 * 3_600_000).toISOString(); // 3h ago
    expect(formatRelative(date, now)).toBe("3h ago");
  });

  it("returns 23h ago at the boundary before switching to days", () => {
    const date = new Date(now - 23 * 3_600_000).toISOString();
    expect(formatRelative(date, now)).toBe("23h ago");
  });

  it("returns days ago for timestamps over 24 hours", () => {
    const date = new Date(now - 3 * 86_400_000).toISOString(); // 3d ago
    expect(formatRelative(date, now)).toBe("3d ago");
  });

  it("returns 1d ago at exactly 24 hours", () => {
    const date = new Date(now - 86_400_000).toISOString();
    expect(formatRelative(date, now)).toBe("1d ago");
  });
});
