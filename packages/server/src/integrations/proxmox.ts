/**
 * Per-agent Proxmox VE integration, authenticated with the agent's own API
 * token. Covers VM lifecycle (start / stop / shutdown / status) and snapshots
 * (list / rollback / create / delete). Every VM-scoped call is gated by an
 * allowlist (`PROXMOX_ALLOWED_VMIDS`) enforced here, so an agent can only touch
 * the VMs the user explicitly granted — independent of the token's own
 * Proxmox-side permissions.
 *
 * In-guest work (installing/testing software inside a VM) is out of scope: the
 * agent SSHes into a booted VM with the `shell_exec` tool instead.
 */

import { Agent } from "undici";

interface ProxmoxConfig {
  host: string;
  tokenId: string;
  tokenSecret: string;
  verifySsl: boolean;
}

function cfg(secrets: Map<string, string>): ProxmoxConfig {
  const host = secrets.get("PROXMOX_HOST");
  const tokenId = secrets.get("PROXMOX_TOKEN_ID");
  const tokenSecret = secrets.get("PROXMOX_TOKEN_SECRET");
  if (!host || !tokenId || !tokenSecret) {
    throw new Error(
      "Proxmox is not configured for this agent. Add PROXMOX_HOST, " +
        "PROXMOX_TOKEN_ID, and PROXMOX_TOKEN_SECRET to its credentials."
    );
  }
  // Default to verifying TLS; opt out for the self-signed certs Proxmox ships.
  const verifySsl = (secrets.get("PROXMOX_VERIFY_SSL") ?? "true").toLowerCase() !== "false";
  return { host, tokenId, tokenSecret, verifySsl };
}

/** The set of vmids this agent may control, parsed from `PROXMOX_ALLOWED_VMIDS`. */
function allowedVmids(secrets: Map<string, string>): Set<number> {
  const raw = secrets.get("PROXMOX_ALLOWED_VMIDS") ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
  );
}

/** Throw unless `vmid` is in the agent's allowlist. Fail-safe when unset. */
function assertAllowed(secrets: Map<string, string>, vmid: number): void {
  const allowed = allowedVmids(secrets);
  if (allowed.size === 0) {
    throw new Error(
      "No VMs are allowed for this agent. Set PROXMOX_ALLOWED_VMIDS (e.g. \"200\") " +
        "in its credentials to grant access to specific VMs."
    );
  }
  if (!allowed.has(vmid)) {
    throw new Error(
      `VM ${vmid} is not in this agent's allowlist (${[...allowed].join(", ")}).`
    );
  }
}

// Reuse one insecure dispatcher rather than building it per request.
let insecureAgent: Agent | undefined;
function dispatcherFor(verifySsl: boolean): Agent | undefined {
  if (verifySsl) return undefined;
  insecureAgent ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureAgent;
}

/** Authenticated call against the Proxmox `/api2/json` API. */
async function px(
  secrets: Map<string, string>,
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  const c = cfg(secrets);
  const dispatcher = dispatcherFor(c.verifySsl);
  const res = await fetch(`https://${c.host}:8006/api2/json${path}`, {
    ...init,
    headers: {
      Authorization: `PVEAPIToken=${c.tokenId}=${c.tokenSecret}`,
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    // `dispatcher` is an undici extension to RequestInit honoured by Node's fetch.
    ...(dispatcher ? { dispatcher } : {}),
  } as RequestInit);
  if (!res.ok) {
    throw new Error(`Proxmox API ${res.status}: ${await res.text()}`);
  }
  // Proxmox wraps every payload in `{ data: ... }`.
  const body = (await res.json()) as { data?: unknown };
  return body.data;
}

/** Build an `application/x-www-form-urlencoded` body (Proxmox's POST format). */
function form(fields: Record<string, string | undefined>): RequestInit {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v != null) params.set(k, v);
  }
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  };
}

export interface VmSummary {
  vmid: number;
  name: string;
  node: string;
  status: string;
}

/** Raw `type=vm` cluster resources, before allowlist filtering. */
async function clusterVms(secrets: Map<string, string>): Promise<VmSummary[]> {
  const data = (await px(secrets, "/cluster/resources?type=vm")) as Array<{
    vmid?: number;
    name?: string;
    node?: string;
    status?: string;
  }>;
  return (data ?? [])
    .filter((r): r is { vmid: number; node: string } & typeof r => typeof r.vmid === "number")
    .map((r) => ({
      vmid: r.vmid,
      name: r.name ?? "",
      node: r.node ?? "",
      status: r.status ?? "unknown",
    }));
}

