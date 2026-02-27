import { getConfig } from "../auth/auth.js";

export const DEFAULT_WORKER_NAMES = [
  "Alice", "Bob", "Charlie", "Dana", "Eli",
  "Fiona", "George", "Hannah", "Ivan", "Julia",
  "Kevin", "Luna", "Marcus", "Nadia", "Oscar",
  "Priya", "Quinn", "Rosa", "Sam", "Tara",
  "Uri", "Vera", "Wesley", "Xena", "Yuki",
  "Zane", "Amber", "Blake", "Chloe", "Derek",
  "Elena", "Felix", "Grace", "Hugo", "Iris",
  "Jasper", "Kira", "Leo", "Maya", "Nico",
  "Olive", "Pedro", "Rhea", "Silas", "Thea",
  "Uma", "Victor", "Wren", "Xander", "Yara",
  "Zoe", "Aiden", "Bella", "Caleb", "Daisy",
  "Ethan", "Freya", "Gavin", "Hazel", "Isaac",
  "Jade", "Kyle", "Lila", "Miles", "Nora",
  "Owen", "Piper", "Reid", "Sage", "Troy",
  "Una", "Vince", "Willow", "Xavi", "Yolanda",
  "Zara", "Ash", "Brynn", "Cruz", "Dove",
];

export function getWorkerNames(): string[] {
  const raw = getConfig("worker_names");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch { /* fall through to defaults */ }
  }
  return DEFAULT_WORKER_NAMES;
}

export function pickWorkerName(exclude: Set<string>): string {
  const names = getWorkerNames();
  const available = names.filter((n) => !exclude.has(n));
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)];
  }
  // All names in use — pick a random one and append a number
  const base = names[Math.floor(Math.random() * names.length)];
  let suffix = 2;
  while (exclude.has(`${base} ${suffix}`)) suffix++;
  return `${base} ${suffix}`;
}
