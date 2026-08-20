/**
 * Rox cloud identity (rox.one) — device authorization for desktop Connect.
 *
 * Product policy: Rox desktop requires Connect before agent UI.
 * Engine remains usable without cloud when ROX_CLOUD_REQUIRED=0.
 */

export interface RoxDeviceStartResult {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

export interface RoxDevicePollPending {
  status: 'pending'
  interval: number
}

export interface RoxDevicePollApproved {
  status: 'approved'
  accessToken: string
  tokenType: string
  expiresIn: number
  user: {
    id: string
    email: string
    name: string
    image?: string | null
  }
}

export type RoxDevicePollResult = RoxDevicePollPending | RoxDevicePollApproved

export interface RoxCloudSession {
  accessToken: string
  expiresAt: number
  user: RoxDevicePollApproved['user']
  authBaseUrl: string
}

export function getRoxAuthBaseUrl(): string {
  const raw = process.env.ROX_AUTH_BASE_URL || 'https://rox.one'
  return raw.replace(/\/$/, '')
}

/** Rox product builds require cloud Connect by default. */
export function isRoxCloudRequired(): boolean {
  const v = process.env.ROX_CLOUD_REQUIRED
  if (v === '0' || v === 'false' || v === 'no') return false
  if (v === '1' || v === 'true' || v === 'yes') return true
  // Default: required (single Rox product binary living in this repo for now)
  return true
}

export async function startRoxDeviceFlow(
  clientId = 'craft-agents-desktop',
): Promise<RoxDeviceStartResult> {
  const base = getRoxAuthBaseUrl()
  const res = await fetch(`${base}/api/auth/device/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ clientId }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Rox device start failed (${res.status}): ${text}`)
  }
  const data = (await res.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    verification_uri_complete: string
    expires_in: number
    interval: number
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete,
    expiresIn: data.expires_in,
    interval: data.interval ?? 5,
  }
}

export async function pollRoxDeviceFlow(
  deviceCode: string,
): Promise<RoxDevicePollResult> {
  const base = getRoxAuthBaseUrl()
  const res = await fetch(`${base}/api/auth/device/poll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ device_code: deviceCode }),
  })
  if (res.status === 410) {
    throw new Error('DEVICE_CODE_EXPIRED')
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Rox device poll failed (${res.status}): ${text}`)
  }
  const data = (await res.json()) as Record<string, unknown>
  if (data.status === 'pending') {
    return {
      status: 'pending',
      interval: typeof data.interval === 'number' ? data.interval : 5,
    }
  }
  if (data.status === 'approved' && typeof data.access_token === 'string') {
    const user = data.user as RoxDevicePollApproved['user']
    return {
      status: 'approved',
      accessToken: data.access_token,
      tokenType: String(data.token_type || 'Bearer'),
      expiresIn: Number(data.expires_in || 0),
      user,
    }
  }
  throw new Error(`Unexpected poll response: ${JSON.stringify(data)}`)
}

export async function fetchRoxBalance(accessToken: string): Promise<{
  balanceRox: string
  user: { id: string; email: string; name: string }
}> {
  const base = getRoxAuthBaseUrl()
  const res = await fetch(`${base}/api/me/balance`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Rox balance failed (${res.status}): ${text}`)
  }
  return (await res.json()) as {
    balanceRox: string
    user: { id: string; email: string; name: string }
  }
}

/** Poll until approved or timeout. */
export async function waitForRoxDeviceApproval(
  deviceCode: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RoxDevicePollApproved> {
  const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000
  const started = Date.now()
  let intervalSec = 5

  while (Date.now() - started < timeoutMs) {
    if (opts.signal?.aborted) {
      throw new Error('ROX_CONNECT_CANCELLED')
    }
    const result = await pollRoxDeviceFlow(deviceCode)
    if (result.status === 'approved') {
      return result
    }
    intervalSec = Math.max(result.interval || 5, 2)
    await new Promise((r) => setTimeout(r, intervalSec * 1000))
  }
  throw new Error('DEVICE_CODE_EXPIRED')
}
