import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync, rmSync } from 'fs';
import type { AnyMemory } from './types';

/**
 * Per-class frontmatter keys. The common keys (id, class, scope, scopeId,
 * confidence, sensitivity, tags, createdAt, updatedAt, archived,
 * source_session, source_message) are emitted for every vault file. The
 * class-specific keys are emitted only for the matching `memory.class`,
 * so the writer is what's responsible for keeping the frontmatter in sync
 * with what `parseVaultRecord` (in repository.ts) expects on the read path.
 */
const COMMON_KEYS = [
  'id', 'class', 'scope', 'scopeId', 'confidence', 'sensitivity',
  'tags', 'createdAt', 'updatedAt', 'archived',
  'source_session', 'source_message',
] as const;

const CLASS_KEYS = {
  profile:    ['key'],
  semantic:   ['category', 'explicit', 'canonicalQuestion'],
  episodic:   ['sessionId', 'outcome', 'tokenCost', 'durationSeconds'],
  procedural: ['triggers', 'successCount', 'pitfalls', 'dependencies'],
} as const;

/**
 * Serialize a single frontmatter field. Lists (triggers / pitfalls / deps)
 * are written as JSON arrays so the parser can round-trip them losslessly.
 * Empty `scopeId` becomes empty string so the line still emits (the parser
 * distinguishes missing-vs-empty).
 *
 * Lists followed by JSON.stringify get their array brackets preserved so
 * `["a","b"]` round-trips losslessly. `parseTagsField` strips the brackets
 * if a hand-edited YAML inline list (`[a, b]`) is encountered on read.
 */
function frontmatterValue(key: string, value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') return value;
  return String(value);
}

function memoryToMarkdown(memory: AnyMemory): string {
  const classKeys = CLASS_KEYS[memory.class] ?? [];
  const orderedKeys = [...COMMON_KEYS, ...classKeys];

  const lines: string[] = [];
  for (const key of orderedKeys) {
    let raw: unknown;
    if (key === 'tags') {
      raw = memory.tags;
    } else if (key.startsWith('source_')) {
      const tail = key.slice('source_'.length);
      raw = (memory.source as any)?.[tail];
    } else {
      raw = (memory as any)[key];
    }
    lines.push(`${key}: ${frontmatterValue(key, raw)}`);
  }

  const frontmatter = `---\n${lines.join('\n')}\n---`;
  // Sanitize multi-line titles so the markdown H1 stays a clean single line.
  // parseVaultRecord's title regex matches up to the first line break; a title
  // with an embedded `\n` would otherwise be truncated on round-trip to just
  // the first line, silently dropping the rest of the user-supplied title.
  const safeTitle = String(memory.title ?? '').replace(/[\r\n]+/g, ' ');
  const body = `# ${safeTitle}\n\n${memory.content}`;
  return `${frontmatter}\n\n${body}\n`;
}

/**
 * One raw vault file as read off disk, before the parser maps it into an
 * `AnyMemory`. `frontmatter` is a flat record; body is the markdown body
 * (everything after the closing `---`). `filePath` is for error reporting.
 */
export interface VaultFileRecord {
  filePath: string;
  frontmatter: Record<string, string>;
  body: string;
}

export interface VaultFileError {
  filePath: string;
  message: string;
}

export type VaultReadResult = {
  records: VaultFileRecord[];
  errors: VaultFileError[];
};

/**
 * Split a vault markdown file into frontmatter + body. The frontmatter is
 * bounded by the FIRST `---\n` (line 1) and the NEXT `---\n` line; anything
 * after the second `---` is the body. If the file has no leading `---` or
 * no closing `---`, the file is malformed and we return an error rather
 * than fabricate a partial parse.
 */
