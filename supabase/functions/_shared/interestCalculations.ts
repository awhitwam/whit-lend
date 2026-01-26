/**
 * Interest Calculation Utilities for Edge Functions
 * Ported from src/lib/schedule/utils/interestCalculations.js
 *
 * These are pure functions with no browser dependencies, suitable for use
 * in both frontend and Supabase Edge Functions.
 */

/**
 * Calculate interest for a period based on product rules and principal balance
 *
 * @param principal - Principal amount to calculate interest on
 * @param annualRate - Annual interest rate (as percentage, e.g., 12 for 12%)
 * @param period - 'Monthly', 'Weekly', or 'Daily'
 * @param interestType - 'Flat', 'Reducing', 'Interest-Only', or 'Rolled-Up'
 * @param daysInPeriod - Days in period for pro-rata calculation (optional)
 * @returns Interest amount for the period
 */
export function calculatePeriodInterest(
  principal: number,
  annualRate: number,
  period: string,
  interestType: string,
  daysInPeriod: number | null = null
): number {
  if (principal <= 0) return 0;

  const periodsPerYear = period === 'Monthly' ? 12 : period === 'Weekly' ? 52 : 365;

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
 * @param principal - Current principal balance
 * @param dailyRate - Daily interest rate (annual rate / 100 / 365)
 * @param days - Number of days to calculate interest for
 * @param interestType - 'Flat', 'Reducing', 'Interest-Only', or 'Rolled-Up'
 * @param originalPrincipal - Original loan principal (used for Flat rate)
 * @returns Interest amount for the days
 */
export function calculateInterestForDays(
  principal: number,
  dailyRate: number,
  days: number,
  interestType: string,
  originalPrincipal: number
): number {
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
 * Calculate the daily interest rate from annual rate
 *
 * @param annualRate - Annual rate as percentage (e.g., 12 for 12%)
 * @returns Daily rate as decimal
 */
export function getDailyRate(annualRate: number): number {
  return annualRate / 100 / 365;
}

/**
 * Calculate the periodic interest rate from annual rate
 *
 * @param annualRate - Annual rate as percentage (e.g., 12 for 12%)
 * @param period - 'Monthly', 'Weekly', or 'Daily'
 * @returns Periodic rate as decimal
 */
export function getPeriodicRate(annualRate: number, period: string): number {
  const periodsPerYear = period === 'Monthly' ? 12 : period === 'Weekly' ? 52 : 365;
  return annualRate / 100 / periodsPerYear;
}

/**
 * Round to currency precision (2 decimal places)
 *
 * @param amount - Amount to round
 * @returns Rounded amount
 */
export function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Transaction type for calculating principal
 */
interface Transaction {
  type: string;
  is_deleted?: boolean;
  principal_applied?: number;
  gross_amount?: number;
  amount?: number;
  date?: string;
}

/**
 * Calculate principal outstanding based on transactions
 *
 * @param originalPrincipal - Initial loan principal amount
 * @param transactions - Array of transaction objects
 * @returns Current principal outstanding
 */
export function calculatePrincipalOutstanding(
  originalPrincipal: number,
  transactions: Transaction[]
): number {
  // Calculate principal repayments
  const repayments = transactions
    .filter(t => t.type === 'Repayment' && !t.is_deleted)
    .reduce((sum, t) => sum + (t.principal_applied || 0), 0);

  return Math.max(0, originalPrincipal - repayments);
}

/**
 * Calculate principal at a specific date, accounting for further advances
 *
 * @param originalPrincipal - Initial loan principal amount
 * @param transactions - Array of transaction objects
 * @param targetDate - Date to calculate principal at
 * @param loanStartDate - Loan start date to identify initial disbursement
 * @returns Principal outstanding at the given date
 */
export function calculatePrincipalAtDate(
  originalPrincipal: number,
  transactions: Transaction[],
  targetDate: Date,
  loanStartDate: Date | null = null
): number {
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);

  // Calculate principal repayments before this date
  const repayments = transactions
    .filter(t => {
      if (t.type !== 'Repayment' || t.is_deleted) return false;
      const txDate = new Date(t.date!);
      txDate.setHours(0, 0, 0, 0);
      return txDate < target;
    })
    .reduce((sum, t) => sum + (t.principal_applied || 0), 0);

  // Calculate further advances (disbursements after the loan start date) before this date
  let furtherAdvances = 0;
  if (loanStartDate) {
    const startDate = new Date(loanStartDate);
    startDate.setHours(0, 0, 0, 0);
    const startDateKey = startDate.toISOString().split('T')[0];

    furtherAdvances = transactions
      .filter(t => {
        if (t.type !== 'Disbursement' || t.is_deleted) return false;
        const txDate = new Date(t.date!);
        txDate.setHours(0, 0, 0, 0);
        const txDateKey = txDate.toISOString().split('T')[0];
        // Exclude initial disbursement (on start date), only count further advances
        // and only count those before the target date
        return txDateKey !== startDateKey && txDate < target;
      })
      .reduce((sum, t) => sum + ((t.gross_amount ?? t.amount) || 0), 0);
  }

  return Math.max(0, originalPrincipal + furtherAdvances - repayments);
}
