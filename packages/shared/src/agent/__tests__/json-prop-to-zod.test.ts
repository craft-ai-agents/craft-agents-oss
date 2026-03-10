/**
 * Tests for jsonPropToZod — JSON Schema → Zod conversion for MCP tool proxy schemas.
 *
 * Regression test for MCP parameter serialization bug: union-type parameters
 * (oneOf/anyOf) and nested objects were converted to z.unknown(), causing the
 * LLM to receive no type information for structured parameters.
 */
import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import { jsonPropToZod } from '../claude-agent.ts'

describe('jsonPropToZod', () => {
  describe('primitives', () => {
    it('converts string type', () => {
      const schema = jsonPropToZod({ type: 'string' })
      expect(schema.safeParse('hello').success).toBe(true)
      expect(schema.safeParse(42).success).toBe(false)
    })

    it('converts number type', () => {
      const schema = jsonPropToZod({ type: 'number' })
      expect(schema.safeParse(42).success).toBe(true)
      expect(schema.safeParse('nope').success).toBe(false)
    })

    it('converts integer type as number', () => {
      const schema = jsonPropToZod({ type: 'integer' })
      expect(schema.safeParse(42).success).toBe(true)
    })

    it('converts boolean type', () => {
      const schema = jsonPropToZod({ type: 'boolean' })
      expect(schema.safeParse(true).success).toBe(true)
      expect(schema.safeParse('yes').success).toBe(false)
    })
  })

  describe('enum', () => {
    it('converts string enum', () => {
      const schema = jsonPropToZod({ enum: ['a', 'b', 'c'] })
      expect(schema.safeParse('a').success).toBe(true)
      expect(schema.safeParse('d').success).toBe(false)
    })
  })

  describe('oneOf / anyOf (union types)', () => {
    it('converts oneOf with object variants (the Craft destination case)', () => {
      const schema = jsonPropToZod({
        oneOf: [
          {
            type: 'object',
            properties: { destination: { type: 'string', enum: ['unsorted', 'templates'] } },
            required: ['destination'],
          },
          {
            type: 'object',
            properties: { folderId: { type: 'string' } },
            required: ['folderId'],
          },
        ],
      })
      // Both variants should be accepted
      expect(schema.safeParse({ destination: 'unsorted' }).success).toBe(true)
      expect(schema.safeParse({ folderId: 'abc-123' }).success).toBe(true)
      // Invalid variant should fail
      expect(schema.safeParse({ invalid: true }).success).toBe(false)
    })

    it('converts anyOf with mixed types', () => {
      const schema = jsonPropToZod({
        anyOf: [
          { type: 'string' },
          { type: 'number' },
        ],
      })
      expect(schema.safeParse('hello').success).toBe(true)
      expect(schema.safeParse(42).success).toBe(true)
      expect(schema.safeParse(true).success).toBe(false)
    })

    it('unwraps single-variant oneOf', () => {
      const schema = jsonPropToZod({
        oneOf: [{ type: 'string' }],
      })
      expect(schema.safeParse('hello').success).toBe(true)
      expect(schema.safeParse(42).success).toBe(false)
    })
  })

  describe('allOf (merged objects)', () => {
    it('merges allOf into a single object', () => {
      const schema = jsonPropToZod({
        allOf: [
          { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
          { type: 'object', properties: { age: { type: 'number' } } },
        ],
      })
      expect(schema.safeParse({ name: 'Alice', age: 30 }).success).toBe(true)
      expect(schema.safeParse({ age: 30 }).success).toBe(false) // name is required
    })
  })

  describe('nested objects', () => {
    it('converts object with properties into z.object', () => {
      const schema = jsonPropToZod({
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'number' },
        },
        required: ['name'],
      })
      expect(schema.safeParse({ name: 'test' }).success).toBe(true)
      expect(schema.safeParse({ name: 'test', count: 5 }).success).toBe(true)
      expect(schema.safeParse({}).success).toBe(false) // name is required
    })

    it('falls back to z.record for object without properties', () => {
      const schema = jsonPropToZod({ type: 'object' })
      expect(schema.safeParse({ anything: 'goes' }).success).toBe(true)
    })
  })

  describe('typed arrays', () => {
    it('converts array with typed items', () => {
      const schema = jsonPropToZod({
        type: 'array',
        items: { type: 'string' },
      })
      expect(schema.safeParse(['a', 'b']).success).toBe(true)
      expect(schema.safeParse([1, 2]).success).toBe(false)
    })

    it('falls back to z.unknown items when no items schema', () => {
      const schema = jsonPropToZod({ type: 'array' })
      expect(schema.safeParse([1, 'mixed', true]).success).toBe(true)
    })
  })

  describe('descriptions', () => {
    it('preserves description on primitives', () => {
      const schema = jsonPropToZod({ type: 'string', description: 'A file path' })
      expect(schema.description).toBe('A file path')
    })

    it('preserves description on union types', () => {
      const schema = jsonPropToZod({
        description: 'Target location',
        oneOf: [
          { type: 'string' },
          { type: 'number' },
        ],
      })
      expect(schema.description).toBe('Target location')
    })

    it('preserves description on nested objects', () => {
      const schema = jsonPropToZod({
        type: 'object',
        description: 'Destination config',
        properties: { id: { type: 'string' } },
      })
      expect(schema.description).toBe('Destination config')
    })
  })

  describe('depth guard', () => {
    it('returns z.unknown at max depth', () => {
      // Build a deeply nested schema (6 levels of oneOf wrapping)
      let schema: any = { type: 'string' }
      for (let i = 0; i < 6; i++) {
        schema = { oneOf: [schema] }
      }
      // Should not throw — just returns z.unknown at depth limit
      const zod = jsonPropToZod(schema)
      expect(zod.safeParse('anything').success).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('handles null/undefined prop gracefully', () => {
      expect(jsonPropToZod(null).safeParse('anything').success).toBe(true)
      expect(jsonPropToZod(undefined).safeParse('anything').success).toBe(true)
    })

    it('handles unknown type string', () => {
      const schema = jsonPropToZod({ type: 'foobar' })
      expect(schema.safeParse('anything').success).toBe(true) // z.unknown
    })

    it('handles empty oneOf array', () => {
      const schema = jsonPropToZod({ oneOf: [] })
      // Falls through to default since empty array is falsy for length check
      expect(schema.safeParse('anything').success).toBe(true)
    })
  })
})
