import ivm from "isolated-vm";
import type { CustomTool } from "@otterbot/shared";

/** Memory limit for each isolate (128 MB) */
const MEMORY_LIMIT_MB = 128;

/**
 * Execute a custom tool's JavaScript code in an isolated-vm sandbox.
 * The code receives a `params` object and must return a string.
 * Available globals: JSON, Math, Date, console.log, fetch (bridged from host).
 * No access to: fs, child_process, require, process, Buffer, setTimeout, setInterval, etc.
 */
export async function executeCustomTool(
  tool: CustomTool,
  params: Record<string, unknown>,
): Promise<string> {
  const logs: string[] = [];
  const isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });

  try {
    const context = await isolate.createContext();
    const jail = context.global;

    // Set up `global` reference
    await jail.set("global", jail.derefInto());

    // Inject params as a copy
    await jail.set("params", new ivm.ExternalCopy(params).copyInto());

    // Bridge console.log via a Reference callback
    await jail.set(
      "_log",
      new ivm.Reference((...args: unknown[]) => {
        logs.push(
          args
            .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
            .join(" "),
        );
      }),
    );
    await context.eval(`
      const console = {
        log: (...args) => _log.applySync(undefined, args.map(a => typeof a === 'string' ? a : JSON.stringify(a))),
      };
    `);

    // Bridge fetch via a Reference callback that returns a promise
    await jail.set(
      "_fetch",
      new ivm.Reference(async (url: string, init?: string) => {
        const opts = init ? JSON.parse(init) : undefined;
        const res = await fetch(url, opts);
        const body = await res.text();
        return new ivm.ExternalCopy({
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          body,
          headers: Object.fromEntries(res.headers.entries()),
        }).copyInto();
      }),
    );
    await context.eval(`
      async function fetch(url, init) {
        const initStr = init ? JSON.stringify(init) : undefined;
        const res = await _fetch.apply(undefined, [url, initStr], { result: { promise: true } });
        return {
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          text: () => Promise.resolve(res.body),
          json: () => Promise.resolve(JSON.parse(res.body)),
          headers: { get: (k) => res.headers[k.toLowerCase()] || null },
        };
      }
    `);

    // Wrap the user code in an async IIFE
    const wrappedCode = `
(async () => {
  ${tool.code}
})()
`;

    const timeoutMs = tool.timeout ?? 30_000;
    const result = await context.eval(wrappedCode, {
      timeout: timeoutMs,
      promise: true,
    });

    const output = typeof result === "string" ? result : JSON.stringify(result);

    if (logs.length > 0) {
      return `${output}\n\n[Console output]\n${logs.join("\n")}`;
    }
    return output;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (logs.length > 0) {
      return `Error: ${message}\n\n[Console output]\n${logs.join("\n")}`;
    }
    return `Error: ${message}`;
  } finally {
    isolate.dispose();
  }
}
