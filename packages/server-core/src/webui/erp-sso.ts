import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export interface AccessSnapshot {
  schema_version: 2; member_id: string; account_id: string; login_email: string; tenant_id: string; active: boolean; role: 'admin' | 'user'
  models: string[]; skills: string[]; sources: string[]; task_price: number; max_concurrency: number
  default_model?: string
  ttl_seconds: number; policy_version: string; pricing_version: 'fixed-task-v1'; execution_mode: 'server_only'
  desktop_channel: '' | 'internal'
}
export const DEFAULT_MANAGED_MODEL = 'pi/deepseek-v4-pro'

/** ERP owns the explicit default. Older snapshots remain compatible and use the
 * product default, then another authorized DeepSeek model, then the first model. */
export function resolveManagedDefaultModel(policy: Pick<AccessSnapshot, 'models' | 'default_model'>): string | undefined {
  return policy.default_model
    ?? (policy.models.includes(DEFAULT_MANAGED_MODEL) ? DEFAULT_MANAGED_MODEL : undefined)
    ?? policy.models.find(model => model.toLocaleLowerCase('en-US').includes('deepseek'))
    ?? policy.models[0]
}
export interface ErpSsoConfig { erp: string; origin: string; clientId: string; clientSecret?: string; serviceUser: string; apiKey: string; apiSecret: string }
const random = () => randomBytes(32).toString('base64url')
const hash = (s: string) => createHash('sha256').update(s).digest('base64url')
const validId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,139}$/.test(s)
const validEmail = (s: unknown): s is string => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(s)
const validPolicyItem = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9_./:@+-]{0,127}$/.test(s)
function origin(s: string) { const u = new URL(s); if (u.username || u.password || u.search || u.hash || u.pathname !== '/' || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(u.hostname)))) throw new Error('SSO requires HTTPS origins (loopback HTTP only for tests)'); return u.origin }
export function ssoConfig(env = process.env): ErpSsoConfig | undefined {
  const names = ['JONWORK_SSO_ERP_URL', 'JONWORK_SSO_ORIGIN', 'JONWORK_SSO_CLIENT_ID', 'JONWORK_SSO_SERVICE_USER', 'JONWORK_SSO_API_KEY', 'JONWORK_SSO_API_SECRET'] as const
  if (!names.some(n => env[n] !== undefined) && env.JONWORK_SSO_CLIENT_SECRET === undefined) return undefined
  if (names.some(n => !env[n])) throw new Error('ERP SSO configuration is incomplete')
  return { erp: origin(env.JONWORK_SSO_ERP_URL!), origin: origin(env.JONWORK_SSO_ORIGIN!), clientId: env.JONWORK_SSO_CLIENT_ID!, clientSecret: env.JONWORK_SSO_CLIENT_SECRET,
    serviceUser: env.JONWORK_SSO_SERVICE_USER!, apiKey: env.JONWORK_SSO_API_KEY!, apiSecret: env.JONWORK_SSO_API_SECRET! }
}
export function accessSnapshot(value: unknown): AccessSnapshot {
  const p = value as AccessSnapshot
  if (!p || p.schema_version !== 2 || !validId(p.member_id) || !validId(p.account_id) || !validEmail(p.login_email) || typeof p.tenant_id !== 'string'
    || !['admin', 'user'].includes(p.role) || typeof p.active !== 'boolean' || p.execution_mode !== 'server_only' || p.pricing_version !== 'fixed-task-v1'
    || !['', 'internal'].includes(p.desktop_channel)
    || !Number.isSafeInteger(p.task_price) || p.task_price < 1 || p.task_price > 1000000
    || !Number.isSafeInteger(p.max_concurrency) || p.max_concurrency < 1 || p.max_concurrency > 100
    || !Number.isSafeInteger(p.ttl_seconds) || p.ttl_seconds < 1 || p.ttl_seconds > 60 || !/^[a-f0-9]{64}$/.test(p.policy_version)
    || (p.default_model !== undefined && (!validPolicyItem(p.default_model) || !p.models?.includes(p.default_model)))
    || [p.models, p.skills, p.sources].some(v => !Array.isArray(v) || v.length > 200 || new Set(v).size !== v.length || v.some(s => !validPolicyItem(s)))) throw new Error('Invalid ERP access snapshot')
  return { schema_version: 2, member_id: p.member_id, account_id: p.account_id, login_email: p.login_email.trim().toLocaleLowerCase('en-US'), tenant_id: p.tenant_id, active: p.active, role: p.role,
    models: p.models, ...(p.default_model ? {default_model:p.default_model} : {}), skills: p.skills, sources: p.sources, task_price: p.task_price, max_concurrency: p.max_concurrency,
    ttl_seconds: p.ttl_seconds, policy_version: p.policy_version, pricing_version: p.pricing_version, execution_mode: p.execution_mode,
    desktop_channel: p.desktop_channel }
}
interface Flow { verifier: string; browser: string; expires: number; device?: string }
interface Device { challenge: string; expires: number; identity?: { member_id: string; account_id: string } }

