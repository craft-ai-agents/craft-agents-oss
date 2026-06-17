import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import type { Example } from '@arizeai/phoenix-client/types/datasets'
import type { AssertionType, EvalAssertion, EvalCase, EvalTaskExpected, EvalTaskInput } from './types'

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid eval case: ${field} must be a non-empty string`)
  }
  return value
}

function parseCase(raw: unknown, index: number): EvalCase {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid eval case at index ${index}: expected object`)
  }
  const item = raw as Record<string, unknown>
  const assertions: EvalAssertion[] = Array.isArray(item.assertions)
    ? item.assertions.map((assertion, assertionIndex) => {
        if (!assertion || typeof assertion !== 'object') {
          throw new Error(`Invalid assertion ${assertionIndex} in case ${index}`)
        }
        const a = assertion as Record<string, unknown>
        const type: AssertionType = a.type === 'code' || a.type === 'manual' || a.type === 'llm' ? a.type : 'manual'
        return {
          type,
          criterion: assertString(a.criterion, `assertions[${assertionIndex}].criterion`),
        }
      })
    : []

  if (assertions.length === 0) {
    throw new Error(`Invalid eval case ${item.id ?? index}: assertions must not be empty`)
  }

  return {
    id: assertString(item.id, 'id'),
    name: assertString(item.name, 'name'),
    category: typeof item.category === 'string' ? item.category : undefined,
    input: assertString(item.input, 'input'),
    context: typeof item.context === 'string' ? item.context : undefined,
    skillSlugs: Array.isArray(item.skillSlugs) ? item.skillSlugs.filter((v): v is string => typeof v === 'string') : undefined,
    metadata: item.metadata && typeof item.metadata === 'object'
      ? item.metadata as Record<string, unknown>
      : undefined,
    expected: item.expected && typeof item.expected === 'object'
      ? item.expected as EvalCase['expected']
      : undefined,
    assertions,
  }
}

export function loadEvalCases(caseFile: string, filter?: string, limit?: number): EvalCase[] {
  const absolute = resolve(caseFile)
  const parsed = load(readFileSync(absolute, 'utf8'))
  if (!Array.isArray(parsed)) {
    throw new Error(`Eval case file must contain a YAML array: ${absolute}`)
  }

  let cases = parsed.map(parseCase)
  if (filter) {
    cases = cases.filter((c) => c.id.includes(filter) || c.name.includes(filter) || c.category?.includes(filter))
  }
  if (limit && limit > 0) {
    cases = cases.slice(0, limit)
  }
  return cases
}

export function casesToPhoenixExamples(cases: EvalCase[]): Example[] {
  return cases.map((testCase) => {
    const input: EvalTaskInput = {
      id: testCase.id,
      name: testCase.name,
      message: testCase.input,
      context: testCase.context,
      skillSlugs: testCase.skillSlugs,
    }
    const output: EvalTaskExpected = {
      ...testCase.expected,
      assertions: testCase.assertions,
    }
    return {
      id: testCase.id,
      input: input as unknown as Record<string, unknown>,
      output: output as unknown as Record<string, unknown>,
      metadata: {
        id: testCase.id,
        name: testCase.name,
        category: testCase.category ?? 'uncategorized',
        ...(testCase.metadata ?? {}),
      },
    }
  })
}
