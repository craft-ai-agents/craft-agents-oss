// Gateway auth — bearer key + anti-DNS-rebinding Host guard.
// A localhost gateway is otherwise open to local request forgery / DNS rebinding:
// any process or browser tab can drain upstream credentials. Validate both.

import type { AuthConfig } from "./types.ts";

export interface AuthOutcome {
  ok: boolean;
  status: number;
  reason: string;
}

const OK: AuthOutcome = { ok: true, status: 200, reason: "ok" };

/** Resolve the expected key: env → macOS Keychain (by keyEnv name). */
export function resolveAuthKey(
  cfg: AuthConfig,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const fromEnv = env[cfg.keyEnv];
  if (fromEnv) return fromEnv;
  if (env.SHADOW_ROUTER_NO_KEYCHAIN) return null;
  if (process.platform !== "darwin") return null;
  try {
    const out = Bun.spawnSync(["security", "find-generic-password", "-s", cfg.keyEnv, "-w"]);
    if (out.exitCode !== 0) return null;
    const v = out.stdout.toString().trim();
    return v.length ? v : null;
  } catch {
    return null;
  }
}

function hostOf(req: Request): string {
  const h = req.headers.get("host") ?? "";
  return h.split(":")[0].replace(/^\[|\]$/g, ""); // strip port + ipv6 brackets
}

/** Check a request against the auth policy. Constant-time-ish bearer compare. */
export function checkAuth(req: Request, cfg: AuthConfig | undefined, expectedKey: string | null): AuthOutcome {
  if (!cfg || !cfg.required) return OK;

  // Host allowlist — blocks DNS-rebinding (attacker page resolving its domain to 127.0.0.1).
  const host = hostOf(req);
  const allowed = cfg.allowedHosts.map((h) => h.replace(/^\[|\]$/g, ""));
  if (host && !allowed.includes(host)) {
    return { ok: false, status: 403, reason: `host-not-allowed:${host}` };
  }

  if (!expectedKey) return { ok: false, status: 503, reason: "no-server-key-configured" };

  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!timingSafeEqual(presented, expectedKey)) {
    return { ok: false, status: 401, reason: "bad-bearer" };
  }
  return OK;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
