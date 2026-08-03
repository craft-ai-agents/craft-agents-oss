/**
 * Centralized path configuration for ARCHstudio.
 *
 * Supports multi-instance development via ARCHSTUDIO_CONFIG_DIR environment variable.
 * When running from a numbered folder (e.g., craft-tui-agent-1), the detect-instance.sh
 * script sets ARCHSTUDIO_CONFIG_DIR to ~/.archstudio-1, allowing multiple instances to run
 * simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.archstudio/
 * Instance 1 (-1 suffix): ~/.archstudio-1/
 * Instance 2 (-2 suffix): ~/.archstudio-2/
 */

// Namespace import (not `{ homedir }`): a named import destructures the
// property at module top-level before any try/catch can run. This module is
// transitively reachable from the Electron renderer bundle (via the config
// barrel), where Vite externalizes `os` behind a proxy that throws on
// property access — the renderer has no use for CONFIG_DIR, but importing
// this file must not crash the whole app.
import * as os from 'os';
import { join } from 'path';

// Allow override via environment variable for multi-instance dev
// Falls back to default ~/.archstudio/ for production and non-numbered dev folders
//
// ARCHSTUDIO_CONFIG_DIR is the supported name. CRAFT_CONFIG_DIR is still read
// as a fallback so existing shells, launch scripts, and CI jobs that predate
// the rename keep working; it can be dropped once those are updated.
function resolveConfigDir(): string {
  try {
    return (
      process.env.ARCHSTUDIO_CONFIG_DIR ||
      process.env.CRAFT_CONFIG_DIR ||
      join(os.homedir(), '.archstudio')
    );
  } catch {
    return '';
  }
}

export const CONFIG_DIR = resolveConfigDir();
