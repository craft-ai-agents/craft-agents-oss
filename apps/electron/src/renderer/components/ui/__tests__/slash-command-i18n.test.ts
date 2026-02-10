import { describe, expect, it } from 'bun:test'
import { DEFAULT_SLASH_COMMANDS, getSlashMenuFooterHint } from '../slash-command-menu'

describe('slash command defaults', () => {
  it('keeps stable ultrathink fallback labels', () => {
    const ultrathink = DEFAULT_SLASH_COMMANDS.find((command) => command.id === 'ultrathink')
    expect(ultrathink?.label).toBe('Ultrathink')
    expect(ultrathink?.description).toBe('Extended reasoning for complex problems')
  })

  it('resolves localized footer hint', () => {
    const footerHint = getSlashMenuFooterHint((key: string) => {
      if (key === 'common:slashMenu.footerHint') {
        return 'Use @ to mention skills and files'
      }
      return key
    })

    expect(footerHint).toBe('Use @ to mention skills and files')
  })
})
