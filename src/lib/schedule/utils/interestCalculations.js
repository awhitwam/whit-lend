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
 *
 * This accounts for:
 * 1. Initial principal (loan.principal_amount)
 * 2. Further advances (Disbursement transactions after initial, using gross_amount)
 * 3. Principal repayments (reduce balance)
 *
 * @param {number} initialPrincipal - Initial loan principal amount (from loan.principal_amount)
 * @param {Array} transactions - Array of transaction objects
 * @param {Date} date - Date to calculate principal at
 * @param {Date} loanStartDate - Optional loan start date to identify initial disbursement
 * @returns {number} Principal outstanding at the given date
 */
export function calculatePrincipalAtDate(initialPrincipal, transactions, date, loanStartDate = null) {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);

  // Calculate principal repayments before this date
  const repayments = transactions
    .filter(t => {
      if (t.type !== 'Repayment' || t.is_deleted) return false;
      const txDate = new Date(t.date);
      txDate.setHours(0, 0, 0, 0);
      return txDate < targetDate;
    })
    .reduce((sum, t) => sum + (t.principal_applied || 0), 0);

  // Calculate further advances (disbursements after the loan start date) before this date
  // Use gross_amount which represents what the borrower owes
  let furtherAdvances = 0;
  if (loanStartDate) {
    const startDate = new Date(loanStartDate);
    startDate.setHours(0, 0, 0, 0);
    const startDateKey = startDate.toISOString().split('T')[0];

    furtherAdvances = transactions
      .filter(t => {
        if (t.type !== 'Disbursement' || t.is_deleted) return false;
        const txDate = new Date(t.date);
        txDate.setHours(0, 0, 0, 0);
        const txDateKey = txDate.toISOString().split('T')[0];
        // Exclude initial disbursement (on start date), only count further advances
        // and only count those before the target date
        return txDateKey !== startDateKey && txDate < targetDate;
      })
      .reduce((sum, t) => sum + ((t.gross_amount ?? t.amount) || 0), 0);
  }

  return Math.max(0, initialPrincipal + furtherAdvances - repayments);
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
