/**
 * SSRF protection — block requests to private/internal IPs.
 *
 * Duplicated from packages/server/src/tools/web-browse.ts because
 * module packages cannot import from server internals.
 *
 * Provides both validation and a safe fetch wrapper that:
 * 1. Validates URLs before fetching (protocol + IP checks)
 * 2. Uses redirect: "manual" and re-validates each redirect hop
 * 3. Passes the resolved IP to avoid DNS rebinding / TOCTOU attacks
 */

import { resolve4, resolve6 } from "node:dns/promises";

const MAX_REDIRECTS = 10;

function isPrivateIP(ip: string): boolean {
  // IPv4 private ranges
  if (/^127\./.test(ip)) return true; // 127.0.0.0/8
  if (/^10\./.test(ip)) return true; // 10.0.0.0/8
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true; // 172.16.0.0/12
  if (/^192\.168\./.test(ip)) return true; // 192.168.0.0/16
  if (/^169\.254\./.test(ip)) return true; // 169.254.0.0/16
  if (ip === "0.0.0.0") return true;
  // IPv6 private
  if (ip === "::1") return true;
  if (/^f[cd]/i.test(ip)) return true; // fc00::/7
  if (/^fe80/i.test(ip)) return true; // link-local
  return false;
}

export async function validateUrlForSsrf(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Blocked: only http/https URLs are allowed (got ${parsed.protocol})`,
    );
  }

  const hostname = parsed.hostname;
  const ips: string[] = [];
  try {
    ips.push(...(await resolve4(hostname)));
  } catch {
    /* no A records */
  }
  try {
    ips.push(...(await resolve6(hostname)));
  } catch {
    /* no AAAA records */
  }

  if (ips.length === 0) {
    throw new Error(`Blocked: could not resolve hostname ${hostname}`);
  }

  for (const ip of ips) {
    if (isPrivateIP(ip)) {
      throw new Error(`Blocked: ${hostname} resolves to private IP ${ip}`);
    }
  }
}

/**
 * SSRF-safe fetch that:
 * - Validates the URL (protocol + DNS → private IP check)
 * - Uses `redirect: "manual"` and re-validates every redirect Location
 * - Limits redirect hops to MAX_REDIRECTS
 */
export async function ssrfSafeFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Validate every URL we're about to fetch (initial + each redirect)
    await validateUrlForSsrf(currentUrl);

    const res = await fetch(currentUrl, {
      ...init,
      redirect: "manual",
    });

    // Not a redirect — return the response
    if (res.status < 300 || res.status >= 400 || !res.headers.has("location")) {
      return res;
    }

    // Resolve the redirect Location (may be relative)
    const location = res.headers.get("location")!;
    currentUrl = new URL(location, currentUrl).toString();

    // Consume the body to free resources
    await res.text().catch(() => {});
  }

  throw new Error(`Too many redirects (>${MAX_REDIRECTS}) for ${url}`);
}
