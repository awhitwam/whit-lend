/**
 * Interest Calculation Utilities
 *
 * Shared functions for calculating interest across all schedulers.
 * Extracted from LoanScheduleManager.jsx for reuse.
 */

/**
 * Calculate interest for a period based on product rules and principal balance
 *
 * @param {number} principal - Principal amount to calculate interest on
 * @param {number} annualRate - Annual interest rate (as percentage, e.g., 12 for 12%)
 * @param {string} period - 'Monthly' or 'Weekly'
 * @param {string} interestType - 'Flat', 'Reducing', 'Interest-Only', or 'Rolled-Up'
 * @param {number|null} daysInPeriod - Days in period for pro-rata calculation
 * @returns {number} Interest amount for the period
 */
export function calculatePeriodInterest(principal, annualRate, period, interestType, daysInPeriod = null) {
  if (principal <= 0) return 0;

  const periodsPerYear = period === 'Monthly' ? 12 : 52;

  if (interestType === 'Flat') {
    // Flat rate: based on original principal, spread evenly
    return principal * (annualRate / 100) / periodsPerYear;
  } else {
    // Reducing, Interest-Only, Rolled-Up: based on current principal
    if (daysInPeriod) {
      // Pro-rated for partial period
      return principal * (annualRate / 100) * (daysInPeriod / 365);
    } else {
      return principal * (annualRate / 100) / periodsPerYear;
    }
  }
}

/**
 * Calculate interest for a specific number of days on a principal amount.
 * Handles different interest types appropriately.
 *
 * @param {number} principal - Current principal balance
 * @param {number} dailyRate - Daily interest rate (annual rate / 100 / 365)
 * @param {number} days - Number of days to calculate interest for
 * @param {string} interestType - 'Flat', 'Reducing', 'Interest-Only', or 'Rolled-Up'
 * @param {number} originalPrincipal - Original loan principal (used for Flat rate)
 * @returns {number} Interest amount for the days
 */
export function calculateInterestForDays(principal, dailyRate, days, interestType, originalPrincipal) {
  if (principal <= 0 || days <= 0) return 0;

  if (interestType === 'Flat') {
    // Flat rate: always based on original principal
    return originalPrincipal * dailyRate * days;
  } else {
    // Reducing, Interest-Only, Rolled-Up: based on current principal
    return principal * dailyRate * days;
  }
}

/**
 * Calculate principal outstanding at a specific date for schedule/interest purposes.
 * Uses GROSS principal (loan.principal_amount) minus repayments.
 *
 * NOTE: We do NOT add disbursement transactions here because:
 * - initialPrincipal IS the GROSS loan amount (what borrower owes)
 * - Disbursement transactions represent NET cash given (after arrangement fee)
 * - Adding them would double-count: GROSS + NET = wrong
 *
 * For cash flow/ledger purposes, use disbursement transactions directly.
 *
 * @param {number} initialPrincipal - Initial loan principal amount
 * @param {Array} transactions - Array of transaction objects
 * @param {Date} date - Date to calculate principal at
 * @returns {number} Principal outstanding at the given date
 */
export function calculatePrincipalAtDate(initialPrincipal, transactions, date) {
  const repayments = transactions
    .filter(t => t.type === 'Repayment' && new Date(t.date) < date)
    .reduce((sum, t) => sum + (t.principal_applied || 0), 0);

  return Math.max(0, initialPrincipal - repayments);
}

/**
 * Calculate the daily interest rate from annual rate
 *
 * @param {number} annualRate - Annual rate as percentage (e.g., 12 for 12%)
 * @returns {number} Daily rate as decimal
 */
export function getDailyRate(annualRate) {
  return annualRate / 100 / 365;
}

/**
 * Calculate the periodic interest rate from annual rate
 *
 * @param {number} annualRate - Annual rate as percentage (e.g., 12 for 12%)
 * @param {string} period - 'Monthly' or 'Weekly'
 * @returns {number} Periodic rate as decimal
 */
export function getPeriodicRate(annualRate, period) {
  const periodsPerYear = period === 'Monthly' ? 12 : 52;
  return annualRate / 100 / periodsPerYear;
}

/**
 * Round to currency precision (2 decimal places)
 *
 * @param {number} amount - Amount to round
 * @returns {number} Rounded amount
 */
export function roundCurrency(amount) {
  return Math.round(amount * 100) / 100;
}
