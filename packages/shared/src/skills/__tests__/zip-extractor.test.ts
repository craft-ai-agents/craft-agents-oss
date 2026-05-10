import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { zipSync, strToU8 } from 'fflate'
import { extractSkillsFromZip } from '../zip-extractor.ts'

// ── helpers ──────────────────────────────────────────────────────────────────

function skillMd(name: string, description: string, body = ''): Uint8Array {
  return strToU8(`---\nname: ${name}\ndescription: ${description}\n---\n${body}`)
}

function writeZip(dir: string, name: string, files: Record<string, Uint8Array>): string {
  const path = join(dir, name)
  writeFileSync(path, zipSync(files))
  return path
}

// ── test setup ────────────────────────────────────────────────────────────────

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'zip-extractor-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ── tests ─────────────────────────────────────────────────────────────────────

describe('extractSkillsFromZip', () => {
  it('returns one DiscoveredSkill when SKILL.md is at the zip root', () => {
    const zipPath = writeZip(tmpDir, 'my-skill.zip', {
      'SKILL.md': skillMd('My Skill', 'Does something useful', 'Body text'),
    })

    const skills = extractSkillsFromZip(zipPath)

    expect(skills).toHaveLength(1)
    expect(skills[0]!.slug).toBe('my-skill')
    expect(skills[0]!.metadata.name).toBe('My Skill')
    expect(skills[0]!.metadata.description).toBe('Does something useful')
    expect(skills[0]!.sourcePath).toBe(zipPath)
  })

  it('derives slug from zip filename (kebab-cased, extension stripped)', () => {
    const zipPath = writeZip(tmpDir, 'Code Reviewer Tool.zip', {
      'SKILL.md': skillMd('Code Reviewer', 'Reviews code'),
    })

    const skills = extractSkillsFromZip(zipPath)
    expect(skills[0]!.slug).toBe('code-reviewer-tool')
  })

  it('returns one DiscoveredSkill per subdirectory at depth 1', () => {
    const zipPath = writeZip(tmpDir, 'multi.zip', {
      'skill-alpha/SKILL.md': skillMd('Alpha', 'First skill'),
      'skill-beta/SKILL.md': skillMd('Beta', 'Second skill'),
    })

    const skills = extractSkillsFromZip(zipPath)
    expect(skills).toHaveLength(2)
    const slugs = skills.map(s => s.slug).sort()
    expect(slugs).toEqual(['skill-alpha', 'skill-beta'])
  })

  it('returns DiscoveredSkills for subdirectories at depth 2', () => {
    const zipPath = writeZip(tmpDir, 'nested.zip', {
      'skills/web-design/SKILL.md': skillMd('Web Design', 'CSS expert'),
      'skills/code-review/SKILL.md': skillMd('Code Review', 'Review PRs'),
    })

    const skills = extractSkillsFromZip(zipPath)
    expect(skills).toHaveLength(2)
    const slugs = skills.map(s => s.slug).sort()
    expect(slugs).toEqual(['code-review', 'web-design'])
  })

  it('returns empty array when no SKILL.md is present anywhere', () => {
    const zipPath = writeZip(tmpDir, 'empty.zip', {
      'README.md': strToU8('# Nothing here'),
      'some-dir/notes.txt': strToU8('no skills'),
    })

    const skills = extractSkillsFromZip(zipPath)
    expect(skills).toHaveLength(0)
  })

  it('ignores SKILL.md at depth > 2', () => {
    const zipPath = writeZip(tmpDir, 'deep.zip', {
      'a/b/c/SKILL.md': skillMd('Too Deep', 'Should not be found'),
    })

    const skills = extractSkillsFromZip(zipPath)
    expect(skills).toHaveLength(0)
  })

  it('prefers root SKILL.md over subdirectory ones', () => {
    const zipPath = writeZip(tmpDir, 'mixed.zip', {
      'SKILL.md': skillMd('Root Skill', 'At the root'),
      'sub/SKILL.md': skillMd('Sub Skill', 'In a subdir'),
    })

    const skills = extractSkillsFromZip(zipPath)
    expect(skills).toHaveLength(1)
    expect(skills[0]!.metadata.name).toBe('Root Skill')
  })

  it('skips __MACOSX entries', () => {
    const zipPath = writeZip(tmpDir, 'macos.zip', {
      '__MACOSX/._SKILL.md': strToU8('garbage'),
      'my-skill/SKILL.md': skillMd('Real Skill', 'Legit'),
    })

    const skills = extractSkillsFromZip(zipPath)
    expect(skills).toHaveLength(1)
    expect(skills[0]!.metadata.name).toBe('Real Skill')
  })

  it('returns empty array when SKILL.md has no name or description', () => {
    const zipPath = writeZip(tmpDir, 'invalid.zip', {
      'SKILL.md': strToU8('# Just a header, no frontmatter'),
    })

    const skills = extractSkillsFromZip(zipPath)
    expect(skills).toHaveLength(0)
  })

  it('includes content body in DiscoveredSkill', () => {
    const body = 'When reviewing code, always check for edge cases.'
    const zipPath = writeZip(tmpDir, 'with-body.zip', {
      'SKILL.md': skillMd('Reviewer', 'Reviews code', body),
    })

    const skills = extractSkillsFromZip(zipPath)
    expect(skills[0]!.content.trim()).toBe(body)
  })
})
