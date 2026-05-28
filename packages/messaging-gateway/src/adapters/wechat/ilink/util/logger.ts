// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Vendored logger — writes JSON lines to a daily file under the OS temp dir:
 *   <tmpDir>/craft-wechat-logs/craft-wechat-YYYY-MM-DD.log
 */

const MAIN_LOG_DIR = path.join(os.tmpdir(), "craft-wechat-logs");
const SUBSYSTEM = "messaging/channels/wechat";
const RUNTIME = "node";
const RUNTIME_VERSION = process.versions.node;
const HOSTNAME = os.hostname() || "unknown";
const PARENT_NAMES = ["openclaw"];

/** tslog-compatible level IDs (higher = more severe). */
const LEVEL_IDS: Record<string, number> = {
  TRACE: 1,
  DEBUG: 2,
  INFO: 3,
  WARN: 4,
  ERROR: 5,
  FATAL: 6,
};

const DEFAULT_LOG_LEVEL = "INFO";

function resolveMinLevel(): number {
  const env = process.env.OPENCLAW_LOG_LEVEL?.toUpperCase();
  if (env && env in LEVEL_IDS) return LEVEL_IDS[env] ?? 3;
  return LEVEL_IDS[DEFAULT_LOG_LEVEL] ?? 3;
}

let minLevelId = resolveMinLevel();

/** Dynamically change the minimum log level at runtime. */
export function setLogLevel(level: string): void {
  const upper = level.toUpperCase();
  if (!(upper in LEVEL_IDS)) {
    throw new Error(`Invalid log level: ${level}. Valid levels: ${Object.keys(LEVEL_IDS).join(", ")}`);
  }
  minLevelId = LEVEL_IDS[upper] ?? minLevelId;
}

/** Shift a Date into local time so toISOString() renders local clock digits. */
function toLocalISO(now: Date): string {
  const offsetMs = -now.getTimezoneOffset() * 60_000;
  const sign = offsetMs >= 0 ? "+" : "-";
  const abs = Math.abs(now.getTimezoneOffset());
  const offStr = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return new Date(now.getTime() + offsetMs).toISOString().replace("Z", offStr);
}

function localDateKey(now: Date): string {
  return toLocalISO(now).slice(0, 10);
}

function resolveMainLogPath(): string {
  const dateKey = localDateKey(new Date());
  return path.join(MAIN_LOG_DIR, `openclaw-${dateKey}.log`);
}

let logDirEnsured = false;

export type Logger = {
  info(message: string): void;
  debug(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** Returns a child logger whose messages are prefixed with `[accountId]`. */
  withAccount(accountId: string): Logger;
  /** Returns the current main log file path. */
  getLogFilePath(): string;
  close(): void;
};

function buildLoggerName(accountId?: string): string {
  return accountId ? `${SUBSYSTEM}/${accountId}` : SUBSYSTEM;
}

function writeLog(level: string, message: string, accountId?: string): void {
  const levelId = LEVEL_IDS[level] ?? 3;
  if (levelId < minLevelId) return;

  const now = new Date();
  const loggerName = buildLoggerName(accountId);
  const prefixedMessage = accountId ? `[${accountId}] ${message}` : message;
  const entry = JSON.stringify({
    "0": loggerName,
    "1": prefixedMessage,
    _meta: {
      runtime: RUNTIME,
      runtimeVersion: RUNTIME_VERSION,
      hostname: HOSTNAME,
      name: loggerName,
      parentNames: PARENT_NAMES,
      date: now.toISOString(),
      logLevelId: LEVEL_IDS[level] ?? LEVEL_IDS.INFO,
      logLevelName: level,
    },
    time: toLocalISO(now),
  });
  try {
    if (!logDirEnsured) {
      fs.mkdirSync(MAIN_LOG_DIR, { recursive: true });
      logDirEnsured = true;
    }
    fs.appendFileSync(resolveMainLogPath(), `${entry}\n`, "utf-8");
  } catch {
    // Best-effort; never block on logging failures.
  }
}

/** Creates a logger instance, optionally bound to a specific account. */
function createLogger(accountId?: string): Logger {
  return {
    info(message: string): void {
      writeLog("INFO", message, accountId);
    },
    debug(message: string): void {
      writeLog("DEBUG", message, accountId);
    },
    warn(message: string): void {
      writeLog("WARN", message, accountId);
    },
    error(message: string): void {
      writeLog("ERROR", message, accountId);
    },
    withAccount(id: string): Logger {
      return createLogger(id);
    },
    getLogFilePath(): string {
      return resolveMainLogPath();
    },
    close(): void {
      // No-op: appendFileSync has no persistent handle to close.
    },
  };
}

export const logger: Logger = createLogger();
