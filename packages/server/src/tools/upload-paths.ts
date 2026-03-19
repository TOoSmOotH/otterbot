import { resolve, sep } from "node:path";

function workspaceRoot(): string {
  return resolve(process.env.WORKSPACE_ROOT ?? "./data");
}

function uploadsRoot(): string {
  return resolve(workspaceRoot(), "data", "uploads");
}

function assertWithin(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (!resolvedCandidate.startsWith(resolvedRoot + sep) && resolvedCandidate !== resolvedRoot) {
    throw new Error("Resolved path escaped allowed directory");
  }
  return resolvedCandidate;
}

export function resolveUploadedImagePath(imageRef: string): string {
  const normalized = imageRef.trim();
  if (!normalized) throw new Error("imageRef is required");

  if (normalized.startsWith("/uploads/")) {
    return assertWithin(uploadsRoot(), resolve(uploadsRoot(), normalized.slice("/uploads/".length)));
  }

  if (normalized.startsWith("uploads/")) {
    return assertWithin(uploadsRoot(), resolve(uploadsRoot(), normalized.slice("uploads/".length)));
  }

  if (normalized.startsWith("/")) {
    return assertWithin(workspaceRoot(), normalized);
  }

  return assertWithin(workspaceRoot(), resolve(workspaceRoot(), normalized));
}
