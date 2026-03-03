import { describe, expect, it } from 'bun:test'
import {
  buildPanelHeaderClassName,
  resolveLeadingActionClassName,
  STOPLIGHT_PADDING,
} from '../panel-header-utils'

describe('PanelHeader helpers', () => {
  describe('buildPanelHeaderClassName', () => {
    it('includes static pl-1 padding class', () => {
      const result = buildPanelHeaderClassName()
      expect(result).toContain('pl-1')
    })

    it('does not include animated padding classes like pl-4', () => {
      const result = buildPanelHeaderClassName()
      expect(result).not.toContain('pl-4')
    })

    it('includes required layout classes', () => {
      const result = buildPanelHeaderClassName()
      expect(result).toContain('flex')
      expect(result).toContain('shrink-0')
      expect(result).toContain('items-center')
      expect(result).toContain('pr-2')
      expect(result).toContain('h-[42px]')
    })

    it('appends custom className when provided', () => {
      const result = buildPanelHeaderClassName('my-custom-class')
      expect(result).toContain('my-custom-class')
      expect(result).toContain('pl-1')
    })

    it('returns base classes when className is undefined', () => {
      const result = buildPanelHeaderClassName(undefined)
      expect(result).toContain('pl-1')
      expect(result).toContain('flex')
    })
  })

  describe('resolveLeadingActionClassName', () => {
    it('adds invisible class when sidebar is visible', () => {
      const result = resolveLeadingActionClassName('rounded-[8px]', true)
      expect(result).toContain('invisible')
      expect(result).toContain('rounded-[8px]')
    })

    it('does not add invisible class when sidebar is hidden', () => {
      const result = resolveLeadingActionClassName('rounded-[8px]', false)
      expect(result).not.toContain('invisible')
      expect(result).toContain('rounded-[8px]')
    })

    it('preserves base className in both states', () => {
      const visibleResult = resolveLeadingActionClassName('btn-primary', true)
      const hiddenResult = resolveLeadingActionClassName('btn-primary', false)
      expect(visibleResult).toContain('btn-primary')
      expect(hiddenResult).toContain('btn-primary')
    })
  })

  describe('STOPLIGHT_PADDING', () => {
    it('is defined as a positive number', () => {
      expect(STOPLIGHT_PADDING).toBeGreaterThan(0)
    })

    it('equals 84 for macOS traffic lights compensation', () => {
      expect(STOPLIGHT_PADDING).toBe(84)
    })
  })
})
