export type FeedbackContentPart = {
  type?: string
  text?: string
  file_url?: string
  filename?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

export type FeedbackTurnMessage = {
  id: string
  type: string
  role: string
  content: FeedbackContentPart[]
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export type FeedbackRecord = {
  id: string
  time: string
  session_id: string
  employee_id: string
  is_like: boolean
  comment: string
  turn_messages: FeedbackTurnMessage[]
  created_at?: string
  updated_at?: string
}

export type ChatFeedbackAddRequest = {
  session_id: string
  employee_id: string
  turn_messages: unknown[]
  is_like: boolean
  comment?: string
}

export type ChatFeedbackUpdateRequest = {
  id: string
  session_id?: string
  employee_id?: string
  turn_messages?: unknown[]
  is_like?: boolean
  comment?: string
}

type RawFeedbackRecord = FeedbackRecord & {
  sessionId?: string
  employeeId?: string
  turnMessages?: FeedbackTurnMessage[] | string
  isLike?: boolean | number | string
  createdAt?: string
  updatedAt?: string
}

type MdpResponse<T> = {
  body?: T
  data?: T
  returnCode?: string
  errorMsg?: string
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: token }
}

async function feedbackRequest<T>(
  baseUrl: string,
  token: string,
  path: string,
  options: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const method = options.method ?? 'GET'
  const hasBody = options.body !== undefined && options.body !== null
  const headers: Record<string, string> = {
    ...authHeader(token),
    ...(method !== 'GET' && hasBody ? { 'Content-Type': 'application/json' } : {}),
  }

  const res = await fetchImpl(`${stripTrailingSlash(baseUrl)}${path}`, { ...options, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Request failed: ${res.status}${text ? ` - ${text}` : ''}`)
  }

  const json = await res.json() as MdpResponse<T> | T
  if (json && typeof json === 'object') {
    const envelope = json as MdpResponse<T>
    if (envelope.returnCode && envelope.returnCode !== 'SUC0000') {
      throw new Error(envelope.errorMsg ?? `Business error: ${envelope.returnCode}`)
    }
    if ('body' in envelope) return envelope.body as T
    if ('data' in envelope) return envelope.data as T
  }
  return json as T
}

function normalizeTurnMessages(value: unknown): FeedbackTurnMessage[] {
  if (Array.isArray(value)) return value as FeedbackTurnMessage[]
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed as FeedbackTurnMessage[] : []
    } catch {
      return []
    }
  }
  return []
}

function normalizeIsLike(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'string') return value === '1' || value === 'true'
  return true
}

export function normalizeFeedbackRecord(record: RawFeedbackRecord): FeedbackRecord {
  const sessionId = record.session_id || record.sessionId || ''
  const employeeId = record.employee_id || record.employeeId || ''
  const turnMessages = record.turn_messages || record.turnMessages || []
  const createdAt = record.created_at || record.createdAt || ''
  const updatedAt = record.updated_at || record.updatedAt || ''
  const isLike = record.is_like ?? record.isLike

  return {
    id: String(record.id || ''),
    time: record.time || createdAt || updatedAt,
    session_id: sessionId,
    employee_id: employeeId,
    is_like: normalizeIsLike(isLike),
    comment: record.comment || '',
    turn_messages: normalizeTurnMessages(turnMessages),
    created_at: createdAt,
    updated_at: updatedAt,
  }
}

function normalizeAddId(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const id = record.id ?? record.feedbackId
    if (typeof id === 'string' || typeof id === 'number') return String(id)
  }
  return ''
}

function withRequestAliases(
  body: ChatFeedbackAddRequest | ChatFeedbackUpdateRequest,
) {
  return {
    ...body,
    sessionId: body.session_id,
    employeeId: body.employee_id,
    turnMessages: body.turn_messages,
    isLike: body.is_like,
  }
}

export async function listChatFeedback(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FeedbackRecord[]> {
  const records = await feedbackRequest<RawFeedbackRecord[]>(
    baseUrl,
    token,
    '/api/mdp/feedback/list',
    undefined,
    fetchImpl,
  )
  return (records || []).map(normalizeFeedbackRecord)
}

export async function addChatFeedback(
  body: ChatFeedbackAddRequest,
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const result = await feedbackRequest<unknown>(
    baseUrl,
    token,
    '/api/mdp/feedback/add',
    {
      method: 'POST',
      body: JSON.stringify(withRequestAliases(body)),
    },
    fetchImpl,
  )
  return normalizeAddId(result)
}

export function updateChatFeedback(
  body: ChatFeedbackUpdateRequest,
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  return feedbackRequest<boolean>(
    baseUrl,
    token,
    '/api/mdp/feedback/update',
    {
      method: 'POST',
      body: JSON.stringify(withRequestAliases(body)),
    },
    fetchImpl,
  )
}

export function deleteChatFeedback(
  id: string,
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  return feedbackRequest<void>(
    baseUrl,
    token,
    `/api/mdp/feedback/delete?id=${encodeURIComponent(id)}`,
    { method: 'POST' },
    fetchImpl,
  )
}
