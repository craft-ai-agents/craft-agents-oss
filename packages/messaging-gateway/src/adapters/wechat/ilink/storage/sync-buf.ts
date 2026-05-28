// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.
import fs from "node:fs";
import path from "node:path";

import { deriveRawAccountId } from "../auth/accounts";

import { resolveStateDir } from "./state-dir";

function resolveAccountsDir(): string {
  return path.join(resolveStateDir(), "openclaw-weixin", "accounts");
}

/**
 * Path to the persistent get_updates_buf file for an account.
 * Stored alongside account data: ~/.openclaw/openclaw-weixin/accounts/{accountId}.sync.json
 */
export function getSyncBufFilePath(accountId: string): string {
  return path.join(resolveAccountsDir(), `${accountId}.sync.json`);
}

/** Legacy single-account syncbuf (pre multi-account): `.openclaw-weixin-sync/default.json`. */
function getLegacySyncBufDefaultJsonPath(): string {
  return path.join(
    resolveStateDir(),
    "agents",
    "default",
    "sessions",
    ".openclaw-weixin-sync",
    "default.json",
  );
}

export type SyncBufData = {
  get_updates_buf: string;
};

function readSyncBufFile(filePath: string): string | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as { get_updates_buf?: string };
    if (typeof data.get_updates_buf === "string") {
      return data.get_updates_buf;
    }
  } catch {
    // file not found or invalid
  }
  return undefined;
}

/**
 * Load persisted get_updates_buf.
 * Falls back in order:
 *   1. Primary path (normalized accountId, new installs)
 *   2. Compat path (raw accountId derived from pattern, old installs)
 *   3. Legacy single-account path (very old installs without multi-account support)
 */
export function loadGetUpdatesBuf(filePath: string): string | undefined {
  const value = readSyncBufFile(filePath);
  if (value !== undefined) return value;

  // Compat: if given path uses a normalized accountId (e.g. "b0f5860fdecb-im-bot.sync.json"),
  // also try the old raw-ID filename (e.g. "b0f5860fdecb@im.bot.sync.json").
  const accountId = path.basename(filePath, ".sync.json");
  const rawId = deriveRawAccountId(accountId);
  if (rawId) {
    const compatPath = path.join(resolveAccountsDir(), `${rawId}.sync.json`);
    const compatValue = readSyncBufFile(compatPath);
    if (compatValue !== undefined) return compatValue;
  }

  // Legacy fallback: old single-account installs stored syncbuf without accountId.
  return readSyncBufFile(getLegacySyncBufDefaultJsonPath());
}

/**
 * Persist get_updates_buf. Creates parent dir if needed.
 */
export function saveGetUpdatesBuf(filePath: string, getUpdatesBuf: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ get_updates_buf: getUpdatesBuf }, null, 0), "utf-8");
}
