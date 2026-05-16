import type { AgentContext } from "./agent-context.js";

/**
 * Holder for the "default" agent context (the COO). Existing single-agent code
 * paths and compatibility shims (`getDb`, `getMemoryService`, …) resolve through
 * here. The orchestrator sets this once the COO profile is loaded at boot.
 *
 * This module imports only the `AgentContext` *type*, so it introduces no
 * runtime import cycle with the service classes.
 */
let _default: AgentContext | null = null;

export function setDefaultContext(ctx: AgentContext): void {
  _default = ctx;
}

export function hasDefaultContext(): boolean {
  return _default !== null;
}

export function getDefaultContext(): AgentContext {
  if (!_default) {
    throw new Error(
      "Default agent context not initialized — the COO profile must be loaded at boot"
    );
  }
  return _default;
}
