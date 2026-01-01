/**
 * Interest Calculation Utilities for Investor Accounts
 *
 * Interest is calculated daily based on the current balance and annual interest rate.
 * Formula: Daily Interest = Balance * (Annual Rate / 100) / 365
 */

/**
 * Calculate daily interest for a given balance and annual rate
 * @param {number} balance - Current capital balance
 * @param {number} annualRate - Annual interest rate as percentage (e.g., 10 for 10%)
 * @returns {number} Daily interest amount
 */
export function calculateDailyInterest(balance, annualRate) {
  if (!balance || balance <= 0 || !annualRate || annualRate <= 0) {
    return 0;
  }
  return (balance * (annualRate / 100)) / 365;
}

/**
 * Calculate interest for a specific number of days
 * @param {number} balance - Current capital balance
 * @param {number} annualRate - Annual interest rate as percentage
 * @param {number} days - Number of days to calculate interest for
 * @returns {number} Total interest for the period
 */
export function calculateInterestForPeriod(balance, annualRate, days) {
  if (days <= 0) return 0;
  return calculateDailyInterest(balance, annualRate) * days;
}

/**
 * Calculate the number of days between two dates
 * @param {Date|string} startDate - Start date
 * @param {Date|string} endDate - End date
 * @returns {number} Number of days between dates
 */
export function daysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = end.getTime() - start.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Calculate accrued interest from a start date to today
 * @param {number} balance - Current capital balance
 * @param {number} annualRate - Annual interest rate as percentage
 * @param {Date|string} lastAccrualDate - Date of last accrual calculation
 * @returns {Object} { accruedInterest, days, dailyRate }
 */
export function calculateAccruedInterest(balance, annualRate, lastAccrualDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const lastDate = lastAccrualDate ? new Date(lastAccrualDate) : new Date();
  lastDate.setHours(0, 0, 0, 0);

  const days = daysBetween(lastDate, today);
  const dailyRate = calculateDailyInterest(balance, annualRate);
  const accruedInterest = dailyRate * days;

  return {
    accruedInterest: Math.round(accruedInterest * 100) / 100, // Round to 2 decimal places
    days,
    dailyRate: Math.round(dailyRate * 100) / 100
  };
}

/**
 * Determine if interest should be posted based on frequency and last posting date
 * @param {string} frequency - Posting frequency: 'monthly', 'quarterly', 'annually'
 * @param {Date|string} lastPostingDate - Date of last interest posting
 * @returns {boolean} True if interest should be posted
 */
export function shouldPostInterest(frequency, lastPostingDate) {
  if (!lastPostingDate) return true; // Never posted, should post

  const today = new Date();
  const lastDate = new Date(lastPostingDate);

  const monthsDiff = (today.getFullYear() - lastDate.getFullYear()) * 12 +
    (today.getMonth() - lastDate.getMonth());

  switch (frequency) {
    case 'monthly':
      return monthsDiff >= 1;
    case 'quarterly':
      return monthsDiff >= 3;
    case 'annually':
      return monthsDiff >= 12;
    default:
      return monthsDiff >= 1;
  }
}

/**
 * Get the start of the current accrual period based on frequency
 * @param {string} frequency - Posting frequency
 * @param {Date|string} referenceDate - Reference date (usually today)
 * @returns {Date} Start of the current period
 */
export function getPeriodStart(frequency, referenceDate = new Date()) {
  const date = new Date(referenceDate);

  switch (frequency) {
    case 'monthly':
      return new Date(date.getFullYear(), date.getMonth(), 1);
    case 'quarterly':
      const quarter = Math.floor(date.getMonth() / 3);
      return new Date(date.getFullYear(), quarter * 3, 1);
    case 'annually':
      return new Date(date.getFullYear(), 0, 1);
    default:
      return new Date(date.getFullYear(), date.getMonth(), 1);
  }
}

/**
 * Get the end of the current accrual period based on frequency
 * @param {string} frequency - Posting frequency
 * @param {Date|string} referenceDate - Reference date
 * @returns {Date} End of the current period
 */
export function getPeriodEnd(frequency, referenceDate = new Date()) {
  const date = new Date(referenceDate);

  switch (frequency) {
    case 'monthly':
      return new Date(date.getFullYear(), date.getMonth() + 1, 0);
    case 'quarterly':
      const quarter = Math.floor(date.getMonth() / 3);
      return new Date(date.getFullYear(), (quarter + 1) * 3, 0);
    case 'annually':
      return new Date(date.getFullYear(), 11, 31);
    default:
      return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }
}

/**
 * Format interest amount for display
 * @param {number} amount - Interest amount
 * @returns {string} Formatted amount
 */
export function formatInterestAmount(amount) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount || 0);
}
