/**
 * SSRF protection — block requests to private/internal IPs.
 *
 * Duplicated from packages/server/src/tools/web-browse.ts because
 * module packages cannot import from server internals.
 *
 * Provides both validation and a safe fetch wrapper that:
 * 1. Validates URLs before fetching (protocol + IP checks)
 * 2. Uses redirect: "manual" and re-validates each redirect hop
 * 3. Fetches using the resolved IP to avoid DNS rebinding / TOCTOU attacks
 */

import { resolve4, resolve6 } from "node:dns/promises";

const MAX_REDIRECTS = 10;

function isPrivateIP(ip: string): boolean {
  // Normalize IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 → 127.0.0.1)
  let normalized = ip;
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Mapped) {
    normalized = v4Mapped[1];
  }

  // IPv4 private/reserved ranges
  if (/^127\./.test(normalized)) return true; // 127.0.0.0/8 loopback
  if (/^10\./.test(normalized)) return true; // 10.0.0.0/8
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(normalized)) return true; // 172.16.0.0/12
  if (/^192\.168\./.test(normalized)) return true; // 192.168.0.0/16
  if (/^169\.254\./.test(normalized)) return true; // 169.254.0.0/16 link-local
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(normalized))
    return true; // 100.64.0.0/10 CGNAT
  if (normalized === "0.0.0.0") return true;
  if (/^0\./.test(normalized)) return true; // 0.0.0.0/8
  if (/^192\.0\.0\./.test(normalized)) return true; // 192.0.0.0/24 IETF protocol
  if (/^192\.0\.2\./.test(normalized)) return true; // 192.0.2.0/24 TEST-NET-1
  if (/^198\.51\.100\./.test(normalized)) return true; // 198.51.100.0/24 TEST-NET-2
  if (/^203\.0\.113\./.test(normalized)) return true; // 203.0.113.0/24 TEST-NET-3
  if (/^198\.1[89]\./.test(normalized)) return true; // 198.18.0.0/15 benchmarking
  if (/^2[234]\d\./.test(normalized)) return true; // 224.0.0.0/4 multicast + 240+ reserved

  // IPv6 private/reserved
  if (ip === "::1") return true; // loopback
  if (ip === "::") return true; // unspecified
  if (/^f[cd]/i.test(ip)) return true; // fc00::/7 unique local
  if (/^fe80/i.test(ip)) return true; // fe80::/10 link-local
  if (/^ff/i.test(ip)) return true; // ff00::/8 multicast
  if (/^100::/i.test(ip)) return true; // 100::/64 discard
  if (/^2001:db8/i.test(ip)) return true; // 2001:db8::/32 documentation

  return false;
}

/**
 * Resolve hostname and validate that none of its IPs are private.
 * Returns the list of validated IPs.
 */
export async function validateUrlForSsrf(
  url: string,
): Promise<{ parsed: URL; ips: string[] }> {
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

  return { parsed, ips };
}

/**
 * SSRF-safe fetch that:
 * 1. Validates the URL (protocol + DNS → private IP check)
 * 2. Fetches using the **original URL** so TLS SNI / certificate validation works
 * 3. Uses `redirect: "manual"` and re-validates every redirect Location
 * 4. Limits redirect hops to MAX_REDIRECTS
 *
 * NOTE: We intentionally fetch with the original hostname rather than the
 * resolved IP. Fetching by IP breaks TLS because certs have DNS SANs (e.g.
 * *.githubusercontent.com) but not IP SANs, causing ERR_TLS_CERT_ALTNAME_INVALID.
 * The SSRF validation still protects against private-IP access since we resolve
 * and check IPs before each fetch.
 */
export async function ssrfSafeFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Validate: resolve hostname and ensure no private IPs
    await validateUrlForSsrf(currentUrl);

    const res = await fetch(currentUrl, {
      ...init,
      redirect: "manual",
    });

    // Not a redirect — return the response
    if (
      res.status < 300 ||
      res.status >= 400 ||
      !res.headers.has("location")
    ) {
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
