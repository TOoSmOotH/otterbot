/**
 * Database seeder for mock mode.
 *
 * Seeds config, provider, and session so the app is immediately usable
 * without real credentials or the setup wizard. Also starts the embedded
 * mock LLM HTTP server and points the provider at it.
 */
import { randomUUID } from "node:crypto";
import { getDb, schema } from "../db/index.js";
import { hashPassphrase, setConfig } from "../auth/auth.js";
import { startMockLLMServer } from "./mock-llm.js";

export async function seedMockData(): Promise<void> {
  const db = getDb();
  const passphrase = process.env.MOCK_PASSPHRASE ?? "demo";

  // ── Start embedded mock LLM server ──────────────────────────────
  const mockPort = await startMockLLMServer();
  const mockBaseUrl = `http://127.0.0.1:${mockPort}`;

  // ── Config: passphrase ──────────────────────────────────────────
  const hash = await hashPassphrase(passphrase);
  setConfig("passphrase_hash", hash);

  // ── Provider: mock provider ─────────────────────────────────────
  const providerId = "mock-provider";
  db.insert(schema.providers)
    .values({
      id: providerId,
      name: "Mock Provider",
      type: "openai-compatible",
      apiKey: "mock-key",
      baseUrl: mockBaseUrl,
    })
    .onConflictDoUpdate({
      target: schema.providers.id,
      set: { baseUrl: mockBaseUrl, apiKey: "mock-key" },
    })
    .run();

  // ── Config: COO & worker model/provider ─────────────────────────
  setConfig("coo_provider", providerId);
  setConfig("coo_model", "mock-model");
  setConfig("worker_provider", providerId);
  setConfig("worker_model", "mock-model");

  // ── Registry entry for workers ──────────────────────────────────
  const registryId = "mock-full-stack-dev";
  db.insert(schema.registryEntries)
    .values({
      id: registryId,
      name: "Full-Stack Developer",
      description: "A versatile developer for building web applications",
      systemPrompt: "You are a full-stack developer. Build what is asked.",
      capabilities: ["code", "web", "api", "database"],
      defaultModel: "mock-model",
      defaultProvider: providerId,
      tools: ["file_read", "file_write", "shell_exec"],
      builtIn: false,
      role: "worker",
    })
    .onConflictDoNothing()
    .run();

  // Note: do NOT set coo_registry_id to the worker entry — the COO
  // filters its tools through skills assigned to its registry entry,
  // and worker skills would hide all COO tools. Leaving it unset makes
  // the COO fall back to builtin-coo with all tools available.

  // ── Skill + agent_skills: wire tools to registry entry ────────
  // Worker tools are derived from skills, not from the registry entry's
  // tools column. We must create a skill and assign it.
  const skillId = "mock-dev-skill";
  const now = new Date().toISOString();
  db.insert(schema.skills)
    .values({
      id: skillId,
      name: "Development Tools",
      description: "File and shell access for building projects",
      version: "1.0.0",
      author: "mock",
      tools: ["file_read", "file_write", "shell_exec"],
      capabilities: ["code", "web", "api", "database"],
      parameters: {},
      tags: [],
      body: "You can read, write files and execute shell commands.",
      source: "built-in",
      scanStatus: "clean",
      scanFindings: [],
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  db.insert(schema.agentSkills)
    .values({ registryEntryId: registryId, skillId })
    .onConflictDoNothing()
    .run();

  // ── Session: auto-auth so mock mode bypasses login ──────────────
  const sessionToken = "mock-session-" + randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.insert(schema.sessions)
    .values({ token: sessionToken, expiresAt })
    .onConflictDoNothing()
    .run();

  console.log(`[mock] Database seeded.`);
  console.log(`[mock] Passphrase: "${passphrase}"`);
  console.log(`[mock] Session token: ${sessionToken}`);
  console.log(`[mock] Provider: ${providerId} → ${mockBaseUrl}`);
}
