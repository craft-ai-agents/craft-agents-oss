/**
 * Truth table for `derivePickerMode`. The helper is small but its behavior
 * has been wrong before (issue #727 was a precedence ordering bug) — pinning
 * each row of the matrix here so future renames / reshufflings can't
 * silently regress to the trapped state.
 */

import { describe, test, expect } from 'bun:test'
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
  // -------------------------------------------------------------------------
  // Precedence: unavailable wins
  // -------------------------------------------------------------------------

  test('connectionUnavailable beats every other flag', () => {
    expect(
      derivePickerMode(
        input({
          connectionUnavailable: true,
          connectionDefaultModel: 'mistral-7b',
          isEmptySession: true,
          connectionCount: 5,
        }),
      ),
    ).toBe('unavailable')
  })

  // -------------------------------------------------------------------------
  // The #727 regression: switcher must win over locked-single on empty session
  // -------------------------------------------------------------------------

  test('empty session + ≥2 connections + single-model pi_compat default → switcher (#727)', () => {
    expect(
      derivePickerMode(
        input({
          connectionDefaultModel: 'mistral-7b',
          isEmptySession: true,
          connectionCount: 2,
        }),
      ),
    ).toBe('switcher')
  })

  test('empty session + many connections + single-model pi_compat default → switcher', () => {
    expect(
      derivePickerMode(
        input({
          connectionDefaultModel: 'llama3',
          isEmptySession: true,
          connectionCount: 7,
        }),
      ),
    ).toBe('switcher')
  })

  test('empty session + ≥2 connections + multi-model default → switcher', () => {
    expect(
      derivePickerMode(
        input({
          connectionDefaultModel: null,
          isEmptySession: true,
          connectionCount: 3,
        }),
      ),
    ).toBe('switcher')
  })

  // -------------------------------------------------------------------------
  // Mid-session lock preserved: switcher off, locked-single still rendered
  // -------------------------------------------------------------------------

  test('non-empty session + single-model pi_compat default → locked-single (lock preserved)', () => {
    expect(
      derivePickerMode(
        input({
          connectionDefaultModel: 'mistral-7b',
          isEmptySession: false,
          connectionCount: 5,
        }),
      ),
    ).toBe('locked-single')
  })

  test('empty session + only 1 connection + single-model pi_compat default → locked-single (no switcher possible)', () => {
    // No other connection to switch to, so the picker stays in the disabled
    // single-row UI even on a fresh session. That's correct.
    expect(
      derivePickerMode(
        input({
          connectionDefaultModel: 'mistral-7b',
          isEmptySession: true,
          connectionCount: 1,
        }),
      ),
    ).toBe('locked-single')
  })

  // -------------------------------------------------------------------------
  // Flat list: the unremarkable "list models for the active connection" case
  // -------------------------------------------------------------------------

  test('non-empty session + multi-model connection → flat', () => {
    expect(
      derivePickerMode(
        input({
          connectionDefaultModel: null,
          isEmptySession: false,
          connectionCount: 3,
        }),
      ),
    ).toBe('flat')
  })

  test('empty session + only 1 multi-model connection → flat', () => {
    expect(
      derivePickerMode(
        input({
          connectionDefaultModel: null,
          isEmptySession: true,
          connectionCount: 1,
        }),
      ),
    ).toBe('flat')
  })

  test('non-empty session + 1 connection + multi-model → flat', () => {
    expect(
      derivePickerMode(
        input({
          connectionDefaultModel: null,
          isEmptySession: false,
          connectionCount: 1,
        }),
      ),
    ).toBe('flat')
  })

  // -------------------------------------------------------------------------
  // Boundary: connectionCount > 1 vs == 1 on an empty session
  // -------------------------------------------------------------------------

  test('connectionCount=2 on empty session triggers switcher (lower bound for >1)', () => {
    expect(
      derivePickerMode(
        input({ connectionDefaultModel: 'm', isEmptySession: true, connectionCount: 2 }),
      ),
    ).toBe('switcher')
  })

  test('connectionCount=1 on empty session never triggers switcher', () => {
    expect(
      derivePickerMode(
        input({ connectionDefaultModel: 'm', isEmptySession: true, connectionCount: 1 }),
      ),
    ).toBe('locked-single')
  })

  // -------------------------------------------------------------------------
  // connectionCount=0 — defensive: should never panic, falls through to flat
  // -------------------------------------------------------------------------

  test('connectionCount=0 (no connections configured) → flat (defensive fallthrough)', () => {
    expect(
      derivePickerMode(
        input({ connectionDefaultModel: null, isEmptySession: true, connectionCount: 0 }),
      ),
    ).toBe('flat')
  })
})
