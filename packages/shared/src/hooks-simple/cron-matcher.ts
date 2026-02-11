/**
 * Cron Matcher
 *
 * Evaluates cron expressions for SchedulerTick events.
 * Uses the `croner` library for accurate timezone-aware cron matching.
 */

import { Cron } from 'croner';

/**
 * Check if a cron expression matches a given date/time.
 * Compares the date's minute against the most recent scheduled run.
 *
 * @param cronExpr - Cron expression (5-field standard or extended)
 * @param date - Date to test against
 * @param timezone - IANA timezone (e.g., "America/Sao_Paulo"). Defaults to system timezone.
 * @returns true if the cron expression would fire at the given date
 */
export function cronMatchesNow(
  cronExpr: string,
  date: Date = new Date(),
  timezone?: string,
): boolean {
  try {
    const job = new Cron(cronExpr, {
      timezone: timezone || undefined,
    });

    // Get the most recent previous run(s) near the target date
    // Since previousRuns takes a reference date, use it to check around our target
    const runs = job.previousRuns(1, date);
    const dateMinute = new Date(date);
    dateMinute.setSeconds(0, 0);
    const dateMinuteMs = dateMinute.getTime();

    // Check if a previous run matches the same minute
    for (const run of runs) {
      const runMinute = new Date(run);
      runMinute.setSeconds(0, 0);
      if (runMinute.getTime() === dateMinuteMs) {
        return true;
      }
    }

    // Also check next run in case we're exactly at the boundary
    const next = job.nextRun(date);
    if (next) {
      const nextMinute = new Date(next);
      nextMinute.setSeconds(0, 0);
      if (nextMinute.getTime() === dateMinuteMs) {
        return true;
      }
    }

    return false;
  } catch {
    // Invalid cron expression
    return false;
  }
}

/**
 * Validate a cron expression.
 * Returns null if valid, error message if invalid.
 */
export function validateCronExpression(cronExpr: string): string | null {
  try {
    new Cron(cronExpr);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid cron expression';
  }
}

/**
 * Get the next run time for a cron expression.
 */
export function getNextCronRun(cronExpr: string, after?: Date, timezone?: string): Date | null {
  try {
    const job = new Cron(cronExpr, {
      timezone: timezone || undefined,
    });
    const next = job.nextRun(after || new Date());
    return next;
  } catch {
    return null;
  }
}
