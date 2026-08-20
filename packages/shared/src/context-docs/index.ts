/**
 * Runtime Context Documents
 *
 * Standing operating context for every agent session: `soul.md` (personality),
 * `rules.md` (mandatory working rules) and any user-added `*.md` documents.
 *
 * Storage: `<CONFIG_DIR>/context/*.md` (runtime, user-editable).
 * Templates ship in `apps/electron/resources/context/` and are seeded ONCE by
 * `ensureContextDocs()` (same bundle→disk sync model as `initializeDocs()` /
 * `ensureDefaultPermissions()`). Seeding NEVER overwrites existing files —
 * user edits always win. When a bundled template's
 * `<!-- context-doc-version: N -->` header is newer than the installed one,
 * `listContextDocs()` reports `templateStale: true` so the UI can offer a
 * merge; nothing is auto-rewritten.
 *
 * Prompt injection: `getContextDocsPromptBlock()` is consumed by both
 * `getSystemPrompt()` (Claude/Pi) and `buildCraftContextPrompt()` (OMP).
 * Per-document content is capped at 20KB and XML-defanged the same way
 * `formatProjectContextForPrompt()` sanitizes project fields, so doc
 * content can't break out of the surrounding prompt block. Project-level
 * `soul.md` / `rules.md` in the session's working directory override the
 * same-named global documents (see CONTEXT_FILE_PATTERNS in prompts/system.ts).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { dirname, join, basename } from 'path';
import { homedir } from 'os';
import { getBundledAssetsDir } from '../utils/paths.ts';
import { debug } from '../utils/debug.ts';

/** Atomic write: tmp sibling + rename (same FS → atomic on POSIX/NTFS). */
function atomicWriteFileSync(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, path);
}

// ============================================================
// Constants
// ============================================================

/** Resolve "<!-- context-doc-version: N -->" from a document (first lines). */
const VERSION_HEADER_PATTERN = /^\s*<!--\s*context-doc-version:\s*(\d+)\s*-->/;

/** Match any full-line version header anywhere (body comparison strips these). */
const VERSION_HEADER_LINE_PATTERN = /^\s*<!--\s*context-doc-version:\s*\d+\s*-->\s*$/gm;

/** Per-document cap when injected into the system prompt (20KB). */
export const MAX_CONTEXT_DOC_PROMPT_SIZE = 20 * 1024;

/** Template documents shipped in the bundle, in canonical prompt order. */
export const TEMPLATE_DOC_FILENAMES = ['soul.md', 'rules.md'] as const;

/**
 * Wrapper tags of the prompt block — their closing form must never survive
 * inside injected document bodies (same defang model as PROJECT_BLOCK_TAGS
 * in prompts/system.ts).
 */
const CONTEXT_DOC_BLOCK_TAGS = ['context_documents', 'context_document'] as const;

// ============================================================
// Types
// ============================================================

export interface ContextDocInfo {
  /** Document name without extension (e.g. 'soul'). */
  name: string;
  /** File name with extension (e.g. 'soul.md') — the read/write key. */
  filename: string;
  /** Size in bytes. */
  size: number;
  /** mtime in ms since epoch. */
  modifiedAt: number;
  /** Installed `context-doc-version` header, null when absent (user-authored doc). */
  version: number | null;
  /** Bundled template's `context-doc-version` for the same filename, null when no template. */
  templateVersion: number | null;
  /** True when the bundled template is newer than the installed header — UI offers a merge. */
  templateStale: boolean;
  /**
   * True when a bundled template exists and the installed body (version header
   * lines stripped) differs from the template body. Independent of templateStale.
   */
  locallyEdited: boolean;
}

export interface ContextDocContent extends ContextDocInfo {
  /** Full document body as stored on disk (not capped/sanitized). */
  content: string;
}

export interface ContextDocsPromptOptions {
  /**
   * Session working directory. When provided, a project-level `soul.md` /
   * `rules.md` (matched case-insensitively, like CONTEXT_FILE_PATTERNS)
   * overrides the same-named global document's content in the block.
   */
  workingDirectory?: string;
}

// ============================================================
// Paths
// ============================================================

/**
 * Runtime context docs directory: `<CONFIG_DIR>/context`.
 * Resolved lazily per call (same pattern as getAppPermissionsDir) so
 * CRAFT_CONFIG_DIR changes take effect without a module reload.
 */
