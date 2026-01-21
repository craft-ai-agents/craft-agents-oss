/**
 * i18n Date/Time Formatting Utilities
 *
 * Provides localized date/time formatting using Intl API with support for:
 * - English and Chinese locales
 * - Absolute dates (Today, Yesterday, or formatted date)
 * - Relative time (X hours ago, X days ago)
 * - Chinese date format: Year-Month-Day (2026年1月21日)
 * - 24-hour time format for Chinese locale
 */

import type { Language } from '@/i18n'

/**
 * Check if a date is today
 */
function isToday(date: Date): boolean {
  const today = new Date()
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  )
}

/**
 * Check if a date is yesterday
 */
function isYesterday(date: Date): boolean {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  )
}

/**
 * Format a date with locale-appropriate formatting
 *
 * @param date - The date to format
 * @param locale - The locale ('en' or 'zh')
 * @param todayLabel - Localized "Today" label
 * @param yesterdayLabel - Localized "Yesterday" label
 * @returns Formatted date string
 *
 * Examples:
 * - English: "Today", "Yesterday", "January 21, 2026"
 * - Chinese: "今天", "昨天", "2026年1月21日"
 */
export function formatDate(
  date: Date,
  locale: Language,
  todayLabel?: string,
  yesterdayLabel?: string
): string {
  if (isToday(date)) {
    return todayLabel || (locale === 'zh' ? '今天' : 'Today')
  }

  if (isYesterday(date)) {
    return yesterdayLabel || (locale === 'zh' ? '昨天' : 'Yesterday')
  }

  // Use Intl.DateTimeFormat for proper localization
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour12: locale === 'en', // 24-hour format for Chinese
  }).format(date)
}

/**
 * Format a date and time with locale-appropriate formatting
 *
 * @param date - The date to format
 * @param locale - The locale ('en' or 'zh')
 * @returns Formatted date and time string
 *
 * Examples:
 * - English: "January 21, 2026 at 3:45 PM"
 * - Chinese: "2026年1月21日 15:45"
 */
export function formatDateTime(date: Date, locale: Language): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: locale === 'en', // 24-hour format for Chinese
  }).format(date)
}

/**
 * Format time only with locale-appropriate formatting
 *
 * @param date - The date to format
 * @param locale - The locale ('en' or 'zh')
 * @returns Formatted time string
 *
 * Examples:
 * - English: "3:45 PM"
 * - Chinese: "15:45"
 */
export function formatTime(date: Date, locale: Language): string {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: locale === 'en', // 24-hour format for Chinese
  }).format(date)
}

/**
 * Calculate the relative time difference
 *
 * @param date - The date to compare
 * @returns Object with value and unit for relative time
 */
function getTimeDifference(date: Date): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) {
    return { value: -diffSeconds, unit: 'second' }
  } else if (diffMinutes < 60) {
    return { value: -diffMinutes, unit: 'minute' }
  } else if (diffHours < 24) {
    return { value: -diffHours, unit: 'hour' }
  } else {
    return { value: -diffDays, unit: 'day' }
  }
}

/**
 * Format relative time (e.g., "2 hours ago", "3天前")
 *
 * @param date - The date to format
 * @param locale - The locale ('en' or 'zh')
 * @returns Relative time string
 *
 * Examples:
 * - English: "2 hours ago", "3 days ago"
 * - Chinese: "2小时前", "3天前"
 */
export function formatRelativeTime(date: Date, locale: Language): string {
  const diff = getTimeDifference(date)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  return rtf.format(diff.value, diff.unit)
}

/**
 * Format a short date (for compact display)
 *
 * @param date - The date to format
 * @param locale - The locale ('en' or 'zh')
 * @returns Short formatted date string
 *
 * Examples:
 * - English: "Jan 21, 2026"
 * - Chinese: "2026年1月21日"
 */
export function formatShortDate(date: Date, locale: Language): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

/**
 * Format a month and year only
 *
 * @param date - The date to format
 * @param locale - The locale ('en' or 'zh')
 * @returns Month and year string
 *
 * Examples:
 * - English: "January 2026"
 * - Chinese: "2026年1月"
 */
export function formatMonthYear(date: Date, locale: Language): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
  }).format(date)
}

/**
 * Get locale-specific date format options
 *
 * @param locale - The locale ('en' or 'zh')
 * @returns Intl.DateTimeFormat options
 */
export function getDateFormatOptions(locale: Language): Intl.DateTimeFormatOptions {
  return {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour12: locale === 'en',
  }
}

/**
 * Check if a locale uses 24-hour time format
 *
 * @param locale - The locale to check
 * @returns true if locale uses 24-hour format
 */
export function is24HourFormat(locale: Language): boolean {
  return locale !== 'en' // Chinese uses 24-hour format
}
