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
 * @param {boolean} inclusive - Include transactions dated ON the target date. Default false
 *   (strictly before) to preserve existing callers. Pass true when `date` is a period START and
 *   interest is charged in arrears: a repayment on the first day of a period reduces the balance
 *   for the whole of that period, and excluding it charges a month's interest on money that had
 *   already been returned.
 * @returns {number} Principal outstanding at the given date
 */
export function calculatePrincipalAtDate(initialPrincipal, transactions, date, loanStartDate = null, inclusive = false) {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);

  const onOrBefore = (value) => {
    const txDate = new Date(value);
    txDate.setHours(0, 0, 0, 0);
    return inclusive ? txDate <= targetDate : txDate < targetDate;
  };

  // Calculate principal repayments before this date
  const repayments = transactions
    .filter(t => {
      if (t.type !== 'Repayment' || t.is_deleted) return false;
      return onOrBefore(t.date);
    })
    .reduce((sum, t) => sum + (t.principal_applied || 0), 0);

  // Calculate further advances (exclude initial disbursement) before this date
  // Use gross_amount which represents what the borrower owes
  const furtherAdvances = transactions
    .filter(t => {
      if (t.type !== 'Disbursement' || t.is_deleted || t.is_initial_disbursement) return false;
      return onOrBefore(t.date);
    })
    .reduce((sum, t) => sum + ((t.gross_amount ?? t.amount) || 0), 0);

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

// ============================================================================
// Roll-up aware interest base
//
// For roll-up/serviced products the interest-bearing base is not the principal
// alone: once the roll-up period ends, its accrued interest is capitalised and
// interest is charged on (capital + capitalised roll-up).
//
// Two things make that base move, and both must be honoured on the day they
// happen rather than once per period:
//   1. capital events (repayments, further advances)
//   2. settlement of the capitalised roll-up itself
//
// Getting (2) wrong means a borrower who has paid off the roll-up keeps paying
// interest on interest they have already settled.
// ============================================================================

/**
 * Normalise any date-like value to local midnight.
 */