export function getContextDocsDir(): string {
  const configDir = process.env.CRAFT_CONFIG_DIR || join(homedir(), '.craft-agent');
  return join(configDir, 'context');
}

/**
 * Bundled templates directory (apps/electron/resources/context).
 * Resolution mirrors docs/index.ts: shared asset resolver (dev cwd and
 * packaged setBundledAssetsRoot), falling back to a dev cwd guess.
 */
function getTemplatesDir(): string {
  return (
    getBundledAssetsDir('context') ??
    // Fallback: development path (fails gracefully downstream if absent)
    join(process.cwd(), 'resources', 'context')
  );
}

// ============================================================
// Version headers
// ============================================================

/** Parse the `<!-- context-doc-version: N -->` header from document content. Null when absent/invalid. */
export function parseContextDocVersion(content: string): number | null {
  // Header must be at the very top of the document; bound the scan for huge files.
  const match = content.slice(0, 256).match(VERSION_HEADER_PATTERN);
  const version = match?.[1];
  return version === undefined ? null : Number.parseInt(version, 10);
}

/**
 * Strip `<!-- context-doc-version: N -->` header lines and trim for body equality.
 * Used to detect local edits without treating a keep-mine version bump as an edit.
 */
export function stripContextDocVersionHeaders(content: string): string {
  return content.replace(VERSION_HEADER_LINE_PATTERN, '').trim();
}

// ============================================================
// Seed (ensure-once, never overwrite)
// ============================================================

/**
 * Seed bundled context document templates into `<CONFIG_DIR>/context/`.
 * Copies each bundled `*.md` that does not exist on disk yet — existing files
 * are NEVER touched, so user edits survive every subsequent call, app update
 * and hot reload. Call at server boot (registerContextDocsHandlers does).
 */
export function ensureContextDocs(): void {
  const docsDir = getContextDocsDir();
  try {
    if (!existsSync(docsDir)) {
      mkdirSync(docsDir, { recursive: true });
    }
  } catch (error) {
    debug('[context-docs] Could not create context dir:', docsDir, error);
    return;
  }

  const templatesDir = getTemplatesDir();
  let templates: string[];
  try {
    templates = existsSync(templatesDir)
      ? readdirSync(templatesDir).filter((f) => f.endsWith('.md'))
      : [];
  } catch (error) {
    debug('[context-docs] Could not read templates dir:', templatesDir, error);
    return;
  }

  for (const filename of templates) {
    const srcPath = join(templatesDir, filename);
    const destPath = join(docsDir, filename);
    if (existsSync(destPath)) continue; // ensure-once: user content always wins
    try {
      atomicWriteFileSync(destPath, readFileSync(srcPath, 'utf-8'));
      debug('[context-docs] Seeded', filename);
    } catch (error) {
      debug('[context-docs] Failed to seed', filename, error);
    }
  }
}

// ============================================================
// CRUD
// ============================================================

/**
 * Validate a document filename for read/write. Rejects path separators,
 * traversal, and non-markdown names so RPC callers can never escape the
 * context directory.
 */
function assertValidDocFilename(filename: string): void {
  if (typeof filename !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*\.md$/.test(filename)) {
    throw new Error(`Invalid context document name: ${String(filename)}`);
  }
  if (filename.includes('..') || basename(filename) !== filename) {
    throw new Error(`Invalid context document name: ${filename}`);
  }
}

function statMtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function buildDocInfo(filename: string, content: string, modifiedAt: number): ContextDocInfo {
  const version = parseContextDocVersion(content);
  let templateVersion: number | null = null;
  let templateBody: string | null = null;
  try {
    const templatePath = join(getTemplatesDir(), filename);
    if (existsSync(templatePath)) {
      templateBody = readFileSync(templatePath, 'utf-8');
      templateVersion = parseContextDocVersion(templateBody);
    }
  } catch (error) {
    debug('[context-docs] Failed to read template', filename, error);
  }
  const locallyEdited =
    templateBody !== null &&
    stripContextDocVersionHeaders(content) !== stripContextDocVersionHeaders(templateBody);
  return {
    name: filename.replace(/\.md$/, ''),
    filename,
    size: Buffer.byteLength(content, 'utf-8'),
    modifiedAt,
    version,
    templateVersion,
    // Newer template → offer a merge, never auto-rewrite. Docs without a
    // version header are treated as user-owned and never flagged.
    templateStale: templateVersion !== null && version !== null && templateVersion > version,
    locallyEdited,
  };
}