/** OAuth code+PKCE. ERP access/refresh tokens never leave this service or enter logs.
 * Identity is obtained from ERP's authenticated, instance-scoped endpoint; no
 * unverified id_token decoding or email-based automatic account merging.
 */
export class ErpSsoClient {
  private flows = new Map<string, Flow>()
  private devices = new Map<string, Device>()
  constructor(readonly config: ErpSsoConfig, private request: typeof fetch = fetch) { origin(config.erp); origin(config.origin) }
  private prune() { const now = Date.now(); for (const [k,v] of this.flows) if (v.expires < now) this.flows.delete(k); for (const [k,v] of this.devices) if (v.expires < now) this.devices.delete(k) }
  startDevice(challenge: string) {
    this.prune()
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || this.devices.size >= 1000) throw new Error('Invalid or excessive SSO requests')
    const device = random(); this.devices.set(device, { challenge, expires: Date.now() + 300000 })
    return { device, login_url: `${this.config.origin}/api/auth/sso/start?device=${device}` }
  }
  start(device?: string) {
    this.prune()
    if (this.flows.size >= 1000 || (device && !this.devices.has(device))) throw new Error('SSO request expired')
    const state = random(); const verifier = random(); const browser = random()
    this.flows.set(state, { verifier, browser: hash(browser), expires: Date.now() + 300000, device })
    const u = new URL('/api/method/frappe.integrations.oauth2.authorize', this.config.erp)
    u.search = new URLSearchParams({ client_id: this.config.clientId, response_type: 'code', redirect_uri: this.callback,
      scope: 'openid', state, code_challenge: hash(verifier), code_challenge_method: 'S256' }).toString()
    // Always pass through the passwordless email page. Going directly to the
    // OAuth endpoint would silently reuse an unrelated ERP browser session and
    // skip email verification altogether.
    const login = new URL('/email-login', this.config.erp)
    login.searchParams.set('redirect-to', `${u.pathname}${u.search}`)
    return { url: login.href, browser }
  }
  get callback() { return `${this.config.origin}/api/auth/sso/callback` }
  private async json(url: string, init: RequestInit) {
    const res = await this.request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) })
    if (!res.ok || !res.body) throw new Error('ERP service unavailable or access denied')
    const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let length = 0
    try { while (true) { const {done,value} = await reader.read(); if (done) break; length += value.byteLength; if (length > 16 * 1024 * 1024) throw new Error('ERP response too large'); chunks.push(value) } }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  async complete(state: string, code: string, browser: string) {
    this.prune(); const flow = this.flows.get(state)
    if (!flow || !browser || hash(browser) !== flow.browser || !code || code.length > 2048) throw new Error('Invalid SSO callback')
    this.flows.delete(state)
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: this.config.clientId, redirect_uri: this.callback, code_verifier: flow.verifier })
    if (this.config.clientSecret) body.set('client_secret', this.config.clientSecret)
    const token = await this.json(`${this.config.erp}/api/method/frappe.integrations.oauth2.get_token`, { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body })
    if (typeof token.access_token !== 'string' || !token.access_token || token.token_type?.toLowerCase() !== 'bearer') throw new Error('Invalid ERP token response')
    const profile = await this.json(`${this.config.erp}/api/method/jonwork_control.integration.my_identity?instance=${encodeURIComponent(this.config.serviceUser)}`,
      { headers: {Authorization: `Bearer ${token.access_token}`} })
    const identity = profile.message
    if (!validId(identity?.member_id) || !validId(identity?.account_id)) throw new Error('ERP account not provisioned')
    if (flow.device) { const d = this.devices.get(flow.device); if (!d) throw new Error('Device login expired'); d.identity = { member_id: identity.member_id, account_id: identity.account_id }; return { device: true as const } }
    return { device: false as const, identity: { member_id: identity.member_id as string, account_id: identity.account_id as string } }
  }
  poll(device: string, verifier: string) {
    this.prune(); const d = this.devices.get(device)
    if (!d || typeof verifier !== 'string' || verifier.length < 43 || verifier.length > 128) throw new Error('Invalid device login')
    const actual = Buffer.from(hash(verifier)); const expected = Buffer.from(d.challenge)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid device verifier')
    if (!d.identity) return null
    this.devices.delete(device); return d.identity
  }
  async call(method: string, params: Record<string, unknown> = {}): Promise<any> {
    if (!['get_access_snapshot','pending_grants','pending_resolutions','ingest_event','heartbeat','resources','resource_bundle'].includes(method)) throw new Error('Unsupported ERP method')
    const result = await this.json(`${this.config.erp}/api/method/jonwork_control.integration.${method}`, {
      method:'POST', headers: {Authorization:`token ${this.config.apiKey}:${this.config.apiSecret}`, 'Content-Type':'application/json'}, body: JSON.stringify(params) })
    if (!Object.hasOwn(result, 'message')) throw new Error('Invalid ERP response')
    return result.message
  }
  async access(member: string) { return accessSnapshot(await this.call('get_access_snapshot', {member})) }
}
