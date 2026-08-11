/**
 * Constrained parameter schemas for page queries.
 *
 * A grant declares which parameters a page may vary. That schema is authored by
 * the AGENT and stored, so it is attacker-influenced input in the
 * prompt-injection threat model — accepting arbitrary JSON Schema would hand a
 * hostile page a parser to play with (`$ref` cycles, `pattern` ReDoS, unbounded
 * nesting).
 *
 * So the vocabulary is deliberately tiny: string with a length cap, bounded
 * integer, boolean, enum. Anything else is rejected at APPROVAL time, before it
 * can ever be evaluated.
 */
import { describe, expect, it } from 'bun:test'
import { validateParamSchema, validateParams } from './param-schema.ts'

describe('validateParamSchema — what may be stored', () => {
  it('accepts the supported vocabulary', () => {
    const r = validateParamSchema({
      q: { type: 'string', maxLength: 100 },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
      unread: { type: 'boolean' },
      folder: { type: 'enum', values: ['inbox', 'archive'] },
    })
    expect(r.ok).toBe(true)
  })

  it('accepts an empty schema (a query with no parameters)', () => {
    expect(validateParamSchema({}).ok).toBe(true)
  })

  it('rejects $ref, which is where schema parsers get interesting', () => {
    const r = validateParamSchema({ q: { $ref: '#/definitions/x' } as never })
    expect(r.ok).toBe(false)
  })

  it('rejects regex patterns (ReDoS)', () => {
    const r = validateParamSchema({ q: { type: 'string', pattern: '(a+)+$' } as never })
    expect(r.ok).toBe(false)
  })

  it('rejects nested objects and arrays', () => {
    expect(validateParamSchema({ q: { type: 'object' } as never }).ok).toBe(false)
    expect(validateParamSchema({ q: { type: 'array' } as never }).ok).toBe(false)
  })

  it('requires a length cap on strings', () => {
    // Unbounded strings are how a "read" query becomes a data-smuggling channel.
    expect(validateParamSchema({ q: { type: 'string' } as never }).ok).toBe(false)
    expect(validateParamSchema({ q: { type: 'string', maxLength: 100000 } as never }).ok).toBe(false)
  })

  it('requires bounds on integers', () => {
    expect(validateParamSchema({ n: { type: 'integer' } as never }).ok).toBe(false)
  })

  it('requires a non-empty, bounded enum', () => {
    expect(validateParamSchema({ f: { type: 'enum', values: [] } }).ok).toBe(false)
    const many = Array.from({ length: 200 }, (_, i) => `v${i}`)
    expect(validateParamSchema({ f: { type: 'enum', values: many } }).ok).toBe(false)
  })

  it('bounds the number of parameters', () => {
    const wide: Record<string, unknown> = {}
    for (let i = 0; i < 50; i++) wide[`p${i}`] = { type: 'boolean' }
    expect(validateParamSchema(wide as never).ok).toBe(false)
  })

  it('rejects parameter names that are not plain identifiers', () => {
    for (const name of ['__proto__', 'constructor', 'a.b', 'a-b', '', 'a b']) {
      expect(validateParamSchema({ [name]: { type: 'boolean' } }).ok).toBe(false)
    }
  })
})

describe('validateParams — what a page may send', () => {
  const schema = {
    q: { type: 'string' as const, maxLength: 20 },
    limit: { type: 'integer' as const, minimum: 1, maximum: 50 },
    unread: { type: 'boolean' as const },
    folder: { type: 'enum' as const, values: ['inbox', 'archive'] },
  }

  it('accepts conforming values', () => {
    const r = validateParams(schema, { q: 'hello', limit: 10, unread: true, folder: 'inbox' })
    expect(r.ok).toBe(true)
  })

  it('accepts a subset — declared does not mean required', () => {
    expect(validateParams(schema, { limit: 5 }).ok).toBe(true)
  })

  it('rejects undeclared parameters rather than ignoring them', () => {
    // Silently dropping an unknown key hides a mismatch between what the page
    // thinks it asked for and what actually ran.
    const r = validateParams(schema, { q: 'hi', sneaky: 'value' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('sneaky')
  })

  it('enforces types', () => {
    expect(validateParams(schema, { limit: '10' }).ok).toBe(false)
    expect(validateParams(schema, { unread: 'true' }).ok).toBe(false)
    expect(validateParams(schema, { q: 42 }).ok).toBe(false)
  })

  it('enforces string length', () => {
    expect(validateParams(schema, { q: 'x'.repeat(21) }).ok).toBe(false)
  })

  it('enforces integer bounds and integrality', () => {
    expect(validateParams(schema, { limit: 0 }).ok).toBe(false)
    expect(validateParams(schema, { limit: 51 }).ok).toBe(false)
    expect(validateParams(schema, { limit: 1.5 }).ok).toBe(false)
  })

  it('enforces enum membership', () => {
    expect(validateParams(schema, { folder: 'trash' }).ok).toBe(false)
  })

  it('rejects prototype-pollution keys even when the schema is empty', () => {
    expect(validateParams({}, JSON.parse('{"__proto__":{"x":1}}')).ok).toBe(false)
  })

  it('rejects a non-object payload', () => {
    for (const p of [null, 'str', 42, []] as unknown[]) {
      expect(validateParams(schema, p as Record<string, unknown>).ok).toBe(false)
    }
  })
})
