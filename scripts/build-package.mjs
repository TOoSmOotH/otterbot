#!/usr/bin/env node
/**
 * Assemble the publishable `otterbot` npm package into `dist-pkg/`.
 *
 * Otterbot is a pnpm monorepo, but it ships as ONE self-contained public
 * package: the compiled server, the compiled CLI, the built web assets, and the
 * 3D `assets/` directory, with a generated `package.json` whose dependencies are
 * the union of the server's and CLI's third-party runtime deps.
 *
 * `@otterbot/shared` is type-only at runtime (the compiled `.js` never imports
 * it), so no bundler is needed — the `dist` directories are copied as-is.
 *
 * Run from the repo root after `pnpm build`:  node scripts/build-package.mjs
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(repoRoot, "dist-pkg");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const rootPkg = readJson(join(repoRoot, "package.json"));
const serverPkg = readJson(join(repoRoot, "packages", "server", "package.json"));
const cliPkg = readJson(join(repoRoot, "packages", "cli", "package.json"));

// --- Sanity: every input the package needs must be built ---------------------
const inputs = [
  ["packages/cli/dist", "cli"],
  ["packages/server/dist", "server"],
  ["packages/web/dist", "web"],
  ["assets", "assets"],
];
for (const [src] of inputs) {
  if (!existsSync(join(repoRoot, src))) {
    console.error(`[build-package] missing ${src} — run \`pnpm build\` first.`);
    process.exit(1);
  }
}

// --- Merge the runtime dependencies ------------------------------------------
// The published package contains the server + CLI code directly, so it needs
// their third-party deps. Workspace deps (`@otterbot/*`) are dropped.
const dependencies = {};
for (const [name, version] of [
  ...Object.entries(serverPkg.dependencies ?? {}),
  ...Object.entries(cliPkg.dependencies ?? {}),
]) {
  if (name.startsWith("@otterbot/")) continue;
  if (dependencies[name] && dependencies[name] !== version) {
    console.warn(`[build-package] dependency ${name} version mismatch — keeping ${dependencies[name]}`);
    continue;
  }
  dependencies[name] = version;
}
const sortedDeps = Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)));

// --- Generate the published package.json -------------------------------------
// No `author` field: the personal name is intentionally kept only in LICENSE.
const pkg = {
  name: "otterbot",
  // release-please bumps the root version; beta builds override it via env.
  version: process.env.OTTERBOT_PKG_VERSION ?? rootPkg.version,
  description: rootPkg.description,
  license: rootPkg.license,
  repository: rootPkg.repository ?? "https://github.com/TOoSmOotH/otterbot",
  type: "module",
  bin: { otterbot: "./cli/cli.js", otter: "./cli/cli.js" },
  files: ["cli", "server", "web", "assets"],
  engines: { node: ">=20" },
  dependencies: sortedDeps,
};

// --- Assemble dist-pkg/ ------------------------------------------------------
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const [src, dest] of inputs) {
  cpSync(join(repoRoot, src), join(outDir, dest), { recursive: true });
}
for (const file of ["README.md", "LICENSE"]) {
  if (existsSync(join(repoRoot, file))) cpSync(join(repoRoot, file), join(outDir, file));
}
writeFileSync(join(outDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`[build-package] assembled otterbot@${pkg.version} → ${outDir}`);
console.log(`[build-package] ${Object.keys(sortedDeps).length} runtime dependencies`);
