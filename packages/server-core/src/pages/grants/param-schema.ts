/**
 * Constrained parameter schemas for page queries (ADR 0001, WS7).
 *
 * A grant declares which parameters a page may vary. That schema is authored by
 * the AGENT, which in this threat model is attacker-influenced: a hostile email
 * can steer what the model writes. Accepting arbitrary JSON Schema would hand a
 * page a parser to attack — `$ref` cycles, `pattern` ReDoS, unbounded nesting.
 *
 * The vocabulary is therefore tiny and closed, and everything is checked at
 * APPROVAL time, before any value is ever evaluated against it.
 */

export type ParamSpec =
  | { type: 'string'; maxLength: number }
  | { type: 'integer'; minimum: number; maximum: number }
  | { type: 'boolean' }
  | { type: 'enum'; values: string[] }

export type ParamSchema = Record<string, ParamSpec>

export type Check = { ok: true } | { ok: false; reason: string }
const no = (reason: string): Check => ({ ok: false, reason })
const yes: Check = { ok: true }

const MAX_PARAMS = 16
const MAX_STRING_LENGTH = 512
const MAX_ENUM_VALUES = 64

/** Plain identifiers only — no dots, dashes, spaces, or prototype keys. */
const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/
const FORBIDDEN_NAMES = new Set(['__proto__', 'constructor', 'prototype'])

function checkName(name: string): Check {
  if (FORBIDDEN_NAMES.has(name)) return no(`parameter name "${name}" is not allowed`)
  if (!NAME_RE.test(name)) return no(`parameter name "${name}" must be a plain identifier`)
  return yes
}

/** Validate a schema before it is stored in a grant. */
export function validateParamSchema(schema: ParamSchema): Check {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return no('parameter schema must be an object')
  }

  const names = Object.keys(schema)
  if (names.length > MAX_PARAMS) {
    return no(`${names.length} parameters; max is ${MAX_PARAMS}`)
  }

  for (const name of names) {
    const nameCheck = checkName(name)
    if (!nameCheck.ok) return nameCheck

    const spec = schema[name] as Record<string, unknown> | undefined
    if (typeof spec !== 'object' || spec === null) return no(`"${name}": spec must be an object`)

    // Anything outside the closed vocabulary is rejected outright, including
    // keys we simply do not implement — silently ignoring `pattern` would let
    // an author believe a constraint is enforced when it is not.
    const allowedKeys: Record<string, string[]> = {
      string: ['type', 'maxLength'],
      integer: ['type', 'minimum', 'maximum'],
      boolean: ['type'],
      enum: ['type', 'values'],
    }
    const type = spec.type
    if (typeof type !== 'string' || !(type in allowedKeys)) {
      return no(`"${name}": type must be one of string, integer, boolean, enum`)
    }
    for (const key of Object.keys(spec)) {
      if (!allowedKeys[type]!.includes(key)) {
        return no(`"${name}": unsupported key "${key}" for type ${type}`)
      }
    }

    if (type === 'string') {
      const max = spec.maxLength
      if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > MAX_STRING_LENGTH) {
        return no(`"${name}": string requires maxLength between 1 and ${MAX_STRING_LENGTH}`)
      }
    }
    if (type === 'integer') {
      const { minimum, maximum } = spec
      if (typeof minimum !== 'number' || typeof maximum !== 'number'
        || !Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum > maximum) {
        return no(`"${name}": integer requires integer minimum <= maximum`)
      }
    }
    if (type === 'enum') {
      const values = spec.values
      if (!Array.isArray(values) || values.length === 0 || values.length > MAX_ENUM_VALUES) {
        return no(`"${name}": enum requires 1..${MAX_ENUM_VALUES} values`)
      }
      if (!values.every(v => typeof v === 'string' && v.length <= MAX_STRING_LENGTH)) {
        return no(`"${name}": enum values must be short strings`)
      }
    }
  }

  return yes
}

/** Validate the values a page actually sent against its grant's schema. */
export function validateParams(schema: ParamSchema, params: Record<string, unknown>): Check {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return no('params must be an object')
  }

  // Own keys only: a payload parsed from JSON can carry __proto__ as an own
  // property, and it must be rejected rather than walked past.
  for (const name of Object.keys(params)) {
    if (FORBIDDEN_NAMES.has(name)) return no(`parameter "${name}" is not allowed`)

    const spec = Object.prototype.hasOwnProperty.call(schema, name) ? schema[name] : undefined
    if (!spec) {
      // Rejected, never ignored: dropping an unknown key hides a mismatch
      // between what the page asked for and what actually ran.
      return no(`parameter "${name}" is not declared by this query`)
    }

    const value = params[name]
    switch (spec.type) {
      case 'string':
        if (typeof value !== 'string') return no(`"${name}" must be a string`)
        if (value.length > spec.maxLength) return no(`"${name}" exceeds maxLength ${spec.maxLength}`)
        break
      case 'integer':
        if (typeof value !== 'number' || !Number.isInteger(value)) return no(`"${name}" must be an integer`)
        if (value < spec.minimum || value > spec.maximum) {
          return no(`"${name}" must be between ${spec.minimum} and ${spec.maximum}`)
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') return no(`"${name}" must be a boolean`)
        break
      case 'enum':
        if (typeof value !== 'string' || !spec.values.includes(value)) {
          return no(`"${name}" must be one of: ${spec.values.join(', ')}`)
        }
        break
    }
  }

  return yes
}
