/**
 * Cross-platform assets copy script
 *
 * Copies shared documentation files (packages/shared/assets/docs/)
 * into the Electron dist directory so they are bundled with the app.
 * At runtime, packages/shared/src/docs/index.ts reads these files
 * and installs them to ~/.g4os/docs/.
 *
 * Without this step, the packaged app falls back to placeholder content.
 * See: https://github.com/g4educacao/g4os/issues/71
 */

import { existsSync, cpSync, mkdirSync } from "fs";
import { join } from "path";

const ROOT_DIR = join(import.meta.dir, "..");
const ELECTRON_DIR = join(ROOT_DIR, "apps/electron");

const srcDir = join(ROOT_DIR, "packages/shared/assets/docs");
const destDir = join(ELECTRON_DIR, "dist/assets/docs");

if (existsSync(srcDir)) {
  mkdirSync(join(ELECTRON_DIR, "dist/assets"), { recursive: true });
  cpSync(srcDir, destDir, { recursive: true, force: true });
  console.log("📦 Copied doc assets to dist");
} else {
  console.log("⚠️ No shared assets/docs directory found");
}
