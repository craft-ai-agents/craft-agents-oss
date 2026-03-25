import { describe, expect, it } from 'bun:test'
import { resolveImportedSkillFilePath } from './skills'

describe('resolveImportedSkillFilePath', () => {
  it('allows nested files under the destination skill directory', () => {
    expect(resolveImportedSkillFilePath('/tmp/skills/my-skill', 'docs/guide.md')).toBe('/tmp/skills/my-skill/docs/guide.md')
  })

  it('rejects parent-directory traversal', () => {
    expect(() => resolveImportedSkillFilePath('/tmp/skills/my-skill', '../config.json')).toThrow('Invalid skill bundle path')
  })

  it('rejects absolute paths', () => {
    expect(() => resolveImportedSkillFilePath('/tmp/skills/my-skill', '/etc/passwd')).toThrow('Invalid skill bundle path')
  })

  it('rejects dot segments and empty segments', () => {
    expect(() => resolveImportedSkillFilePath('/tmp/skills/my-skill', './SKILL.md')).toThrow('Invalid skill bundle path')
    expect(() => resolveImportedSkillFilePath('/tmp/skills/my-skill', 'nested//SKILL.md')).toThrow('Invalid skill bundle path')
  })
})
