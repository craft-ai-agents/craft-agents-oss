import { createHash } from 'node:crypto'

export const OPENCLAW_PORT_BLOCK_SIZE = 8
export const OPENCLAW_PORT_RANGE_START = 42_000
export const OPENCLAW_PORT_RANGE_END = 48_000

export interface OpenClawPortBlock {
  readonly basePort: number
  readonly ports: readonly number[]
}

export interface OpenClawRuntimeLayout {
  readonly runtimeDir: string
  readonly configDir: string
  readonly configPath: string
  readonly stateDir: string
  readonly workspaceDir: string
  readonly auditDir: string
  readonly snapshotsPath: string
  readonly acceptancesPath: string
}

/**
 * Structured, token-free baseline ready for `openclaw config validate` once
 * the managed toolchain capability probe is wired in.
 */
export interface HardenedOpenClawConfig {
  readonly gateway: {
    readonly mode: 'local'
    readonly bind: 'loopback'
    readonly port: number
    readonly auth: { readonly mode: 'token' }
    readonly tailscale: { readonly mode: 'off' }
  }
  readonly session: { readonly dmScope: 'per-channel-peer' }
  readonly tools: {
    readonly profile: 'messaging'
    readonly deny: readonly string[]
    readonly fs: { readonly workspaceOnly: true }
    readonly exec: { readonly security: 'deny'; readonly ask: 'always' }
    readonly elevated: { readonly enabled: false }
  }
  readonly channels: Record<string, never>
  readonly plugins: { readonly allowlist: readonly [] }
}

export function deriveOpenClawRuntimeId(workspaceId: string): string {
  const digest = createHash('sha256')
    .update('craft-openclaw-runtime:v1\u0000', 'utf8')
    .update(workspaceId, 'utf8')
    .digest('base64url')
  return `openclaw_${digest.slice(0, 32)}`
}

export function deriveOpenClawPortBlock(runtimeId: string): OpenClawPortBlock {
  const slots = Math.floor((OPENCLAW_PORT_RANGE_END - OPENCLAW_PORT_RANGE_START + 1) / OPENCLAW_PORT_BLOCK_SIZE)
  const hash = createHash('sha256').update(`craft-openclaw-port:v1\u0000${runtimeId}`, 'utf8').digest()
  const slot = hash.readUInt32BE(0) % slots
  const basePort = OPENCLAW_PORT_RANGE_START + slot * OPENCLAW_PORT_BLOCK_SIZE
  return {
    basePort,
    ports: Object.freeze(Array.from({ length: OPENCLAW_PORT_BLOCK_SIZE }, (_, index) => basePort + index)),
  }
}

export function buildHardenedOpenClawConfig(portBlock: OpenClawPortBlock): HardenedOpenClawConfig {
  return {
    gateway: {
      mode: 'local',
      bind: 'loopback',
      port: portBlock.basePort,
      auth: { mode: 'token' },
      tailscale: { mode: 'off' },
    },
    session: { dmScope: 'per-channel-peer' },
    tools: {
      profile: 'messaging',
      deny: ['group:automation', 'group:runtime', 'group:fs', 'sessions_spawn', 'sessions_send'],
      fs: { workspaceOnly: true },
      exec: { security: 'deny', ask: 'always' },
      elevated: { enabled: false },
    },
    channels: {},
    plugins: { allowlist: [] as const },
  }
}
