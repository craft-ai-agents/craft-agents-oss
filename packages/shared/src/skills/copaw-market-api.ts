/**
 * CoPaw Skill Marketplace HTTP API
 *
 * Wraps the CoPaw market service endpoints used by rpi-main.
 * All requests carry an Authorization header with the SSO session token.
 */

/** Default CoPaw market service base URL (UAT). */
export const COPAW_MARKET_BASE_URL = 'http://withdataservice.paasuat.cmbchina.cn'

// ── Response types ────────────────────────────────────────────────────────────

/** Raw market skill returned by the CoPaw market service. */
export interface CopawMarketSkill {
  fileKey: string
  userName: string
  employeeId: string
  department: string | null
  /** English slug used as the unique identifier. */
  name: string
  chineseName: string | null
  description: string
  /** A = 公共, B = DevOps */
  tag: 'A' | 'B'
  /** Install/download count. */
  hot: number
  createdAt: string
  version?: string
}

/**
 * Renderer → main-process IPC payload for publishing a skill to the market.
 * The server reads userName/employeeId/version from the SSO session.
 */
export interface CopawMarketUploadInput {
  /** English slug (marketplace name). */
  name: string
  /** Chinese display name. */
  chineseName: string
  description: string
  /** A = 公共, B = DevOps */
  tag: 'A' | 'B'
  /** SKILL.md content — the server will zip this before sending. */
  skillContent: string
}

/** Internal payload sent as multipart/form-data to the market HTTP service. */
export interface CopawMarketUploadPayload {
  name: string
  chineseName: string
  description: string
  tag: 'A' | 'B'
  /** Resolved from SSO session by the server-side handler. */
  userName: string
  /** Resolved from SSO session by the server-side handler. */
  employeeId: string
  /** Timestamp-based version string (see generateMarketSkillVersion). */
  version: string
}

/** Result returned after a successful market upload. */
export type CopawMarketUploadResult =
  | { status: 'published'; skill: CopawMarketSkill }
  | { status: 'conflict'; message: string }
  | { status: 'error'; message: string }

// ── Internal helpers ──────────────────────────────────────────────────────────

interface MarketApiEnvelope<T = unknown> {
  returnCode: string
  errorMsg?: string
  body: T | null
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`请求失败: ${res.status}${text ? ` - ${text}` : ''}`)
  }
  const json = await res.json() as MarketApiEnvelope<T>
  if (json.returnCode !== 'SUC0000') {
    throw new Error(json.errorMsg ?? `业务错误: ${json.returnCode}`)
  }
  return json.body as T
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: token }
}

// ── Public API functions ──────────────────────────────────────────────────────

/** Fetch the full market skill catalogue. */
export async function listCopawMarketSkills(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CopawMarketSkill[]> {
  const res = await fetchImpl(`${baseUrl}/skills/market`, {
    headers: authHeader(token),
  })
  const skills = await parseEnvelope<CopawMarketSkill[]>(res)
  return skills ?? []
}

/**
 * Publish a skill to the market.
 *
 * The SKILL.md content is zipped in-process before sending so the server
 * receives a standard bundle archive.
 */
export async function uploadCopawMarketSkill(
  input: CopawMarketUploadPayload,
  zipBytes: Uint8Array,
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CopawMarketUploadResult> {
  const formData = new FormData()
  formData.append('file', new Blob([zipBytes.buffer as ArrayBuffer], { type: 'application/zip' }), `${input.name}.zip`)
  formData.append('name', input.name)
  formData.append('chinese_name', input.chineseName)
  formData.append('description', input.description)
  formData.append('tag', input.tag)
  formData.append('user_name', input.userName)
  formData.append('employee_id', input.employeeId)
  formData.append('version', input.version)

  const res = await fetchImpl(`${baseUrl}/skills/market/upload`, {
    method: 'POST',
    headers: authHeader(token),
    body: formData,
  })

  if (res.status === 409) {
    return { status: 'conflict', message: `市场标识符 "${input.name}" 已被占用，请更换名称。` }
  }

  try {
    const skill = await parseEnvelope<CopawMarketSkill>(res)
    return { status: 'published', skill }
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : '发布失败' }
  }
}

/** Delete a market skill by name. Only the original uploader can delete. */
export async function deleteCopawMarketSkill(
  skillName: string,
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(
    `${baseUrl}/skills/market/${encodeURIComponent(skillName)}`,
    { method: 'DELETE', headers: authHeader(token) },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`删除失败: ${res.status}${text ? ` - ${text}` : ''}`)
  }
}

/**
 * Generate a version string based on the current timestamp.
 * Format matches CoPaw convention: "YYYYMMDDHHmmss".
 */
export function generateMarketSkillVersion(): string {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
}
