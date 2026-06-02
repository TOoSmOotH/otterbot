import { describe, expect, it } from "vitest";
import { recordToolDisplay, takeToolDisplay } from "./tool-display.js";

describe("tool-display side-channel", () => {
  it("returns the recorded detail once, then forgets it", () => {
    recordToolDisplay("call-1", { transcript: "hello tty" });
    expect(takeToolDisplay("call-1")).toEqual({ transcript: "hello tty" });
    // A second take finds nothing — it was consumed.
    expect(takeToolDisplay("call-1")).toBeUndefined();
  });

  it("returns undefined for an unknown id", () => {
    expect(takeToolDisplay("nope")).toBeUndefined();
  });

  it("ignores an empty toolCallId", () => {
    recordToolDisplay("", { transcript: "x" });
    expect(takeToolDisplay("")).toBeUndefined();
  });
});
