import type { ScopedSecret } from "./secrets-store.js";

/**
 * Merge ordered credential layers into one effective map. Layers are applied
 * low→high precedence, so a key present in a later layer overrides the same key
 * in an earlier one. Used to compose an agent's effective credentials from
 * provider keys, instance-wide global secrets, and the agent's own secrets (in
 * that order — the agent's own win). Pure and side-effect free.
 */
export function layerScopedSecrets(
  layers: Array<Map<string, ScopedSecret>>,
): Map<string, ScopedSecret> {
  const out = new Map<string, ScopedSecret>();
  for (const layer of layers) {
    for (const [key, entry] of layer) out.set(key, entry);
  }
  return out;
}
