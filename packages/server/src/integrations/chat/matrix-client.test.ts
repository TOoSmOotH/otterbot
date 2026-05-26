import { describe, it, expect } from "vitest";
import { sanitizeMatrixRequestBody, detectMention } from "./matrix-client.js";

const UPLOAD = "/_matrix/client/v3/keys/upload";

const SELF = "@otterthebot:derpzilla.net";
// As built in buildClient: [mxid, localpart, displayName].
const TOKENS = [SELF.toLowerCase(), "otterthebot", "otter bot"];

describe("detectMention", () => {
  it("matches structured m.mentions regardless of display name", () => {
    expect(
      detectMention(SELF, TOKENS, { body: "hey there", "m.mentions": { user_ids: [SELF] } })
    ).toBe(true);
  });

  it("matches the MXID in an HTML pill even when the body shows the display name", () => {
    expect(
      detectMention(SELF, TOKENS, {
        body: "Otter Bot: ping",
        formatted_body: `<a href="https://matrix.to/#/${SELF}">Otter Bot</a>: ping`,
      })
    ).toBe(true);
  });

  it("matches the display name in the plain body (no pill, no m.mentions)", () => {
    expect(detectMention(SELF, TOKENS, { body: "Otter Bot can you help" })).toBe(true);
  });

  it("matches the localpart", () => {
    expect(detectMention(SELF, TOKENS, { body: "otterthebot hello" })).toBe(true);
  });

  it("does not match an unrelated message", () => {
    expect(detectMention(SELF, TOKENS, { body: "good morning everyone" })).toBe(false);
  });
});

describe("sanitizeMatrixRequestBody", () => {
  it("drops an explicit null device_keys from keys/upload", () => {
    const body = { device_keys: null, one_time_keys: { a: 1 } };
    const out = sanitizeMatrixRequestBody(UPLOAD, body) as Record<string, unknown>;
    expect("device_keys" in out).toBe(false);
    expect(out.one_time_keys).toEqual({ a: 1 });
    // Does not mutate the original.
    expect("device_keys" in body).toBe(true);
  });

  it("keeps a real device_keys object", () => {
    const body = { device_keys: { user_id: "@a:b" }, one_time_keys: {} };
    expect(sanitizeMatrixRequestBody(UPLOAD, body)).toBe(body);
  });

  it("leaves non-upload requests untouched", () => {
    const body = { device_keys: null };
    expect(sanitizeMatrixRequestBody("/_matrix/client/v3/keys/query", body)).toBe(body);
  });

  it("is a no-op when device_keys is absent", () => {
    const body = { one_time_keys: {} };
    expect(sanitizeMatrixRequestBody(UPLOAD, body)).toBe(body);
  });
});
