import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_BUILTIN_STATUS_PALETTE,
  DEFAULT_STATUS_COLORS,
  getDefaultStatusColor,
} from './defaults.ts'

describe('built-in status palette', () => {
  it('defines the canonical neutral, blue, and orange Kanban semantics', () => {
    expect(DEFAULT_BUILTIN_STATUS_PALETTE).toEqual({
      backlog: { light: '#94a3b8', dark: '#cbd5e1' },
      todo: { light: '#3b82f6', dark: '#60a5fa' },
      'in-progress': { light: '#3b82f6', dark: '#60a5fa' },
      'needs-review': { light: '#f59e0b', dark: '#fbbf24' },
      done: { light: '#10b981', dark: '#34d399' },
    })
  })

  it('resolves built-ins from the palette and preserves the unknown fallback', () => {
    expect(getDefaultStatusColor('in-progress')).toBe(
      DEFAULT_BUILTIN_STATUS_PALETTE['in-progress'],
    )
    expect(DEFAULT_STATUS_COLORS['needs-review']).toBe(
      DEFAULT_BUILTIN_STATUS_PALETTE['needs-review'],
    )
    expect(getDefaultStatusColor('custom-status')).toBe('foreground/50')
  })
})
