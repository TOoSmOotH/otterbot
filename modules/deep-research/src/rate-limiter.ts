/**
 * Per-domain rate limiter using an in-memory sliding window.
 * Prevents the module from overwhelming external APIs.
 */

interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
}

const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  "www.reddit.com": { requestsPerMinute: 10, requestsPerHour: 60 },
  "api.twitter.com": { requestsPerMinute: 15, requestsPerHour: 300 },
  "hn.algolia.com": { requestsPerMinute: 30, requestsPerHour: 1000 },
  "api.search.brave.com": { requestsPerMinute: 20, requestsPerHour: 200 },
  "api.tavily.com": { requestsPerMinute: 20, requestsPerHour: 200 },
  "html.duckduckgo.com": { requestsPerMinute: 10, requestsPerHour: 60 },
};

const GENERAL_LIMIT: RateLimitConfig = {
  requestsPerMinute: 20,
  requestsPerHour: 200,
};

/** In-memory timestamp log per domain */
const requestLog = new Map<string, number[]>();

function getLimits(domain: string): RateLimitConfig {
  return DEFAULT_LIMITS[domain] ?? GENERAL_LIMIT;
}

function pruneOld(timestamps: number[], cutoff: number): number[] {
  const idx = timestamps.findIndex((t) => t > cutoff);
  return idx === -1 ? [] : timestamps.slice(idx);
}

/**
 * Check whether a request to the given domain is currently allowed.
 */
export function canRequest(domain: string): boolean {
  const limits = getLimits(domain);
  const now = Date.now();
  const timestamps = requestLog.get(domain) ?? [];

  // Prune timestamps older than 1 hour
  const pruned = pruneOld(timestamps, now - 3_600_000);

  const lastMinute = pruned.filter((t) => t > now - 60_000).length;
  const lastHour = pruned.length;

  return (
    lastMinute < limits.requestsPerMinute && lastHour < limits.requestsPerHour
  );
}

/**
 * Record that a request was made to the given domain.
 */
export function recordRequest(domain: string): void {
  const timestamps = requestLog.get(domain) ?? [];
  const now = Date.now();
  // Prune while we're at it
  const pruned = pruneOld(timestamps, now - 3_600_000);
  pruned.push(now);
  requestLog.set(domain, pruned);
}

/**
 * Wait until a request slot is available for the domain.
 * Uses exponential backoff up to 10 seconds between checks.
 */
export async function waitForSlot(domain: string): Promise<void> {
  let delay = 500;
  const maxDelay = 10_000;
  const maxWait = 60_000;
  const start = Date.now();

  while (!canRequest(domain)) {
    if (Date.now() - start > maxWait) {
      throw new Error(
        `Rate limit: waited ${maxWait / 1000}s for ${domain} — giving up`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, maxDelay);
  }
}

/**
 * Convenience: wait for slot, then record the request.
 * Call this before every outbound HTTP request.
 */
export async function acquireSlot(domain: string): Promise<void> {
  await waitForSlot(domain);
  recordRequest(domain);
}
