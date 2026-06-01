import { mkdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Artifact } from "@otterbot/shared";

/** Common extension → MIME map for serving and persisting agent artifacts. */
const ARTIFACT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
  ".zip": "application/zip",
};

/** Resolve a MIME type from a filename's extension, defaulting to octet-stream. */
export function mimeFromName(name: string): string {
  return ARTIFACT_MIME[extname(name).toLowerCase()] ?? "application/octet-stream";
}

export interface PersistArtifactOpts {
  /** The agent's `files/` directory (from `ProfilePaths.files`). */
  filesDir: string;
  /** The owning agent's id — used to build the served URL. */
  agentId: string;
  data: Buffer;
  /** The desired/original filename; its extension drives content-type. */
  name: string;
  mimeType?: string;
  /** Override the inferred kind (defaults to image when MIME is `image/*`). */
  kind?: "image" | "file";
  prompt?: string;
}

/**
 * Persist a produced file into the agent's `files/` dir under a unique,
 * traversal-safe name, and return an {@link Artifact} referencing it. Mirrors
 * `persistImage` in `image-gen.ts`. This is the registration point for any
 * file-producing tool: return the artifact's fields in the tool result so the
 * runtime surfaces it.
 */
export function persistArtifact(opts: PersistArtifactOpts): Artifact {
  mkdirSync(opts.filesDir, { recursive: true });
  const ext = extname(opts.name);
  const stored = `art_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
  writeFileSync(join(opts.filesDir, stored), opts.data);
  const mimeType = opts.mimeType ?? mimeFromName(opts.name);
  return {
    id: stored,
    kind: opts.kind ?? (mimeType.startsWith("image/") ? "image" : "file"),
    url: `/api/agents/${opts.agentId}/files/${stored}`,
    name: opts.name,
    mimeType,
    prompt: opts.prompt,
  };
}
