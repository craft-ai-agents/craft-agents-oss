import { describe, it, expect } from 'bun:test'
import { classifyExternalUrl, isSafeExternalUrl, formatBlockedUrlError } from '../url-safety.ts'

describe('classifyExternalUrl — safe external (standard web schemes)', () => {
  it('classifies http:// as safe-external', () => {
    expect(classifyExternalUrl('http://example.com').kind).toBe('safe-external')
  })

  it('classifies https:// as safe-external', () => {
    expect(classifyExternalUrl('https://example.com/path?q=1').kind).toBe('safe-external')
  })

  it('classifies mailto: as safe-external', () => {
    expect(classifyExternalUrl('mailto:user@example.com').kind).toBe('safe-external')
  })

  it('classifies tel: as safe-external', () => {
    expect(classifyExternalUrl('tel:+15551234567').kind).toBe('safe-external')
  })

  it('classifies sms: as safe-external', () => {
    expect(classifyExternalUrl('sms:+15551234567').kind).toBe('safe-external')
  })
})

describe('classifyExternalUrl — safe external (custom app schemes)', () => {
  it.each([
    ['obsidian://open?vault=mine&file=note'],
    ['vscode://file/Users/me/repo/src/index.ts'],
    ['zed://file/Users/me/repo/src/index.ts'],
    ['notion://open?id=abc123'],
    ['slack://channel?team=T1&id=C2'],
    ['things:///show?id=abc'],
    ['jetbrains://idea/navigate/reference?project=foo'],
    ['cursor://open?path=/tmp/x'],
    ['craftdocs://open?docId=123'],
  ])('classifies %s as safe-external', (url) => {
    expect(classifyExternalUrl(url).kind).toBe('safe-external')
  })
})

describe('classifyExternalUrl — internal deep links', () => {
  it('classifies craftagents:// as internal-deeplink', () => {
    expect(classifyExternalUrl('craftagents://settings').kind).toBe('internal-deeplink')
  })

  it('is case-insensitive for the scheme', () => {
    expect(classifyExternalUrl('CRAFTAGENTS://settings').kind).toBe('internal-deeplink')
  })
})

describe('classifyExternalUrl — dangerous schemes', () => {
  it.each([
    ['javascript:alert(1)', 'javascript:'],
    ['JavaScript:alert(1)', 'javascript:'],
    ['JAVASCRIPT:alert(1)', 'javascript:'],
    ['data:text/html,<script>alert(1)</script>', 'data:'],
    ['vbscript:msgbox("hi")', 'vbscript:'],
    ['blob:https://example.com/abc', 'blob:'],
    ['file:///etc/passwd', 'file:'],
    ['FILE:///etc/passwd', 'file:'],
  ])('classifies %s as dangerous with scheme %s', (url, expectedScheme) => {
    const result = classifyExternalUrl(url)
    expect(result.kind).toBe('dangerous')
    if (result.kind === 'dangerous') {
      expect(result.scheme).toBe(expectedScheme)
      expect(result.reason).toBeTruthy()
    }
  })

  it('attaches a file-specific reason that mentions preview blocks for file: URLs', () => {
    const result = classifyExternalUrl('file:///tmp/test.md')
    expect(result.kind).toBe('dangerous')
    if (result.kind === 'dangerous') {
      expect(result.reason).toMatch(/markdown-preview/)
    }
  })

  it('attaches a JS-specific reason for javascript: URLs', () => {
    const result = classifyExternalUrl('javascript:alert(1)')
    expect(result.kind).toBe('dangerous')
    if (result.kind === 'dangerous') {
      expect(result.reason).toMatch(/JavaScript/)
    }
  })
})

describe('classifyExternalUrl — malformed input', () => {
  it('rejects empty string with a scheme-less reason', () => {
    const result = classifyExternalUrl('')
    expect(result.kind).toBe('dangerous')
    if (result.kind === 'dangerous') {
      expect(result.scheme).toBeUndefined()
      expect(result.reason).toMatch(/empty/i)
    }
  })

  it('rejects whitespace-only string', () => {
    const result = classifyExternalUrl('   ')
    expect(result.kind).toBe('dangerous')
  })

  it('rejects plain text that is not a URL with a malformed reason', () => {
    const result = classifyExternalUrl('not a url')
    expect(result.kind).toBe('dangerous')
    if (result.kind === 'dangerous') {
      expect(result.scheme).toBeUndefined()
      expect(result.reason).toMatch(/malformed/i)
    }
  })

  it('trims leading/trailing whitespace before classifying', () => {
    expect(classifyExternalUrl('  https://example.com  ').kind).toBe('safe-external')
  })
})

describe('formatBlockedUrlError', () => {
  it('formats a scheme-bearing dangerous classification with parenthesized scheme', () => {
    const message = formatBlockedUrlError(classifyExternalUrl('file:///tmp/x'))
    expect(message).toMatch(/^URL blocked \(file:\)\. /)
  })

  it('omits the parenthesized scheme when no scheme is present', () => {
    const message = formatBlockedUrlError(classifyExternalUrl(''))
    expect(message).toMatch(/^URL blocked\. /)
    expect(message).not.toMatch(/\(/)
  })

  it('returns an empty string for non-dangerous classifications', () => {
    expect(formatBlockedUrlError(classifyExternalUrl('https://example.com'))).toBe('')
    expect(formatBlockedUrlError(classifyExternalUrl('craftagents://settings'))).toBe('')
  })
})

describe('isSafeExternalUrl', () => {
  it('returns true for http/https', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
  })

  it('returns true for custom app schemes', () => {
    expect(isSafeExternalUrl('obsidian://open?vault=mine')).toBe(true)
    expect(isSafeExternalUrl('vscode://file/x')).toBe(true)
  })

  it('returns false for internal deep links', () => {
    expect(isSafeExternalUrl('craftagents://settings')).toBe(false)
  })

  it('returns false for dangerous schemes', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
  })

  it('returns false for malformed input', () => {
    expect(isSafeExternalUrl('')).toBe(false)
    expect(isSafeExternalUrl('not a url')).toBe(false)
  })
})
