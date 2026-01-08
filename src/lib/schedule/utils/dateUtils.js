/**
 * Date Utilities for Schedule Generation
 *
 * Helper functions for working with dates and periods in loan schedules.
 */

import {
  addMonths,
  addWeeks,
  differenceInDays,
  startOfMonth,
  format,
  parseISO
} from 'date-fns';

// Re-export commonly used date-fns functions
export { addMonths, addWeeks, differenceInDays, startOfMonth, format, parseISO };

/**
 * Advance a date by a number of periods
 *
 * @param {Date} date - Starting date
 * @param {string} period - 'Monthly' or 'Weekly'
 * @param {number} count - Number of periods to advance (default: 1)
 * @returns {Date} Advanced date
 */
export function advancePeriod(date, period, count = 1) {
  return period === 'Monthly' ? addMonths(date, count) : addWeeks(date, count);
}

/**
 * Calculate how many periods are needed to cover a number of days
 *
 * @param {number} days - Number of days to cover
 * @param {string} period - 'Monthly' or 'Weekly'
 * @returns {number} Number of periods (rounded up)
 */
export function periodsToCoverDays(days, period) {
  return period === 'Monthly' ? Math.ceil(days / 30.44) : Math.ceil(days / 7);
}

/**
 * Get the number of periods in a year
 *
 * @param {string} period - 'Monthly' or 'Weekly'
 * @returns {number} Periods per year (12 or 52)
 */
export function getPeriodsPerYear(period) {
  return period === 'Monthly' ? 12 : 52;
}

/**
 * Get the approximate days in a period
 *
 * @param {string} period - 'Monthly' or 'Weekly'
 * @returns {number} Average days per period
 */
export function getDaysInPeriod(period) {
  return period === 'Monthly' ? 30.44 : 7;
}

/**
 * Format a date as YYYY-MM-DD string
 *
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string
 */
export function formatDateISO(date) {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Normalize a date to midnight (00:00:00)
 *
 * @param {Date|string} date - Date to normalize
 * @returns {Date} Normalized date
 */
export function normalizeDate(date) {
  const d = typeof date === 'string' ? new Date(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get period boundaries for a given installment number
 *
 * @param {Date} startDate - Loan start date
 * @param {string} period - 'Monthly' or 'Weekly'
 * @param {number} installmentNumber - 1-based installment number
 * @returns {Object} { periodStart, periodEnd }
 */
export function getPeriodBoundaries(startDate, period, installmentNumber) {
  const periodStart = installmentNumber === 1
    ? startDate
    : advancePeriod(startDate, period, installmentNumber - 1);
  const periodEnd = advancePeriod(startDate, period, installmentNumber);

  return { periodStart, periodEnd };
}

/**
 * Get the first of next month from a given date
 *
 * @param {Date} date - Starting date
 * @returns {Date} First day of the next month
 */
export function getFirstOfNextMonth(date) {
  return startOfMonth(addMonths(date, 1));
}