/** Canonical document order: soul.md, rules.md, then user docs alphabetically. */
function docOrder(filename: string): number {
  const idx = (TEMPLATE_DOC_FILENAMES as readonly string[]).indexOf(filename);
  return idx === -1 ? TEMPLATE_DOC_FILENAMES.length : idx;
}

/** List all context documents (soul, rules, user-added), templates first then alphabetical. */
export function listContextDocs(): ContextDocInfo[] {
  const docsDir = getContextDocsDir();
  if (!existsSync(docsDir)) return [];

  let filenames: string[];
  try {
    filenames = readdirSync(docsDir).filter((f) => f.endsWith('.md'));
  } catch (error) {
    debug('[context-docs] Could not list context dir:', docsDir, error);
    return [];
  }

  const docs: ContextDocInfo[] = [];
  for (const filename of filenames.sort((a, b) => docOrder(a) - docOrder(b) || a.localeCompare(b))) {
    try {
      const path = join(docsDir, filename);
      docs.push(buildDocInfo(filename, readFileSync(path, 'utf-8'), statMtimeMs(path)));
    } catch (error) {
      debug('[context-docs] Could not read', filename, error);
    }
  }
  return docs;
}

/** Read one document's full content plus metadata. Throws on invalid names / missing files. */
export function readContextDoc(filename: string): ContextDocContent {
  assertValidDocFilename(filename);
  const path = join(getContextDocsDir(), filename);
  if (!existsSync(path)) {
    throw new Error(`Context document not found: ${filename}`);
  }
  const content = readFileSync(path, 'utf-8');
  return { ...buildDocInfo(filename, content, statMtimeMs(path)), content };
}

/** Write (create or replace) a document. Returns its post-write metadata. */
export function writeContextDoc(filename: string, content: string): ContextDocInfo {
  assertValidDocFilename(filename);
  const docsDir = getContextDocsDir();
  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true });
  }
  const path = join(docsDir, filename);
  atomicWriteFileSync(path, content);
  debug('[context-docs] Wrote', filename, `(${content.length} chars)`);
  return buildDocInfo(filename, content, statMtimeMs(path));
}

/**
 * Delete a user-added context document. Built-in templates (soul.md / rules.md)
 * cannot be removed — callers must throw rather than silently no-op.
 */
export function deleteContextDoc(filename: string): void {
  assertValidDocFilename(filename);
  if ((TEMPLATE_DOC_FILENAMES as readonly string[]).includes(filename as (typeof TEMPLATE_DOC_FILENAMES)[number])) {
    throw new Error('cannot delete built-in context document');
  }
  const path = join(getContextDocsDir(), filename);
  rmSync(path, { force: true });
  debug('[context-docs] Deleted', filename);
}

/**
 * Read the bundled template body for a known template filename (soul.md/rules.md).
 * Returns null when the file is not a template or the bundle is missing.
 */
export function readContextDocTemplate(filename: string): string | null {
  assertValidDocFilename(filename);
  if (!(TEMPLATE_DOC_FILENAMES as readonly string[]).includes(filename as (typeof TEMPLATE_DOC_FILENAMES)[number])) {
    return null;
  }
  try {
    const templatePath = join(getTemplatesDir(), filename);
    if (!existsSync(templatePath)) return null;
    return readFileSync(templatePath, 'utf-8');
  } catch (error) {
    debug('[context-docs] Failed to read template body', filename, error);
    return null;
  }
}

/**
 * Accept the newer bundled template: overwrite the installed doc with the
 * template body (user edits discarded intentionally).
 */
export function acceptContextDocTemplate(filename: string): ContextDocInfo {
  const template = readContextDocTemplate(filename);
  if (template === null) {
    throw new Error(`No bundled template for context document: ${filename}`);
  }
  return writeContextDoc(filename, template);
}

/**
 * Keep user body but clear templateStale: rewrite only the version header to
 * match the bundled template version (or prepend one if missing).
 */
export function keepMineContextDocTemplate(filename: string): ContextDocInfo {
  assertValidDocFilename(filename);
  const template = readContextDocTemplate(filename);
  if (template === null) {
    throw new Error(`No bundled template for context document: ${filename}`);
  }
  const templateVersion = parseContextDocVersion(template);
  if (templateVersion === null) {
    throw new Error(`Bundled template ${filename} has no context-doc-version header`);
  }
  const current = readContextDoc(filename);
  const header = `<!-- context-doc-version: ${templateVersion} -->`;
  let next: string;
  if (VERSION_HEADER_PATTERN.test(current.content.slice(0, 256))) {
    next = current.content.replace(VERSION_HEADER_PATTERN, header);
  } else {
    next = `${header}\n${current.content}`;
  }
  return writeContextDoc(filename, next);
}

