import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { AppManifest, AppTemplate, AppFramework, AppStatus } from "@otterbot/shared";

const TEMPLATES_DIR = path.resolve(process.cwd(), "assets/app-templates");

/**
 * Discover available app templates from the assets/app-templates directory.
 */
export function listAppTemplates(): AppTemplate[] {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];

  const entries = fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true });
  const templates: AppTemplate[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const templateJsonPath = path.join(TEMPLATES_DIR, entry.name, "template.json");
    if (!fs.existsSync(templateJsonPath)) continue;

    try {
      const raw = fs.readFileSync(templateJsonPath, "utf-8");
      const tmpl = JSON.parse(raw) as AppTemplate;
      templates.push(tmpl);
    } catch {
      console.warn(`[app-service] Failed to parse template: ${templateJsonPath}`);
    }
  }

  return templates;
}

/**
 * Get the apps directory for a given workspace.
 */
function appsDir(workspacePath: string): string {
  return path.join(workspacePath, "apps");
}

/**
 * Get the directory for a specific app.
 */
function appDir(workspacePath: string, appId: string): string {
  return path.join(appsDir(workspacePath), appId);
}

/**
 * Create a new app from a template.
 */
export function createApp(
  workspacePath: string,
  opts: {
    name: string;
    framework: string;
    templateId?: string;
    description?: string;
    projectId: string;
  },
): AppManifest {
  const appId = nanoid(12);
  const dir = appDir(workspacePath, appId);

  // Create directory structure
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "assets", "images"), { recursive: true });

  // Determine template and entry point defaults based on framework
  const framework = opts.framework as AppFramework;
  let entryPoint = "index.html";
  let buildCommand: string | undefined;
  let devCommand: string | undefined;
  let outputDir: string | undefined;

  switch (framework) {
    case "react":
      buildCommand = "npm run build";
      devCommand = "npm run dev";
      outputDir = "dist";
      break;
    case "vue":
      buildCommand = "npm run build";
      devCommand = "npm run dev";
      outputDir = "dist";
      break;
    case "nextjs":
      buildCommand = "npm run build";
      devCommand = "npm run dev";
      outputDir = ".next";
      entryPoint = "src/pages/index.tsx";
      break;
    case "astro":
      buildCommand = "npm run build";
      devCommand = "npm run dev";
      outputDir = "dist";
      entryPoint = "src/pages/index.astro";
      break;
    default:
      // html, custom — no build step
      break;
  }

  // Copy template files if a template is specified
  const templateId = opts.templateId ?? `${framework}-basic`;
  const templateDir = path.join(TEMPLATES_DIR, templateId);

  if (fs.existsSync(templateDir)) {
    copyDirRecursive(templateDir, dir, opts.name, opts.description);
  }

  // Create manifest
  const now = new Date().toISOString();
  const manifest: AppManifest = {
    id: appId,
    name: opts.name,
    description: opts.description ?? "",
    version: "0.1.0",
    framework,
    entryPoint,
    buildCommand,
    devCommand,
    outputDir,
    tags: [],
    status: "draft" as AppStatus,
    projectId: opts.projectId,
    createdAt: now,
    updatedAt: now,
  };

  // Write manifest
  fs.writeFileSync(path.join(dir, "app.json"), JSON.stringify(manifest, null, 2));

  return manifest;
}

/**
 * List all apps in a workspace, optionally filtered by projectId.
 */
export function listApps(workspacePath: string, projectId?: string): AppManifest[] {
  const dir = appsDir(workspacePath);
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const apps: AppManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, "app.json");
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(raw) as AppManifest;
      if (!projectId || manifest.projectId === projectId) {
        apps.push(manifest);
      }
    } catch {
      console.warn(`[app-service] Failed to parse app manifest: ${manifestPath}`);
    }
  }

  return apps;
}

/**
 * Get a single app manifest.
 */
export function getApp(workspacePath: string, appId: string): AppManifest | null {
  const manifestPath = path.join(appDir(workspacePath, appId), "app.json");
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(raw) as AppManifest;
  } catch {
    return null;
  }
}

/**
 * Build an app.
 * For HTML framework, copies source to dist/.
 * For react/vue/nextjs/astro, runs the build command via child_process.
 */
export function buildApp(
  workspacePath: string,
  appId: string,
): { ok: boolean; manifest?: AppManifest; error?: string } {
  const dir = appDir(workspacePath, appId);
  const manifestPath = path.join(dir, "app.json");

  if (!fs.existsSync(manifestPath)) {
    return { ok: false, error: "App not found" };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as AppManifest;

  if (manifest.framework === "html" || manifest.framework === "custom") {
    // Simple copy to dist/
    const distDir = path.join(dir, "dist");

    if (fs.existsSync(distDir)) {
      fs.rmSync(distDir, { recursive: true, force: true });
    }
    fs.mkdirSync(distDir, { recursive: true });

    // Copy all files except dist, app.json, template.json, node_modules
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (["dist", "app.json", "template.json", "node_modules"].includes(entry.name)) continue;
      const src = path.join(dir, entry.name);
      const dest = path.join(distDir, entry.name);
      if (entry.isDirectory()) {
        copyDirRecursive(src, dest);
      } else {
        fs.copyFileSync(src, dest);
      }
    }
  } else if (manifest.buildCommand) {
    // Run build command for frameworks that need it
    try {
      execSync(manifest.buildCommand, {
        cwd: dir,
        stdio: "pipe",
        timeout: 120_000,
        env: { ...process.env, NODE_ENV: "production" },
      });
    } catch (err) {
      const message = err instanceof Error ? (err as any).stderr?.toString() || err.message : String(err);
      return { ok: false, error: `Build command failed: ${message}` };
    }
  }

  // Update manifest status
  manifest.status = "preview" as AppStatus;
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return { ok: true, manifest };
}

/**
 * Delete an app and its files.
 */
export function deleteApp(workspacePath: string, appId: string): boolean {
  const dir = appDir(workspacePath, appId);
  if (!fs.existsSync(dir)) return false;

  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * Get the absolute path to an app's dist directory for static file serving.
 */
export function getAppDistPath(workspacePath: string, appId: string): string | null {
  const dist = path.join(appDir(workspacePath, appId), "dist");
  return fs.existsSync(dist) ? dist : null;
}

/**
 * Get the absolute path to an app's source directory.
 */
export function getAppSourcePath(workspacePath: string, appId: string): string | null {
  const dir = appDir(workspacePath, appId);
  return fs.existsSync(dir) ? dir : null;
}

// --- Helpers ---

function copyDirRecursive(src: string, dest: string, appName?: string, appDescription?: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.name === "template.json") continue;

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, appName, appDescription);
    } else {
      let content = fs.readFileSync(srcPath, "utf-8");
      // Replace template placeholders
      if (appName) {
        content = content.replace(/\{\{APP_NAME\}\}/g, appName);
      }
      if (appDescription) {
        content = content.replace(/\{\{APP_DESCRIPTION\}\}/g, appDescription);
      }
      fs.writeFileSync(destPath, content);
    }
  }
}
