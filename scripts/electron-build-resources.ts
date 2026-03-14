/**
 * Cross-platform resources copy script
 */

import { existsSync, cpSync, mkdirSync } from "fs";
import { join } from "path";

const ROOT_DIR = join(import.meta.dir, "..");
const ELECTRON_DIR = join(ROOT_DIR, "apps/electron");

const srcDir = join(ELECTRON_DIR, "resources");
const destDir = join(ELECTRON_DIR, "dist/resources");
const piSource = join(ROOT_DIR, "packages/pi-agent-server/dist/index.js");
const piDestDir = join(destDir, "pi-agent-server");
const koffiSource = join(ROOT_DIR, "node_modules/koffi");
const koffiDest = join(piDestDir, "node_modules/koffi");

function koffiPlatformDir(): string {
  const platform = process.platform === "win32"
    ? "win32"
    : process.platform === "linux"
      ? "linux"
      : "darwin";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${platform}_${arch}`;
}

if (existsSync(srcDir)) {
  cpSync(srcDir, destDir, { recursive: true, force: true });
  console.log("📦 Copied resources to dist");
} else {
  console.log("⚠️ No resources directory found");
}

if (!existsSync(piSource)) {
  console.log("⚠️ Pi agent server not found, skipping resource staging");
  process.exit(0);
}

mkdirSync(piDestDir, { recursive: true });
cpSync(piSource, join(piDestDir, "index.js"), { force: true });

if (!existsSync(koffiSource)) {
  console.log("⚠️ koffi not found, staged Pi agent server without native runtime");
  process.exit(0);
}

mkdirSync(koffiDest, { recursive: true });

for (const entry of ["package.json", "index.js", "indirect.js", "index.d.ts", "lib"]) {
  const src = join(koffiSource, entry);
  if (existsSync(src)) {
    cpSync(src, join(koffiDest, entry), { recursive: true, force: true });
  }
}

const targetDir = koffiPlatformDir();
const nativeSrc = join(koffiSource, "build", "koffi", targetDir);
const nativeDest = join(koffiDest, "build", "koffi", targetDir);

if (existsSync(nativeSrc)) {
  mkdirSync(nativeDest, { recursive: true });
  cpSync(nativeSrc, nativeDest, { recursive: true, force: true });
} else {
  cpSync(join(koffiSource, "build"), join(koffiDest, "build"), { recursive: true, force: true });
}

console.log(`🥧 Staged Pi agent server resources (${targetDir})`);