function splitFrontmatter(raw: string, filePath: string): { frontmatter: Record<string, string>; body: string } {
  // Normalize CRLF -> LF so leading-`\n` checks work on Windows-authored files.
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error(`missing leading '---' delimiter`);
  }
  // Skip past the opening '---' and look for the next '---' on its own line.
  const afterOpen = normalized.slice(4);
  const closeIdx = afterOpen.indexOf('\n---');
  if (closeIdx < 0) {
    throw new Error(`missing closing '---' delimiter`);
  }
  const block = afterOpen.slice(0, closeIdx);
  const body = afterOpen.slice(closeIdx + 4).replace(/^\n/, '');

  const frontmatter: Record<string, string> = {};
  for (const line of block.split('\n')) {
    if (!line.includes(':')) continue;
    const idx = line.indexOf(':');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

/**
 * Strip filesystem-unsafe characters from a filename stem. Windows
 * rejects `\ / : * ? " < > |` in NTFS filenames, and a stray colon in a
 * memory id (e.g. `mem:p1`) used to silently truncate `writeFileSync` to
 * a zero-byte stub with the extension stripped on disk - leaving every
 * vault round-trip look successful but `readVault()` returned zero
 * records. The stem itself is whatever the caller passes in; here we
 * only scrub characters and do NOT truncate, because truncating a long
 * `${title}_${id}` stem to a fixed length used to silently chop the id
 * portion and produce different memories that hash to the same path,
 * causing one memory to overwrite another on disk.
 */
function safeFilenameStem(stem: string): string {
  return stem.replace(/[\\\/:*?"<>|]/g, '_');
}

export class ObsidianVaultSync {
  private vaultRoot: string;

  constructor(vaultRoot: string) {
    this.vaultRoot = vaultRoot;
    for (const cls of ['profile', 'semantic', 'episodic', 'procedural']) {
      const dir = join(this.vaultRoot, cls);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  static createSync(vaultRoot: string): ObsidianVaultSync {
    return new ObsidianVaultSync(vaultRoot);
  }

  /**
   * Reverse of `getPath` so we can clean up a vault file given just the
   * `memory_id`. Not currently used by `readVault` (which scans by folder)
   * but kept so a future sweeper job can reconcile orphans.
   *
   * Both the title and the id go through `safeFilenameStem` - the id can
   * carry reserved characters (`mem:p1` has `:`) that Windows silently
   * truncated writes through before this fix.
   */
  pathFor(memory: AnyMemory): string {
    return join(this.vaultRoot, memory.class, `${safeFilenameStem(`${memory.title}_${memory.id}`)}.md`);
  }

  private getPath(memory: AnyMemory): string {
    return this.pathFor(memory);
  }

  syncMemory(memory: AnyMemory): void {
    const path = this.getPath(memory);
    writeFileSync(path, memoryToMarkdown(memory), 'utf-8');
  }

  syncAll(memories: AnyMemory[]): void {
    for (const m of memories) this.syncMemory(m);
  }

  removeMemory(memory: AnyMemory): void {
    const path = this.getPath(memory);
    if (existsSync(path)) rmSync(path);
  }

  /**
   * Read every vault file in the four class folders. Returns BOTH the
   * successfully-parsed records AND a list of files that failed to parse,
   * so the caller can decide whether to surface partial failures to the
   * user rather than silently dropping them.
   *
   * The previous `readVault()` returned a partial shape (id, class, title,
   * content, tags only) and used fragile regex / `split('---')` that
   * captured the wrong body section when the frontmatter spanned multiple
   * `---` lines. This rewrite installs the proper frontmatter parser in
   * `splitFrontmatter` so round-trip fidelity extends beyond the four
   * common fields.
   */
  readVault(): VaultReadResult {
    const records: VaultFileRecord[] = [];
    const errors: VaultFileError[] = [];
    for (const cls of ['profile', 'semantic', 'episodic', 'procedural']) {
      const dir = join(this.vaultRoot, cls);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.md')) continue;
        const filePath = join(dir, file);
        try {
          const raw = readFileSync(filePath, 'utf-8');
          const { frontmatter, body } = splitFrontmatter(raw, filePath);
          records.push({ filePath, frontmatter, body });
        } catch (e) {
          errors.push({
            filePath,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
    return { records, errors };
  }
}

export { memoryToMarkdown };
