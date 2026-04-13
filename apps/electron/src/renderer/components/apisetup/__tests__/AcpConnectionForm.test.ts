/**
 * Tests for AcpConnectionForm utilities (tokenizeCommand)
 * and core behavior contracts.
 */

import { describe, test, expect } from 'bun:test'
import { tokenizeCommand } from '../AcpConnectionForm'

describe('tokenizeCommand', () => {
  test('splits simple space-separated args', () => {
    expect(tokenizeCommand('gemini --yolo')).toEqual(['gemini', '--yolo'])
  })

  test('returns empty array for empty string', () => {
    expect(tokenizeCommand('')).toEqual([])
  })

  test('returns empty array for whitespace-only string', () => {
    expect(tokenizeCommand('   ')).toEqual([])
  })

  test('handles double-quoted arg with spaces', () => {
    expect(tokenizeCommand('my-agent "--flag value"')).toEqual(['my-agent', '--flag value'])
  })

  test('handles single-quoted arg with spaces', () => {
    expect(tokenizeCommand("my-agent '--flag value'")).toEqual(['my-agent', '--flag value'])
  })

  test('strips quotes from quoted token', () => {
    expect(tokenizeCommand('"gemini" "--yolo"')).toEqual(['gemini', '--yolo'])
  })

  test('handles multiple args with mixed quoting', () => {
    expect(tokenizeCommand('agent -a "foo bar" --baz')).toEqual(['agent', '-a', 'foo bar', '--baz'])
  })

  test('handles leading/trailing whitespace', () => {
    expect(tokenizeCommand('  gemini  --yolo  ')).toEqual(['gemini', '--yolo'])
  })

  test('single token (no args)', () => {
    expect(tokenizeCommand('gemini')).toEqual(['gemini'])
  })

  test('empty double-quoted string becomes empty token', () => {
    expect(tokenizeCommand('cmd ""')).toEqual(['cmd', ''])
  })
})
