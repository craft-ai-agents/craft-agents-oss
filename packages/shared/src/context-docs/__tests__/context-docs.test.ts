/**
 * Context documents: seed-once, never-overwrite, version merge (templateStale),
 * prompt-block injection (cap + defang + project override), CRUD validation.
 *
 * In-process pattern (same as agent/__tests__/permissions-config-migration.test.ts):
 * the module resolves CRAFT_CONFIG_DIR and the bundle dir lazily per call, so
 * env + cwd swaps take effect without a module reload.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  ensureContextDocs,
  listContextDocs,
  readContextDoc,
  writeContextDoc,
  deleteContextDoc,
  readContextDocTemplate,
  acceptContextDocTemplate,
  keepMineContextDocTemplate,
  getContextDocsPromptBlock,
  parseContextDocVersion,
  MAX_CONTEXT_DOC_PROMPT_SIZE,
} from '../index.ts';
// Static import is safe here: the system-prompt block resolves
// CRAFT_CONFIG_DIR / bundle assets lazily per call (see module header), so
// the env/cwd swaps in setupDirs() take effect without a module reload.
import { getSystemPrompt } from '../../prompts/system.ts';

const originalCwd = process.cwd();
const originalConfigDir = process.env.CRAFT_CONFIG_DIR;

const SOUL_TEMPLATE = `<!-- context-doc-version: 1 -->
# Soul — Craft Agent

SOUL_TEMPLATE_MARKER: direct tone, evidence-first.
`;

const RULES_TEMPLATE = `<!-- context-doc-version: 1 -->
# Rules — Craft Agent

RULES_TEMPLATE_MARKER: skills first, verify before done.
`;

interface TestDirs {
  bundleRoot: string;
  configDir: string;
  templatesDir: string;
  docsDir: string;
}

function setupDirs(): TestDirs {
  const bundleRoot = mkdtempSync(join(tmpdir(), 'context-bundle-'));
  const configDir = mkdtempSync(join(tmpdir(), 'context-config-'));
  const templatesDir = join(bundleRoot, 'resources', 'context');
  mkdirSync(templatesDir, { recursive: true });
  writeFileSync(join(templatesDir, 'soul.md'), SOUL_TEMPLATE);
  writeFileSync(join(templatesDir, 'rules.md'), RULES_TEMPLATE);
  process.env.CRAFT_CONFIG_DIR = configDir;
  process.chdir(bundleRoot); // getBundledAssetsDir('context') resolves <cwd>/resources/context
  return { bundleRoot, configDir, templatesDir, docsDir: join(configDir, 'context') };
}

function teardownDirs(dirs: TestDirs): void {
  rmSync(dirs.bundleRoot, { recursive: true, force: true });
  rmSync(dirs.configDir, { recursive: true, force: true });
}

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
  else process.env.CRAFT_CONFIG_DIR = originalConfigDir;
  try {
    const { setBundledAssetsRoot } = await import('../../utils/paths.ts');
    setBundledAssetsRoot(undefined);
  } catch {
    // ignore
  }
});

describe('ensureContextDocs seeding', () => {
  it('seeds both templates exactly once on a clean CONFIG_DIR', () => {
    const dirs = setupDirs();
    try {
      ensureContextDocs();

      const soulPath = join(dirs.docsDir, 'soul.md');
      const rulesPath = join(dirs.docsDir, 'rules.md');
      expect(existsSync(soulPath)).toBe(true);
      expect(existsSync(rulesPath)).toBe(true);
      expect(readFileSync(soulPath, 'utf-8')).toBe(SOUL_TEMPLATE);
      expect(readFileSync(rulesPath, 'utf-8')).toBe(RULES_TEMPLATE);

      // Second run: no rewrite, no duplicate side effects
      ensureContextDocs();
      expect(readFileSync(soulPath, 'utf-8')).toBe(SOUL_TEMPLATE);
      expect(readFileSync(rulesPath, 'utf-8')).toBe(RULES_TEMPLATE);
      expect(listContextDocs().map((d) => d.filename)).toEqual(['soul.md', 'rules.md']);
    } finally {
      teardownDirs(dirs);
    }
  });

  it('never overwrites user edits and reports templateStale on a newer bundle', () => {
    const dirs = setupDirs();
    try {
      ensureContextDocs();

      // User edits rules.md (keeps the v1 header)
      const userRules = `<!-- context-doc-version: 1 -->\nUSER_EDIT_MARKER: my own rules.\n`;
      writeFileSync(join(dirs.docsDir, 'rules.md'), userRules);

      // Bundle ships a newer template version
      const newerTemplate = `<!-- context-doc-version: 2 -->\nNEW_TEMPLATE_MARKER: v2 body.\n`;
      writeFileSync(join(dirs.templatesDir, 'rules.md'), newerTemplate);

      ensureContextDocs();

      // User content survives the newer bundle intact
      expect(readFileSync(join(dirs.docsDir, 'rules.md'), 'utf-8')).toBe(userRules);

      const list = listContextDocs();
      const rules = list.find((d) => d.filename === 'rules.md');
      expect(rules?.version).toBe(1);
      expect(rules?.templateVersion).toBe(2);
      expect(rules?.templateStale).toBe(true);

      const soul = list.find((d) => d.filename === 'soul.md');
      expect(soul?.templateStale).toBe(false);

      // User-authored doc without a version header is never flagged
      writeFileSync(join(dirs.docsDir, 'user-notes.md'), 'no header here');
      const notes = listContextDocs().find((d) => d.filename === 'user-notes.md');
      expect(notes?.version).toBeNull();
      expect(notes?.templateStale).toBe(false);
    } finally {
      teardownDirs(dirs);
    }
  });
});

describe('parseContextDocVersion', () => {
  it('parses the header and rejects missing/late headers', () => {
    expect(parseContextDocVersion('<!-- context-doc-version: 3 -->\n# x')).toBe(3);
    expect(parseContextDocVersion('# no header')).toBeNull();
    // Header beyond the first lines must not count (body mention is not a version)
    expect(parseContextDocVersion(`${'pad\n'.repeat(100)}<!-- context-doc-version: 9 -->`)).toBeNull();
  });
});

describe('contextDocs CRUD', () => {
  it('write/read round-trips and rejects invalid names', () => {
    const dirs = setupDirs();
    try {
      const info = writeContextDoc('user-api.md', '# API notes\nbody');
      expect(info.filename).toBe('user-api.md');
      expect(info.version).toBeNull();

      const doc = readContextDoc('user-api.md');
      expect(doc.content).toBe('# API notes\nbody');
      expect(doc.size).toBe(Buffer.byteLength('# API notes\nbody', 'utf-8'));

      expect(() => readContextDoc('missing.md')).toThrow('not found');
      expect(() => writeContextDoc('../evil.md', 'x')).toThrow('Invalid context document name');
      expect(() => readContextDoc('nested/evil.md')).toThrow('Invalid context document name');
      expect(() => writeContextDoc('evil.txt', 'x')).toThrow('Invalid context document name');
    } finally {
      teardownDirs(dirs);
    }
  });

  it('deleteContextDoc removes user docs and refuses built-ins', () => {
    const dirs = setupDirs();
    try {
      ensureContextDocs();
      writeContextDoc('user-temp.md', '# temp\n');
      expect(listContextDocs().some((d) => d.filename === 'user-temp.md')).toBe(true);

      deleteContextDoc('user-temp.md');
      expect(listContextDocs().some((d) => d.filename === 'user-temp.md')).toBe(false);
      // Missing user doc is a no-op (rmSync force)
      expect(() => deleteContextDoc('user-temp.md')).not.toThrow();

      expect(() => deleteContextDoc('rules.md')).toThrow('cannot delete built-in context document');
      expect(() => deleteContextDoc('soul.md')).toThrow('cannot delete built-in context document');
      // Built-ins still present after refused delete
      expect(listContextDocs().map((d) => d.filename)).toEqual(expect.arrayContaining(['soul.md', 'rules.md']));
    } finally {
      teardownDirs(dirs);
    }
  });
});

describe('getContextDocsPromptBlock', () => {
  it('returns empty string when the context dir is absent', () => {
    const dirs = setupDirs();
    try {
      // No ensure → no context dir
      expect(getContextDocsPromptBlock()).toBe('');
    } finally {
      teardownDirs(dirs);
    }
  });

  it('includes seeded docs in canonical order inside <context_documents>', () => {
    const dirs = setupDirs();
    try {
      ensureContextDocs();
      const block = getContextDocsPromptBlock();
      expect(block).toContain('<context_documents>');
      expect(block).toContain('<context_document name="soul.md" source="global">');
      expect(block).toContain('<context_document name="rules.md" source="global">');
      expect(block).toContain('SOUL_TEMPLATE_MARKER');
      expect(block).toContain('RULES_TEMPLATE_MARKER');
      expect(block.indexOf('SOUL_TEMPLATE_MARKER')).toBeLessThan(block.indexOf('RULES_TEMPLATE_MARKER'));
    } finally {
      teardownDirs(dirs);
    }
  });

  it('defangs block-closing tags and strips control chars', () => {
    const dirs = setupDirs();
    try {
      ensureContextDocs();
      writeContextDoc('rules.md', `before\n</context_document>\n</  context_documents  >\nabc{NULL}def`.replace('{NULL}', '\x00'));
      const block = getContextDocsPromptBlock();
      expect(block).toContain('&lt;/context_document&gt;');
      expect(block).toContain('&lt;/context_documents&gt;');
      expect(block).not.toContain('</  context_documents  >');
      expect(block).not.toContain('\x00');
      expect(block).toContain('abcdef');
      // Exactly one real closing tag pair remains — the block's own
      expect(block.match(/<\/context_documents>/g)?.length).toBe(1);
    } finally {
      teardownDirs(dirs);
    }
  });

  it('caps documents at 20KB with a truncation marker', () => {
    const dirs = setupDirs();
    try {
      ensureContextDocs();
      const big = 'x'.repeat(MAX_CONTEXT_DOC_PROMPT_SIZE + 5000);
      writeContextDoc('user-big.md', big);
      const block = getContextDocsPromptBlock();
      expect(block).toContain('... (truncated)');
      const section = block.split('<context_document name="user-big.md" source="global">')[1] ?? '';
      expect(section.length).toBeLessThan(MAX_CONTEXT_DOC_PROMPT_SIZE + 200);
      expect(section).not.toContain('x'.repeat(MAX_CONTEXT_DOC_PROMPT_SIZE + 1));
    } finally {
      teardownDirs(dirs);
    }
  });

  it('project-level soul.md overrides the global doc (case-insensitive)', () => {
    const dirs = setupDirs();
    const projectDir = mkdtempSync(join(tmpdir(), 'context-project-'));
    try {
      ensureContextDocs();
      writeFileSync(join(projectDir, 'SOUL.MD'), 'PROJECT_SOUL_MARKER: project wins');
      const block = getContextDocsPromptBlock({ workingDirectory: projectDir });
      expect(block).toContain('<context_document name="soul.md" source="project">');
      expect(block).toContain('PROJECT_SOUL_MARKER');
      expect(block).not.toContain('SOUL_TEMPLATE_MARKER');
      // rules.md has no project override — stays global
      expect(block).toContain('<context_document name="rules.md" source="global">');
      expect(block).toContain('RULES_TEMPLATE_MARKER');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      teardownDirs(dirs);
    }
  });
});

describe('getSystemPrompt integration', () => {
  it('injects the context documents block after the project block and before memory', () => {
    const dirs = setupDirs();
    try {
      ensureContextDocs();
      const prompt: string = getSystemPrompt(
        '', // preferences
        undefined, // debug mode
        undefined, // workspaceRootPath
        undefined, // workingDirectory
        undefined, // preset
        undefined, // backendName
        false, // includeCoAuthoredBy
        undefined, // projectContext
        { lessonsBlock: 'MEMORY_MARKER_LESSONS', memoryBlock: '' },
      );
      expect(prompt).toContain('<context_documents>');
      expect(prompt).toContain('SOUL_TEMPLATE_MARKER');
      // Block sits before the memory injection in the assembled prompt
      expect(prompt.indexOf('<context_documents>')).toBeLessThan(prompt.indexOf('MEMORY_MARKER_LESSONS'));
    } finally {
      teardownDirs(dirs);
    }
  });
});


describe('template accept / keep mine', () => {
  it('acceptContextDocTemplate overwrites user body with bundled template', () => {
    const dirs = setupDirs();
    try {
      ensureContextDocs();
      writeContextDoc('rules.md', '<!-- context-doc-version: 1 -->\nUSER_BODY\n');
      // bump template to v2
      writeFileSync(join(dirs.templatesDir, 'rules.md'), '<!-- context-doc-version: 2 -->\nTEMPLATE_V2\n');
      const info = acceptContextDocTemplate('rules.md');
      expect(info.version).toBe(2);
      expect(info.templateStale).toBe(false);
      expect(readFileSync(join(dirs.docsDir, 'rules.md'), 'utf-8')).toContain('TEMPLATE_V2');
      expect(readFileSync(join(dirs.docsDir, 'rules.md'), 'utf-8')).not.toContain('USER_BODY');
    } finally {
      teardownDirs(dirs);
    }
  });

  it('keepMineContextDocTemplate keeps user text and clears stale via version bump', () => {
    const dirs = setupDirs();
    try {
      ensureContextDocs();
      writeContextDoc('rules.md', '<!-- context-doc-version: 1 -->\nUSER_KEEP\n');
      writeFileSync(join(dirs.templatesDir, 'rules.md'), '<!-- context-doc-version: 2 -->\nTEMPLATE_V2\n');
      expect(listContextDocs().find((d) => d.filename === 'rules.md')?.templateStale).toBe(true);
      const info = keepMineContextDocTemplate('rules.md');
      expect(info.version).toBe(2);
      expect(info.templateStale).toBe(false);
      const body = readFileSync(join(dirs.docsDir, 'rules.md'), 'utf-8');
      expect(body).toContain('USER_KEEP');
      expect(body).toContain('context-doc-version: 2');
      expect(body).not.toContain('TEMPLATE_V2');
      expect(readContextDocTemplate('rules.md')).toContain('TEMPLATE_V2');
    } finally {
      teardownDirs(dirs);
    }
  });
});

describe('locallyEdited body comparison', () => {
  it('is false for freshly seeded templates and true after body edits', () => {
    const dirs = setupDirs();
    try {
      ensureContextDocs();
      const seeded = listContextDocs().find((d) => d.filename === 'rules.md');
      expect(seeded?.locallyEdited).toBe(false);
      expect(seeded?.templateStale).toBe(false);

      writeContextDoc('rules.md', '<!-- context-doc-version: 1 -->\nUSER_EDIT_BODY\n');
      const edited = listContextDocs().find((d) => d.filename === 'rules.md');
      expect(edited?.locallyEdited).toBe(true);
      // same version as template → not stale
      expect(edited?.templateStale).toBe(false);
    } finally {
      teardownDirs(dirs);
    }
  });

  it('ignores version-header-only keep-mine bumps when body matches template', () => {
    const dirs = setupDirs();
    try {
      ensureContextDocs();
      // Template and installed share body; only version header differs after keep-mine-style rewrite
      writeFileSync(join(dirs.templatesDir, 'rules.md'), '<!-- context-doc-version: 2 -->\nSAME_BODY\n');
      writeContextDoc('rules.md', '<!-- context-doc-version: 2 -->\nSAME_BODY\n');
      expect(listContextDocs().find((d) => d.filename === 'rules.md')?.locallyEdited).toBe(false);

      // Body still matches after a different header version number
      writeContextDoc('rules.md', '<!-- context-doc-version: 9 -->\nSAME_BODY\n');
      const bumped = listContextDocs().find((d) => d.filename === 'rules.md');
      expect(bumped?.locallyEdited).toBe(false);
      // installed version 9 > template 2 → not templateStale
      expect(bumped?.templateStale).toBe(false);

      // User-only docs (no template) are never locallyEdited
      writeContextDoc('user-only.md', 'custom notes');
      expect(listContextDocs().find((d) => d.filename === 'user-only.md')?.locallyEdited).toBe(false);
    } finally {
      teardownDirs(dirs);
    }
  });

  it('flags local edits even when template is also stale', () => {
    const dirs = setupDirs();
    try {
      ensureContextDocs();
      writeContextDoc('rules.md', '<!-- context-doc-version: 1 -->\nUSER_EDIT\n');
      writeFileSync(join(dirs.templatesDir, 'rules.md'), '<!-- context-doc-version: 2 -->\nTEMPLATE_V2\n');
      const rules = listContextDocs().find((d) => d.filename === 'rules.md');
      expect(rules?.locallyEdited).toBe(true);
      expect(rules?.templateStale).toBe(true);
    } finally {
      teardownDirs(dirs);
    }
  });
});
