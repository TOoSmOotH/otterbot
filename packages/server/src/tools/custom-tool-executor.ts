import vm from "node:vm";
import type { CustomTool } from "@otterbot/shared";

/**
 * Execute a custom tool's JavaScript code in a sandboxed VM context.
 * The code receives a `params` object and must return a string.
 * Available globals: fetch, JSON, Math, Date, console.log, URL, URLSearchParams,
 * TextEncoder, TextDecoder, atob, btoa, setTimeout, setInterval, clearTimeout,
 * clearInterval, crypto.randomUUID, encodeURIComponent, decodeURIComponent,
 * AbortController, Headers, structuredClone.
 * No access to: fs, child_process, require, process, Buffer, etc.
 */
export async function executeCustomTool(
  tool: CustomTool,
  params: Record<string, unknown>,
): Promise<string> {
  const logs: string[] = [];

  const sandbox = {
    params,
    fetch: globalThis.fetch,
    JSON,
    Math,
    Date,
    URL,
    URLSearchParams,
    console: {
      log: (...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      },
    },
    // Text encoding/decoding
    TextEncoder,
    TextDecoder,
    // Base64
    atob,
    btoa,
    // Timers
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    // Crypto (limited to randomUUID)
    crypto: { randomUUID: () => globalThis.crypto.randomUUID() },
    // URL encoding
    encodeURIComponent,
    decodeURIComponent,
    // Fetch helpers
    AbortController,
    Headers,
    // Deep cloning
    structuredClone,
    // Provide a way to set the result from async code
    __result: undefined as string | undefined,
  };

  // Wrap the code in an async IIFE so the user can use await
  const wrappedCode = `
(async () => {
  ${tool.code}
})().then(r => { __result = typeof r === 'string' ? r : JSON.stringify(r); })
   .catch(e => { __result = 'Error: ' + (e.message || String(e)); });
`;

  const context = vm.createContext(sandbox);
  const script = new vm.Script(wrappedCode, { filename: `custom-tool:${tool.name}` });

  // Execute the script, which returns a Promise
  script.runInContext(context, { timeout: tool.timeout });

  // The script is async, so we need to wait for the microtask queue to flush.
  // We do this by awaiting the promise that was assigned.
  // Since vm doesn't directly await, we re-run a small script that returns the internal promise.
  const awaitScript = new vm.Script(
    `(async () => { ${tool.code} })()`,
    { filename: `custom-tool:${tool.name}:await` },
  );

  try {
    const promise = awaitScript.runInContext(context, { timeout: tool.timeout });
    const result = await promise;
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
  }
}
