import { describe, expect, test } from 'bun:test'
import { derivePickerMode, type PickerModeInput } from '../picker-mode'

function input(overrides: Partial<PickerModeInput> = {}): PickerModeInput {
  return {
    connectionUnavailable: false,
    connectionDefaultModel: null,
    isEmptySession: false,
    connectionCount: 1,
    ...overrides,
  }
}

describe('derivePickerMode', () => {
  test('connectionUnavailable beats every other flag', () => {
    expect(
      derivePickerMode(input({
        connectionUnavailable: true,
        connectionDefaultModel: 'mistral-7b',
        isEmptySession: true,
        connectionCount: 5,
      })),
    ).toBe('unavailable')
  })

  test('empty session with multiple connections beats single-model lock', () => {
    expect(
      derivePickerMode(input({
        connectionDefaultModel: 'mistral-7b',
        isEmptySession: true,
        connectionCount: 2,
      })),
    ).toBe('switcher')
  })

  test('non-empty session with multiple connections still shows switcher for hot swapping', () => {
    expect(
      derivePickerMode(input({
        connectionDefaultModel: 'mistral-7b',
        isEmptySession: false,
        connectionCount: 5,
      })),
    ).toBe('switcher')
  })

  test('empty session with one single-model connection stays locked', () => {
    expect(
      derivePickerMode(input({
        connectionDefaultModel: 'mistral-7b',
        isEmptySession: true,
        connectionCount: 1,
      })),
    ).toBe('locked-single')
  })

  test('started session with multiple connections uses switcher', () => {
    expect(
      derivePickerMode(input({
        connectionDefaultModel: null,
        isEmptySession: false,
        connectionCount: 3,
      })),
    ).toBe('switcher')
  })

  test('empty session with one multi-model connection falls through to flat picker', () => {
    expect(
      derivePickerMode(input({
        connectionDefaultModel: null,
        isEmptySession: true,
        connectionCount: 1,
      })),
    ).toBe('flat')
  })
})
