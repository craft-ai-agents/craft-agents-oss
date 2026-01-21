/**
 * Test suite for i18n date formatting utilities
 *
 * Run with: bun test src/renderer/lib/__tests__/i18n-dates.test.ts
 */

import { describe, it, expect } from 'bun:test'
import {
  formatDate,
  formatDateTime,
  formatTime,
  formatRelativeTime,
  formatShortDate,
  formatMonthYear,
  is24HourFormat,
  type Language,
} from '../i18n-dates'

describe('i18n-dates', () => {
  describe('formatDate', () => {
    it('should format today in English', () => {
      const today = new Date()
      expect(formatDate(today, 'en')).toBe('Today')
    })

    it('should format today in Chinese', () => {
      const today = new Date()
      expect(formatDate(today, 'zh')).toBe('今天')
    })

    it('should format yesterday in English', () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      expect(formatDate(yesterday, 'en')).toBe('Yesterday')
    })

    it('should format yesterday in Chinese', () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      expect(formatDate(yesterday, 'zh')).toBe('昨天')
    })

    it('should format a regular date in English (Month Day, Year)', () => {
      const date = new Date('2026-02-15T10:30:00')
      const result = formatDate(date, 'en')
      // Should be something like "February 15, 2026"
      expect(result).toContain('2026')
      expect(result).toContain('February')
    })

    it('should format a regular date in Chinese (Year Month Day)', () => {
      const date = new Date('2026-02-15T10:30:00')
      const result = formatDate(date, 'zh')
      // Should be something like "2026年2月15日"
      expect(result).toMatch(/\d{4}年.*月.*日/)
    })
  })

  describe('formatDateTime', () => {
    it('should format date and time in English with 12-hour format', () => {
      const date = new Date('2026-01-21T15:30:00')
      const result = formatDateTime(date, 'en')
      expect(result).toMatch(/.*(PM|AM)/) // Should have AM/PM
    })

    it('should format date and time in Chinese with 24-hour format', () => {
      const date = new Date('2026-01-21T15:30:00')
      const result = formatDateTime(date, 'zh')
      expect(result).toContain('15:30') // 24-hour format
    })
  })

  describe('formatTime', () => {
    it('should format time in English with 12-hour format', () => {
      const date = new Date('2026-01-21T15:30:00')
      const result = formatTime(date, 'en')
      expect(result).toMatch(/.*(PM|AM)/)
    })

    it('should format time in Chinese with 24-hour format', () => {
      const date = new Date('2026-01-21T15:30:00')
      const result = formatTime(date, 'zh')
      expect(result).toBe('15:30')
    })
  })

  describe('formatRelativeTime', () => {
    it('should format seconds ago in English', () => {
      const date = new Date()
      date.setSeconds(date.getSeconds() - 30)
      const result = formatRelativeTime(date, 'en')
      expect(result).toContain('second')
    })

    it('should format seconds ago in Chinese', () => {
      const date = new Date()
      date.setSeconds(date.getSeconds() - 30)
      const result = formatRelativeTime(date, 'zh')
      expect(result).toContain('秒')
    })

    it('should format minutes ago in English', () => {
      const date = new Date()
      date.setMinutes(date.getMinutes() - 5)
      const result = formatRelativeTime(date, 'en')
      expect(result).toContain('5')
      expect(result).toContain('minute')
    })

    it('should format minutes ago in Chinese', () => {
      const date = new Date()
      date.setMinutes(date.getMinutes() - 5)
      const result = formatRelativeTime(date, 'zh')
      expect(result).toContain('5分钟')
    })

    it('should format hours ago in English', () => {
      const date = new Date()
      date.setHours(date.getHours() - 2)
      const result = formatRelativeTime(date, 'en')
      expect(result).toContain('2')
      expect(result).toContain('hour')
    })

    it('should format hours ago in Chinese', () => {
      const date = new Date()
      date.setHours(date.getHours() - 2)
      const result = formatRelativeTime(date, 'zh')
      expect(result).toContain('2小时')
    })

    it('should format days ago in English', () => {
      const date = new Date()
      date.setDate(date.getDate() - 3)
      const result = formatRelativeTime(date, 'en')
      expect(result).toContain('3')
      expect(result).toContain('day')
    })

    it('should format days ago in Chinese', () => {
      const date = new Date()
      date.setDate(date.getDate() - 3)
      const result = formatRelativeTime(date, 'zh')
      expect(result).toContain('3天')
    })
  })

  describe('formatShortDate', () => {
    it('should format short date in English', () => {
      const date = new Date('2026-01-21')
      const result = formatShortDate(date, 'en')
      expect(result).toContain('2026')
      expect(result).toContain('Jan')
    })

    it('should format short date in Chinese', () => {
      const date = new Date('2026-01-21')
      const result = formatShortDate(date, 'zh')
      expect(result).toMatch(/\d{4}年.*月.*日/)
    })
  })

  describe('formatMonthYear', () => {
    it('should format month and year in English', () => {
      const date = new Date('2026-01-21')
      const result = formatMonthYear(date, 'en')
      expect(result).toContain('January')
      expect(result).toContain('2026')
    })

    it('should format month and year in Chinese', () => {
      const date = new Date('2026-01-21')
      const result = formatMonthYear(date, 'zh')
      expect(result).toContain('2026年')
      expect(result).toContain('1月')
    })
  })

  describe('is24HourFormat', () => {
    it('should return false for English locale', () => {
      expect(is24HourFormat('en')).toBe(false)
    })

    it('should return true for Chinese locale', () => {
      expect(is24HourFormat('zh')).toBe(true)
    })
  })
})
