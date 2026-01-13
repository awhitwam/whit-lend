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
