import { beforeEach, describe, expect, it, vi } from "vitest";

const resolve4Mock = vi.hoisted(() => vi.fn());
const resolve6Mock = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  resolve4: resolve4Mock,
  resolve6: resolve6Mock,
}));

import { ssrfSafeFetch, validateUrlForSsrf } from "./ssrf.js";

describe("SSRF protections", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resolve4Mock.mockReset();
    resolve6Mock.mockReset();
    resolve6Mock.mockRejectedValue(new Error("no AAAA"));
  });

  it("blocks hostnames that resolve to private IPs", async () => {
    resolve4Mock.mockResolvedValue(["127.0.0.1"]);

    await expect(validateUrlForSsrf("http://internal.example.local/path")).rejects.toThrow(
      /resolves to private IP/,
    );
  });

  it("fetches using original URL for TLS SNI compatibility", async () => {
    resolve4Mock.mockResolvedValue(["93.184.216.34"]);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await ssrfSafeFetch("https://example.com/docs?q=1");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];

    // Should use the original URL (not IP) so TLS cert validation works
    expect(url).toBe("https://example.com/docs?q=1");
    expect((init as RequestInit).redirect).toBe("manual");
  });

  it("re-validates redirect locations and blocks redirects to private targets", async () => {
    resolve4Mock.mockImplementation(async (host: string) => {
      if (host === "example.com") return ["93.184.216.34"];
      if (host === "evil.local") return ["127.0.0.1"];
      return ["93.184.216.35"];
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("redirect", {
          status: 302,
          headers: { location: "http://evil.local/secret" },
        }),
      );

    await expect(ssrfSafeFetch("https://example.com/start")).rejects.toThrow(
      /resolves to private IP/,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
