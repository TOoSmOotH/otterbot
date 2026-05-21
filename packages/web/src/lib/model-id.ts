/** Slugify a label into a model-id root (mirrors the server's `slugify`). */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "model"
  );
}

/** A configured-model id derived from `base`, unique within `existingIds`. */
export function uniqueModelId(existingIds: string[], base: string): string {
  const root = slugify(base);
  let id = root;
  let n = 2;
  while (existingIds.includes(id)) id = `${root}-${n++}`;
  return id;
}
