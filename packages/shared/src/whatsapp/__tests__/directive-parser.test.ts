import { describe, test, expect } from 'bun:test'
import {
  extractDirective,
  hasDirective,
  getDirective,
  type PermissionDirective,
} from '../directive-parser'

describe('extractDirective', () => {
  test('valid directive with content', () => {
    const result = extractDirective('@vesper /allow-all research competitors')
    expect(result.directive).toBe('allow-all')
    expect(result.content).toBe('research competitors')
  })

  test('no directive returns null', () => {
    const result = extractDirective('just ask claude')
    expect(result.directive).toBeNull()
    expect(result.content).toBe('just ask claude')
  })

  test('case insensitive directive', () => {
    const result = extractDirective('@vesper /SAFE research')
    expect(result.directive).toBe('safe')
    expect(result.content).toBe('research')
  })

  test('valid directives: safe, ask, allow-all', () => {
    const safe = extractDirective('@vesper /safe data')
    const ask = extractDirective('@vesper /ask code')
    const allow = extractDirective('@vesper /allow-all run')

    expect(safe.directive).toBe('safe')
    expect(ask.directive).toBe('ask')
    expect(allow.directive).toBe('allow-all')
  })

  test('invalid directive ignored', () => {
    const result = extractDirective('@vesper /invalid research')
    expect(result.directive).toBeNull()
    expect(result.content).toContain('@vesper')
  })

  test('multi-word content preserved', () => {
    const result = extractDirective(
      '@vesper /safe research my competitors market share'
    )
    expect(result.directive).toBe('safe')
    expect(result.content).toBe('research my competitors market share')
  })

  test('whitespace trimming', () => {
    const result = extractDirective('   @vesper /ask   test   ')
    expect(result.directive).toBe('ask')
    expect(result.content).toBe('test')
  })

  test('missing @vesper prefix', () => {
    const result = extractDirective('/safe research')
    expect(result.directive).toBeNull()
    expect(result.content).toBe('/safe research')
  })

  test('empty content after directive', () => {
    const result = extractDirective('@vesper /safe')
    expect(result.directive).toBeNull()
    expect(result.content).toBe('@vesper /safe')
  })

  test('directive in middle of message', () => {
    const result = extractDirective('hello @vesper /safe world')
    expect(result.directive).toBeNull()
    expect(result.content).toBe('hello @vesper /safe world')
  })

  test('multiple directives (only first recognized)', () => {
    const result = extractDirective('@vesper /safe @vesper /allow-all test')
    expect(result.directive).toBe('safe')
    expect(result.content).toBe('@vesper /allow-all test')
  })
})

describe('hasDirective', () => {
  test('returns true for valid directive', () => {
    expect(hasDirective('@vesper /safe test')).toBe(true)
    expect(hasDirective('@vesper /ask test')).toBe(true)
    expect(hasDirective('@vesper /allow-all test')).toBe(true)
  })

  test('returns false for no directive', () => {
    expect(hasDirective('just a message')).toBe(false)
    expect(hasDirective('@vesper /invalid')).toBe(false)
    expect(hasDirective('/safe test')).toBe(false)
  })

  test('case insensitive detection', () => {
    expect(hasDirective('@vesper /SAFE test')).toBe(true)
    expect(hasDirective('@VESPR /ask test')).toBe(true)
  })

  test('whitespace tolerance', () => {
    expect(hasDirective('   @vesper /safe test   ')).toBe(true)
  })
})

describe('getDirective', () => {
  test('returns directive when present', () => {
    expect(getDirective('@vesper /safe test')).toBe('safe')
    expect(getDirective('@vesper /ask test')).toBe('ask')
    expect(getDirective('@vesper /allow-all test')).toBe('allow-all')
  })

  test('returns null when directive absent', () => {
    expect(getDirective('just a message')).toBeNull()
    expect(getDirective('@vesper /invalid')).toBeNull()
  })

  test('case normalization', () => {
    const result = getDirective('@vesper /ALLOW-ALL test') as PermissionDirective
    expect(result).toBe('allow-all')
  })
})
