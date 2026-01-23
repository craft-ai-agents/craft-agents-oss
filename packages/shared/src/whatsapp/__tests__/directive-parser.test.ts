import { describe, test, expect } from 'bun:test'
import {
  extractDirective,
  hasDirective,
  getDirective,
  type PermissionDirective,
} from '../directive-parser'

describe('extractDirective', () => {
  test('valid directive with content', () => {
    const result = extractDirective('@vespr /allow-all research competitors')
    expect(result.directive).toBe('allow-all')
    expect(result.content).toBe('research competitors')
  })

  test('no directive returns null', () => {
    const result = extractDirective('just ask claude')
    expect(result.directive).toBeNull()
    expect(result.content).toBe('just ask claude')
  })

  test('case insensitive directive', () => {
    const result = extractDirective('@vespr /SAFE research')
    expect(result.directive).toBe('safe')
    expect(result.content).toBe('research')
  })

  test('valid directives: safe, ask, allow-all', () => {
    const safe = extractDirective('@vespr /safe data')
    const ask = extractDirective('@vespr /ask code')
    const allow = extractDirective('@vespr /allow-all run')

    expect(safe.directive).toBe('safe')
    expect(ask.directive).toBe('ask')
    expect(allow.directive).toBe('allow-all')
  })

  test('invalid directive ignored', () => {
    const result = extractDirective('@vespr /invalid research')
    expect(result.directive).toBeNull()
    expect(result.content).toContain('@vespr')
  })

  test('multi-word content preserved', () => {
    const result = extractDirective(
      '@vespr /safe research my competitors market share'
    )
    expect(result.directive).toBe('safe')
    expect(result.content).toBe('research my competitors market share')
  })

  test('whitespace trimming', () => {
    const result = extractDirective('   @vespr /ask   test   ')
    expect(result.directive).toBe('ask')
    expect(result.content).toBe('test')
  })

  test('missing @vespr prefix', () => {
    const result = extractDirective('/safe research')
    expect(result.directive).toBeNull()
    expect(result.content).toBe('/safe research')
  })

  test('empty content after directive', () => {
    const result = extractDirective('@vespr /safe')
    expect(result.directive).toBeNull()
    expect(result.content).toBe('@vespr /safe')
  })

  test('directive in middle of message', () => {
    const result = extractDirective('hello @vespr /safe world')
    expect(result.directive).toBeNull()
    expect(result.content).toBe('hello @vespr /safe world')
  })

  test('multiple directives (only first recognized)', () => {
    const result = extractDirective('@vespr /safe @vespr /allow-all test')
    expect(result.directive).toBe('safe')
    expect(result.content).toBe('@vespr /allow-all test')
  })
})

describe('hasDirective', () => {
  test('returns true for valid directive', () => {
    expect(hasDirective('@vespr /safe test')).toBe(true)
    expect(hasDirective('@vespr /ask test')).toBe(true)
    expect(hasDirective('@vespr /allow-all test')).toBe(true)
  })

  test('returns false for no directive', () => {
    expect(hasDirective('just a message')).toBe(false)
    expect(hasDirective('@vespr /invalid')).toBe(false)
    expect(hasDirective('/safe test')).toBe(false)
  })

  test('case insensitive detection', () => {
    expect(hasDirective('@vespr /SAFE test')).toBe(true)
    expect(hasDirective('@VESPR /ask test')).toBe(true)
  })

  test('whitespace tolerance', () => {
    expect(hasDirective('   @vespr /safe test   ')).toBe(true)
  })
})

describe('getDirective', () => {
  test('returns directive when present', () => {
    expect(getDirective('@vespr /safe test')).toBe('safe')
    expect(getDirective('@vespr /ask test')).toBe('ask')
    expect(getDirective('@vespr /allow-all test')).toBe('allow-all')
  })

  test('returns null when directive absent', () => {
    expect(getDirective('just a message')).toBeNull()
    expect(getDirective('@vespr /invalid')).toBeNull()
  })

  test('case normalization', () => {
    const result = getDirective('@vespr /ALLOW-ALL test') as PermissionDirective
    expect(result).toBe('allow-all')
  })
})
