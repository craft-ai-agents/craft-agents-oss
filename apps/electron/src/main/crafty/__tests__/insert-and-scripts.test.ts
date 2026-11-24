import { describe, expect, it } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { chooseInsertMode, TYPE_MAX_CHARS } from '../insert-mode'
import { JXA_SCRIPTS } from '../jxa'

describe('chooseInsertMode', () => {
  it('types short single-line text and pastes long text', () => {
    expect(chooseInsertMode('auto', 'Sounds good, thanks!', 'com.apple.Safari')).toBe('type')
    expect(chooseInsertMode('auto', 'x'.repeat(TYPE_MAX_CHARS), null)).toBe('type')
    expect(chooseInsertMode('auto', 'x'.repeat(TYPE_MAX_CHARS + 1), null)).toBe('paste')
  })

  it('always pastes in Slack, where typing opens pickers', () => {
    expect(chooseInsertMode('auto', 'ok', 'com.tinyspeck.slackmacgap')).toBe('paste')
  })

  it('never types a newline (Enter sends the message), even when typing was asked for', () => {
    expect(chooseInsertMode('type', 'line one\nline two', null)).toBe('paste')
    expect(chooseInsertMode('auto', 'a\r', null)).toBe('paste')
  })

  it('honours an explicit mode for single-line text', () => {
    expect(chooseInsertMode('paste', 'ok', null)).toBe('paste')
    expect(chooseInsertMode('type', 'x'.repeat(500), 'com.tinyspeck.slackmacgap')).toBe('type')
  })
})

// Compiles the scripts without running them: no keystrokes, no Apple Events, no prompts.
describe.skipIf(process.platform !== 'darwin')('JXA scripts', () => {
  for (const [name, script] of Object.entries(JXA_SCRIPTS)) {
    it(`${name} compiles`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'crafty-jxa-'))
      try {
        execFileSync('/usr/bin/osacompile', ['-l', 'JavaScript', '-o', join(dir, `${name}.scpt`), '-e', script], { stdio: 'pipe' })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
