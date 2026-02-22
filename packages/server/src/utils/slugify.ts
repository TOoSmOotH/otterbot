import { nanoid } from "nanoid";

/**
 * Create a human-readable project ID from a name.
 * Result: `${slug}-${nanoid(6)}`, e.g. "my-cool-project-a7kh9d"
 */
export function makeProjectId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumeric → hyphen
    .replace(/-+/g, "-")          // collapse multiple hyphens
    .replace(/^-|-$/g, "")        // trim leading/trailing hyphens
    .slice(0, 40);                // cap length

  const suffix = nanoid(6);
  return slug ? `${slug}-${suffix}` : suffix;
}
