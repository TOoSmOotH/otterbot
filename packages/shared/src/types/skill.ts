export interface SkillParameterDef {
  type: string;
  default?: string | number | boolean;
  description?: string;
}

export interface SkillMeta {
  name: string;
  description: string;
  version: string;
  author: string;
  tools: string[];
  capabilities: string[];
  parameters: Record<string, SkillParameterDef>;
  tags: string[];
}

export type ScanSeverity = "error" | "warning" | "info";

export interface ScanFinding {
  severity: ScanSeverity;
  category: "hidden-content" | "prompt-injection" | "dangerous-tools" | "exfiltration";
  message: string;
  line?: number;
  snippet?: string;
}

export interface ScanReport {
  clean: boolean;
  findings: ScanFinding[];
}

export type SkillScanStatus = "clean" | "warnings" | "errors" | "unscanned";

export type SkillSource = "built-in" | "created" | "imported" | "cloned";

export interface Skill {
  id: string;
  meta: SkillMeta;
  body: string;
  source: SkillSource;
  clonedFromId: string | null;
  scanStatus: SkillScanStatus;
  scanFindings: ScanFinding[];
  createdAt: string;
  updatedAt: string;
}

export interface SkillCreate {
  meta: SkillMeta;
  body: string;
}

export interface SkillUpdate {
  meta?: Partial<SkillMeta>;
  body?: string;
}
