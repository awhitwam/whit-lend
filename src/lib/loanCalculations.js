/**
 * Shared loan calculation utilities
 * Centralizes calculation logic to avoid duplication between components
 */

/**
 * Calculate roll-up interest for preview/estimation
 * Uses the same logic as RollUpServicedScheduler but simplified for UI preview
 *
 * @param {number} principal - The principal amount (gross amount - this IS what borrower owes)
 * @param {number} rate - Annual interest rate as percentage (e.g., 15 for 15%)
 * @param {number} rollUpLength - Number of months in roll-up period
 * @returns {string} - Calculated roll-up interest formatted to 2 decimal places
 */
export const calculateRollUpAmount = (principal, rate, rollUpLength) => {
  if (!principal || !rate || !rollUpLength) return '';

  // Principal IS the gross amount - no additional fees added
  // Additional deducted fees are just a memo of what wasn't disbursed
  const grossPrincipal = parseFloat(principal);
  const dailyRate = parseFloat(rate) / 100 / 365;
  // Approximate days in roll-up period (average 30.44 days per month)
  const daysInRollUp = parseFloat(rollUpLength) * 30.44;
  const rollUpInterest = grossPrincipal * dailyRate * daysInRollUp;

  return rollUpInterest.toFixed(2);
};

/**
 * Calculate net disbursed amount
 * This is what the borrower actually receives after deductions
 *
 * @param {number} principal - Principal amount (gross - what borrower owes)
 * @param {number} arrangementFee - Arrangement fee (deducted from disbursement)
 * @param {number} additionalFees - Additional deducted fees
 * @param {number} deductedInterest - Deducted interest (if any)
 * @returns {number} - Net amount to be disbursed to borrower
 */
export const calculateNetDisbursed = (principal, arrangementFee = 0, additionalFees = 0, deductedInterest = 0) => {
  return parseFloat(principal || 0)
    - parseFloat(arrangementFee || 0)
    - parseFloat(additionalFees || 0)
    - parseFloat(deductedInterest || 0);
};

/**
 * Fees collected from the borrower on a loan.
 *
 * Repayments only. The arrangement fee is written into fees_applied on the initial
 * Disbursement row (LoanDetails.jsx:667), so counting every transaction would add a fee
 * the borrower never paid in cash - on a loan whose arrangement and exit fees are equal
 * it would double the figure exactly.
 *
 * Note that fees_applied carries no fee type, so this cannot distinguish an exit fee from
 * a Fixed Charge instalment or an imported late penalty. Callers must treat the result as
 * "fees received", not "exit fee received".
 *
 * @param {Array} transactions - loan transactions
 * @param {Date|string} [asOfDate] - ignore receipts after this date, for back-dated quotes
 * @returns {number} total fees received
 */
export const getFeesReceived = (transactions = [], asOfDate = null) => {
  const cutoff = asOfDate ? new Date(asOfDate) : null;
  const cutoffValid = cutoff && !Number.isNaN(cutoff.getTime());

  return (transactions || []).reduce((sum, tx) => {
    if (!tx || tx.type !== 'Repayment') return sum;
    if (tx.is_deleted) return sum;
    if (cutoffValid && tx.date && new Date(tx.date) > cutoff) return sum;
    const fees = parseFloat(tx.fees_applied) || 0;
    return fees > 0 ? sum + fees : sum;
  }, 0);
};

/**
 * Exit fee still owed, for settlement figures.
 *
 * Mirrors the treatment the Dashboard already uses for its "Exit Fees Due" tile
 * (Dashboard.jsx:251-256): the contracted exit fee less fees already received, floored at
 * zero. Without this, settling a loan whose exit fee has been paid overstates what is owed
 * by the whole fee.
 *
 * @param {Object} loan - the loan record
 * @param {Array} transactions - the loan's transactions
 * @param {Date|string} [asOfDate] - ignore receipts after this date
 * @returns {number} exit fee remaining
 */
export const getExitFeeRemaining = (loan, transactions = [], asOfDate = null) => {
  const exitFee = parseFloat(loan?.exit_fee) || 0;
  if (exitFee <= 0) return 0;
  return Math.max(0, exitFee - getFeesReceived(transactions, asOfDate));
};
