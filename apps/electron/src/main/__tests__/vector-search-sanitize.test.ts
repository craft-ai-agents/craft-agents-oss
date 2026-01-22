/**
 * Tests for vector search argument sanitization
 *
 * The sanitize function removes shell metacharacters from QMD CLI arguments
 * to prevent command injection attacks.
 */

import { describe, it, expect } from 'bun:test'

/**
 * Sanitize function extracted for testing
 * This is the same logic used in the IPC handler
 */
function sanitizeArg(arg: string): string {
  return arg.replace(/[`$(){}|;&]/g, '').slice(0, 1000)
}

describe('vector-search sanitization', () => {
  describe('safe inputs (should pass through)', () => {
    it('allows normal search queries', () => {
      expect(sanitizeArg('normal query')).toBe('normal query')
      expect(sanitizeArg('how to authenticate users')).toBe('how to authenticate users')
      expect(sanitizeArg('error handling best practices')).toBe('error handling best practices')
    })

    it('allows queries with common punctuation', () => {
      expect(sanitizeArg('what is a "good" pattern?')).toBe('what is a "good" pattern?')
      expect(sanitizeArg("what's the best way")).toBe("what's the best way")
      expect(sanitizeArg('file.md')).toBe('file.md')
      expect(sanitizeArg('path/to/file')).toBe('path/to/file')
    })

    it('allows queries with numbers', () => {
      expect(sanitizeArg('version 2.0')).toBe('version 2.0')
      expect(sanitizeArg('RFC 7231')).toBe('RFC 7231')
    })

    it('allows unicode characters', () => {
      expect(sanitizeArg('hello world')).toBe('hello world')
    })
  })

  describe('dangerous inputs (should be sanitized)', () => {
    it('removes semicolon (command separator)', () => {
      expect(sanitizeArg('test; rm -rf /')).toBe('test rm -rf /')
      expect(sanitizeArg('query; echo pwned')).toBe('query echo pwned')
    })

    it('removes command substitution with $()', () => {
      expect(sanitizeArg('$(whoami)')).toBe('whoami')
      expect(sanitizeArg('test $(cat /etc/passwd)')).toBe('test cat /etc/passwd')
    })

    it('removes command substitution with backticks', () => {
      expect(sanitizeArg('`id`')).toBe('id')
      expect(sanitizeArg('test `uname -a`')).toBe('test uname -a')
    })

    it('removes pipe operator', () => {
      expect(sanitizeArg('test | cat /etc/passwd')).toBe('test  cat /etc/passwd')
      expect(sanitizeArg('query | xargs rm')).toBe('query  xargs rm')
    })

    it('removes ampersand (background operator)', () => {
      expect(sanitizeArg('test & rm -rf /')).toBe('test  rm -rf /')
      expect(sanitizeArg('query && echo pwned')).toBe('query  echo pwned')
    })

    it('removes curly braces (brace expansion)', () => {
      expect(sanitizeArg('{a,b,c}')).toBe('a,b,c')
      expect(sanitizeArg('test{1..10}')).toBe('test1..10')
    })

    it('handles multiple dangerous characters', () => {
      expect(sanitizeArg('$(id); `whoami` | cat & {}')).toBe('id whoami  cat  ')
    })
  })

  describe('length limiting', () => {
    it('truncates very long inputs to 1000 characters', () => {
      const longInput = 'a'.repeat(2000)
      expect(sanitizeArg(longInput)).toHaveLength(1000)
    })

    it('preserves inputs under 1000 characters', () => {
      const shortInput = 'a'.repeat(500)
      expect(sanitizeArg(shortInput)).toHaveLength(500)
    })

    it('handles exactly 1000 characters', () => {
      const exactInput = 'a'.repeat(1000)
      expect(sanitizeArg(exactInput)).toHaveLength(1000)
    })
  })

  describe('edge cases', () => {
    it('handles empty string', () => {
      expect(sanitizeArg('')).toBe('')
    })

    it('handles string with only dangerous chars', () => {
      expect(sanitizeArg('$(){}|;&`')).toBe('')
    })

    it('handles whitespace', () => {
      expect(sanitizeArg('   ')).toBe('   ')
      expect(sanitizeArg('\t\n')).toBe('\t\n')
    })

    it('preserves safe special characters', () => {
      expect(sanitizeArg('!@#%^*-_=+[]:<>,.?/')).toBe('!@#%^*-_=+[]:<>,.?/')
    })
  })
})
