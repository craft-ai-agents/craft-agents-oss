import { spawn } from "bun";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const ROOT_DIR = join(import.meta.dir, "..");
const IS_WINDOWS = process.platform === "win32";
const BIN_EXT = IS_WINDOWS ? ".exe" : "";
const ELECTRON_BIN = join(ROOT_DIR, `node_modules/.bin/electron${BIN_EXT}`);

function loadEnvFile(filename: string): void {
  const envPath = join(ROOT_DIR, filename);
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // .env.local takes precedence — don't override if already set
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  // Load in order so .env.local overrides .env (matching Bun/Vite convention)
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const proc = spawn({
    cmd: [ELECTRON_BIN, "apps/electron"],
    cwd: ROOT_DIR,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env as Record<string, string>,
  });

  process.exit(await proc.exited);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
