import { describe, it, expect } from 'bun:test'
import { lockHolderMatchesLock, parseTasklistImageName } from './lock-identity.ts'

describe('parseTasklistImageName', () => {
  it('extracts the image name from a CSV data row', () => {
    expect(parseTasklistImageName('"Craft Agents.exe","1234","Console","1","150,000 K"')).toBe('Craft Agents.exe')
  })

  it('returns null for the no-tasks INFO message', () => {
    expect(parseTasklistImageName('INFO: No tasks are running which match the specified criteria.')).toBeNull()
  })

  it('returns null for empty or malformed output', () => {
    expect(parseTasklistImageName('')).toBeNull()
    expect(parseTasklistImageName('""')).toBeNull()
  })

  it('uses only the first row of multi-line output', () => {
    expect(parseTasklistImageName('"bun.exe","99","Console","1","10 K"\r\n"other.exe","100","Console","1","10 K"')).toBe('bun.exe')
  })
})

describe('lockHolderMatchesLock (#978)', () => {
  const lockWith = (execName?: string) => ({ pid: 1234, startedAt: 1_000, execName })

  it('matches on identical execName', () => {
    expect(lockHolderMatchesLock(lockWith('Craft Agents.exe'), 'Craft Agents.exe', null)).toBe(true)
  })

  it('matches execName case-insensitively', () => {
    expect(lockHolderMatchesLock(lockWith('craft agents.exe'), 'Craft Agents.EXE', null)).toBe(true)
  })

  it('matches dev shapes the legacy heuristic missed (bun holding the lock)', () => {
    expect(lockHolderMatchesLock(lockWith('bun'), 'bun', null)).toBe(true)
  })

  it('rejects a different executable even when its name contains "craft"', () => {
    // PID recycled onto e.g. a game process — must NOT keep the brick (#978)
    expect(lockHolderMatchesLock(lockWith('Craft Agents.exe'), 'minecraft-launcher', null)).toBe(false)
  })

  it('fails open when the live exec name cannot be determined', () => {
    expect(lockHolderMatchesLock(lockWith('Craft Agents.exe'), null, null)).toBe(false)
  })

  it('ignores the command line when execName is recorded', () => {
    // cmdline mentions craft, but the executable is something else → recycled PID
    expect(lockHolderMatchesLock(lockWith('Craft Agents.exe'), 'java', '/usr/bin/java -jar minecraft.jar')).toBe(false)
  })

  describe('legacy locks without execName', () => {
    it('falls back to the craft-substring heuristic on the command line', () => {
      expect(lockHolderMatchesLock(lockWith(undefined), null, '/Applications/Craft Agents.app/Contents/MacOS/Craft Agents')).toBe(true)
      expect(lockHolderMatchesLock(lockWith(undefined), null, '/usr/libexec/swcd')).toBe(false)
    })

    it('fails open when the command line cannot be read', () => {
      expect(lockHolderMatchesLock(lockWith(undefined), null, null)).toBe(false)
    })
  })
})
