import { describe, expect, test } from 'bun:test'
import { parseDelimitedTablePreview } from '../table-preview'

describe('parseDelimitedTablePreview', () => {
  test('parses quoted CSV cells', () => {
    const table = parseDelimitedTablePreview('name,notes\nMia,"hello, world"\nLee,"quote ""inside"""', 'data.csv', 'text/csv')
    expect(table.delimiter).toBe(',')
    expect(table.rows).toEqual([
      ['name', 'notes'],
      ['Mia', 'hello, world'],
      ['Lee', 'quote "inside"'],
    ])
  })

  test('parses TSV from extension', () => {
    const table = parseDelimitedTablePreview('name\tscore\nMia\t9', 'scores.tsv', undefined)
    expect(table.delimiter).toBe('\t')
    expect(table.rows).toEqual([
      ['name', 'score'],
      ['Mia', '9'],
    ])
  })

  test('truncates huge tables for preview', () => {
    const content = ['a,b', ...Array.from({ length: 250 }, (_, index) => `${index},${index + 1}`)].join('\n')
    const table = parseDelimitedTablePreview(content, 'large.csv', 'text/csv')
    expect(table.rows).toHaveLength(200)
    expect(table.truncated).toBe(true)
  })
})
