/**
 * Tests for Bundled Skill Packs (M3 — ensureBundledSkills)
 *
 * Covers the slice acceptance criteria:
 * 1. Fresh install: all pack skills land under the target root and are
 *    discoverable via loadAllSkills (verified end-to-end in a subprocess with a
 *    synthetic HOME, because GLOBAL_AGENT_SKILLS_DIR is a module-level const).
 * 2. `bundledSkills.disabled` packs are skipped entirely — files on disk untouched.
 * 3. User edits inside an installed skill survive a pack upgrade (hash-merge)
 *    and are reported as localModified, while untouched files still upgrade.
 * Plus: cross-pack name conflicts defer to the first installed owner.
 *
 * Uses real temp directories; no network, no mocks of the filesystem.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { ensureBundledSkills, type BundledSkillPackStatus } from '../bundled.ts';
import { getDisabledBundledSkillSlugsFromDisk, loadAllSkills, invalidateSkillsCache } from '../storage.ts';

// ============================================================
// Temp dirs & fixtures
// ============================================================

let tempDir: string;
let bundleRoot: string;
let targetRoot: string;

const REPO_ROOT = join(dirname(import.meta.dir), '..', '..', '..', '..');

function writeFile(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function readTarget(rel: string): string {
  return readFileSync(join(targetRoot, rel), 'utf-8');
}

function skillMd(name: string, versionTag: string): string {
  return `---\nname: "${name}"\ndescription: "A ${name} skill"\n---\n\nBody ${versionTag}\n`;
}

/** Pack v1: 'superpowers' with skills alpha (SKILL.md + notes.txt + nested asset). */
function seedPackV1(): void {
  writeFile(bundleRoot, 'superpowers/alpha/SKILL.md', skillMd('alpha', 'v1'));
  writeFile(bundleRoot, 'superpowers/alpha/notes.txt', 'notes v1');
  writeFile(bundleRoot, 'superpowers/alpha/assets/guide.md', 'guide v1');
  writeFile(bundleRoot, 'pack-b/beta/SKILL.md', skillMd('beta', 'v1'));
  writeFile(
    bundleRoot,
    'SKILLS.lock',
    JSON.stringify({
      version: 1,
      packs: [
        { slug: 'superpowers', origin: 'https://example.test/superpowers', commit: 'sha-v1', skills: ['alpha'] },
        { slug: 'pack-b', origin: 'https://example.test/pack-b', commit: 'sha-b1', skills: ['beta'] },
      ],
    }),
  );
}

