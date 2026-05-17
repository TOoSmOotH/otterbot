import { getSkillService } from "./skill-service.js";
import { formatScanFindings, scanSkillContent } from "./skill-scanner.js";
import type { Skill, SkillMeta } from "@otterbot/shared";

/**
 * Interop with agentskills.io — the community standard for portable
 * markdown skills. Their frontmatter uses the same `name`/`description`/
 * `version`/`tags` fields we do, plus an optional `license` and
 * `dependencies` list that we translate onto our `capabilities` field.
 */

export interface AgentSkillsIoFrontmatter {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  license?: string;
  tags?: string[];
  dependencies?: string[];
  tools?: string[];
  parameters?: Record<string, { type: string; description?: string; default?: unknown }>;
}

export function fromAgentSkillsIo(raw: string): { meta: SkillMeta; body: string } {
  const parsed = getSkillService().parseSkillFile(raw);
  // agentskills.io `dependencies` maps onto our `capabilities`; the
  // parseSkillFile method already picks up standard fields.
  return parsed;
}

export function toAgentSkillsIo(skill: Skill): string {
  return getSkillService().serializeSkillFile(skill.meta, skill.body);
}

export async function importSkillFromUrl(url: string): Promise<Skill> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { accept: "text/markdown,text/plain,*/*" },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const raw = await res.text();
  return importSkillFromRaw(raw);
}

export function importSkillFromRaw(raw: string): Skill {
  const scan = scanSkillContent(raw);
  if (scan.findings.some((f) => f.severity === "error")) {
    throw new Error(
      "Skill rejected by scanner: " + formatScanFindings(scan.findings),
    );
  }
  const { meta, body } = fromAgentSkillsIo(raw);
  return getSkillService().create({ meta, body, source: "imported" }, { scanReport: scan });
}

export function exportAllSkills(): { filename: string; content: string }[] {
  const skills = getSkillService().list();
  return skills.map((s) => ({
    filename: `${slugify(s.meta.name)}.md`,
    content: toAgentSkillsIo(s),
  }));
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "skill";
}
