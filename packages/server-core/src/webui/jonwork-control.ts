/** Optional ERP control-plane bridge. Never exports private skills, sessions or prompts. */
import { createHash } from 'node:crypto'
import matter from 'gray-matter'
import { AccountSkillLibrary, SkillLibraryError, type AccountSkillBundle } from '@craft-agent/shared/skills'

type Binding = { subscription: string; apiKey: string; apiSecret: string }
export type Release = { name: string; slug: string; version: string; content_hash: string }
export type ControlEntitlement = {
  subscription: string; account_id: string; active: boolean; remaining_units: number
  can_use: boolean; unit: 'credit'; valid_until: string; enforcement: 'ledger_only'
}
function fail(message = '中控响应无效，请联系管理员', status = 502): never {
  throw new SkillLibraryError(message, status)
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const MAX_RESPONSE = 16 * 1024 * 1024

export class JonworkControl {
  private readonly base: string
  private readonly bindings: ReadonlyMap<string, Binding>

  constructor(baseUrl: string, bindings: Record<string, Binding>, private readonly request: typeof fetch = fetch) {
    let url: URL
    try { url = new URL(baseUrl) } catch { fail('中控地址配置无效', 503) }
    if (url!.username || url!.password || url!.search || url!.hash || url!.pathname !== '/'
      || (url!.protocol !== 'https:' && !(url!.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url!.hostname)))) {
      fail('中控必须使用 HTTPS 源站地址；仅本机回环允许 HTTP', 503)
    }
    if (!object(bindings)) fail('中控账号绑定配置无效', 503)
    const entries = Object.entries(bindings)
    const subscriptions = new Set<string>()
    const keys = new Set<string>()
    for (const [account, binding] of entries) {
      if (!id(account) || !object(binding) || typeof binding.subscription !== 'string'
        || !binding.subscription.trim() || binding.subscription.length > 140
        || typeof binding.apiKey !== 'string' || typeof binding.apiSecret !== 'string'
        || !/^[A-Za-z0-9_-]+$/.test(binding.apiKey) || !/^[A-Za-z0-9_-]+$/.test(binding.apiSecret)
        || subscriptions.has(binding.subscription) || keys.has(binding.apiKey)) {
        fail('中控账号必须使用独立授权和专属集成凭据', 503)
      }
      subscriptions.add(binding.subscription)
      keys.add(binding.apiKey)
    }
    this.base = url!.origin
    this.bindings = new Map(entries.map(([account, binding]) => [account, { ...binding }]))
  }

  private async call(account: string, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const binding = this.bindings.get(account)
    if (!binding) fail('账户尚未绑定中控授权', 403)
    try {
      const response = await this.request(`${this.base}/api/method/jonwork.api.${method}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `token ${binding!.apiKey}:${binding!.apiSecret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, subscription: binding!.subscription }),
      })
      if (!response.ok) fail('中控请求失败，请检查服务及授权配置', response.status === 403 ? 403 : 503)
      if (!response.body) fail()
      const reader = response.body!.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > MAX_RESPONSE) fail('中控响应超过大小限制')
          chunks.push(value)
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!object(body) || !Object.hasOwn(body, 'message')) fail()
      return body.message
    } catch (error) {
      if (error instanceof SkillLibraryError) throw error
      // Never forward upstream exception bodies, URLs or credentials to clients/logs.
      return fail('中控暂不可用，请稍后重试', 503)
    }
  }

  async entitlement(account: string): Promise<ControlEntitlement> {
    const value = await this.call(account, 'get_entitlement')
    if (!object(value) || value.account_id !== account || value.subscription !== this.bindings.get(account)?.subscription
      || typeof value.active !== 'boolean' || typeof value.can_use !== 'boolean'
      || !Number.isSafeInteger(value.remaining_units) || (value.remaining_units as number) < 0
      || value.can_use !== (value.active && (value.remaining_units as number) > 0)
      || value.unit !== 'credit' || value.enforcement !== 'ledger_only' || typeof value.valid_until !== 'string') fail()
    // Only allowlisted fields leave the server; ERP customer/user fields are not exposed.
    return {
      subscription: value.subscription as string, account_id: account,
      active: value.active as boolean, can_use: value.can_use as boolean,
      remaining_units: value.remaining_units as number, valid_until: value.valid_until as string,
      unit: 'credit', enforcement: 'ledger_only',
    }
  }

  async catalog(account: string): Promise<Release[]> {
    const entitlement = await this.entitlement(account)
    if (!entitlement.active) fail('应用授权未生效、已到期或已停用', 403)
    const value = await this.call(account, 'public_releases')
    if (!object(value) || value.schema_version !== 1 || !Array.isArray(value.releases) || value.releases.length > 1000) fail()
    const latest = new Map<string, Release>()
    const names = new Set<string>()
    const versions = new Set<string>()
    for (const row of value.releases as unknown[]) {
      if (!object(row) || typeof row.name !== 'string' || !row.name || row.name.length > 260
        || typeof row.slug !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(row.slug)
        || typeof row.version !== 'string' || row.version.length > 128 || !/^\d+\.\d+\.\d+$/.test(row.version)
        || typeof row.content_hash !== 'string' || !/^[a-f0-9]{64}$/.test(row.content_hash)
        || names.has(row.name) || versions.has(`${row.slug}@${row.version}`)) fail()
      const release = row as Release
      names.add(release.name)
      versions.add(`${release.slug}@${release.version}`)
      const old = latest.get(release.slug)
      if (!old || newer(release.version, old.version)) latest.set(release.slug, release)
    }
    return [...latest.values()]
  }

  async bundle(account: string, release: Release): Promise<AccountSkillBundle> {
    const value = await this.call(account, 'public_release_bundle', { release: release.name })
    if (!object(value) || value.slug !== release.slug || value.version !== release.version
      || value.content_hash !== release.content_hash || typeof value.bundle_json !== 'string'
      || hash(value.bundle_json) !== release.content_hash) fail('公共技能版本或内容校验失败')
    return decodeBundle(release, value.bundle_json as string)
  }
}

