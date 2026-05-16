/**
 * Database entry point.
 *
 * The multi-agent rewrite splits storage into:
 *  - one shared control DB  -> `openControlDb` (db/control-db.ts)
 *  - one isolated DB per agent -> `openAgentDb` (db/agent-db.ts)
 *
 * The `getDb` / `getRawSqlite` exports below are backwards-compatibility shims
 * that resolve to the default (COO) agent context. New code should take an
 * `AgentContext` (or its `db`/`sqlite`) explicitly instead of calling these.
 */
import type Database from "better-sqlite3-multiple-ciphers";
import { getDefaultContext } from "../runtime/default-agent.js";
import * as schema from "./schema.js";
import type { AgentDrizzle } from "./agent-db.js";

export { schema };
export { openAgentDb, recreateVecTable } from "./agent-db.js";
export type { AgentDb, AgentDrizzle } from "./agent-db.js";
export { openControlDb } from "./control-db.js";
export type { ControlDb, ControlDrizzle } from "./control-db.js";

/** @deprecated Use the COO `AgentContext.db`. Shim for legacy single-agent code. */
export function getDb(): AgentDrizzle {
  return getDefaultContext().db;
}

/** @deprecated Use the COO `AgentContext.sqlite`. Shim for legacy single-agent code. */
export function getRawSqlite(): Database.Database {
  return getDefaultContext().sqlite;
}
