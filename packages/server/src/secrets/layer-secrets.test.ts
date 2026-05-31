import { describe, it, expect } from "vitest";
import type { ScopedSecret } from "./secrets-store.js";
import { layerScopedSecrets } from "./layer-secrets.js";
import { buildShellSecrets } from "./shell-secrets.js";

const s = (value: string, scope: ScopedSecret["scope"]): ScopedSecret => ({ value, scope });

describe("layerScopedSecrets", () => {
  it("layers provider < global < per-agent, later wins on collision", () => {
    const provider = new Map([["MODEL_KEY", s("prov", "direct")]]);
    const global = new Map([
      ["MODEL_KEY", s("glob", "direct")],
      ["PROXMOX_TOKEN_SECRET", s("uuid", "direct")],
    ]);
    const agent = new Map([["MODEL_KEY", s("agent", "direct")]]);

    const merged = layerScopedSecrets([provider, global, agent]);

    // Per-agent overrides global overrides provider for the shared key.
    expect(merged.get("MODEL_KEY")?.value).toBe("agent");
    // A global-only key is present.
    expect(merged.get("PROXMOX_TOKEN_SECRET")?.value).toBe("uuid");
  });

  it("keeps global secrets out of the LLM-visible shell per their scope", () => {
    const global = new Map([
      ["PROXMOX_TOKEN_SECRET", s("uuid", "direct")], // never in shell
      ["PROXMOX_HOST", s("pve.lan", "cap:proxmox")], // shell only when proxmox enabled
      ["GENERIC", s("v", "broad")], // always in shell
    ]);
    const merged = layerScopedSecrets([global]);

    const offShell = buildShellSecrets(merged, new Set());
    expect(offShell.has("PROXMOX_TOKEN_SECRET")).toBe(false);
    expect(offShell.has("PROXMOX_HOST")).toBe(false);
    expect(offShell.get("GENERIC")).toBe("v");

    const onShell = buildShellSecrets(merged, new Set(["proxmox"]));
    expect(onShell.has("PROXMOX_TOKEN_SECRET")).toBe(false); // direct: still hidden
    expect(onShell.get("PROXMOX_HOST")).toBe("pve.lan"); // cap now satisfied
  });
});
