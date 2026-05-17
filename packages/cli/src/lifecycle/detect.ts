/** Server detection: probe a running Otterbot server without side effects. */

export type ProbeResult =
  | { up: true; onboardingComplete: boolean; agentCount: number }
  | { up: false; reason: "refused" | "timeout" | "error" };

/**
 * Probe `${serverUrl}/api/setup-state`. A connection-refused error means no
 * server is listening; a timeout or other error is reported distinctly so the
 * caller can decide whether spawning a new server makes sense.
 */
export async function probeServer(serverUrl: string, timeoutMs = 1500): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(new URL("/api/setup-state", serverUrl), {
      signal: controller.signal,
    });
    if (!res.ok) return { up: false, reason: "error" };
    const body = (await res.json()) as {
      onboardingComplete?: boolean;
      agentCount?: number;
    };
    return {
      up: true,
      onboardingComplete: Boolean(body.onboardingComplete),
      agentCount: typeof body.agentCount === "number" ? body.agentCount : 0,
    };
  } catch (err) {
    if (controller.signal.aborted) return { up: false, reason: "timeout" };
    const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code
      ?? (err as { code?: string })?.code;
    if (code === "ECONNREFUSED") return { up: false, reason: "refused" };
    return { up: false, reason: "error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Poll `probeServer` until it reports the server is up, or the deadline passes.
 * `onTick` receives the elapsed seconds so the UI can show progress.
 */
export async function waitForServer(
  serverUrl: string,
  opts: { timeoutMs?: number; intervalMs?: number; onTick?: (elapsedSec: number) => void } = {}
): Promise<ProbeResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 400;
  const start = Date.now();
  for (;;) {
    const result = await probeServer(serverUrl, 1000);
    if (result.up) return result;
    if (Date.now() - start >= timeoutMs) return result;
    opts.onTick?.(Math.floor((Date.now() - start) / 1000));
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
