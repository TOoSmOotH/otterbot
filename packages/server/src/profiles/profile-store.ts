import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  copyFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseDotenv } from "dotenv";
import type { AgentProfile, AgentRole, ChannelBotConfig, ModelRef } from "@otterbot/shared";

/** Resolved on-disk paths for one agent profile directory. */
export interface ProfilePaths {
  id: string;
  dir: string;
  profileJson: string;
  soulMd: string;
  envFile: string;
  agentDb: string;
  skillsDir: string;
  subagentsDir: string;
  /** Sandboxed working directory for the agent's `shell_exec` tool. */
  workspace: string;
}

export function profilePaths(root: string, id: string): ProfilePaths {
  const dir = resolve(root, id);
  return {
    id,
    dir,
    profileJson: join(dir, "profile.json"),
    soulMd: join(dir, "SOUL.md"),
    envFile: join(dir, ".env"),
    agentDb: join(dir, "agent.db"),
    skillsDir: join(dir, "skills"),
    subagentsDir: join(dir, "subagents"),
    workspace: join(dir, "workspace"),
  };
}

const DEFAULT_COO_PERSONA = `You are Otterbot's COO — the coordinating agent.

You answer the user directly, and you coordinate a team of specialized agents.
When a request is better handled by another agent, delegate it and relay the
result. You remember things across sessions and build a model of the user over
time.

Principles:
- Be direct and concrete; prefer action over description.
- Acknowledge learnings naturally ("Got it", "Noted").
- Delegate work that matches another agent's specialty rather than guessing.
`;

/** On-disk shape of `profile.json` — the full profile minus the persona (SOUL.md). */
type ProfileJson = Omit<AgentProfile, "persona">;

function lmstudioRef(modelId: string): ModelRef {
  return { provider: "lmstudio", modelId };
}

/**
 * Manages agent profile directories on disk. Each profile is a self-contained
 * Hermes-style home directory: `profile.json`, `SOUL.md`, `.env`, `agent.db`,
 * `skills/`, `subagents/`.
 */
export class ProfileStore {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  pathsFor(id: string): ProfilePaths {
    return profilePaths(this.root, id);
  }

  exists(id: string): boolean {
    return existsSync(profilePaths(this.root, id).profileJson);
  }

