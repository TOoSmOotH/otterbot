// ---------------------------------------------------------------------------
// Specialist Agent types (formerly "Module system")
//
// Specialist Agents are agents with their own isolated knowledge store,
// data ingestion pipeline, config schema, and tools. They are the primary
// extension point for connecting Otterbot to external data sources.
//
// The "Module" naming is preserved for backward compatibility — internally
// a specialist agent is implemented as a module.
// ---------------------------------------------------------------------------

/**
 * Opaque type alias for the better-sqlite3 Database instance.
 * Specialist authors who need raw DB access can cast to their preferred type.
 * We avoid importing better-sqlite3 here to keep the shared package dependency-free.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ModuleDatabase {
  prepare(sql: string): { run(...params: unknown[]): unknown; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
}

// ─── Manifest ────────────────────────────────────────────────────────────────

export interface ModuleManifest {
  id: string;
  name: string;
  version: string; // semver
  description: string;
  author?: string;
}

// ─── Config schema ───────────────────────────────────────────────────────────

export interface ModuleConfigField {
  type: "string" | "number" | "boolean" | "secret" | "select";
  description: string;
  required: boolean;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
}

export type ModuleConfigSchema = Record<string, ModuleConfigField>;

// ─── Triggers ────────────────────────────────────────────────────────────────

export interface PollTrigger {
  type: "poll";
  intervalMs: number;
  minIntervalMs?: number;
}

export interface WebhookTrigger {
  type: "webhook";
  path: string;
}

export type ModuleTrigger = PollTrigger | WebhookTrigger;

// ─── Handler results ────────────────────────────────────────────────────────

export interface PollResultItem {
  id: string;
  title: string;
  content: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface PollResult {
  items: PollResultItem[];
  summary?: string;
}

export interface WebhookRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  params: Record<string, string>;
  query: Record<string, string>;
}

export interface WebhookResult {
  status?: number;
  body?: unknown;
  items?: PollResultItem[];
}

// ─── Knowledge store ─────────────────────────────────────────────────────────

export interface KnowledgeDocument {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeStore {
  db: ModuleDatabase;
  upsert(id: string, content: string, metadata?: Record<string, unknown>): Promise<void>;
  search(query: string, limit?: number): Promise<KnowledgeDocument[]>;
  delete(id: string): void;
  get(id: string): KnowledgeDocument | null;
  count(): number;
}

// ─── LLM access for modules ─────────────────────────────────────────────────

export interface GenerateResponseOptions {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  temperature?: number;
  maxSteps?: number;
}

export interface GenerateResponseResult {
  text: string;
}

// ─── Module context ──────────────────────────────────────────────────────────

export interface ModuleContext {
  knowledge: KnowledgeStore;
  getConfig(key: string): string | undefined;
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** Generate an LLM response using the server's configured provider. Available at runtime. */
  generateResponse?(options: GenerateResponseOptions): Promise<GenerateResponseResult>;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

export type PollHandler = (ctx: ModuleContext) => Promise<PollResult>;
export type FullSyncHandler = (ctx: ModuleContext) => Promise<PollResult>;
export type WebhookHandler = (req: WebhookRequest, ctx: ModuleContext) => Promise<WebhookResult>;
export type QueryHandler = (query: string, ctx: ModuleContext) => Promise<string>;

// ─── Migrations ──────────────────────────────────────────────────────────────

export interface ModuleMigration {
  version: number;
  description: string;
  up(db: ModuleDatabase): void;
  down?(db: ModuleDatabase): void;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export interface ModuleToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute(args: Record<string, unknown>, ctx: ModuleContext): Promise<string>;
}

// ─── Module definition ───────────────────────────────────────────────────────

export interface ModuleAgentConfig {
  defaultName: string;
  defaultPrompt: string;
  defaultModel?: string;
  defaultProvider?: string;
}

export interface ModuleDefinition {
  manifest: ModuleManifest;
  configSchema?: ModuleConfigSchema;
  triggers?: ModuleTrigger[];
  migrations?: ModuleMigration[];
  tools?: ModuleToolDefinition[];
  agent?: ModuleAgentConfig;
  onPoll?: PollHandler;
  onFullSync?: FullSyncHandler;
  onWebhook?: WebhookHandler;
  onQuery?: QueryHandler;
  onLoad?(ctx: ModuleContext): Promise<void>;
  onUnload?(ctx: ModuleContext): Promise<void>;
}

// ─── Installed module tracking ───────────────────────────────────────────────

export type ModuleSource = "git" | "npm" | "local";

export interface InstalledModule {
  id: string;
  /** Module type ID from manifest.id (e.g. "github-discussions"). Multiple instances can share the same moduleId. */
  moduleId: string;
  name: string;
  version: string;
  source: ModuleSource;
  sourceUri: string;
  enabled: boolean;
  modulePath: string;
  installedAt: string;
  updatedAt: string;
}

export interface ModulesManifest {
  version: 1;
  modules: InstalledModule[];
}

// ─── defineModule() / defineSpecialist() ─────────────────────────────────────

/** Identity function for type narrowing — module authors use this to define their module. */
export function defineModule(def: ModuleDefinition): ModuleDefinition {
  return def;
}

// ─── Specialist Agent aliases ────────────────────────────────────────────────
// User-facing name for the module system. These are type aliases only —
// the underlying implementation is unchanged.

/** A specialist agent definition. Alias for ModuleDefinition. */
export type SpecialistDefinition = ModuleDefinition;

/** A specialist agent's manifest. Alias for ModuleManifest. */
export type SpecialistManifest = ModuleManifest;

/** A specialist agent's config schema. Alias for ModuleConfigSchema. */
export type SpecialistConfigSchema = ModuleConfigSchema;

/** A specialist agent's config field. Alias for ModuleConfigField. */
export type SpecialistConfigField = ModuleConfigField;

/** A specialist agent's AI config. Alias for ModuleAgentConfig. */
export type SpecialistAgentConfig = ModuleAgentConfig;

/** An installed specialist agent. Alias for InstalledModule. */
export type InstalledSpecialist = InstalledModule;

/** Define a specialist agent. Alias for defineModule(). */
export const defineSpecialist = defineModule;
