import { describe, expect, test } from 'bun:test'
import { parseChartPreviewSpec } from '../chart-preview'

describe('parseChartPreviewSpec', () => {
  test('parses RunnerOS chart JSON', () => {
    const result = parseChartPreviewSpec(JSON.stringify({
      type: 'bar',
      title: 'Revenue',
      data: [
        { label: 'Jan', value: 12 },
        { label: 'Feb', value: 18 },
      ],
    }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.spec.type).toBe('bar')
      expect(result.spec.data).toEqual([
        { label: 'Jan', value: 12 },
        { label: 'Feb', value: 18 },
      ])
    }
  })

  test('parses simple Vega-Lite values', () => {
    const result = parseChartPreviewSpec(JSON.stringify({
      mark: 'line',
      encoding: {
        x: { field: 'month' },
        y: { field: 'sales' },
      },
      data: {
        values: [
          { month: 'Jan', sales: 4 },
          { month: 'Feb', sales: 9 },
        ],
      },
    }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.spec.type).toBe('line')
      expect(result.spec.xLabel).toBe('month')
      expect(result.spec.yLabel).toBe('sales')
      expect(result.spec.data).toEqual([
        { label: 'Jan', value: 4 },
        { label: 'Feb', value: 9 },
      ])
    }
  })

  test('rejects unsupported specs', () => {
    const result = parseChartPreviewSpec('{"hello":"world"}')
    expect(result.ok).toBe(false)
  })
})