  /** List all profile ids that have a `profile.json`. */
  listIds(): string[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root).filter((name) => {
      const p = join(this.root, name);
      try {
        return statSync(p).isDirectory() && existsSync(join(p, "profile.json"));
      } catch {
        return false;
      }
    });
  }

  list(): AgentProfile[] {
    return this.listIds().map((id) => this.load(id));
  }

  /** Load a profile, resolving the persona from SOUL.md. */
  load(id: string): AgentProfile {
    const paths = profilePaths(this.root, id);
    if (!existsSync(paths.profileJson)) {
      throw new Error(`Profile not found: ${id}`);
    }
    const json = JSON.parse(readFileSync(paths.profileJson, "utf8")) as Partial<ProfileJson>;
    const persona = existsSync(paths.soulMd) ? readFileSync(paths.soulMd, "utf8") : "";
    return normalizeProfile({ ...json, id, persona });
  }

  /** Persist a profile: writes `profile.json` (minus persona) and `SOUL.md`. */
  save(profile: AgentProfile): void {
    const paths = profilePaths(this.root, profile.id);
    mkdirSync(paths.dir, { recursive: true });
    mkdirSync(paths.skillsDir, { recursive: true });
    const { persona, ...json } = profile;
    writeFileSync(paths.profileJson, JSON.stringify(json, null, 2), "utf8");
    writeFileSync(paths.soulMd, persona, "utf8");
  }

  /**
   * Read a legacy plaintext `.env` from a profile directory, if one exists.
   * Used once at boot to migrate old credentials into the encrypted database.
   */
  readLegacyEnv(id: string): Map<string, string> | null {
    const paths = profilePaths(this.root, id);
    if (!existsSync(paths.envFile)) return null;
    const parsed = parseDotenv(readFileSync(paths.envFile, "utf8"));
    return new Map(Object.entries(parsed));
  }

  /** Delete a profile's legacy `.env` after its secrets have been migrated. */
  removeLegacyEnv(id: string): void {
    const paths = profilePaths(this.root, id);
    if (existsSync(paths.envFile)) rmSync(paths.envFile, { force: true });
  }

  /** Scaffold a new profile directory and persist it. */
  create(profile: AgentProfile): AgentProfile {
    const normalized = normalizeProfile(profile);
    this.save(normalized);
    return normalized;
  }

  delete(id: string): void {
    const paths = profilePaths(this.root, id);
    if (existsSync(paths.dir)) rmSync(paths.dir, { recursive: true, force: true });
  }

  /**
   * Ensure a default COO profile exists. Optionally seeds it with legacy
   * skill markdown files from a previous install.
   */
  ensureCooProfile(opts: { chatModelId: string; legacySkillsDir?: string }): AgentProfile {
    if (this.exists("coo")) return this.load("coo");

    const paths = profilePaths(this.root, "coo");
    mkdirSync(paths.dir, { recursive: true });
    mkdirSync(paths.skillsDir, { recursive: true });

    // Migrate legacy skill files, if present.
    if (opts.legacySkillsDir && existsSync(opts.legacySkillsDir)) {
      for (const name of readdirSync(opts.legacySkillsDir)) {
        if (!name.endsWith(".md")) continue;
        copyFileSync(join(opts.legacySkillsDir, name), join(paths.skillsDir, name));
      }
    }

    const now = new Date().toISOString();
    const profile: AgentProfile = {
      id: "coo",
      displayName: "Otterbot COO",
      role: "coo",
      persona: DEFAULT_COO_PERSONA,
      model: {
        chat: lmstudioRef(opts.chatModelId),
        embedding: lmstudioRef(opts.chatModelId),
      },
      allowedModels: [{ provider: "lmstudio", modelId: "*" }],
      allowedChatServices: ["web"],
      transport: "local",
      slack: null,
      discord: null,
      email: null,
      artwork: { avatar: null },
      allowedPeers: [],
      canSpawnSubagents: true,
      subagentLimit: 5,
      canRunShell: false,
      parentId: null,
      createdAt: now,
    };
    this.save(profile);
    console.info("[profiles] created default COO profile");
    return profile;
  }
}

/** Fill in defaults on a channel connector config (older profiles lack newer fields). */
function normalizeChannel(c: ChannelBotConfig | null | undefined): ChannelBotConfig | null {
  if (!c) return null;
  return {
    enabled: c.enabled ?? false,
    channelId: c.channelId ?? "",
    publicBot: c.publicBot ?? false,
    allowedUserIds: c.allowedUserIds ?? [],
    // Default to @mention-only so the agent isn't noisy in a shared channel.
    mentionOnly: c.mentionOnly ?? true,
  };
}

/** Fill in defaults for any missing fields so older/partial profiles still load. */
export function normalizeProfile(p: Partial<AgentProfile> & { id: string }): AgentProfile {
  const role: AgentRole = p.role ?? "agent";
  const chat: ModelRef = p.model?.chat ?? lmstudioRef("local-model");
  const embedding: ModelRef = p.model?.embedding ?? chat;
  return {
    id: p.id,
    displayName: p.displayName ?? p.id,
    role,
    persona: p.persona ?? "",
    model: { chat, embedding },
    allowedModels: p.allowedModels?.length
      ? p.allowedModels
      : [{ provider: chat.provider, modelId: "*" }],
    allowedChatServices: p.allowedChatServices ?? ["web"],
    transport: p.transport ?? "local",
    slack: normalizeChannel(p.slack),
    discord: normalizeChannel(p.discord),
    email: p.email ?? null,
    artwork: { avatar: p.artwork?.avatar ?? null },
    allowedPeers: p.allowedPeers ?? [],
    canSpawnSubagents: p.canSpawnSubagents ?? role !== "subagent",
    subagentLimit: p.subagentLimit ?? 5,
    canRunShell: p.canRunShell ?? false,
    parentId: p.parentId ?? null,
    createdAt: p.createdAt ?? new Date().toISOString(),
  };
}
