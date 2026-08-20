// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.
import os from "node:os";
import path from "node:path";

/**
 * On-disk state dir for the vendored WeChat (iLink) transport: account index,
 * per-account credential cache, sync buffers, context tokens. The adapter sets
 * this via setStateDir() in initialize(); falls back to an env var or ~/.craft-agent.
 */
let overrideStateDir: string | undefined;

export function setStateDir(dir: string | undefined): void {
  overrideStateDir = dir?.trim() || undefined;
}

export function resolveStateDir(): string {
  return (
    overrideStateDir ||
    process.env.CRAFT_WECHAT_STATE_DIR?.trim() ||
    path.join(os.homedir(), ".craft-agent", "wechat")
  );
}