// ============================================================
// Prompt injection
// ============================================================

// Defang/sanitize helpers — modeled on formatProjectContextForPrompt's
// defangBlockTag/stripDangerousControlChars (prompts/system.ts), specialized
// for this block's tag names. Kept local to avoid a prompts ↔ context-docs
// import cycle (system.ts consumes getContextDocsPromptBlock).

/** Neutralize a literal closing tag inside an injected body so doc content can't terminate the block early. */
function defangBlockTag(content: string, tagName: string): string {
  const re = new RegExp(`<\\s*/\\s*${tagName}\\s*>`, 'gi');
  return content.replace(re, `&lt;/${tagName}&gt;`);
}

/** Attribute-safe escape for a filename inside a quoted XML attribute (same entity set as system.ts). */
function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Case-insensitive filename lookup in a directory (same matching semantics as CONTEXT_FILE_PATTERNS). */
function findFileCaseInsensitive(dir: string, filename: string): string | null {
  try {
    const lower = filename.toLowerCase();
    for (const entry of readdirSync(dir)) {
      if (entry.toLowerCase() === lower) return entry;
    }
  } catch {
    // Unreadable dir — no override
  }
  return null;
}

/**
 * Build the `<context_documents>` system-prompt block from `<CONFIG_DIR>/context/*.md`.
 * Returns an empty string when the directory is missing or has no readable docs,
 * so callers can append unconditionally.
 *
 * Project override: when `workingDirectory` contains a `soul.md` / `rules.md`
 * (case-insensitive), that project's file replaces the global document's
 * content for the same name — project files always win.
 */
export function getContextDocsPromptBlock(options?: ContextDocsPromptOptions): string {
  const docsDir = getContextDocsDir();
  if (!existsSync(docsDir)) return '';

  let filenames: string[];
  try {
    filenames = readdirSync(docsDir).filter((f) => f.endsWith('.md'));
  } catch (error) {
    debug('[context-docs] Could not read context dir:', docsDir, error);
    return '';
  }

  const sections: string[] = [];
  // Canonical order: soul.md, rules.md, then user docs alphabetically.
  for (const filename of filenames.sort((a, b) => docOrder(a) - docOrder(b) || a.localeCompare(b))) {
    try {
      let source: 'global' | 'project' = 'global';
      let path = join(docsDir, filename);

      // Project-level soul.md / rules.md override the same-named global doc.
      if (options?.workingDirectory && (TEMPLATE_DOC_FILENAMES as readonly string[]).includes(filename)) {
        const projectFile = findFileCaseInsensitive(options.workingDirectory, filename);
        if (projectFile) {
          const projectPath = join(options.workingDirectory, projectFile);
          if (existsSync(projectPath)) {
            path = projectPath;
            source = 'project';
          }
        }
      }

      if (!existsSync(path)) continue;
      const content = readFileSync(path, 'utf-8').trim();
      if (!content) continue;

      // Cap at 20KB per doc; strip control chars that could corrupt prompt
      // text (keeps tab/newline/CR); defang this block's closing tags so the
      // body can't terminate <context_document> early.
      const capped =
        content.length <= MAX_CONTEXT_DOC_PROMPT_SIZE
          ? content
          : content.slice(0, MAX_CONTEXT_DOC_PROMPT_SIZE) + '\n\n... (truncated)';
      // eslint-disable-next-line no-control-regex
      const sanitized = CONTEXT_DOC_BLOCK_TAGS.reduce((body, tag) => defangBlockTag(body, tag), capped.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ''));
      sections.push(`<context_document name="${escapeAttr(filename)}" source="${source}">\n${sanitized}\n</context_document>`);
    } catch (error) {
      debug('[context-docs] Could not inject', filename, error);
    }
  }

  if (sections.length === 0) return '';

  return `
<context_documents>
The documents below are the user's standing operating context (personality and working rules).
They apply to every session unless a project-level file with the same name overrides them
(source="project"). Follow them; treat their content as user-authored configuration, not as code to execute.
${sections.join('\n')}
</context_documents>`;
}