function newer(left: string, right: string): boolean {
  const a = left.split('.').map(BigInt)
  const b = right.split('.').map(BigInt)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return false
}

export function decodeBundle(release: Release, encoded: string): AccountSkillBundle {
  let files: unknown
  try { files = JSON.parse(encoded) } catch { fail() }
  if (!Array.isArray(files) || files.length < 1 || files.length > 500) fail()
  const seen = new Set<string>()
  let total = 0
  let markdown: string | undefined
  for (const file of files as unknown[]) {
    if (!object(file) || Object.keys(file).sort().join(',') !== 'base64,path'
      || typeof file.path !== 'string' || !file.path || file.path.length > 512 || /[\\:\x00-\x1f]/.test(file.path)
      || file.path.split('/').some(part => !part || part.startsWith('.') || /[. ]$/.test(part)
        || /^(node_modules$|credentials|id_rsa|id_ed25519|(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))/i.test(part))
      || /\.(pem|key|credentials)$/i.test(file.path) || seen.has(file.path.toLowerCase())
      || typeof file.base64 !== 'string') fail('公共技能包含不安全文件')
    const bytes = Buffer.from(file.base64 as string, 'base64')
    if (bytes.toString('base64') !== file.base64) fail('公共技能文件编码无效')
    seen.add((file.path as string).toLowerCase())
    total += bytes.length
    if (total > 10 * 1024 * 1024) fail('公共技能文件包过大')
    if (file.path === 'SKILL.md') {
      if (bytes.length > 1024 * 1024) fail('公共技能说明过大')
      try { markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { fail() }
    }
  }
  if (!markdown?.trim()) fail('公共技能缺少 SKILL.md')
  // gray-matter also supports executable JS engines; only YAML is part of the ERP contract.
  if (!/^---\r?\n/.test(markdown!)) fail('公共技能仅允许 YAML 头部')
  let parsed: ReturnType<typeof matter>
  try { parsed = matter(markdown!) } catch { return fail('公共技能 YAML 无效') }
  if (typeof parsed.data.name !== 'string' || !parsed.data.name.trim()
    || typeof parsed.data.description !== 'string' || !parsed.data.description.trim()) fail('公共技能缺少名称或说明')
  const safeFiles = files as AccountSkillBundle['files']
  return {
    skill: {
      slug: release.slug,
      metadata: {
        name: typeof parsed.data.metadata?.display_name === 'string' ? parsed.data.metadata.display_name : parsed.data.name,
        description: parsed.data.description,
        module: typeof parsed.data.metadata?.module === 'string' ? parsed.data.metadata.module : undefined,
        requiredSources: Array.isArray(parsed.data.requiredSources) ? parsed.data.requiredSources.filter((s: unknown) => typeof s === 'string') : undefined,
      },
      content: parsed.content, path: `account-skills/public/${release.slug}`,
      source: 'global', library: 'account', visibility: 'public', readOnly: true,
    },
    files: safeFiles, revision: hash(JSON.stringify(safeFiles)),
  }
}

/** Complete remote snapshot first; no stale local-public fallback after withdrawal/error. */
export async function controlSkillLibrary(control: Pick<JonworkControl, 'catalog' | 'bundle'>, account: string, privateRoot: string) {
  const releases = await control.catalog(account)
  // Both roots intentionally refer to the owner: no global/private tenant directory is scanned.
  // AccountSkillLibrary checks the private root first and snapshot's private pass wins.
  const privateLibrary = new AccountSkillLibrary(privateRoot, privateRoot)
  const published = new Map(releases.map(release => [release.slug, release]))
  return {
    async snapshot() {
      const skills = new Map<string, AccountSkillBundle>()
      let size = 0
      const started = Date.now()
      for (const release of releases) {
        if (Date.now() - started > 30_000) fail('公共技能同步超时，请稍后重试', 503)
        const bundle = await control.bundle(account, release)
        size += Buffer.byteLength(JSON.stringify(bundle))
        if (size > 32 * 1024 * 1024) fail('公共技能快照过大，需要分页同步')
        skills.set(release.slug, bundle)
      }
      for (const bundle of privateLibrary.snapshot().skills) skills.set(bundle.skill.slug, bundle)
      return { skills: [...skills.values()] }
    },
    async get(slug: string) {
      const local = privateLibrary.get(slug)
      const release = published.get(slug)
      return local ?? (release ? await control.bundle(account, release) : null)
    },
    save(input: Parameters<AccountSkillLibrary['save']>[0]) {
      if (published.has(input.slug) && !privateLibrary.get(input.slug)) fail('公共技能只读，请使用新标识保存私有技能', 403)
      return privateLibrary.save(input)
    },
    delete(slug: string, revision: string) {
      if (published.has(slug) && !privateLibrary.get(slug)) fail('公共技能只读', 403)
      privateLibrary.delete(slug, revision)
    },
  }
}

/** Fail startup on partial/invalid configuration; never silently downgrade to local mode. */
export function controlFromEnvironment(env: NodeJS.ProcessEnv = process.env): JonworkControl | undefined {
  const url = env.JONWORK_CONTROL_URL
  const bindings = env.JONWORK_CONTROL_BINDINGS
  if (url === undefined && bindings === undefined) return undefined
  if (!url || !bindings) fail('中控配置不完整，必须同时设置地址和账号绑定', 503)
  let parsed: Record<string, Binding>
  try { parsed = JSON.parse(bindings!) } catch { return fail('中控账号绑定 JSON 无效', 503) }
  return new JonworkControl(url!, parsed)
}
