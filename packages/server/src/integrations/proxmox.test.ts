import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createSnapshot,
  deleteSnapshot,
  listSnapshots,
  listVms,
  rollbackSnapshot,
  startVm,
  stopVm,
  vmStatus,
} from "./proxmox.js";

/**
 * Exercises the Proxmox integration without hitting the network: a stubbed
 * `fetch` that answers the cluster-resources lookup and the follow-up action,
 * asserting auth header, URL/method, node resolution, and allowlist gating.
 */

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The two VMs the test cluster reports. */
const CLUSTER_VMS = [
  { vmid: 200, name: "test-vm", node: "pve1", status: "stopped", type: "qemu" },
  { vmid: 201, name: "other", node: "pve2", status: "running", type: "qemu" },
];

/**
 * A fetch mock that routes by URL: the cluster-resources call returns the VM
 * list; everything else returns `actionData`. Returns the spy for assertions.
 */
function stubFetch(actionData: unknown = "UPID:pve1:task") {
  const mock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.includes("/cluster/resources")) return jsonResponse(CLUSTER_VMS);
    return jsonResponse(actionData);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Base secrets with VM 200 allowed; merge overrides per test. */
function secrets(extra: Record<string, string> = {}): Map<string, string> {
  return new Map(
    Object.entries({
      PROXMOX_HOST: "pve.lan",
      PROXMOX_TOKEN_ID: "root@pam!otterbot",
      PROXMOX_TOKEN_SECRET: "secret-uuid",
      PROXMOX_ALLOWED_VMIDS: "200",
      ...extra,
    })
  );
}

describe("proxmox integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts a VM with the right auth header, node, and URL", async () => {
    const mock = stubFetch("UPID:pve1:start");
    const res = await startVm(secrets(), 200);
    expect(res.upid).toBe("UPID:pve1:start");

    // Two calls: resolve node, then start.
    expect(mock.mock.calls.length).toBe(2);
    const [clusterUrl] = mock.mock.calls[0];
    expect(clusterUrl).toBe("https://pve.lan:8006/api2/json/cluster/resources?type=vm");

    const [startUrl, startInit] = mock.mock.calls[1];
    expect(startUrl).toBe("https://pve.lan:8006/api2/json/nodes/pve1/qemu/200/status/start");
    expect((startInit as RequestInit).method).toBe("POST");
    const headers = (startInit as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("PVEAPIToken=root@pam!otterbot=secret-uuid");
  });

  it("refuses a vmid that is not in the allowlist before any fetch", async () => {
    const mock = stubFetch();
    await expect(startVm(secrets(), 999)).rejects.toThrow(/not in this agent's allowlist/);
    expect(mock).not.toHaveBeenCalled();
  });

  it("refuses every VM when the allowlist is unset", async () => {
    const mock = stubFetch();
    await expect(startVm(secrets({ PROXMOX_ALLOWED_VMIDS: "" }), 200)).rejects.toThrow(
      /No VMs are allowed/
    );
    expect(mock).not.toHaveBeenCalled();
  });

  it("throws a clear error when credentials are missing, without fetching", async () => {
    const mock = stubFetch();
    const incomplete = new Map([["PROXMOX_ALLOWED_VMIDS", "200"]]);
    await expect(startVm(incomplete, 200)).rejects.toThrow(/not configured/);
    expect(mock).not.toHaveBeenCalled();
  });

  it("surfaces a non-ok Proxmox response", async () => {
    const mock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("/cluster/resources")) return jsonResponse(CLUSTER_VMS);
      return new Response("internal error", { status: 500 });
    });
    vi.stubGlobal("fetch", mock);
    await expect(startVm(secrets(), 200)).rejects.toThrow(/Proxmox API 500: internal error/);
  });

  it("lists only allowlisted VMs", async () => {
    stubFetch();
    const vms = await listVms(secrets());
    expect(vms).toEqual([{ vmid: 200, name: "test-vm", node: "pve1", status: "stopped" }]);
  });

  it("reads VM status", async () => {
    const mock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("/cluster/resources")) return jsonResponse(CLUSTER_VMS);
      return jsonResponse({ status: "running", uptime: 42 });
    });
    vi.stubGlobal("fetch", mock);
    const res = await vmStatus(secrets(), 200);
    expect(res.status).toBe("running");
    expect(mock.mock.calls[1][0]).toBe(
      "https://pve.lan:8006/api2/json/nodes/pve1/qemu/200/status/current"
    );
  });

  it("stops gracefully by default and hard-stops when graceful=false", async () => {
    const graceful = stubFetch();
    await stopVm(secrets(), { vmid: 200 });
    expect(graceful.mock.calls[1][0]).toMatch(/\/qemu\/200\/status\/shutdown$/);
    vi.unstubAllGlobals();

    const hard = stubFetch();
    await stopVm(secrets(), { vmid: 200, graceful: false });
    expect(hard.mock.calls[1][0]).toMatch(/\/qemu\/200\/status\/stop$/);
  });

  it("lists snapshots", async () => {
    const mock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("/cluster/resources")) return jsonResponse(CLUSTER_VMS);
      return jsonResponse([
        { name: "clean", description: "fresh install", snaptime: 1 },
        { name: "current", description: "" },
      ]);
    });
    vi.stubGlobal("fetch", mock);
    const snaps = await listSnapshots(secrets(), 200);
    expect(snaps.map((s) => s.name)).toEqual(["clean", "current"]);
  });

  it("rolls back to a named snapshot via POST", async () => {
    const mock = stubFetch("UPID:pve1:rollback");
    const res = await rollbackSnapshot(secrets(), { vmid: 200, snapname: "clean" });
    expect(res.upid).toBe("UPID:pve1:rollback");
    const [url, init] = mock.mock.calls[1];
    expect(url).toBe("https://pve.lan:8006/api2/json/nodes/pve1/qemu/200/snapshot/clean/rollback");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("creates a snapshot with a form body", async () => {
    const mock = stubFetch("UPID:pve1:snap");
    await createSnapshot(secrets(), { vmid: 200, snapname: "before-test", description: "pre" });
    const [url, init] = mock.mock.calls[1];
    expect(url).toBe("https://pve.lan:8006/api2/json/nodes/pve1/qemu/200/snapshot");
    expect((init as RequestInit).method).toBe("POST");
    const body = (init as RequestInit).body as string;
    expect(body).toContain("snapname=before-test");
    expect(body).toContain("description=pre");
  });

  it("deletes a snapshot via DELETE", async () => {
    const mock = stubFetch("UPID:pve1:del");
    await deleteSnapshot(secrets(), { vmid: 200, snapname: "old" });
    const [url, init] = mock.mock.calls[1];
    expect(url).toBe("https://pve.lan:8006/api2/json/nodes/pve1/qemu/200/snapshot/old");
    expect((init as RequestInit).method).toBe("DELETE");
  });
});
