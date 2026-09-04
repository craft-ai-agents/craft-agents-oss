import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import matter from 'gray-matter';
import type { LoadedSkill } from './types';

export interface AccountSkillBundle {
  skill: LoadedSkill;
  revision: string;
  files: Array<{ path: string; base64: string }>;
}
export interface AccountSkillSnapshot { skills: AccountSkillBundle[] }
export interface SaveAccountSkillInput { slug: string; content: string; expectedRevision: string | null }

export class SkillLibraryError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function validateSkillSlug(slug: string): void {
  if (typeof slug !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,127}$/.test(slug)) {
    throw new SkillLibraryError('技能标识只能包含字母、数字、短横线和下划线');
  }
}

// Reject links at every level, including dangling links and Windows junctions.
// Neither tenants nor cached skill bundles may redirect reads/writes elsewhere.
export function assertSkillPath(root: string, target: string): void {
  const base = resolve(root);
  const destination = resolve(target);
  const rel = relative(base, destination);
  if (rel === '..' || rel.startsWith(`..\\`) || rel.startsWith('../') || isAbsolute(rel)) {
    throw new SkillLibraryError('无权访问技能目录之外的文件', 403);
  }
  let cursor = destination;
  while (true) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw new SkillLibraryError('技能目录不允许符号链接', 403);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (existsSync(base) && existsSync(destination)) {
    const actual = relative(realpathSync(base), realpathSync(destination));
    if (actual === '..' || actual.startsWith('../') || actual.startsWith('..\\') || isAbsolute(actual)) {
      throw new SkillLibraryError('无权访问技能目录之外的文件', 403);
    }
  }
}

const MAX_SKILL_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 500;
function permittedFile(path: string): boolean {
  return !path.split(/[\\/]/).some(part => part.startsWith('.') || /^(node_modules|credentials(?:\..*)?|id_rsa.*|id_ed25519.*)$/i.test(part))
    && !/\.(pem|key|credentials)$/i.test(path);
}

function parseContent(content: string) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 1024 * 1024) throw new SkillLibraryError('SKILL.md 不能超过 1 MB');
  let parsed;
  try { parsed = matter(content); } catch { throw new SkillLibraryError('SKILL.md 的 YAML 格式无效'); }
  if (typeof parsed.data.name !== 'string' || !parsed.data.name.trim() || typeof parsed.data.description !== 'string' || !parsed.data.description.trim()) {
    throw new SkillLibraryError('SKILL.md 必须包含 name 和 description');
  }
  return parsed;
}

export function readSkillBundle(root: string, slug: string, visibility: 'public' | 'private'): AccountSkillBundle | null {
  validateSkillSlug(slug);
  const skillDir = join(root, slug);
  assertSkillPath(root, skillDir);
  if (!existsSync(join(skillDir, 'SKILL.md'))) return null;
  const files: AccountSkillBundle['files'] = [];
  let size = 0;
  function scan(dir: string, prefix = '') {
    assertSkillPath(root, dir);
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!permittedFile(path) || entry.isSymbolicLink()) continue;
      const absolute = join(dir, entry.name);
      assertSkillPath(root, absolute);
      if (entry.isDirectory()) scan(absolute, path);
      else if (entry.isFile()) {
        size += lstatSync(absolute).size;
        if (size > MAX_SKILL_BYTES || files.length >= MAX_FILES) throw new SkillLibraryError('技能文件过大或数量过多');
        files.push({ path, base64: readFileSync(absolute).toString('base64') });
      }
    }
  }
  scan(skillDir);
  const markdown = files.find(file => file.path === 'SKILL.md');
  if (!markdown) return null;
  const parsed = parseContent(Buffer.from(markdown.base64, 'base64').toString('utf8'));
  return {
    skill: {
      slug,
      metadata: {
        name: typeof parsed.data.metadata?.display_name === 'string' ? parsed.data.metadata.display_name : parsed.data.name,
        description: parsed.data.description,
        icon: typeof parsed.data.icon === 'string' ? parsed.data.icon : undefined,
        requiredSources: Array.isArray(parsed.data.requiredSources) ? parsed.data.requiredSources.filter((s: unknown) => typeof s === 'string') : undefined,
        module: typeof parsed.data.metadata?.module === 'string' ? parsed.data.metadata.module : undefined,
      },
      content: parsed.content,
      path: `account-skills/${visibility}/${slug}`,
      source: visibility === 'public' ? 'global' : 'workspace',
      library: 'account', visibility, readOnly: visibility === 'public',
    },
    revision: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    files,
  };
}

export class AccountSkillLibrary {
  constructor(readonly publicRoot: string, readonly privateRoot: string) {}

