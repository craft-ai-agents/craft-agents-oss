// Lightweight Cron Parser
//
// No external dependencies. Supports:
// - "08:00"            — daily at 8:00 AM
// - "weekdays 08:00"   — Mon-Fri at 8:00 AM
// - "weekends 10:00"   — Sat-Sun at 10:00 AM
// - "*/2h"             — every 2 hours
// - Standard 5-field:  "0 8 * * 1-5" (min hour dom month dow)

export interface ParsedSchedule {
  type: 'daily' | 'weekdays' | 'weekends' | 'interval' | 'cron';
  /** For daily/weekdays/weekends: hour (0-23) */
  hour?: number;
  /** For daily/weekdays/weekends: minute (0-59) */
  minute?: number;
  /** For interval: interval in milliseconds */
  intervalMs?: number;
  /** For cron: parsed 5-field cron */
  cron?: ParsedCron;
}

interface ParsedCron {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

/**
 * Parse a schedule expression.
 * Throws on invalid input.
 */
export function parseSchedule(schedule: string): ParsedSchedule {
  const s = schedule.trim();

  // Interval: "*/2h", "*/30m"
  const intervalMatch = s.match(/^\*\/(\d+)([hm])$/);
  if (intervalMatch) {
    const value = parseInt(intervalMatch[1]!, 10);
    const unit = intervalMatch[2]!;
    if (value <= 0) throw new Error(`Invalid interval value: ${value}`);
    const intervalMs = unit === 'h' ? value * 60 * 60 * 1000 : value * 60 * 1000;
    return { type: 'interval', intervalMs };
  }

  // Time-based: "HH:MM", "weekdays HH:MM", "weekends HH:MM"
  const timeMatch = s.match(/^(?:(weekdays|weekends)\s+)?(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const prefix = timeMatch[1] as 'weekdays' | 'weekends' | undefined;
    const hour = parseInt(timeMatch[2]!, 10);
    const minute = parseInt(timeMatch[3]!, 10);
    if (hour < 0 || hour > 23) throw new Error(`Invalid hour: ${hour}`);
    if (minute < 0 || minute > 59) throw new Error(`Invalid minute: ${minute}`);
    const type = prefix ?? 'daily';
    return { type, hour, minute };
  }

  // Standard 5-field cron: "min hour dom month dow"
  const parts = s.split(/\s+/);
  if (parts.length === 5) {
    const cron = parseCronFields(parts);
    return { type: 'cron', cron };
  }

  throw new Error(`Invalid schedule: "${schedule}"`);
}

/**
 * Get the next run time after a given date.
 */
export function getNextRun(schedule: string, after: Date = new Date()): Date {
  const parsed = parseSchedule(schedule);

  switch (parsed.type) {
    case 'interval': {
      return new Date(after.getTime() + parsed.intervalMs!);
    }
    case 'daily': {
      return getNextTimeForDays(parsed.hour!, parsed.minute!, after, [0, 1, 2, 3, 4, 5, 6]);
    }
    case 'weekdays': {
      return getNextTimeForDays(parsed.hour!, parsed.minute!, after, [1, 2, 3, 4, 5]);
    }
    case 'weekends': {
      return getNextTimeForDays(parsed.hour!, parsed.minute!, after, [0, 6]);
    }
    case 'cron': {
      return getNextCronRun(parsed.cron!, after);
    }
  }
}

/**
 * Check if a job should run now (for missed-job detection on app launch).
 */
export function shouldRunNow(
  schedule: string,
  lastRunAt?: number,
  graceWindowMs: number = 2 * 60 * 60 * 1000 // 2 hours default
): boolean {
  const now = Date.now();

  if (!lastRunAt) {
    // Never run before — check if we're within grace window of the most recent scheduled time
    const prevRun = getPreviousRun(schedule, new Date());
    if (!prevRun) return false;
    return (now - prevRun.getTime()) <= graceWindowMs;
  }

  // Check if a scheduled run was missed between lastRunAt and now
  const nextAfterLast = getNextRun(schedule, new Date(lastRunAt));
  if (nextAfterLast.getTime() <= now) {
    // A run was missed — check if it's within grace window
    return (now - nextAfterLast.getTime()) <= graceWindowMs;
  }

  return false;
}

/**
 * Human-readable description of a schedule.
 */
export function describeSchedule(schedule: string): string {
  try {
    const parsed = parseSchedule(schedule);
    const pad = (n: number) => String(n).padStart(2, '0');

    switch (parsed.type) {
      case 'daily':
        return `Every day at ${pad(parsed.hour!)}:${pad(parsed.minute!)}`;
      case 'weekdays':
        return `Weekdays at ${pad(parsed.hour!)}:${pad(parsed.minute!)}`;
      case 'weekends':
        return `Weekends at ${pad(parsed.hour!)}:${pad(parsed.minute!)}`;
      case 'interval': {
        const ms = parsed.intervalMs!;
        if (ms >= 60 * 60 * 1000) {
          const hours = ms / (60 * 60 * 1000);
          return `Every ${hours} hour${hours === 1 ? '' : 's'}`;
        }
        const minutes = ms / (60 * 1000);
        return `Every ${minutes} minute${minutes === 1 ? '' : 's'}`;
      }
      case 'cron':
        return `Cron: ${schedule}`;
    }
  } catch {
    return schedule;
  }
}

// ============================================
// Internal helpers
// ============================================

function getNextTimeForDays(hour: number, minute: number, after: Date, validDays: number[]): Date {
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);

  // Try today first
  candidate.setHours(hour, minute, 0, 0);
  if (candidate.getTime() > after.getTime() && validDays.includes(candidate.getDay())) {
    return candidate;
  }

  // Search up to 8 days ahead
  for (let i = 1; i <= 8; i++) {
    const next = new Date(after);
    next.setDate(next.getDate() + i);
    next.setHours(hour, minute, 0, 0);
    if (validDays.includes(next.getDay())) {
      return next;
    }
  }

  // Should never happen with valid day sets
  throw new Error('Could not find next run date');
}

function getPreviousRun(schedule: string, before: Date): Date | null {
  const parsed = parseSchedule(schedule);

  switch (parsed.type) {
    case 'interval': {
      return new Date(before.getTime() - parsed.intervalMs!);
    }
    case 'daily':
    case 'weekdays':
    case 'weekends': {
      const validDays = parsed.type === 'weekdays' ? [1, 2, 3, 4, 5]
        : parsed.type === 'weekends' ? [0, 6]
        : [0, 1, 2, 3, 4, 5, 6];

      // Check today
      const today = new Date(before);
      today.setHours(parsed.hour!, parsed.minute!, 0, 0);
      if (today.getTime() < before.getTime() && validDays.includes(today.getDay())) {
        return today;
      }

      // Search backwards
      for (let i = 1; i <= 8; i++) {
        const prev = new Date(before);
        prev.setDate(prev.getDate() - i);
        prev.setHours(parsed.hour!, parsed.minute!, 0, 0);
        if (validDays.includes(prev.getDay())) {
          return prev;
        }
      }
      return null;
    }
    case 'cron': {
      // For cron, search backwards minute-by-minute up to 48 hours
      const limit = 48 * 60;
      for (let i = 1; i <= limit; i++) {
        const candidate = new Date(before.getTime() - i * 60 * 1000);
        candidate.setSeconds(0, 0);
        if (cronMatchesDate(parsed.cron!, candidate)) {
          return candidate;
        }
      }
      return null;
    }
  }
}

function getNextCronRun(cron: ParsedCron, after: Date): Date {
  // Search forward minute-by-minute, up to 366 days
  const limit = 366 * 24 * 60;
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  // Start from the next minute
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let i = 0; i < limit; i++) {
    if (cronMatchesDate(cron, candidate)) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error('Could not find next cron run within 366 days');
}

function cronMatchesDate(cron: ParsedCron, date: Date): boolean {
  return (
    cron.minutes.includes(date.getMinutes()) &&
    cron.hours.includes(date.getHours()) &&
    cron.daysOfMonth.includes(date.getDate()) &&
    cron.months.includes(date.getMonth() + 1) &&
    cron.daysOfWeek.includes(date.getDay())
  );
}

function parseCronFields(parts: string[]): ParsedCron {
  return {
    minutes: parseCronField(parts[0]!, 0, 59),
    hours: parseCronField(parts[1]!, 0, 23),
    daysOfMonth: parseCronField(parts[2]!, 1, 31),
    months: parseCronField(parts[3]!, 1, 12),
    daysOfWeek: parseCronField(parts[4]!, 0, 6),
  };
}

function parseCronField(field: string, min: number, max: number): number[] {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    // Handle */N (step from min)
    const stepAll = part.match(/^\*\/(\d+)$/);
    if (stepAll) {
      const step = parseInt(stepAll[1]!, 10);
      for (let i = min; i <= max; i += step) values.add(i);
      continue;
    }

    // Handle * (wildcard)
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }

    // Handle N-M (range) with optional /step
    const rangeMatch = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]!, 10);
      const end = parseInt(rangeMatch[2]!, 10);
      const step = rangeMatch[3] ? parseInt(rangeMatch[3], 10) : 1;
      if (start < min || end > max || start > end) {
        throw new Error(`Invalid cron range: ${part}`);
      }
      for (let i = start; i <= end; i += step) values.add(i);
      continue;
    }

    // Handle single number
    const num = parseInt(part, 10);
    if (isNaN(num) || num < min || num > max) {
      throw new Error(`Invalid cron value: ${part} (expected ${min}-${max})`);
    }
    values.add(num);
  }

  if (values.size === 0) throw new Error(`Empty cron field: ${field}`);
  return [...values].sort((a, b) => a - b);
}
