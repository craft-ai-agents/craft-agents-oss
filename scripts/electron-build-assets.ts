/**
 * Cross-platform assets copy script
 *
 * Copies bundled config assets into the Electron dist directory so they are
 * available at runtime via getBundledAssetsDir().
 */

import { existsSync, cpSync, mkdirSync } from "fs";
import { join } from "path";

const ROOT_DIR = join(import.meta.dir, "..");
const ELECTRON_DIR = join(ROOT_DIR, "apps/electron");
const DIST_ASSETS_DIR = join(ELECTRON_DIR, "dist/assets");

mkdirSync(DIST_ASSETS_DIR, { recursive: true });

// Shared assets from packages/shared/assets/
const sharedAssetsRoot = join(ROOT_DIR, "packages/shared/assets");
for (const dir of ["docs", "tool-icons"]) {
  const src = join(sharedAssetsRoot, dir);
  if (existsSync(src)) {
    cpSync(src, join(DIST_ASSETS_DIR, dir), { recursive: true, force: true });
  }
}

// Config assets from apps/electron/resources/
const resourcesRoot = join(ELECTRON_DIR, "resources");
for (const dir of ["themes", "permissions"]) {
  const src = join(resourcesRoot, dir);
  if (existsSync(src)) {
    cpSync(src, join(DIST_ASSETS_DIR, dir), { recursive: true, force: true });
  }
}

// Config defaults file (single JSON, not a directory)
const configDefaultsSrc = join(resourcesRoot, "config-defaults.json");
if (existsSync(configDefaultsSrc)) {
  cpSync(configDefaultsSrc, join(DIST_ASSETS_DIR, "config-defaults.json"), { force: true });
}

console.log("📦 Copied bundled assets to dist");
