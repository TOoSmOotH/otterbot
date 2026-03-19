import { afterEach, describe, expect, it } from "vitest";
import { resolveUploadedImagePath } from "../upload-paths.js";

const ORIGINAL_WORKSPACE_ROOT = process.env.WORKSPACE_ROOT;

describe("resolveUploadedImagePath", () => {
  afterEach(() => {
    process.env.WORKSPACE_ROOT = ORIGINAL_WORKSPACE_ROOT;
  });

  it("resolves uploaded URLs into the uploads directory", () => {
    process.env.WORKSPACE_ROOT = "/tmp/otterbot";
    expect(resolveUploadedImagePath("/uploads/test.png")).toBe("/tmp/otterbot/data/uploads/test.png");
  });

  it("rejects traversal outside the upload root", () => {
    process.env.WORKSPACE_ROOT = "/tmp/otterbot";
    expect(() => resolveUploadedImagePath("/uploads/../../etc/passwd")).toThrow();
  });
});
