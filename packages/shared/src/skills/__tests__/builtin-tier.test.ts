/**
 * Built-in skill tier (ADR 0001 §7).
 *
 * loadAllSkills() scans ~/.agents/skills, {workspace}/skills and
 * {project}/.agents/skills — none of which is a place the app may write, so a
 * skill that must ship WITH the app and update WITH it has nowhere to live.
 *
 * Copying it into ~/.agents/skills instead would force a choice between
 * clobbering the user's edits on every update and going permanently stale. A
 * fourth tier read from the bundled resources, loaded FIRST so all three
 * existing tiers override it, avoids both.
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadAllSkills } from '../storage.ts'
import { setBundledAssetsRoot } from '../../utils/paths.ts'

let root: string
let workspace: string

function writeSkill(dir: string, slug: string, name: string, body = 'Body') {
  mkdirSync(join(dir, slug), { recursive: true })
  writeFileSync(
    join(dir, slug, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} description\n---\n\n${body}\n`,
    'utf-8',
  )
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'craft-builtin-skills-'))
  workspace = join(root, 'ws')
  mkdirSync(join(workspace, 'skills'), { recursive: true })
  // getBundledAssetsDir looks for <assetsRoot>/resources/<subfolder>
  mkdirSync(join(root, 'bundle', 'resources', 'skills'), { recursive: true })
  setBundledAssetsRoot(join(root, 'bundle'))
})

afterEach(() => {
  setBundledAssetsRoot(undefined as unknown as string)
  rmSync(root, { recursive: true, force: true })
})

describe('built-in skills tier', () => {
  it('discovers a skill shipped in bundled resources', () => {
    writeSkill(join(root, 'bundle', 'resources', 'skills'), 'craft-pages', 'Craft Pages')
    const skills = loadAllSkills(workspace)
    const found = skills.find(s => s.slug === 'craft-pages')
    expect(found).toBeDefined()
    expect(found!.metadata.name).toBe('Craft Pages')
  })

  it('marks it with a distinct source so the UI can tell it apart', () => {
    writeSkill(join(root, 'bundle', 'resources', 'skills'), 'craft-pages', 'Craft Pages')
    const found = loadAllSkills(workspace).find(s => s.slug === 'craft-pages')
    expect(found!.source).toBe('builtin')
  })

  it('is overridden by a workspace skill of the same slug', () => {
    // The whole point of "lowest priority": a user who wants to customise the
    // shipped skill can, and their copy wins.
    writeSkill(join(root, 'bundle', 'resources', 'skills'), 'craft-pages', 'Shipped')
    writeSkill(join(workspace, 'skills'), 'craft-pages', 'User Override')
    const found = loadAllSkills(workspace).find(s => s.slug === 'craft-pages')
    expect(found!.metadata.name).toBe('User Override')
    expect(found!.source).toBe('workspace')
  })

  it('is overridden by a project skill of the same slug', () => {
    const project = join(root, 'proj')
    mkdirSync(join(project, '.agents', 'skills'), { recursive: true })
    writeSkill(join(root, 'bundle', 'resources', 'skills'), 'craft-pages', 'Shipped')
    writeSkill(join(project, '.agents', 'skills'), 'craft-pages', 'Project Override')
    const found = loadAllSkills(workspace, project).find(s => s.slug === 'craft-pages')
    expect(found!.metadata.name).toBe('Project Override')
  })

  it('does not disturb skills from the other tiers', () => {
    writeSkill(join(root, 'bundle', 'resources', 'skills'), 'craft-pages', 'Shipped')
    writeSkill(join(workspace, 'skills'), 'other', 'Other')
    const slugs = loadAllSkills(workspace).map(s => s.slug)
    expect(slugs).toContain('craft-pages')
    expect(slugs).toContain('other')
  })

  it('is a no-op when no bundled skills directory exists', () => {
    rmSync(join(root, 'bundle', 'resources', 'skills'), { recursive: true, force: true })
    expect(() => loadAllSkills(workspace)).not.toThrow()
  })
})