function atMidnight(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Total interest settled by repayments dated on or before `date`.
 *
 * Reads `interest_applied` from transactions rather than `repayment_schedules.interest_paid`,
 * because regenerating a schedule deletes and recreates its rows (BaseScheduler.saveSchedule)
 * and resets every paid column to zero. Transactions are the durable record.
 *
 * @param {Array} transactions - Loan transactions
 * @param {Date|string} date - Cut-off date (inclusive)
 * @returns {number} Interest paid on or before the date
 */
export function calculateInterestPaidToDate(transactions, date) {
  const target = atMidnight(date);

  return (transactions || [])
    .filter(t => t.type === 'Repayment' && !t.is_deleted && atMidnight(t.date) <= target)
    .reduce((sum, t) => sum + (t.interest_applied || 0), 0);
}

/**
 * Unpaid portion of the capitalised roll-up interest as at `date`.
 *
 * The roll-up is the oldest interest on the loan, so under the oldest-first ordering used by
 * applyPaymentWaterfall it is the first interest any repayment settles. Interest paid is
 * therefore applied against it before any serviced period.
 *
 * @param {number} rollUpInterest - Total capitalised roll-up interest
 * @param {Array} transactions - Loan transactions
 * @param {Date|string} date - Date to evaluate at
 * @returns {number} Roll-up interest still outstanding
 */
export function calculateRollUpOutstandingAtDate(rollUpInterest, transactions, date) {
  if (!rollUpInterest || rollUpInterest <= 0) return 0;

  return Math.max(0, rollUpInterest - calculateInterestPaidToDate(transactions, date));
}

/**
 * Read the roll-up interest for a loan, preferring the generated schedule row over the
 * loan column (the row reflects any override that was actually applied).
 *
 * @param {Array} schedule - Repayment schedule rows
 * @param {Object} loan - Loan record
 * @returns {number} Roll-up interest, or 0 if this is not a roll-up loan
 */
export function getRollUpInterestFromSchedule(schedule, loan) {
  const rollUpRow = (schedule || []).find(s => s.is_roll_up_period);
  const fromRow = Number(rollUpRow?.interest_amount);
  if (Number.isFinite(fromRow) && fromRow > 0) return fromRow;

  const fromLoan = Number(loan?.roll_up_amount);
  return Number.isFinite(fromLoan) && fromLoan > 0 ? fromLoan : 0;
}

/**
 * The interest-bearing base right now: capital outstanding plus any roll-up still unpaid.
 *
 * Use this instead of a schedule row's `calculation_principal_start`. That column is frozen when
 * the schedule is generated and cannot know about repayments made since, so reading it charges
 * interest on capital the borrower has already returned.
 *
 * @returns {{principal: number, rollUpOutstanding: number, base: number}}
 */
export function getCurrentInterestBase({
  initialPrincipal,
  rollUpInterest = 0,
  transactions = [],
  asOfDate = new Date(),
  loanStartDate = null
}) {
  const principal = calculatePrincipalAtDate(
    initialPrincipal,
    transactions,
    asOfDate,
    loanStartDate,
    true
  );

  // No capital, no interest - whatever the frozen schedule columns say.
  if (principal <= 0) return { principal: 0, rollUpOutstanding: 0, base: 0 };

  const rollUpOutstanding = calculateRollUpOutstandingAtDate(rollUpInterest, transactions, asOfDate);

  return { principal, rollUpOutstanding, base: principal + rollUpOutstanding };
}

/**
 * Interest for a period, split at every date on which the interest base changes.
 *
 * Mirrors the segment shape produced by calculateInterestFromLedger so existing renderers can
 * consume it, but is roll-up aware: each segment's base is
 * `capital outstanding + roll-up still unpaid`.
 *
 * @param {number} initialPrincipal - loan.principal_amount
 * @param {number} rollUpInterest - Capitalised roll-up interest (0 for non-roll-up loans)
 * @param {Array} transactions - Loan transactions
 * @param {Date} periodStart - Period start (inclusive)
 * @param {Date} periodEnd - Period end (exclusive)
 * @param {Date} loanStartDate - Loan start, to identify the initial disbursement
 * @param {number} dailyRate - Daily rate as a decimal (annual / 100 / 365)
 * @param {number} extraBase - Additional base, e.g. unpaid accrued under compound_after_rollup
 * @returns {{interest: number, segments: Array}}
 */
export function calculateSegmentedInterest({
  initialPrincipal,
  rollUpInterest = 0,
  transactions = [],
  periodStart,
  periodEnd,
  loanStartDate = null,
  dailyRate,
  extraBase = 0
}) {
  const start = atMidnight(periodStart);
  const end = atMidnight(periodEnd);

  if (!(end > start)) return { interest: 0, segments: [] };

  // Any transaction landing strictly inside the period splits it: repayments and further
  // advances move capital, and a repayment's interest leg can clear the roll-up.
  const boundaries = new Set();
  for (const tx of transactions || []) {
    if (tx.is_deleted) continue;
    if (tx.type !== 'Repayment' && tx.type !== 'Disbursement') continue;
    if (tx.type === 'Disbursement' && tx.is_initial_disbursement) continue;

    const txDate = atMidnight(tx.date);
    if (txDate > start && txDate < end) boundaries.add(txDate.getTime());
  }

  const points = [
    start.getTime(),
    ...[...boundaries].sort((a, b) => a - b),
    end.getTime()
  ];

  let interest = 0;
  const segments = [];

  for (let i = 0; i < points.length - 1; i++) {
    const segmentStart = new Date(points[i]);
    const segmentEnd = new Date(points[i + 1]);
    const days = Math.round((segmentEnd - segmentStart) / 86400000);
    if (days <= 0) continue;

    // inclusive: a transaction dated on the segment start has already taken effect for the
    // whole of that segment, matching how interest is charged in arrears.
    const principal = calculatePrincipalAtDate(
      initialPrincipal,
      transactions,
      segmentStart,
      loanStartDate,
      true
    );
    const rollUpOutstanding = calculateRollUpOutstandingAtDate(
      rollUpInterest,
      transactions,
      segmentStart
    );

    const base = principal > 0 ? principal + rollUpOutstanding + extraBase : 0;
    const segmentInterest = base * dailyRate * days;
    interest += segmentInterest;

    segments.push({
      from: segmentStart,
      to: segmentEnd,
      days,
      principal,
      rollUpOutstanding,
      base,
      principalStart: base,
      dailyInterest: base * dailyRate,
      interest: segmentInterest
    });
  }

  return { interest, segments };
}

/**
 * Interest accrued on a schedule row as at a date.
 *
 * A payment cannot settle interest that has not been earned yet. Rows that have already fallen
 * due accrue in full, the row containing the date is pro-rated across its days, and rows wholly
 * in the future accrue nothing - so a redemption cannot sweep up future periods.
 *
 * On an interest-paid-in-advance loan the due date is the period START and the whole period's
 * interest falls due on it, so there is nothing to pro-rate: the row is either due in full or
 * not yet due.
 *
 * @param {Object} row - Schedule row (needs due_date, interest_amount, calculation_days)
 * @param {Date|string|null} asOfDate - Cut-off; null disables the cap
 * @param {boolean} interestPaidInAdvance - True when due_date is the period start
 * @returns {number} Interest accrued on the row
 */
export function interestAccruedOnRow(row, asOfDate, interestPaidInAdvance = false) {
  const interestAmount = row.interest_amount || 0;
  if (!asOfDate || interestAmount <= 0) return interestAmount;

  const dueDate = atMidnight(row.due_date);
  const target = atMidnight(asOfDate);

  if (target >= dueDate) return interestAmount;
  if (interestPaidInAdvance) return 0;

  const days = row.calculation_days || 0;
  if (days <= 0) return 0;

  const periodStart = new Date(dueDate);
  periodStart.setDate(periodStart.getDate() - days);
  if (target <= periodStart) return 0;

  const elapsed = Math.round((target - periodStart) / 86400000);
  return interestAmount * (elapsed / days);
}

/**
 * Spread a payment across what is owed, in settlement order: interest, then fees, then capital.
 *
 * Each leg is capped at what is actually outstanding, so a payment larger than the debt leaves an
 * unallocated excess rather than over-settling a leg. All figures must already be measured as at
 * the payment date - back-dating a redemption must not settle interest that had not yet accrued
 * on the day the money arrived.
 *
 * @param {number} amount - The payment
 * @param {number} interestOutstanding - Interest owed at the payment date
 * @param {number} feesOutstanding - Fees owed at the payment date
 * @param {number} capitalOutstanding - Capital owed at the payment date
 * @returns {{interest: number, fees: number, capital: number, excess: number, capitalAfter: number}}
 */
export function allocateSettlement({
  amount = 0,
  interestOutstanding = 0,
  feesOutstanding = 0,
  capitalOutstanding = 0
}) {
  let left = Math.max(0, amount);

  const interest = Math.min(left, Math.max(0, interestOutstanding));
  left -= interest;

  const fees = Math.min(left, Math.max(0, feesOutstanding));
  left -= fees;

  const capital = Math.min(left, Math.max(0, capitalOutstanding));
  left -= capital;

  return {
    interest,
    fees,
    capital,
    excess: left,
    capitalAfter: Math.max(0, capitalOutstanding) - capital
  };
}

/**
 * Interest outstanding on a loan as at a date, from its schedule and transactions.
 *
 * Sums what each schedule row had earned by that date - rows already due in full, the row in
 * progress pro-rated - and subtracts interest already settled. A row that starts after the date
 * contributes nothing.
 *
 * This is deliberately built from leaf helpers rather than calling into LoanCalculator, which
 * sits in an import cycle with the scheduler registry and is not safely importable from
 * unrelated modules.
 *
 * @param {Array} schedule - The loan's repayment schedule rows
 * @param {Array} transactions - The loan's transactions
 * @param {Date|string} asOfDate - The date to value at
 * @param {boolean} interestPaidInAdvance - True when a due date is the period start
 * @returns {{due: number, paid: number, outstanding: number}}
 */
export function calculateInterestOutstandingAtDate({
  schedule = [],
  transactions = [],
  asOfDate = new Date(),
  interestPaidInAdvance = false
}) {
  const due = (schedule || []).reduce(
    (sum, row) => sum + interestAccruedOnRow(row, asOfDate, interestPaidInAdvance),
    0
  );
  const paid = calculateInterestPaidToDate(transactions, asOfDate);

  return { due, paid, outstanding: Math.max(0, due - paid) };
}
