import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const envPath = resolve(root, ".env");
const examplePath = resolve(root, ".env.example");

if (existsSync(envPath)) {
  process.exit(0);
}

if (!existsSync(examplePath)) {
  console.warn("[otterbot] .env is missing and .env.example was not found; continuing.");
  process.exit(0);
}

const key = randomBytes(32).toString("hex");
const example = readFileSync(examplePath, "utf8");
const contents = example.replace(
  /^OTTERBOT_DB_KEY=.*$/m,
  `OTTERBOT_DB_KEY=${key}`
);

writeFileSync(envPath, contents, { mode: 0o600 });
console.log("[otterbot] Created .env from .env.example with a generated OTTERBOT_DB_KEY.");
