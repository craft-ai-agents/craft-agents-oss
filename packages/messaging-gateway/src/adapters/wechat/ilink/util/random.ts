// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.
import crypto from "node:crypto";

/**
 * Generate a prefixed unique ID using timestamp + crypto random bytes.
 * Format: `{prefix}:{timestamp}-{8-char hex}`
 */
export function generateId(prefix: string): string {
  return `${prefix}:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Generate a temporary file name with random suffix.
 * Format: `{prefix}-{timestamp}-{8-char hex}{ext}`
 */
export function tempFileName(prefix: string, ext: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
}