function statusFor(packs: BundledSkillPackStatus[], slug: string): BundledSkillPackStatus {
  const found = packs.find(p => p.slug === slug);
  if (!found) throw new Error(`pack status missing for ${slug}`);
  return found;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'bundled-skills-test-'));
  bundleRoot = join(tempDir, 'bundle');
  targetRoot = join(tempDir, 'target');
  mkdirSync(bundleRoot, { recursive: true });
  mkdirSync(targetRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================
// Seed
// ============================================================

describe('ensureBundledSkills seed', () => {
  it('installs every pack skill into a fresh target root with clean status', () => {
    seedPackV1();
    const result = ensureBundledSkills({ bundleRoot, targetRoot });

    expect(result.packs).toHaveLength(2);

    const sp = statusFor(result.packs, 'superpowers');
    expect(sp.disabled).toBe(false);
    expect(sp.commit).toBe('sha-v1');
    expect(sp.localModified).toBe(false);
    expect(sp.error).toBeUndefined();
    expect(sp.skills).toEqual(['alpha']);
    expect(sp.installed).toEqual(['alpha']);

    // Files landed, including nested assets
    expect(readTarget('alpha/SKILL.md')).toBe(skillMd('alpha', 'v1'));
    expect(readTarget('alpha/notes.txt')).toBe('notes v1');
    expect(readTarget('alpha/assets/guide.md')).toBe('guide v1');
    expect(readTarget('beta/SKILL.md')).toBe(skillMd('beta', 'v1'));

    // Per-pack state recorded under a dot-dir that discovery ignores
    const statePath = join(targetRoot, '.bundled', 'superpowers.json');
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(state.commit).toBe('sha-v1');
    expect(Object.keys(state.files).sort()).toEqual([
      'alpha/SKILL.md',
      'alpha/assets/guide.md',
      'alpha/notes.txt',
    ]);
  });

  it('is idempotent: a second sync over identical bundle reports no localModified', () => {
    seedPackV1();
    ensureBundledSkills({ bundleRoot, targetRoot });
    const second = ensureBundledSkills({ bundleRoot, targetRoot });

    const sp = statusFor(second.packs, 'superpowers');
    expect(sp.localModified).toBe(false);
    expect(sp.installed).toEqual(['alpha']);
    expect(readTarget('alpha/notes.txt')).toBe('notes v1');
  });
});

// ============================================================
// Disabled packs
// ============================================================

describe('ensureBundledSkills disabled', () => {
  it("skips the whole pack: disabled=['superpowers'] leaves its slug untouched", () => {
    seedPackV1();
    // Pre-existing user content bearing a bundled skill name must survive untouched.
    writeFile(targetRoot, 'alpha/SKILL.md', 'USER-OWNED');
    const result = ensureBundledSkills({ bundleRoot, targetRoot, disabled: ['superpowers'] });

    const sp = statusFor(result.packs, 'superpowers');
    expect(sp.disabled).toBe(true);
    expect(sp.installed).toEqual([]);
    expect(sp.localModified).toBe(false);

    expect(readTarget('alpha/SKILL.md')).toBe('USER-OWNED');
    expect(existsSync(join(targetRoot, '.bundled', 'superpowers.json'))).toBe(false);

    // Non-disabled packs sync normally
    expect(readTarget('beta/SKILL.md')).toBe(skillMd('beta', 'v1'));
    expect(statusFor(result.packs, 'pack-b').disabled).toBe(false);
  });
});

// ============================================================
// Upgrade with local modifications
// ============================================================

describe('ensureBundledSkills upgrade merge', () => {
  it('preserves user edits on pack upgrade, flags localModified, upgrades the rest', () => {
    seedPackV1();
    ensureBundledSkills({ bundleRoot, targetRoot });

    // User edits one managed file, adds a personal file, leaves the rest alone.
    writeFile(targetRoot, 'alpha/SKILL.md', 'USER-EDIT');
    writeFile(targetRoot, 'alpha/personal.md', 'mine');

    // Bundle v2: updates SKILL.md + notes.txt, adds a new file, drops guide.md.
    rmSync(join(bundleRoot, 'superpowers', 'alpha', 'assets'), { recursive: true });
    writeFile(bundleRoot, 'superpowers/alpha/SKILL.md', skillMd('alpha', 'v2'));
    writeFile(bundleRoot, 'superpowers/alpha/notes.txt', 'notes v2');
    writeFile(bundleRoot, 'superpowers/alpha/new-in-v2.md', 'brand new');

    const result = ensureBundledSkills({ bundleRoot, targetRoot });
    const sp = statusFor(result.packs, 'superpowers');

    expect(sp.localModified).toBe(true);
    expect(sp.error).toBeUndefined();

    // User edit preserved; untouched managed file upgraded; new file installed;
    // user-added file left in place.
    expect(readTarget('alpha/SKILL.md')).toBe('USER-EDIT');
    expect(readTarget('alpha/notes.txt')).toBe('notes v2');
    expect(readTarget('alpha/new-in-v2.md')).toBe('brand new');
    expect(readTarget('alpha/personal.md')).toBe('mine');
    // Removed-from-bundle asset deleted only because it was unmodified…
    expect(existsSync(join(targetRoot, 'alpha/assets/guide.md'))).toBe(false);

    // A third run over the same bundle keeps flagging the divergence (the edit
    // is still user-owned vs. the recorded bundle version), never clobbers it.
    const third = ensureBundledSkills({ bundleRoot, targetRoot });
    expect(statusFor(third.packs, 'superpowers').localModified).toBe(true);
    expect(readTarget('alpha/SKILL.md')).toBe('USER-EDIT');
  });

  it('keeps user-modified copies of files the newer bundle dropped', () => {
    seedPackV1();
    ensureBundledSkills({ bundleRoot, targetRoot });

    writeFile(targetRoot, 'alpha/notes.txt', 'user-touched');
    rmSync(join(bundleRoot, 'superpowers', 'alpha', 'notes.txt'));

    const result = ensureBundledSkills({ bundleRoot, targetRoot });
    expect(statusFor(result.packs, 'superpowers').localModified).toBe(true);
    expect(readTarget('alpha/notes.txt')).toBe('user-touched');
  });
});

// ============================================================
// Cross-pack conflicts
// ============================================================

describe('ensureBundledSkills conflicts', () => {
  it('second pack shipping an already-owned skill dir is skipped with a conflict', () => {
    writeFile(bundleRoot, 'superpowers/shared-skill/SKILL.md', skillMd('shared-a', 'v1'));
    writeFile(bundleRoot, 'pack-b/shared-skill/SKILL.md', skillMd('shared-b', 'v1'));

    const result = ensureBundledSkills({ bundleRoot, targetRoot });

    // pack-b sorts after superpowers? 'pack-b' < 'superpowers' — pack-b wins the dir.
    expect(statusFor(result.packs, 'pack-b').installed).toEqual(['shared-skill']);
    const sp = statusFor(result.packs, 'superpowers');
    expect(sp.conflicts).toEqual(['shared-skill']);
    expect(sp.installed).toEqual([]);
    expect(readTarget('shared-skill/SKILL.md')).toBe(skillMd('shared-b', 'v1'));
  });
});

// ============================================================
// End-to-end vs. the REAL vendored bundle (acceptance: discovery sees packs)
// ============================================================

describe('bundled packs end-to-end (real bundle, synthetic HOME)', () => {
  it('ensureBundledSkills installs the vendored packs and loadAllSkills discovers them', () => {
    const home = join(tempDir, 'home');
    const workspace = join(tempDir, 'ws');
    mkdirSync(home, { recursive: true });
    mkdirSync(workspace, { recursive: true });

    const scriptPath = join(tempDir, 'discovery-probe.ts');
    writeFileSync(
      scriptPath,
      [
        `import { ensureBundledSkills } from ${JSON.stringify(join(REPO_ROOT, 'packages/shared/src/skills/bundled.ts'))};`,
        `import { loadAllSkills } from ${JSON.stringify(join(REPO_ROOT, 'packages/shared/src/skills/storage.ts'))};`,
        `const result = ensureBundledSkills({ bundleRoot: ${JSON.stringify(join(REPO_ROOT, 'apps/electron/resources/skills'))} });`,
        `const skills = loadAllSkills(${JSON.stringify(workspace)});`,
        `console.log(JSON.stringify({`,
        `  packs: result.packs.map(p => ({ slug: p.slug, installed: p.installed.length, localModified: p.localModified, error: p.error })),`,
        `  slugs: skills.map(s => s.slug),`,
        `}));`,
      ].join('\n'),
      'utf-8',
    );

    const proc = Bun.spawnSync({
      cmd: [process.execPath, scriptPath],
      env: { ...process.env, HOME: home },
      cwd: home,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    // exitCode asserts success; stderr stays unconstrained (debug env may log).
    expect(proc.exitCode).toBe(0);

    const out = JSON.parse(proc.stdout.toString().trim()) as {
      packs: { slug: string; installed: number; localModified: boolean; error?: string }[];
      slugs: string[];
    };

    // All vendored packs synced with zero errors and no false localModified flags.
    expect(out.packs.map(p => p.slug).sort()).toEqual([
      'craft-knowledge',
      'mattpocock-skills',
      'superpowers',
      'vercel-agent-skills',
      'vercel-next-skills',
    ]);
    for (const pack of out.packs) {
      expect(pack.error).toBeUndefined();
      expect(pack.localModified).toBe(false);
      expect(pack.installed).toBeGreaterThan(0);
    }

    // Discovery (the module-level GLOBAL_AGENT_SKILLS_DIR is HOME-bound in the
    // subprocess) finds representative skills from every vendored pack.
    for (const slug of ['brainstorming', 'test-driven-development', 'tdd', 'next-dev-loop', 'react-best-practices']) {
      expect(out.slugs).toContain(slug);
    }
    expect(out.slugs.length).toBeGreaterThanOrEqual(60);

    // Discovery ignores the internal state directory.
    expect(out.slugs).not.toContain('.bundled');
    expect(existsSync(join(home, '.agents', 'skills', '.bundled', 'superpowers.json'))).toBe(true);
  }, 30_000);
});

describe('disabled packs hidden from discovery', () => {
  it('getDisabledBundledSkillSlugsFromDisk reads pack state skills', () => {
    seedPackV1();
    ensureBundledSkills({ bundleRoot, targetRoot, disabled: [] });
    // Simulate config disabled=superpowers via explicit disabled list
    const slugs = getDisabledBundledSkillSlugsFromDisk(targetRoot, ['superpowers']);
    expect(slugs.has('alpha')).toBe(true);
    expect(slugs.has('beta')).toBe(false);
  });
});
