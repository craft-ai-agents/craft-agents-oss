/**
 * JSON message protocol between ExtensionHostManager (main) and the
 * craft-sandbox worker (utilityProcess).
 *
 * Third-party code never runs in Electron main — only inside the worker.
 * SiYuan plugins are NOT loaded here (executesSiyuanPlugins stays false).
 *
 * Capability broker: worker may request mint/fetch via parentPort; main
 * redeems tokens and performs egress. Raw secrets never travel to worker.
 */

export type MainToWorkerMessage =
  | { id: string; type: 'ping' }
  | { id: string; type: 'load'; extensionId: string; entryPath: string }
  | {
      id: string
      type: 'call'
      extensionId: string
      method: string
      args?: unknown[]
      /** Declared permissions for this call (basic gate on worker side). */
      permissions?: string[]
    }
  | { id: string; type: 'unload'; extensionId: string }
  /** Ask worker to describe commands declared by a loaded extension module. */
  | { id: string; type: 'list-commands'; extensionId: string }
  /** Main → Worker response to a broker-request. */
  | {
      id: string
      type: 'broker-ok'
      result:
        | { token: string; expiresAt: number; permission: string }
        | { status: number; body: string; headers: Record<string, string> }
    }
  | { id: string; type: 'broker-error'; error: string }

/** Worker → Main broker RPC (handled by ExtensionHostManager). */
export type BrokerRequestMessage =
  | {
      type: 'broker-request'
      id: string
      extensionId: string
      action: 'mint'
      permission: string
      ttlMs?: number
      singleUse?: boolean
    }
  | {
      type: 'broker-request'
      id: string
      extensionId: string
      action: 'fetch'
      capabilityToken: string
      url: string
      method?: string
      headers?: Record<string, string>
      body?: string
    }

export type WorkerToMainMessage =
  | { type: 'ready' }
  | { id: string; type: 'pong' }
  | { id: string; type: 'ok'; result?: unknown }
  | { id: string; type: 'error'; error: string }
  | BrokerRequestMessage

export interface MessagePortLike {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
  off?(event: 'message', listener: (message: unknown) => void): void
  addEventListener?(
    event: 'message',
    listener: (event: { data: unknown }) => void,
  ): void
  removeEventListener?(
    event: 'message',
    listener: (event: { data: unknown }) => void,
  ): void
}

/** Known secret / credential env keys never forwarded into the worker. */
export const SECRET_ENV_KEY_RE =
  /^(?:.*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE[_-]?KEY|CONNECTION[_-]?STRING).*|.*_(?:KEY|URL|URI|DSN)$|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|AWS_SESSION_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|GOOGLE_OAUTH_CLIENT_SECRET|SLACK_OAUTH_CLIENT_SECRET|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|HF_TOKEN|HUGGING_FACE_HUB_TOKEN|DATABASE_URL|POSTGRES_URL|MYSQL_URL|REDIS_URL|MONGO_URL|MONGODB_URI|SENTRY_DSN)$/i

/**
 * Build a scrubbed env for utilityProcess.fork.
 * Starts from a minimal allowlist + PATH/HOME/TMP so Node can boot,
 * never copies raw main process secrets.
 */
export function buildScrubbedWorkerEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const keep = new Set([
    'PATH',
    'PATHEXT',
    'HOME',
    'USERPROFILE',
    'TMP',
    'TEMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'TZ',
  ])

  const env: NodeJS.ProcessEnv = {
    // Explicitly unset — worker must not re-enter Electron-as-node tricks.
    ELECTRON_RUN_AS_NODE: undefined,
  }

  for (const key of keep) {
    const v = source[key]
    if (typeof v === 'string' && v.length > 0) env[key] = v
  }

  // Extra CRAFT_* non-secret knobs (sandbox root only).
  if (source.CRAFT_EXTENSION_SANDBOX_ROOT) {
    env.CRAFT_EXTENSION_SANDBOX_ROOT = source.CRAFT_EXTENSION_SANDBOX_ROOT
  }
  if (source.CRAFT_CONFIG_DIR) {
    env.CRAFT_CONFIG_DIR = source.CRAFT_CONFIG_DIR
  }

  // Defense in depth: drop anything secret-shaped that slipped into keep.
  for (const key of Object.keys(env)) {
    if (SECRET_ENV_KEY_RE.test(key)) delete env[key]
  }

  return env
}
