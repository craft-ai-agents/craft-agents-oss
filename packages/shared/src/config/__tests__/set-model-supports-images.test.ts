import { describe, expect, it } from 'bun:test'
import {
  setModelSupportsImages,
  type LlmConnection,
} from '../llm-connections.ts'

const BASE: LlmConnection = {
  slug: 'custom',
  name: 'Custom Endpoint',
  providerType: 'pi_compat',
  authType: 'api_key_with_endpoint',
  baseUrl: 'http://localhost:8080',
  customEndpoint: { api: 'openai-completions' },
  createdAt: 1,
}

describe('setModelSupportsImages', () => {
  it('promotes a string entry to an object with supportsImages set (and name/shortName mirroring id)', () => {
    const conn: LlmConnection = { ...BASE, models: ['foo', 'bar'] }
    const updated = setModelSupportsImages(conn, 'foo', true)

    expect(updated).not.toBe(conn)
    // name/shortName are mirrored from id so renderer surfaces that read
    // `model.name` (the trigger button, picker row labels) keep showing a
    // label after the toggle flips a string entry into an object.
    expect(updated.models![0]).toEqual({
      id: 'foo',
      name: 'foo',
      shortName: 'foo',
      supportsImages: true,
    } as never)
    expect(updated.models![1]).toBe('bar')
  })

  it('updates supportsImages on an object entry without one', () => {
    const conn: LlmConnection = {
      ...BASE,
      models: [{ id: 'foo', contextWindow: 200_000 } as never],
    }
    const updated = setModelSupportsImages(conn, 'foo', true)

    expect(updated.models![0]).toEqual({
      id: 'foo',
      contextWindow: 200_000,
      supportsImages: true,
    } as never)
  })

  it('overwrites supportsImages on an object entry that already has it', () => {
    const conn: LlmConnection = {
      ...BASE,
      models: [{ id: 'foo', supportsImages: true } as never],
    }
    const updated = setModelSupportsImages(conn, 'foo', false)

    expect(updated.models![0]).toEqual({ id: 'foo', supportsImages: false } as never)
  })

  it('returns the connection unchanged when modelId is not in models[]', () => {
    const conn: LlmConnection = { ...BASE, models: ['foo'] }
    const updated = setModelSupportsImages(conn, 'missing', true)

    expect(updated).toBe(conn)
  })

  it('returns the connection unchanged when models is undefined', () => {
    const conn: LlmConnection = { ...BASE }
    const updated = setModelSupportsImages(conn, 'foo', true)

    expect(updated).toBe(conn)
  })

  it('only updates the first matching entry when duplicates exist', () => {
    const conn: LlmConnection = {
      ...BASE,
      models: ['foo', 'foo'],
    }
    const updated = setModelSupportsImages(conn, 'foo', true)

    expect(updated.models![0]).toEqual({
      id: 'foo',
      name: 'foo',
      shortName: 'foo',
      supportsImages: true,
    } as never)
    expect(updated.models![1]).toBe('foo')
  })

  it('does not mutate the input connection or its models array', () => {
    const conn: LlmConnection = { ...BASE, models: ['foo'] }
    const before = JSON.stringify(conn)
    setModelSupportsImages(conn, 'foo', true)
    expect(JSON.stringify(conn)).toBe(before)
  })
})
