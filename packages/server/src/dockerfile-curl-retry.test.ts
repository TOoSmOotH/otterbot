import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");

function expectCurlWithRetryFor(urlPattern: string): void {
  const regex = new RegExp(
    String.raw`curl\s+[^\n]*--retry\s+3[^\n]*--retry-delay\s+5[^\n]*${urlPattern}`,
    "m",
  );
  expect(dockerfile).toMatch(regex);
}

describe("Dockerfile curl retry resilience", () => {
  it("adds retry flags to all critical external downloads", () => {
    expectCurlWithRetryFor(String.raw`https://cli\.github\.com/packages/githubcli-archive-keyring\.gpg`);
    expectCurlWithRetryFor(
      String.raw`https://go\.dev/dl/go\$\{GOLANG_VERSION\}\.linux-\$\(dpkg --print-architecture\)\.tar\.gz`,
    );
    expectCurlWithRetryFor(String.raw`https://sh\.rustup\.rs`);
    expectCurlWithRetryFor(String.raw`https://claude\.ai/install\.sh`);
    expectCurlWithRetryFor(String.raw`https://github\.com/novnc/noVNC/archive/refs/tags/v1\.5\.0\.tar\.gz`);
  });
});
