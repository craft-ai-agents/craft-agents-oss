import { describe, expect, test } from 'bun:test';
import {
  appendOutputSchemaInstruction,
  isValidWorkflowOutputSchema,
  parseStructuredStepOutput,
} from './output-schema.ts';

describe('workflow output schema helpers', () => {
  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      count: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['title', 'count'],
  };

  test('accepts JSON Schema objects with a type', () => {
    expect(isValidWorkflowOutputSchema(schema)).toBe(true);
    expect(isValidWorkflowOutputSchema({ properties: {} })).toBe(false);
    expect(isValidWorkflowOutputSchema(null)).toBe(false);
  });

  test('parses and validates structured output', () => {
    const got = parseStructuredStepOutput(
      '{"title":"Draft","count":3,"tags":["a"]}',
      schema,
    );
    expect(got).toEqual({ ok: true, value: { title: 'Draft', count: 3, tags: ['a'] } });
  });

  test('parses fenced JSON output', () => {
    const got = parseStructuredStepOutput(
      '```json\n{"title":"Draft","count":3}\n```',
      schema,
    );
    expect(got.ok).toBe(true);
  });

  test('rejects invalid JSON and schema mismatches', () => {
    expect(parseStructuredStepOutput('not json', schema)).toMatchObject({ ok: false, code: 'invalid-json' });
    expect(parseStructuredStepOutput('{"title":9}', schema)).toMatchObject({
      ok: false,
      code: 'schema-validation-failed',
    });
  });

  test('appends structured-output instruction to prompts', () => {
    const prompt = appendOutputSchemaInstruction('Do it.', schema);
    expect(prompt).toContain('Return only JSON');
    expect(prompt).toContain('"title"');
  });
});
