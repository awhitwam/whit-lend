/**
 * Date Utilities for Edge Functions
 * Ported from src/lib/schedule/utils/dateUtils.js
 *
 * Pure date manipulation functions without external dependencies.
 */

/**
 * Add months to a date
 *
 * @param date - Starting date
 * @param months - Number of months to add
 * @returns New date with months added
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Add weeks to a date
 *
 * @param date - Starting date
 * @param weeks - Number of weeks to add
 * @returns New date with weeks added
 */
export function addWeeks(date: Date, weeks: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + weeks * 7);
  return result;
}

/**
 * Add days to a date
 *
 * @param date - Starting date
 * @param days - Number of days to add
 * @returns New date with days added
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Calculate the difference in days between two dates
 *
 * @param dateLeft - First date
 * @param dateRight - Second date
 * @returns Number of days difference (can be negative)
 */
export function differenceInDays(dateLeft: Date, dateRight: Date): number {
  const left = new Date(dateLeft);
  left.setHours(0, 0, 0, 0);
  const right = new Date(dateRight);
  right.setHours(0, 0, 0, 0);
  return Math.round((left.getTime() - right.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Advance a date by a number of periods
 *
 * @param date - Starting date
 * @param period - 'Monthly', 'Weekly', or 'Daily'
 * @param count - Number of periods to advance
 * @returns New date advanced by the specified periods
 */
export function advancePeriod(date: Date, period: string, count: number): Date {
  const result = new Date(date);
  switch (period) {
    case 'Monthly':
      result.setMonth(result.getMonth() + count);
      break;
    case 'Weekly':
      result.setDate(result.getDate() + count * 7);
      break;
    case 'Daily':
      result.setDate(result.getDate() + count);
      break;
    default:
      // Default to monthly
      result.setMonth(result.getMonth() + count);
  }
  return result;
}

/**
 * Get the number of periods per year for a given period type
 *
 * @param period - 'Monthly', 'Weekly', or 'Daily'
 * @returns Number of periods in a year
 */
export function getPeriodsPerYear(period: string): number {
  switch (period) {
    case 'Monthly':
      return 12;
    case 'Weekly':
      return 52;
    case 'Daily':
      return 365;
    default:
      return 12;
  }
}

/**
 * Get approximate days in a period
 *
 * @param period - 'Monthly', 'Weekly', or 'Daily'
 * @returns Approximate number of days in the period
 */
export function getDaysInPeriod(period: string): number {
  switch (period) {
    case 'Monthly':
      return 30.44; // Average days per month
    case 'Weekly':
      return 7;
    case 'Daily':
      return 1;
    default:
      return 30.44;
  }
}

/**
 * Format a date as ISO date string (YYYY-MM-DD)
 *
 * @param date - Date to format
 * @returns ISO date string
 */
export function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Normalize a date to start of day (midnight)
 *
 * @param date - Date to normalize
 * @returns New date set to start of day
 */
export function normalizeDate(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get the start of the month for a date
 *
 * @param date - Date to get start of month for
 * @returns New date set to first day of the month
 */
export function startOfMonth(date: Date): Date {
  const result = new Date(date);
  result.setDate(1);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get the first day of the next month
 *
 * @param date - Date to calculate from
 * @returns First day of the following month
 */
export function getFirstOfNextMonth(date: Date): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + 1);
  result.setDate(1);
  result.setHours(0, 0, 0, 0);
  return result;
}