/** Resolve which node a vmid lives on (also serves as an existence check). */
async function resolveNode(secrets: Map<string, string>, vmid: number): Promise<string> {
  assertAllowed(secrets, vmid);
  const vm = (await clusterVms(secrets)).find((v) => v.vmid === vmid);
  if (!vm) throw new Error(`VM ${vmid} was not found on the Proxmox cluster.`);
  return vm.node;
}

/** List the VMs this agent is allowed to control. */
export async function listVms(secrets: Map<string, string>): Promise<VmSummary[]> {
  const allowed = allowedVmids(secrets);
  return (await clusterVms(secrets)).filter((v) => allowed.has(v.vmid));
}

/** Current runtime status of a VM. */
export async function vmStatus(
  secrets: Map<string, string>,
  vmid: number
): Promise<{ status: string; raw: unknown }> {
  const node = await resolveNode(secrets, vmid);
  const data = (await px(secrets, `/nodes/${node}/qemu/${vmid}/status/current`)) as {
    status?: string;
  };
  return { status: data?.status ?? "unknown", raw: data };
}

/** Start a VM. Returns the Proxmox task id (UPID). */
export async function startVm(
  secrets: Map<string, string>,
  vmid: number
): Promise<{ upid: string }> {
  const node = await resolveNode(secrets, vmid);
  const upid = (await px(secrets, `/nodes/${node}/qemu/${vmid}/status/start`, {
    method: "POST",
  })) as string;
  return { upid };
}

/** Stop a VM — graceful ACPI shutdown by default, hard stop otherwise. */
export async function stopVm(
  secrets: Map<string, string>,
  args: { vmid: number; graceful?: boolean }
): Promise<{ upid: string }> {
  const node = await resolveNode(secrets, args.vmid);
  const action = args.graceful === false ? "stop" : "shutdown";
  const upid = (await px(secrets, `/nodes/${node}/qemu/${args.vmid}/status/${action}`, {
    method: "POST",
  })) as string;
  return { upid };
}

export interface SnapshotSummary {
  name: string;
  description: string;
  snaptime?: number;
}

/** List a VM's snapshots. */
export async function listSnapshots(
  secrets: Map<string, string>,
  vmid: number
): Promise<SnapshotSummary[]> {
  const node = await resolveNode(secrets, vmid);
  const data = (await px(secrets, `/nodes/${node}/qemu/${vmid}/snapshot`)) as Array<{
    name?: string;
    description?: string;
    snaptime?: number;
  }>;
  return (data ?? [])
    .filter((s): s is { name: string } & typeof s => typeof s.name === "string")
    .map((s) => ({ name: s.name, description: s.description ?? "", snaptime: s.snaptime }));
}

/** Roll a VM back to a named snapshot. Returns the Proxmox task id (UPID). */
export async function rollbackSnapshot(
  secrets: Map<string, string>,
  args: { vmid: number; snapname: string }
): Promise<{ upid: string }> {
  const node = await resolveNode(secrets, args.vmid);
  const upid = (await px(
    secrets,
    `/nodes/${node}/qemu/${args.vmid}/snapshot/${encodeURIComponent(args.snapname)}/rollback`,
    { method: "POST" }
  )) as string;
  return { upid };
}

/** Take a new snapshot of a VM. Returns the Proxmox task id (UPID). */
export async function createSnapshot(
  secrets: Map<string, string>,
  args: { vmid: number; snapname: string; description?: string }
): Promise<{ upid: string }> {
  const node = await resolveNode(secrets, args.vmid);
  const upid = (await px(
    secrets,
    `/nodes/${node}/qemu/${args.vmid}/snapshot`,
    form({ snapname: args.snapname, description: args.description })
  )) as string;
  return { upid };
}

/** Delete a named snapshot. Returns the Proxmox task id (UPID). */
export async function deleteSnapshot(
  secrets: Map<string, string>,
  args: { vmid: number; snapname: string }
): Promise<{ upid: string }> {
  const node = await resolveNode(secrets, args.vmid);
  const upid = (await px(
    secrets,
    `/nodes/${node}/qemu/${args.vmid}/snapshot/${encodeURIComponent(args.snapname)}`,
    { method: "DELETE" }
  )) as string;
  return { upid };
}
