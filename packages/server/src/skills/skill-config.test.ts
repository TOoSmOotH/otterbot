import { describe, it, expect } from "vitest";
import type { SkillConfigSchema } from "@otterbot/shared";
import {
  readSkillConfig,
  buildSkillConfigPayload,
  deriveSkillCredentials,
  renderSkillConfigContext,
} from "./skill-config.js";
import { parseConfiguredVms } from "../integrations/proxmox.js";

/** A representative schema covering scalar, secret, boolean, and nested-list fields. */
const schema: SkillConfigSchema = {
  fields: [
    { key: "host", label: "Host", type: "string", credentialKey: "PROXMOX_HOST", scope: "cap:proxmox" },
    {
      key: "tokenSecret",
      label: "Token secret",
      type: "secret",
      secret: true,
      credentialKey: "PROXMOX_TOKEN_SECRET",
      scope: "direct",
    },
    {
      key: "verifySsl",
      label: "Verify SSL",
      type: "boolean",
      default: true,
      credentialKey: "PROXMOX_VERIFY_SSL",
      scope: "cap:proxmox",
    },
    {
      key: "vms",
      label: "VMs",
      type: "list",
      credentialKey: "PROXMOX_VMS",
      scope: "cap:proxmox",
      itemFields: [
        { key: "vmid", label: "VMID", type: "number" },
        { key: "name", label: "Name", type: "string" },
        {
          key: "snapshots",
          label: "Snapshots",
          type: "list",
          itemFields: [{ key: "name", label: "Snapshot", type: "string" }],
        },
      ],
    },
  ],
};

describe("readSkillConfig", () => {
  it("masks secrets and parses non-secret values", () => {
    const secrets = new Map([
      ["PROXMOX_HOST", "pve.lan"],
      ["PROXMOX_TOKEN_SECRET", "super-secret"],
      ["PROXMOX_VERIFY_SSL", "false"],
      ["PROXMOX_VMS", JSON.stringify([{ vmid: 200, name: "box", snapshots: [{ name: "clean" }] }])],
    ]);
    const { values, secretsPresent } = readSkillConfig(schema, secrets);

    expect(values.host).toBe("pve.lan");
    expect(values.verifySsl).toBe(false);
    expect(values.vms).toEqual([{ vmid: 200, name: "box", snapshots: [{ name: "clean" }] }]);
    // The secret value is never returned, only its presence.
    expect("tokenSecret" in values).toBe(false);
    expect(secretsPresent.tokenSecret).toBe(true);
  });

  it("reports an absent secret as not present and tolerates malformed list JSON", () => {
    const secrets = new Map([["PROXMOX_VMS", "{not json"]]);
    const { values, secretsPresent } = readSkillConfig(schema, secrets);
    expect(secretsPresent.tokenSecret).toBe(false);
    expect(values.vms).toEqual([]);
  });
});

describe("buildSkillConfigPayload", () => {
  it("serialises scalars/lists and applies each field's scope", () => {
    const payload = buildSkillConfigPayload(schema, {
      host: "pve.lan",
      tokenSecret: "the-token",
      verifySsl: false,
      vms: [{ vmid: 200, name: "box", snapshots: [{ name: "clean" }] }],
    });
    expect(payload.PROXMOX_HOST).toEqual({ value: "pve.lan", scope: "cap:proxmox" });
    expect(payload.PROXMOX_VERIFY_SSL).toEqual({ value: "false", scope: "cap:proxmox" });
    expect(payload.PROXMOX_TOKEN_SECRET).toEqual({ value: "the-token", scope: "direct" });
    expect(JSON.parse(payload.PROXMOX_VMS.value)).toEqual([
      { vmid: 200, name: "box", snapshots: [{ name: "clean" }] },
    ]);
  });

  it("omits a blank secret so an empty submit never wipes the stored value", () => {
    const payload = buildSkillConfigPayload(schema, { host: "pve.lan", tokenSecret: "   " });
    expect("PROXMOX_TOKEN_SECRET" in payload).toBe(false);
    expect(payload.PROXMOX_HOST.value).toBe("pve.lan");
  });
});

describe("deriveSkillCredentials", () => {
  it("derives PROXMOX_ALLOWED_VMIDS from the proxmox VM list", () => {
    const derived = deriveSkillCredentials("proxmox", {
      vms: [{ vmid: 200 }, { vmid: 0 }, { vmid: 301, name: "x" }],
    });
    expect(derived.PROXMOX_ALLOWED_VMIDS).toEqual({ value: "200,301", scope: "cap:proxmox" });
  });

  it("returns nothing for other skills", () => {
    expect(deriveSkillCredentials("gh-auth", { vms: [{ vmid: 200 }] })).toEqual({});
  });
});

describe("renderSkillConfigContext", () => {
  it("summarises non-secret config and never leaks secrets", () => {
    const secrets = new Map([
      ["PROXMOX_HOST", "pve.lan"],
      ["PROXMOX_TOKEN_SECRET", "super-secret"],
      ["PROXMOX_VMS", JSON.stringify([{ vmid: 200, name: "box", snapshots: [{ name: "clean" }] }])],
    ]);
    const rendered = renderSkillConfigContext(schema, secrets);
    expect(rendered).toContain("Host: pve.lan");
    expect(rendered).toContain("200 box");
    expect(rendered).toContain("snapshots: clean");
    expect(rendered).not.toContain("super-secret");
  });

  it("returns null when nothing is configured", () => {
    expect(renderSkillConfigContext(schema, new Map())).toBeNull();
  });
});

describe("parseConfiguredVms", () => {
  it("parses the configured VM list", () => {
    const secrets = new Map([
      [
        "PROXMOX_VMS",
        JSON.stringify([
          { vmid: 200, name: "box", snapshots: [{ name: "clean" }, { name: "pre" }] },
          { vmid: "bad" },
        ]),
      ],
    ]);
    expect(parseConfiguredVms(secrets)).toEqual([
      { vmid: 200, name: "box", snapshots: ["clean", "pre"] },
    ]);
  });

  it("returns an empty list when absent or malformed", () => {
    expect(parseConfiguredVms(new Map())).toEqual([]);
    expect(parseConfiguredVms(new Map([["PROXMOX_VMS", "nope"]]))).toEqual([]);
  });
});
