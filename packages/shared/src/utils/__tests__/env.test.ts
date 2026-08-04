import { afterEach, describe, expect, it } from 'bun:test'
import { sanitizeChildProcessEnv } from '../env.ts'

const leakedKey = 'ARCHSTUDIO_TEST_LITERAL_UNDEFINED'
const originalValue = process.env[leakedKey]

afterEach(() => {
  if (originalValue === undefined) delete process.env[leakedKey]
  else process.env[leakedKey] = originalValue
})

describe('sanitizeChildProcessEnv', () => {
  it('removes undefined and literal "undefined" values without mutating the input', () => {
    const input: Record<string, string | undefined> = {
      KEEP: 'value',
      REMOVE_UNDEFINED: undefined,
      REMOVE_LITERAL: 'undefined',
    }

    const sanitized = sanitizeChildProcessEnv(input)

    expect(sanitized).toEqual({ KEEP: 'value' })
    expect(input).toEqual({
      KEEP: 'value',
      REMOVE_UNDEFINED: undefined,
      REMOVE_LITERAL: 'undefined',
    })
  })

  it('filters a literal undefined leak from process.env', () => {
    process.env[leakedKey] = 'undefined'

    expect(sanitizeChildProcessEnv(process.env)[leakedKey]).toBeUndefined()
  })

  it('preserves intentional values that only resemble the sentinel', () => {
    const sanitized = sanitizeChildProcessEnv({
      UPPERCASE: 'UNDEFINED',
      WHITESPACE: ' undefined ',
      EMPTY: '',
    })

    expect(sanitized).toEqual({
      UPPERCASE: 'UNDEFINED',
      WHITESPACE: ' undefined ',
      EMPTY: '',
    })
  })
})
