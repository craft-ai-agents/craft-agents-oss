/** Validate and expose ERP-managed skill bundles without leaking private workspace data. */
import { createHash } from 'node:crypto'
import matter from 'gray-matter'
import { AccountSkillLibrary, SkillLibraryError, type AccountSkillBundle } from '@craft-agent/shared/skills'

export type Release = { name: string; slug: string; version: string; content_hash: string }
function fail(message = '中控响应无效，请联系管理员', status = 502): never {
  throw new SkillLibraryError(message, status)
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

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
export interface ErpResourceProvider {
  catalog(account: string): Promise<Release[]>
  bundle(account: string, release: Release): Promise<AccountSkillBundle>
}

export async function erpSkillLibrary(provider: ErpResourceProvider, account: string, privateRoot: string) {
  const releases = await provider.catalog(account)
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
        const bundle = await provider.bundle(account, release)
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
      return local ?? (release ? await provider.bundle(account, release) : null)
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
