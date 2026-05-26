import { describe, it, expect } from "vitest";
import { sanitizeMatrixRequestBody } from "./matrix-client.js";

const UPLOAD = "/_matrix/client/v3/keys/upload";

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
