import { describe, test, expect } from 'bun:test'
import { formatPathsToRelative, formatSinglePathToRelative } from '../files'

// Regression for #1056: session.jsonl stored tool records had a '.' inserted
// into absolute paths. Root cause: formatPathsToRelative relativized display
// text against process.cwd() (the filesystem root in a packaged app) and its
// regex matched keyword segments (/home, /tmp, ...) that were only a substring
// of a longer absolute path.
describe('#1056 formatPathsToRelative keeps paths verbatim when base is the filesystem root', () => {
  // '/' is what process.cwd() resolves to in the packaged macOS app.
  const cases: Array<[string, string]> = [
    ['/Volumes/home/Drive', '/Volumes/home/Drive'],
    ['/Users/samflorentine/.craft-agent', '/Users/samflorentine/.craft-agent'],
    ['/opt/homebrew', '/opt/homebrew'],
    ['//sam@192.168.1.100/home', '//sam@192.168.1.100/home'],
    ['/private/tmp/x', '/private/tmp/x'],
    ['/Users/x', '/Users/x'],
    ['/etc/hosts', '/etc/hosts'],
    ['/var/log/x', '/var/log/x'],
  ]
  for (const [input, expected] of cases) {
    test(`unchanged: ${input}`, () => {
      expect(formatPathsToRelative(input, '/')).toBe(expected)
    })
  }
})

describe('#1056 regex does not treat a keyword as a substring of a longer path', () => {
  test('"/home" inside "/Volumes/home" is not matched even with a non-root base', () => {
    // base deliberately matches the "/Volumes" prefix so that, if the "/home"
    // substring were matched and relativized, the parent path would be corrupted.
    expect(formatPathsToRelative('/Volumes/home/Databases', '/Volumes')).toBe('/Volumes/home/Databases')
  })
})

describe('formatPathsToRelative still relativizes paths under a real cwd', () => {
  test('path under cwd becomes ./relative', () => {
    expect(formatPathsToRelative('open /Users/dev/proj/src/a.ts now', '/Users/dev/proj')).toBe('open ./src/a.ts now')
  })
  test('path outside cwd stays absolute', () => {
    expect(formatPathsToRelative('read /etc/hosts', '/Users/dev/proj')).toBe('read /etc/hosts')
  })
})

describe('formatSinglePathToRelative', () => {
  test('does not relativize against root', () => {
    expect(formatSinglePathToRelative('/Users/x', '/')).toBe('/Users/x')
  })
  test('relativizes under a real base', () => {
    expect(formatSinglePathToRelative('/Users/dev/proj/a.ts', '/Users/dev/proj')).toBe('./a.ts')
  })
})
