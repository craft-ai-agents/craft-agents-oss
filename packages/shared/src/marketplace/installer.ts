/**
 * Marketplace installer — pinned-ref checkout → verify → atomic install.
 * Spec: docs/runtime-context-marketplace-prd.md §8.1, plan §5 (M4a).
 *
 * Guarantees:
 * - clone is ALWAYS pinned to the catalog commit SHA and verified
 *   (git rev-parse HEAD === ref; mismatch → staging wiped, nothing installed);
 * - upstream install scripts are NEVER executed (clone-only, no npm/brew/curl|sh);
 * - installation is atomic per target: stage in a sibling tmp dir, then
 *   rename over the destination (backup+rollback when replacing);
 * - kind:tool does NOT install anything in M4a — the tool name is validated
 *   against the toolchain manifest and recorded as 'deferred' so the UI can
 *   route the actual install through toolchain:update.
 */

import { execFile } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'

import { CONFIG_DIR } from '../config/paths.ts'
import { CodedError } from '../protocol/types.ts'
import { loadManifest } from '../toolchain/manifest.ts'
import { atomicWriteFileSync, marketplacePaths, type MarketplaceDocument, type MarketplaceEntry, type MarketplaceFetch } from './catalog.ts'
import {
  INSTALL_MARKER_NAME,
  readInstallMarker,
  readLock,
  removeInstallMarker,
  removeLockRecord,
  upsertLockRecord,
  writeInstallMarker,
  type MarketplaceLockRecord,
} from './lock.ts'

const execFileAsync = promisify(execFile)

export interface ExecFileResult {
  stdout: string
  stderr: string
}

export type ExecFileFn = (file: string, args: string[], options: { cwd?: string }) => Promise<ExecFileResult>

const defaultExecFile: ExecFileFn = async (file, args, options) => {
  const { stdout, stderr } = await execFileAsync(file, args, { cwd: options.cwd, maxBuffer: 16 * 1024 * 1024 })
  return { stdout, stderr }
}

export class MarketplaceIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarketplaceIntegrityError'
  }
}

export interface InstallOptions {
  configDir?: string
  /** Default ~/.agents/skills */
  skillsDir?: string
  /** Default <configDir>/context */
  contextDir?: string
  execFileFn?: ExecFileFn
  fetchFn?: MarketplaceFetch
  now?: () => number
  onProgress?: (phase: 'clone' | 'verify' | 'install' | 'fetch' | 'collision', detail?: string) => void
}

export type MarketplaceInstallResult =
  | {
      id: string
      kind: 'skillpack'
      status: 'installed'
      ref: string
      skills: string[]
      targets: string[]
      /** Pre-existing unowned dirs, пропущенные гардой (не overwrite). */
      collisions?: string[]
    }
  | { id: string; kind: 'context-doc'; status: 'installed'; ref: string; targets: string[]; collisions?: string[] }
  | { id: string; kind: 'tool'; status: 'deferred' | 'installed'; ref: string; toolName: string }

export interface RemovedKept {
  path: string
  reason: 'locally-modified' | 'not-owned'
}

export type MarketplaceRemoveResult = {
  id: string
  status: 'removed' | 'partial' | 'not-installed'
  removed: string[]
  kept: RemovedKept[]
}

// ---------------------------------------------------------------------------
// Content hashing (SHA-256 over sorted relative paths + bytes). Used both to
// record install content and to detect local edits on remove (soft-clean).
// ---------------------------------------------------------------------------

function walkFiles(dir: string, base: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, base, out)
    else if (entry.isFile()) out.push(relative(base, full))
  }
}