  snapshot(): AccountSkillSnapshot {
    const skills = new Map<string, AccountSkillBundle>();
    for (const [root, visibility] of [[this.publicRoot, 'public'], [this.privateRoot, 'private']] as const) {
      assertSkillPath(root, root);
      if (!existsSync(root)) continue;
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
        const bundle = readSkillBundle(root, entry.name, visibility);
        if (bundle) skills.set(entry.name, bundle);
      }
    }
    return { skills: [...skills.values()] };
  }

  get(slug: string): AccountSkillBundle | null {
    return readSkillBundle(this.privateRoot, slug, 'private') ?? readSkillBundle(this.publicRoot, slug, 'public');
  }

  save(input: SaveAccountSkillInput): AccountSkillBundle {
    validateSkillSlug(input.slug);
    parseContent(input.content);
    const existing = this.get(input.slug);
    if (existing?.skill.readOnly) throw new SkillLibraryError('公共技能只读，请使用新的技能标识另存为私有技能', 403);
    if ((existing?.revision ?? null) !== input.expectedRevision) throw new SkillLibraryError('技能已在其他设备修改，请重新打开后再保存', 409);
    const dir = join(this.privateRoot, input.slug);
    assertSkillPath(this.privateRoot, join(dir, 'SKILL.md'));
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.save-${randomUUID()}.tmp`);
    writeFileSync(tmp, input.content, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, join(dir, 'SKILL.md'));
    return this.get(input.slug)!;
  }

  delete(slug: string, expectedRevision: string): void {
    const existing = this.get(slug);
    if (!existing) throw new SkillLibraryError('技能不存在', 404);
    if (existing.skill.readOnly) throw new SkillLibraryError('公共技能只读', 403);
    if (existing.revision !== expectedRevision) throw new SkillLibraryError('技能已在其他设备修改，请刷新后重试', 409);
    const target = join(this.privateRoot, slug);
    assertSkillPath(this.privateRoot, target);
    // Recoverable delete, outside the skill catalog; never remove shared data.
    const trash = join(this.privateRoot, '.trash');
    assertSkillPath(this.privateRoot, trash);
    mkdirSync(trash, { recursive: true });
    renameSync(target, join(trash, `${slug}-${randomUUID()}`));
  }
}

/** Account-specific, content-checked cache. Not an OS-level sandbox. */
export function materializeAccountSkills(snapshot: AccountSkillSnapshot, accountCacheRoot: string): { publicRoot: string; privateRoot: string } {
  const version = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const root = join(accountCacheRoot, version);
  assertSkillPath(accountCacheRoot, root);
  const expected = new Map<string, Buffer>();
  for (const bundle of snapshot.skills) for (const file of bundle.files) {
    const target = join(root, bundle.skill.visibility!, bundle.skill.slug, file.path);
    assertSkillPath(root, target);
    expected.set(resolve(target), Buffer.from(file.base64, 'base64'));
  }
  if (existsSync(join(root, '.complete'))) {
    const seen = new Set<string>();
    const verify = (dir: string) => {
      assertSkillPath(root, dir);
      for (const entry of readdirSync(dir, {withFileTypes:true})) {
        const target = join(dir,entry.name); assertSkillPath(root,target);
        if (entry.isDirectory()) { verify(target); continue; }
        if (target === join(root,'.complete')) continue;
        const bytes = expected.get(resolve(target));
        if (!entry.isFile() || !bytes || !readFileSync(target).equals(bytes)) throw new SkillLibraryError('执行技能缓存已被修改，请管理员核查后重新初始化',403);
        seen.add(resolve(target));
      }
    };
    verify(root);
    if (seen.size !== expected.size) throw new SkillLibraryError('执行技能缓存不完整，请管理员核查',403);
  }
  if (!existsSync(join(root, '.complete'))) {
    mkdirSync(root, { recursive: true });
    for (const bundle of snapshot.skills) {
      validateSkillSlug(bundle.skill.slug);
      if (!['public', 'private'].includes(bundle.skill.visibility!)) throw new SkillLibraryError('无效的技能可见范围');
      let size = 0;
      if (bundle.files.length > MAX_FILES) throw new SkillLibraryError('技能文件数量过多');
      for (const file of bundle.files) {
        if (!file.path || file.path.includes('\\') || file.path.split('/').some(p => !p || p === '..' || p === '.') || isAbsolute(file.path) || file.path.includes(':') || !permittedFile(file.path)) throw new SkillLibraryError('无效的技能文件路径');
        const target = join(root, bundle.skill.visibility!, bundle.skill.slug, file.path);
        assertSkillPath(root, target);
        const bytes = Buffer.from(file.base64, 'base64');
        size += bytes.length;
        if (size > MAX_SKILL_BYTES) throw new SkillLibraryError('技能文件过大');
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes, { mode: 0o600 });
      }
    }
    writeFileSync(join(root, '.complete'), '1');
  }
  return { publicRoot: join(root, 'public'), privateRoot: join(root, 'private') };
}
