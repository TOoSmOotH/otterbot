/**
 * Pure helpers for the schema-driven per-skill config system.
 *
 * A skill's `configSchema` (see `SkillConfigSchema`) declares typed fields; the
 * UI renders a form, and field values are persisted into the agent's encrypted
 * credentials store (`agent_secrets`). These functions translate between the
 * two: reading stored credential values back into form values (masking
 * secrets), and turning submitted form values into a credential payload.
 *
 * Kept side-effect free so they can be unit-tested without a database.
 */

import type {
  CredentialScope,
  SkillConfigField,
  SkillConfigSchema,
} from "@otterbot/shared";
import type { ScopedSecret } from "../secrets/secrets-store.js";

/** The shape returned to the config form so it can pre-fill itself. */
export interface SkillConfigView {
  schema: SkillConfigSchema;
  /** Parsed, non-secret values keyed by field key. Secret fields are absent. */
  values: Record<string, unknown>;
  /** For secret fields: whether a value is currently stored (never the value). */
  secretsPresent: Record<string, boolean>;
}

/** Parse a single stored credential string into the field's typed value. */
function parseFieldValue(field: SkillConfigField, raw: string): unknown {
  switch (field.type) {
    case "boolean":
      return raw.toLowerCase() === "true";
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case "list":
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        // Tolerate malformed/legacy values — surface an empty list, never throw.
        return [];
      }
    default:
      return raw;
  }
}

/**
 * Read an agent's stored credential values back into form values for a skill.
 * Secret fields never yield a value — only a `secretsPresent` flag.
 */
export function readSkillConfig(
  schema: SkillConfigSchema,
  secrets: Map<string, string>,
): { values: Record<string, unknown>; secretsPresent: Record<string, boolean> } {
  const values: Record<string, unknown> = {};
  const secretsPresent: Record<string, boolean> = {};
  for (const field of schema.fields) {
    if (!field.credentialKey) continue;
    const raw = secrets.get(field.credentialKey);
    if (field.secret) {
      secretsPresent[field.key] = typeof raw === "string" && raw.length > 0;
      continue;
    }
    if (raw !== undefined) values[field.key] = parseFieldValue(field, raw);
  }
  return { values, secretsPresent };
}

/** Serialise a submitted form value into the string stored under a credential key. */
function serialiseFieldValue(field: SkillConfigField, value: unknown): string {
  switch (field.type) {
    case "boolean": {
      const b = value ?? field.default ?? false;
      return b ? "true" : "false";
    }
    case "list":
      return JSON.stringify(Array.isArray(value) ? value : []);
    default: {
      const v = value ?? field.default ?? "";
      return String(v);
    }
  }
}

/**
 * Build the credential payload (`key -> { value, scope }`) for a submitted
 * config form. Secret fields left blank are omitted so an empty submit never
 * wipes a stored secret.
 */
export function buildSkillConfigPayload(
  schema: SkillConfigSchema,
  formValues: Record<string, unknown>,
): Record<string, ScopedSecret> {
  const payload: Record<string, ScopedSecret> = {};
  for (const field of schema.fields) {
    if (!field.credentialKey) continue;
    const value = formValues[field.key];
    if (field.secret) {
      // Blank/absent secret → leave the stored value untouched.
      if (value === undefined || value === null || String(value).trim() === "") continue;
      payload[field.credentialKey] = { value: String(value), scope: scopeOf(field) };
      continue;
    }
    payload[field.credentialKey] = {
      value: serialiseFieldValue(field, value),
      scope: scopeOf(field),
    };
  }
  return payload;
}

function scopeOf(field: SkillConfigField): CredentialScope {
  return field.scope ?? "broad";
}

/** Summarise one list item (e.g. a VM) from its item fields. */
function renderConfigItem(itemFields: SkillConfigField[], item: unknown): string {
  const obj = (item ?? {}) as Record<string, unknown>;
  const scalars: string[] = [];
  const lists: string[] = [];
  for (const f of itemFields) {
    const v = obj[f.key];
    if (f.type === "list") {
      const arr = Array.isArray(v) ? v : [];
      const subKey = f.itemFields?.[0]?.key;
      const names = arr
        .map((x) => (subKey ? (x as Record<string, unknown>)?.[subKey] : x))
        .filter((n) => n !== undefined && n !== null && String(n) !== "")
        .map((n) => String(n));
      if (names.length) lists.push(`${f.label.toLowerCase()}: ${names.join(", ")}`);
    } else if (v !== undefined && v !== null && String(v) !== "") {
      scalars.push(String(v));
    }
  }
  return [scalars.join(" "), lists.join("; ")].filter(Boolean).join(" — ");
}

/**
 * Render a skill's stored non-secret config as a compact markdown reference
 * block for the agent's prompt, or null if nothing is configured. Secret
 * fields are never included.
 */
export function renderSkillConfigContext(
  schema: SkillConfigSchema,
  secrets: Map<string, string>,
): string | null {
  const lines: string[] = [];
  for (const field of schema.fields) {
    if (!field.credentialKey || field.secret) continue;
    const raw = secrets.get(field.credentialKey);
    if (raw === undefined || raw === "") continue;
    const val = parseFieldValue(field, raw);
    if (field.type === "list") {
      const items = Array.isArray(val) ? val : [];
      if (items.length === 0) continue;
      lines.push(`- ${field.label}:`);
      for (const item of items) {
        lines.push(`  - ${renderConfigItem(field.itemFields ?? [], item)}`);
      }
    } else {
      lines.push(`- ${field.label}: ${String(val)}`);
    }
  }
  if (lines.length === 0) return null;
  return (
    "Configured settings (reference — confirm live before acting):\n" + lines.join("\n")
  );
}

/** One VM entry in the proxmox `vms` config list. */
interface ConfiguredVmInput {
  vmid?: number | string;
  name?: string;
  snapshots?: Array<{ name?: string }>;
}

/**
 * Skill-specific derived credentials: values computed from the form rather than
 * entered directly. Proxmox derives its `PROXMOX_ALLOWED_VMIDS` allowlist from
 * the configured VM list, so the user only manages VMs in one place.
 */
export function deriveSkillCredentials(
  skillId: string,
  formValues: Record<string, unknown>,
): Record<string, ScopedSecret> {
  if (skillId !== "proxmox") return {};
  const vms = Array.isArray(formValues.vms) ? (formValues.vms as ConfiguredVmInput[]) : [];
  const vmids = vms
    .map((v) => Number(v?.vmid))
    .filter((n) => Number.isInteger(n) && n > 0);
  return {
    PROXMOX_ALLOWED_VMIDS: { value: vmids.join(","), scope: "cap:proxmox" },
  };
}
