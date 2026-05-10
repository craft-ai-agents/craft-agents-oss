import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShellSource = readFileSync(
  join(import.meta.dir, '../AppShell.tsx'),
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

  test('AI Assist tab keeps the existing add-skill EditPopover configuration', () => {
    expect(skillImportModalSource).toContain('EditPopover')
    expect(skillImportModalSource).toContain("getEditConfig('add-skill', workspaceRootPath)")
  })
})
