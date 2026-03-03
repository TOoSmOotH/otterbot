/**
 * Shared model cache directory for @huggingface/transformers and kokoro-js.
 *
 * By default @huggingface/transformers caches downloaded models inside its
 * own package directory within node_modules (`<pkg>/.cache/`), which may be
 * read-only at runtime (e.g. on macOS or in Docker).  This module computes
 * a writable, persistent cache path and redirects the library to use it.
 */

import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Persistent model cache directory (bind-mounted volume in Docker) */
export function getModelCacheDir(): string {
  const dataDir =
    process.env.WORKSPACE_ROOT ??
    resolve(__dirname, "../../../../docker/otterbot");
  return resolve(dataDir, "data", "models");
}

/**
 * Redirect the @huggingface/transformers cache to a writable directory.
 *
 * This sets both:
 *  - `env.cacheDir` on the JS library's runtime config (the actual
 *    mechanism used by @huggingface/transformers in Node.js)
 *  - `HF_HOME` / `TRANSFORMERS_CACHE` process env vars (for any
 *    Python-based tooling or future compatibility)
 *
 * Call this **before** any `pipeline()` or `from_pretrained()` calls.
 * It is safe to call multiple times.
 */
export async function ensureModelCacheDir(): Promise<string> {
  const cacheDir = getModelCacheDir();

  // Best-effort create the directory so downloads don't fail on first run
  try {
    mkdirSync(cacheDir, { recursive: true });
  } catch {
    // Non-fatal — the directory may already exist or be created by Docker
  }

  // Set the JS library's runtime cache directory
  const { env } = await import("@huggingface/transformers");
  env.cacheDir = cacheDir;

  // Also set env vars for broader compatibility
  process.env.HF_HOME = cacheDir;
  process.env.TRANSFORMERS_CACHE = cacheDir;

  return cacheDir;
}