export function sha256Directory(dir: string): string {
  const hash = createHash('sha256')
  const files: string[] = []
  walkFiles(dir, dir, files)
  // Install-маркер (.craft-marketplace.lock.json) пишется ПОСЛЕ записи sha в record —
  // иначе первый remove читал бы «свежий» sha с маркером и объявлял директорию
  // locally-modified (soft-clean ложный keep).
  const comparable = files.filter((rel) => basename(rel) !== INSTALL_MARKER_NAME)
  comparable.sort()
  for (const rel of comparable) {
    hash.update(rel)
    hash.update('\0')
    hash.update(readFileSync(join(dir, rel)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

export function sha256FileContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

// ---------------------------------------------------------------------------
// Pinned-ref checkout. Uses `git fetch <sha> --depth 1` (GitHub allows
// reachable-SHA fetch), then verifies the checked-out HEAD equals the pin.
// ---------------------------------------------------------------------------

export async function checkoutPinnedRef(
  repo: string,
  ref: string,
  stagingDir: string,
  execFileFn: ExecFileFn = defaultExecFile,
): Promise<void> {
  rmSync(stagingDir, { recursive: true, force: true })
  mkdirSync(stagingDir, { recursive: true })
  const url = `https://github.com/${repo}.git`
  await execFileFn('git', ['init', '-q', stagingDir], {})
  try {
    await execFileFn('git', ['remote', 'add', 'origin', url], { cwd: stagingDir })
    await execFileFn('git', ['fetch', '-q', '--depth', '1', 'origin', ref], { cwd: stagingDir })
    await execFileFn('git', ['-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD'], { cwd: stagingDir })
    const { stdout } = await execFileFn('git', ['rev-parse', 'HEAD'], { cwd: stagingDir })
    const head = stdout.trim()
    if (head !== ref) {
      throw new MarketplaceIntegrityError(`ref mismatch for ${repo}: pinned ${ref}, got HEAD ${head}`)
    }
  } catch (err) {
    rmSync(stagingDir, { recursive: true, force: true })
    throw err
  }
}

// ---------------------------------------------------------------------------
// SKILL.md scanning (`skills` install mode)
// ---------------------------------------------------------------------------

interface ScannedSkill {
  /** Install basename under <skillsDir>. */
  name: string
  /** Absolute dir inside the staging checkout. */
  dir: string
}

const MAX_SCAN_DEPTH = 5

function scanForSkillFiles(base: string, depth: number, out: string[]): void {
  if (depth > MAX_SCAN_DEPTH || !existsSync(base)) return
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(base, entry.name)
    if (existsSync(join(full, 'SKILL.md'))) out.push(full)
    else scanForSkillFiles(full, depth + 1, out)
  }
}

/**
 * Find skill dirs inside a checkout. If the scan root itself has SKILL.md it
 * becomes a skill named after the entry id; nested skill dirs are flattened
 * to their basename (skill discovery reads exactly one level, see
 * skills/storage.ts loadSkillsFromDir).
 */
export function scanSkillDirs(checkoutDir: string, entry: MarketplaceEntry): ScannedSkill[] {
  const scanRoot = entry.skillsSubdir ? join(checkoutDir, entry.skillsSubdir) : checkoutDir
  // Containment: absolute skillsSubdir would make join() drop checkoutDir on POSIX.
  // Fail closed if scan root escapes the pinned checkout (or does not exist yet).
  try {
    const realCheckout = realpathSync(checkoutDir)
    const realScan = existsSync(scanRoot) ? realpathSync(scanRoot) : scanRoot
    const prefix = realCheckout.endsWith(sep) ? realCheckout : realCheckout + sep
    if (realScan !== realCheckout && !String(realScan).startsWith(prefix)) {
      throw new MarketplaceIntegrityError(
        `skillsSubdir escapes checkout: '${entry.skillsSubdir}' → ${realScan}`,
      )
    }
  } catch (err) {
    if (err instanceof MarketplaceIntegrityError) throw err
    // realpath failures (ENOENT on checkout) — fall through; empty scan below.
  }
  const found: string[] = []
  if (existsSync(join(scanRoot, 'SKILL.md'))) found.push(scanRoot)
  scanForSkillFiles(scanRoot, 1, found)
  if (found.length === 0) return []

  const used = new Set<string>()
  return found.map((dir) => {
    const wanted = dir === scanRoot ? entry.id : basename(dir)
    let name = wanted
    let n = 2
    while (used.has(name)) name = `${wanted}-${n++}` // basename collisions in flat packs
    used.add(name)
    return { name, dir }
  })
}

// ---------------------------------------------------------------------------
// Atomic target swap
// ---------------------------------------------------------------------------

function swapStagedIntoPlace(staged: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true })
  const backup = `${target}.craft-bak-${randomBytes(4).toString('hex')}`
  const hadExisting = existsSync(target)
  if (hadExisting) renameSync(target, backup)
  try {
    renameSync(staged, target)
  } catch (err) {
    if (hadExisting && existsSync(backup)) renameSync(backup, target) // rollback
    throw err
  }
  rmSync(backup, { recursive: true, force: true })
}

function copyCheckout(src: string, dest: string): void {
  cpSync(src, dest, {
    recursive: true,
    filter: (source) => !source.split(sep).includes('.git'),
  })
}

// ---------------------------------------------------------------------------
// Install (dispatch by kind)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Модульный in-process mutex: публичный installEntry сериализуется по entry.id
// на уровне модуля — прямые вызовы (минуя per-slug очередь RPC-хэндлера) не
// могут устроить гонку (double-clone, swap/lock рассинхрон): повторный install
// того же id ЖДЁТ завершения текущего. Разные id ставятся параллельно.
// Реализация — тот же promise-tail, что и createMarketplaceQueue ниже.
// ---------------------------------------------------------------------------

const installById = createMarketplaceQueue()

export function installEntry(entry: MarketplaceEntry, options: InstallOptions = {}): Promise<MarketplaceInstallResult> {
  return installById(entry.id, () => installEntryUnlocked(entry, options))
}

async function installEntryUnlocked(entry: MarketplaceEntry, options: InstallOptions = {}): Promise<MarketplaceInstallResult> {
  if (entry.kind === 'tool') {
    const toolName = entry.toolName as string // guaranteed by parseCatalog
    const known = loadManifest().some((tool) => tool.name === toolName)
    if (!known) {
      throw new CodedError(
        'TOOL_NOT_IN_MANIFEST',
        `Marketplace tool '${toolName}' (entry '${entry.id}') is not in the toolchain manifest; deferred install via toolchain:update is impossible`,
      )
    }
    const paths = marketplacePaths(options.configDir)
    const now = (options.now ?? (() => Date.now()))()
    upsertLockRecord(paths.lockFile, {
      id: entry.id,
      kind: 'tool',
      repo: entry.source.repo,
      ref: entry.source.ref,
      installedAt: now,
      status: 'deferred',
      targets: [],
      toolName,
    })
    return { id: entry.id, kind: 'tool', status: 'deferred', ref: entry.source.ref, toolName }
  }
  if (entry.kind === 'context-doc') return installContextDoc(entry, options)
  return installSkillpack(entry, options)
}

async function installSkillpack(entry: MarketplaceEntry, options: InstallOptions): Promise<MarketplaceInstallResult> {
  const configDir = options.configDir ?? CONFIG_DIR
  const paths = marketplacePaths(configDir)
  const skillsDir = options.skillsDir ?? join(homedir(), '.agents', 'skills')
  const execFileFn = options.execFileFn ?? defaultExecFile
  const now = () => (options.now ?? (() => Date.now()))()
  const progress = options.onProgress ?? (() => {})

  progress('clone', entry.source.repo)
  const staging = join(paths.tmpDir, `clone-${randomUUID()}`)
  await checkoutPinnedRef(entry.source.repo, entry.source.ref, staging, execFileFn)
  progress('verify')

  try {
    const record: MarketplaceLockRecord = {
      id: entry.id,
      kind: 'skillpack',
      repo: entry.source.repo,
      ref: entry.source.ref,
      installedAt: now(),
      status: 'installed',
      targets: [],
      skills: [],
      contentSha256: {},
    }

    // Владелец существующей target-директории: id записи из install-маркера
    // (источник истины — пишется при каждой установке) либо из aggregate
    // registry. null → артефакт НЕ наш (напр., ручная установка пользователя).
    const ownerOf = (target: string): string | null => {
      const marker = readInstallMarker(target)
      if (marker) return marker.id
      for (const existing of Object.values(readLock(paths.lockFile).entries)) {
        if (existing.targets.includes(target)) return existing.id
      }
      return null
    }

    const collisions: string[] = []
    /** Targets we actually wrote this call — rollback must NOT touch kept local-mod paths. */
    const writtenTargets: string[] = []

    const installOne = (name: string, srcDir: string, allowRename: boolean): void => {
      progress('install', name)
      let finalName = name
      let target = join(skillsDir, finalName)
      // Защита чужого контента: существующая директория без нашего install-маркера
      // и без записи в registry пропускается (не overwrite). Ошибку не бросаем —
      // помечаем collision'ом.
      if (existsSync(target)) {
        const owner = ownerOf(target)
        if (owner === null) {
          progress('collision', `${finalName} — existing unowned directory kept`)
          collisions.push(`${target} (unowned — existing user content kept)`)
          return
        }
        if (owner !== entry.id) {
          if (!allowRename) {
            // directory-mode: basename = entry.id, rename запрещён — fail-closed,
            // иначе swap перетрёт чужой пакет/артефакт с тем же именем.
            progress('collision', `${finalName} — owned by ${owner}, refuse overwrite`)
            collisions.push(`${target} (owned by ${owner} — refuse overwrite)`)
            return
          }
          // Cross-pack коллизия имён (skills-режим): basename занят ДРУГИМ
          // пакетом (маркер и registry принадлежат ему). Политика: namespaced
          // '<packid>--<skill>', чужой пакет не трогаем.
          const occupied = target
          finalName = `${entry.id}--${name}`
          target = join(skillsDir, finalName)
          progress('collision', `${name} renamed to ${finalName} (name in use by ${owner})`)
          collisions.push(`${occupied} renamed to ${finalName} (name in use by ${owner})`)
          if (existsSync(target)) {
            const namespacedOwner = ownerOf(target)
            if (namespacedOwner === null) {
              progress('collision', `${finalName} — existing unowned directory kept`)
              collisions.push(`${target} (unowned — existing user content kept)`)
              return
            }
            if (namespacedOwner !== entry.id) {
              progress('collision', `${finalName} — namespaced name in use by ${namespacedOwner}, skipped`)
              collisions.push(`${target} (namespaced name in use by ${namespacedOwner} — skipped)`)
              return
            }
          }
        } else {
          // owner === entry.id: reinstall/update. Soft-clean — keep user edits.
          // Missing contentSha256 → fail-closed keep (same as removeEntry).
          const prev = readLock(paths.lockFile).entries[entry.id]
          const recorded = prev?.contentSha256?.[target]
          if (!recorded) {
            progress('collision', `${finalName} — owned without hash, kept`)
            collisions.push(`${target} (locally-modified — user edits kept)`)
            record.targets.push(target)
            record.skills!.push(finalName)
            return
          }
          const current = sha256Directory(target)
          if (current !== recorded) {
            progress('collision', `${finalName} — locally modified, kept`)
            collisions.push(`${target} (locally-modified — user edits kept)`)
            record.targets.push(target)
            record.skills!.push(finalName)
            record.contentSha256![target] = recorded
            return
          }
        }
      }
      const staged = join(paths.tmpDir, `stage-${randomUUID()}`)
      copyCheckout(srcDir, staged)
      swapStagedIntoPlace(staged, target)
      const contentSha = sha256Directory(target)
      const pinKey = finalName // skills basename; directory mode uses entry.id as name
      const expected = entry.expectedContentSha256?.[pinKey]
      if (expected !== undefined && expected !== contentSha) {
        rmSync(target, { recursive: true, force: true })
        throw new MarketplaceIntegrityError(
          `content sha256 mismatch for '${pinKey}': expected ${expected.slice(0, 12)}…, got ${contentSha.slice(0, 12)}…`,
        )
      }
      record.targets.push(target)
      record.skills!.push(finalName)
      record.contentSha256![target] = contentSha
      writeInstallMarker(target, record)
      writtenTargets.push(target)
    }

    try {
      if (entry.installMode === 'directory') {
        // Whole-repo pack (clone-only). Upstream install.sh is NEVER executed.
        installOne(entry.id, staging, false)
        // Fail only when nothing landed (unowned/foreign refuse). Locally-modified
        // keep leaves targets non-empty and is a successful soft-clean update.
        if (record.targets.length === 0) {
          throw new MarketplaceIntegrityError(
            `cannot install '${entry.id}': target exists and is not ours` +
              (collisions[0] ? ` — ${collisions[0]}` : ''),
          )
        }
      } else {
        const skills = scanSkillDirs(staging, entry)
        if (skills.length === 0) {
          throw new MarketplaceIntegrityError(`no SKILL.md found in ${entry.source.repo}@${entry.source.ref.slice(0, 8)} (subdir '${entry.skillsSubdir ?? '.'}')`)
        }
        for (const skill of skills) installOne(skill.name, skill.dir, true)
        // Mirror context-doc: all-collision install must not write a false
        // 'installed' lock row with zero targets (UI would show Installed, remove no-ops).
        if (record.targets.length === 0) {
          throw new MarketplaceIntegrityError(
            `cannot install '${entry.id}': no writable skills` +
              (collisions[0] ? ` — ${collisions[0]}` : ''),
          )
        }
      }
    } catch (err) {
      // Rollback only what THIS call wrote — never rmSync kept local-mod targets.
      for (const target of writtenTargets) {
        rmSync(target, { recursive: true, force: true })
      }
      throw err
    }
    upsertLockRecord(paths.lockFile, record)
    const result: MarketplaceInstallResult = { id: entry.id, kind: 'skillpack', status: 'installed', ref: entry.source.ref, skills: record.skills!, targets: record.targets }
    if (collisions.length > 0 && result.kind === 'skillpack') result.collisions = collisions
    return result
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

async function installContextDoc(entry: MarketplaceEntry, options: InstallOptions): Promise<MarketplaceInstallResult> {
  const configDir = options.configDir ?? CONFIG_DIR
  const paths = marketplacePaths(configDir)
  const contextDir = options.contextDir ?? join(configDir, 'context')
  const fetchFn: MarketplaceFetch | undefined = options.fetchFn ?? (globalThis.fetch as unknown as MarketplaceFetch | undefined)
  if (!fetchFn) throw new MarketplaceIntegrityError('fetch unavailable — cannot download context-doc sources')
  const now = (options.now ?? (() => Date.now()))()
  const progress = options.onProgress ?? (() => {})

  const MAX_DOC_BYTES = 1024 * 1024 // 1MB sanity cap per document
  const record: MarketplaceLockRecord = {
    id: entry.id,
    kind: 'context-doc',
    repo: entry.source.repo,
    ref: entry.source.ref,
    installedAt: now,
    status: 'installed',
    targets: [],
    contentSha256: {},
  }

  mkdirSync(contextDir, { recursive: true })
  // Fetch-all-then-write-all: иначе обрыв на N-м документе оставляет N-1 сирот
  // без lock-записи (removeEntry → not-installed, файлы потеряны навсегда).
  const staged: { doc: MarketplaceDocument; body: string }[] = []
  for (const doc of entry.documents ?? []) {
    progress('fetch', doc.repoPath)
    const url = `https://raw.githubusercontent.com/${entry.source.repo}/${entry.source.ref}/${doc.repoPath}`
    const res = await fetchFn(url, { headers: { 'user-agent': 'craft-agents-marketplace' }, signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new MarketplaceIntegrityError(`HTTP ${res.status} downloading ${url}`)
    const body = await res.text()
    if (Buffer.byteLength(body) > MAX_DOC_BYTES) {
      throw new MarketplaceIntegrityError(`document ${doc.repoPath} exceeds 1MB cap`)
    }
    staged.push({ doc, body })
  }
  const collisions: string[] = []
  // Владелец существующего target: marker (source of truth) либо registry.
  // null → файл пользователя/шаблон ensureContextDocs без marketplace-маркера —
  // НЕ overwrite (иначе marketplace pack затирает soul.md/rules.md юзера).
  const ownerOf = (target: string): string | null => {
    const marker = readInstallMarker(target)
    if (marker) return marker.id
    for (const existing of Object.values(readLock(paths.lockFile).entries)) {
      if (existing.targets.includes(target)) return existing.id
    }
    return null
  }

  /** Targets written this call — rollback on integrity failure mid-loop. */
  const writtenTargets: string[] = []

  try {
    for (const { doc, body } of staged) {
      const target = join(contextDir, doc.targetName)
      if (existsSync(target)) {
        const owner = ownerOf(target)
        if (owner === null) {
          progress('collision', `${doc.targetName} — existing unowned context doc kept`)
          collisions.push(`${target} (unowned — existing user content kept)`)
          continue
        }
        if (owner !== entry.id) {
          progress('collision', `${doc.targetName} — owned by ${owner}, refuse overwrite`)
          collisions.push(`${target} (owned by ${owner} — refuse overwrite)`)
          continue
        }
        // owner === entry.id: soft-clean on update — keep user edits.
        // Missing contentSha256 → fail-closed keep (mirror removeEntry).
        const prev = readLock(paths.lockFile).entries[entry.id]
        const recorded = prev?.contentSha256?.[target]
        if (!recorded) {
          progress('collision', `${doc.targetName} — owned without hash, kept`)
          collisions.push(`${target} (locally-modified — user edits kept)`)
          record.targets.push(target)
          continue
        }
        const current = sha256FileContent(readFileSync(target))
        if (current !== recorded) {
          progress('collision', `${doc.targetName} — locally modified, kept`)
          collisions.push(`${target} (locally-modified — user edits kept)`)
          record.targets.push(target)
          record.contentSha256![target] = recorded
          continue
        }
      }
      atomicWriteFileSync(target, body)
      const contentSha = sha256FileContent(body)
      const expected = entry.expectedContentSha256?.[doc.targetName]
      if (expected !== undefined && expected !== contentSha) {
        rmSync(target, { recursive: true, force: true })
        removeInstallMarker(target)
        throw new MarketplaceIntegrityError(
          `content sha256 mismatch for '${doc.targetName}': expected ${expected.slice(0, 12)}…, got ${contentSha.slice(0, 12)}…`,
        )
      }
      record.targets.push(target)
      record.contentSha256![target] = contentSha
      writeInstallMarker(target, record)
      writtenTargets.push(target)
    }
  } catch (err) {
    for (const target of writtenTargets) {
      rmSync(target, { recursive: true, force: true })
      removeInstallMarker(target)
    }
    throw err
  }

  if (record.targets.length === 0) {
    throw new MarketplaceIntegrityError(
      `cannot install '${entry.id}': no writable context docs` +
        (collisions[0] ? ` — ${collisions[0]}` : ''),
    )
  }

  upsertLockRecord(paths.lockFile, record)
  const result: MarketplaceInstallResult = {
    id: entry.id,
    kind: 'context-doc',
    status: 'installed',
    ref: entry.source.ref,
    targets: record.targets,
  }
  if (collisions.length > 0 && result.kind === 'context-doc') result.collisions = collisions
  return result
}

// ---------------------------------------------------------------------------
// Remove (soft-clean: delete only content we installed, untouched if the user
// edited it — proven by content SHA in the record/marker)
// ---------------------------------------------------------------------------

export function removeEntry(id: string, options: { configDir?: string; lockPath?: string } = {}): MarketplaceRemoveResult {
  const lockPath = options.lockPath ?? marketplacePaths(options.configDir).lockFile
  const record = readLock(lockPath).entries[id]
  if (!record) return { id, status: 'not-installed', removed: [], kept: [] }

  const removed: string[] = []
  const kept: RemovedKept[] = []

  for (const target of record.targets) {
    if (!existsSync(target)) {
      removed.push(target) // already gone from disk; drop the registry reference
      removeInstallMarker(target)
      continue
    }
    const recorded = record.contentSha256?.[target]
    // Fail-closed: missing hash → treat as locally-modified (do not delete user data).
    // Older/partial records or mid-write crashes must not rmSync user edits.
    if (!recorded) {
      kept.push({ path: target, reason: 'locally-modified' })
      removeInstallMarker(target)
      continue
    }
    const current = statSync(target).isDirectory() ? sha256Directory(target) : sha256FileContent(readFileSync(target))
    if (current !== recorded) {
      kept.push({ path: target, reason: 'locally-modified' })
      removeInstallMarker(target)
      continue
    }
    rmSync(target, { recursive: true, force: true })
    removeInstallMarker(target)
    removed.push(target)
  }

  removeLockRecord(lockPath, id)
  return { id, status: kept.length > 0 ? 'partial' : 'removed', removed, kept }
}

// ---------------------------------------------------------------------------
// Per-slug install queue (RPC handler serializes mutations per entry id)
// ---------------------------------------------------------------------------

export function createMarketplaceQueue(): <T>(key: string, fn: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>()
  return function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (tails.get(key) ?? Promise.resolve()).catch(() => {}).then(fn)
    tails.set(key, run)
    // ВАЖНО: cleanup-цепочку надо сразу галшировать ошибкой — иначе .finally на
    // отвергнутом run создаёт ВТОРУЮ цепочку (unhandledRejection), которая ложно
    // красним тесты ((fail) в bun test) и шумит в серверном процессе.
    void run.catch(() => {}).finally(() => {
      if (tails.get(key) === run) tails.delete(key)
    })
    return run
  }
}
