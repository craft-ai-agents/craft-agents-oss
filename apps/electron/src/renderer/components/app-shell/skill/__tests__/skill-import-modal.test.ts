import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getRemoteResolvePhase } from '../remote-skill-import-state'
import type { DiscoveredSkill } from '../../../../../shared/types'

const appShellSource = readFileSync(
  join(import.meta.dir, '../../AppShell.tsx'),
  'utf8',
)

const skillsListPanelSource = readFileSync(
  join(import.meta.dir, '../SkillsListPanel.tsx'),
  'utf8',
)

const skillImportModalSource = readFileSync(
  join(import.meta.dir, '../SkillImportModal.tsx'),
  'utf8',
)

const discoveredSkill: DiscoveredSkill = {
  slug: 'code-reviewer',
  metadata: {
    name: 'Code Reviewer',
    description: 'Reviews code changes',
  },
  content: 'Review code.',
  sourcePath: 'https://github.com/example/skills/tree/HEAD/code-reviewer',
}

describe('Skill Import Modal shell', () => {
  test('AppShell renders SkillImportModal for add-skill actions', () => {
    expect(appShellSource).toContain('SkillImportModal')
    expect(appShellSource).toContain('const [skillImportOpen, setSkillImportOpen] = useState(false)')
    expect(appShellSource).toContain('setSkillImportOpen(true)')
  })

  test('SkillsListPanel empty state delegates to onAddSkill instead of EditPopover', () => {
    expect(skillsListPanelSource).toContain('onAddSkill')
    expect(skillsListPanelSource).not.toContain('EditPopover')
    expect(skillsListPanelSource).not.toContain("getEditConfig('add-skill'")
  })

  test('modal exposes Create, AI Assist, Remote, and Upload tabs', () => {
    expect(skillImportModalSource).toContain('value="create"')
    expect(skillImportModalSource).toContain('value="ai"')
    expect(skillImportModalSource).toContain('value="remote"')
    expect(skillImportModalSource).toContain('value="upload"')
  })

  test('Create tab uses createSkill and overwrite confirmation uses forceWriteSkill', () => {
    expect(skillImportModalSource).toContain('window.electronAPI.createSkill')
    expect(skillImportModalSource).toContain('setPendingOverwrite(nextSkill)')
    expect(skillImportModalSource).toContain('window.electronAPI.forceWriteSkill')
  })

  test('slug derivation import stays browser-safe for renderer startup', () => {
    expect(skillImportModalSource).toContain("@craft-agent/shared/skills/slug")
    expect(skillImportModalSource).not.toContain("from '@craft-agent/shared/skills'")
  })

  test('AI Assist tab keeps the existing add-skill EditPopover configuration', () => {
    expect(skillImportModalSource).toContain('EditPopover')
    expect(skillImportModalSource).toContain("getEditConfig('add-skill', workspaceRootPath)")
  })

  test('Remote tab preserves resolver errors', () => {
    expect(getRemoteResolvePhase({ error: 'This repository is not accessible.' })).toEqual({
      kind: 'error',
      message: 'This repository is not accessible.',
    })
  })

  test('Remote tab explains empty discovery results', () => {
    const phase = getRemoteResolvePhase([])

    expect(phase.kind).toBe('error')
    if (phase.kind !== 'error') throw new Error('Expected empty discovery to map to an error phase')
    expect(phase.message).toContain('The repository was reached, but no supported SKILL.md files were found.')
    expect(phase.message).toContain('SKILL.md')
    expect(phase.message).toContain('skill directories up to three levels deep')
    expect(phase.message).toContain('Skill Picker')
    expect(phase.message).toContain('Open a direct GitHub subpath to a skill, or use the Upload tab')
  })

  test('Remote tab routes discovered skills to install or picker phases', () => {
    expect(getRemoteResolvePhase([discoveredSkill])).toEqual({
      kind: 'single',
      skill: discoveredSkill,
    })

    const secondSkill = { ...discoveredSkill, slug: 'test-writer' }
    expect(getRemoteResolvePhase([discoveredSkill, secondSkill])).toEqual({
      kind: 'picker',
      skills: [discoveredSkill, secondSkill],
    })
  })
})
