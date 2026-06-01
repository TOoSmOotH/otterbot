import { and, eq } from "drizzle-orm";
import type { Connection, ConnectionType } from "@otterbot/shared";
import { isChatConnectionType } from "@otterbot/shared";
import { controlSchema, type ControlDb } from "../db/control-db.js";
import { getConnectionTypeDef } from "../integrations/connection-registry.js";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "connection"
  );
}

/**
 * Named connectors that reference a {@link Credential} and carry non-secret
 * per-connector config. Assigned to agents via the `connection_assignments`
 * link table. The v1 "one chat connection per agent / per connection" rule is
 * enforced by the orchestrator's assign path; this store provides the
 * primitives it checks against.
 */
export class ConnectionStore {
  constructor(private readonly control: ControlDb) {}

  list(): Connection[] {
    const rows = this.control.db.select().from(controlSchema.connections).all();
    return rows.map((r) => this.toConnection(r));
  }

  get(id: string): Connection | null {
    const r = this.control.db
      .select()
      .from(controlSchema.connections)
      .where(eq(controlSchema.connections.id, id))
      .get();
    return r ? this.toConnection(r) : null;
  }

  create(input: {
    type: ConnectionType;
    label: string;
    config?: Record<string, unknown>;
    credentialId?: string | null;
    id?: string;
  }): Connection {
    if (!getConnectionTypeDef(input.type)) throw new Error(`unknown connection type: ${input.type}`);
    const id = this.uniqueId(input.id ?? input.label ?? input.type);
    const now = new Date().toISOString();
    this.control.db
      .insert(controlSchema.connections)
      .values({
        id,
        label: input.label || input.type,
        type: input.type,
        config: input.config ?? {},
        credentialId: input.credentialId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return this.get(id)!;
  }

  update(
    id: string,
    patch: { label?: string; config?: Record<string, unknown>; credentialId?: string | null }
  ): Connection | null {
    const existing = this.get(id);
    if (!existing) return null;
    const sets: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (patch.label !== undefined) sets.label = patch.label;
    if (patch.config !== undefined) sets.config = patch.config;
    if (patch.credentialId !== undefined) sets.credentialId = patch.credentialId;
    this.control.db.update(controlSchema.connections).set(sets).where(eq(controlSchema.connections.id, id)).run();
    return this.get(id);
  }

  delete(id: string): boolean {
    this.control.db
      .delete(controlSchema.connectionAssignments)
      .where(eq(controlSchema.connectionAssignments.connectionId, id))
      .run();
    const res = this.control.db.delete(controlSchema.connections).where(eq(controlSchema.connections.id, id)).run();
    return res.changes > 0;
  }

  // --- assignments ----------------------------------------------------------

  /** Agent ids a connection is assigned to. */
  assigneesOf(connectionId: string): string[] {
    return this.control.db
      .select({ agentId: controlSchema.connectionAssignments.agentId })
      .from(controlSchema.connectionAssignments)
      .where(eq(controlSchema.connectionAssignments.connectionId, connectionId))
      .all()
      .map((r) => r.agentId);
  }

  /** All connections assigned to an agent. */
  connectionsForAgent(agentId: string): Connection[] {
    const ids = this.control.db
      .select({ connectionId: controlSchema.connectionAssignments.connectionId })
      .from(controlSchema.connectionAssignments)
      .where(eq(controlSchema.connectionAssignments.agentId, agentId))
      .all()
      .map((r) => r.connectionId);
    return ids.map((id) => this.get(id)).filter((c): c is Connection => c !== null);
  }

  chatConnectionsForAgent(agentId: string): Connection[] {
    return this.connectionsForAgent(agentId).filter((c) => isChatConnectionType(c.type));
  }

  isAssigned(connectionId: string, agentId: string): boolean {
    return (
      this.control.db
        .select({ agentId: controlSchema.connectionAssignments.agentId })
        .from(controlSchema.connectionAssignments)
        .where(
          and(
            eq(controlSchema.connectionAssignments.connectionId, connectionId),
            eq(controlSchema.connectionAssignments.agentId, agentId)
          )
        )
        .get() !== undefined
    );
  }

  assign(connectionId: string, agentId: string): void {
    if (this.isAssigned(connectionId, agentId)) return;
    this.control.db
      .insert(controlSchema.connectionAssignments)
      .values({ connectionId, agentId, createdAt: new Date().toISOString() })
      .run();
  }

  unassign(connectionId: string, agentId: string): boolean {
    const res = this.control.db
      .delete(controlSchema.connectionAssignments)
      .where(
        and(
          eq(controlSchema.connectionAssignments.connectionId, connectionId),
          eq(controlSchema.connectionAssignments.agentId, agentId)
        )
      )
      .run();
    return res.changes > 0;
  }

  /** Drop every assignment for an agent (e.g. on agent delete). */
  clearAgent(agentId: string): void {
    this.control.db
      .delete(controlSchema.connectionAssignments)
      .where(eq(controlSchema.connectionAssignments.agentId, agentId))
      .run();
  }

  // --- internals ------------------------------------------------------------

  private toConnection(r: {
    id: string;
    label: string;
    type: string;
    config: Record<string, unknown>;
    credentialId: string | null;
    createdAt: string;
    updatedAt: string;
  }): Connection {
    return {
      id: r.id,
      label: r.label,
      type: r.type,
      config: r.config ?? {},
      credentialId: r.credentialId ?? null,
      assignedAgentIds: this.assigneesOf(r.id),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private uniqueId(base: string): string {
    const root = slugify(base);
    let id = root;
    let n = 2;
    const exists = (candidate: string) =>
      this.control.db
        .select({ id: controlSchema.connections.id })
        .from(controlSchema.connections)
        .where(eq(controlSchema.connections.id, candidate))
        .get() !== undefined;
    while (exists(id)) id = `${root}-${n++}`;
    return id;
  }
}
