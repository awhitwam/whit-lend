/**
 * Which live loans were servicing interest and have stopped.
 *
 * WHY EVERY PAYMENT FACT COMES FROM `transactions`, NEVER FROM THE SCHEDULE:
 * mcp-server/src/caveats.js documents that repayment_schedules.principal_paid and
 * interest_paid were never backfilled on the bulk-imported book - all 2,149 rows sit at
 * 0/0/'Pending'. Running the arrears formula in Dashboard.jsx over that data reports
 * GBP 26.6m of arrears on a GBP 9.4m book. So schedule rows are read ONLY for due_date,
 * interest_amount and the is_*_period flags, which are scheduler-generated and reliable.
 * Do not "improve" this by reading the schedule payment columns.
 *
 * Lateness is per-loan, not a flat 30 days: days since the last interest payment minus
 * that loan's own payment interval. A monthly loan trips at ~30 as asked; a quarterly
 * rent loan trips at ~91 instead of being wrongly flagged every month.
 *
 * DEPENDENCY RULE: import only from './interestCalculation.js'. That module has no
 * imports of its own and uses no path aliases, so this one loads under plain `node` and
 * is pinned by scripts/check-late-payments.mjs. Importing from './schedule/**' would drag
 * in '@/api/dataClient' (BaseScheduler) and a JSX component (RollUpServicedScheduler:19),
 * and './reconciliation/utils.js' would drag in '@/components/loan/LoanCalculator'.
 *
 * KNOWN LIMITATION: a loan whose interest was deducted at drawdown (`deducted_interest`)
 * has no qualifying Repayment, so the never-paid gate excludes it.
 */

import { toUtcDay, daysBetweenUtc, formatUtcDay } from './interestCalculation.js';

/**
 * Days past the expected interval before a loan is listed.
 *
 * Zero is the literal ask: a monthly loan appears the day it passes ~30 days. Raise it to
 * 5-7 if the card proves noisy with borrowers who habitually pay a few days late - that is
 * the only change needed, since the tiers below measure from the same number.
 */
export const GRACE_DAYS = 0;

/** Upper bound of tiers 1-4 in days late; anything beyond is tier 5. */
export const SEVERITY_TIERS = [14, 30, 60, 90];

/** Half a penny: "this is a real amount, not a rounding artefact". */
const EPSILON = 0.005;

/** Mean days in a Gregorian month. Used only as a cadence fallback. */
const MONTH_DAYS = 30.44;

const toNumber = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
};

// ============================================================================
// CLASSIFICATION
// ============================================================================

// Mirrors deriveSchedulerType in src/components/product/ProductForm.jsx:18-30 and the
// fallback map in src/components/loan/LoanScheduleManager.jsx:61-67, so this card can
// never disagree with the engine that built the schedule.
const PRODUCT_TYPE_MAP = {
  'Fixed Charge': 'fixed_charge',
  'Irregular Income': 'irregular_income',
  'Rent': 'rent',
  'Roll-Up & Serviced': 'roll_up_serviced'
};

// 'Roll-Up & Serviced' appears here too because LoanApplicationForm.jsx:392 writes it as
// a literal interest_type on the loan.
const INTEREST_TYPE_MAP = {
  'Rolled-Up': 'rolled_up',
  'Interest-Only': 'interest_only',
  'Flat': 'flat_rate',
  'Reducing': 'reducing_balance',
  'Roll-Up & Serviced': 'roll_up_serviced'
};

/**
 * Which scheduler governs this loan.
 *
 * loans.scheduler_type does not exist - backupSchema.js lists it but migration 056 adds
 * the column to loan_products only - so the product is the authority, and the loan's own
 * product_type/interest_type are the fallback for unmigrated products.
 *
 * @param {Object} loan
 * @param {Object|null} [product]
 * @returns {string} a registered scheduler id
 */
export function resolveSchedulerType(loan, product) {
  if (product?.scheduler_type) return product.scheduler_type;

  const productType = product?.product_type || loan?.product_type;
  if (productType && PRODUCT_TYPE_MAP[productType]) return PRODUCT_TYPE_MAP[productType];

  const interestType = product?.interest_type || loan?.interest_type;
  if (interestType && INTEREST_TYPE_MAP[interestType]) return INTEREST_TYPE_MAP[interestType];

  return 'reducing_balance';
}

/**
 * Add whole months to a UTC-midnight day, clamping to the target month's length so
 * 31 Jan + 1 month is 28 Feb rather than rolling into March.
 *
 * date-fns addMonths does the same thing but operates in local time, which is the day
 * shift toUtcDay() exists to prevent.
 *
 * @param {Date|null} day
 * @param {number} months
 * @returns {Date|null}
 */
export function addMonthsUtc(day, months) {
  if (!day) return null;
  const target = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + months, 1));
  const lastDayOfMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return new Date(Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    Math.min(day.getUTCDate(), lastDayOfMonth)
  ));
}

/**
 * Does this scheduler expect periodic interest, and from when?
 *
 * Scheduler type decides WHETHER interest is expected; schedule rows only say when the
 * clock started. Rows cannot classify alone: RolledUpScheduler emits a term-end row
 * shape-identical to an interest_only balloon, and FixedChargeScheduler.js:81 writes a
 * charge into interest_amount.
 *
 * @param {Object} loan
 * @param {string} schedulerType
 * @param {Array} loanRows - repayment_schedules rows for THIS loan
 * @returns {{expectsInterest: boolean, servicingStartDay: Date|null, phaseRows: Array,
 *            reason: string|null}}
 */
export function classifyServicing(loan, schedulerType, loanRows) {
  const rows = (loanRows || []).filter(r => r && r.due_date);
  const startDay = toUtcDay(loan?.start_date);

  const earliest = (list) => list
    .map(r => toUtcDay(r.due_date))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime())[0] || null;

  if (schedulerType === 'irregular_income') {
    // generatesSchedule = false; income arrives when it arrives.
    return {
      expectsInterest: false,
      servicingStartDay: null,
      phaseRows: [],
      reason: 'no-periodic-interest'
    };
  }

  if (schedulerType === 'rolled_up') {
    // Interest rolls up through the term and is only serviced monthly in extension.
    // RolledUpScheduler.js:117-118 emits 12 extension months even when auto_extend is
    // off, so the PRESENCE of extension rows proves nothing - the term-end date is what
    // decides whether servicing has started.
    const termRows = rows.filter(r => !r.is_extension_period);
    const extensionRows = rows.filter(r => r.is_extension_period);
    const termEnd = termRows.length
      ? termRows.map(r => toUtcDay(r.due_date)).filter(Boolean)
          .sort((a, b) => b.getTime() - a.getTime())[0]
      : null;
    return {
      expectsInterest: true,
      servicingStartDay: termEnd,
      phaseRows: extensionRows,
      reason: termEnd ? null : 'not-yet-servicing'
    };
  }

  if (schedulerType === 'roll_up_serviced') {
    const servicedRows = rows.filter(r => r.is_serviced_period);
    // RollUpServicedScheduler.js:176-177 dates the first serviced period one month AFTER
    // the roll-up due date, hence the +1. `|| 6` not `?? 6`, to stay bug-compatible
    // with that scheduler's own line 101.
    const fallback = addMonthsUtc(startDay, (toNumber(loan?.roll_up_length) || 6) + 1);
    return {
      expectsInterest: true,
      servicingStartDay: servicedRows.length ? earliest(servicedRows) : fallback,
      phaseRows: servicedRows,
      reason: null
    };
  }

  // rent, reducing_balance, flat_rate, interest_only, fixed_charge: servicing from the
  // first due date, or from drawdown when no schedule has been generated.
  return {
    expectsInterest: true,
    servicingStartDay: rows.length ? earliest(rows) : startDay,
    phaseRows: rows,
    reason: null
  };
}

// ============================================================================
// CADENCE
// ============================================================================

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Gaps in days between consecutive UTC-midnight days. */
const gapsBetween = (days) => {
  const sorted = (days || []).filter(Boolean).slice().sort((a, b) => a.getTime() - b.getTime());
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = daysBetweenUtc(sorted[i - 1], sorted[i]);
    if (gap > 0) gaps.push(gap);
  }
  return gaps;
};

/**
 * Round an observed payment gap to the contractual cadence it is obviously an instance of.
 *
 * Reimplements the buckets at RentScheduler.js:166-180 - that logic is an instance method
 * on a class this module must not import - and adds fortnightly and weekly, which rent
 * does not model but other products do.
 *
 * Applied ONLY to the payment-derived path. A schedule median is the contract itself and
 * must not be rounded. Snapping stops a rent payer whose gaps were 88/94/97 from earning
 * an interval of 94: the contract is 91, and the extra slack is laxness-learning.
 *
 * @param {number} gapDays
 * @returns {number}
 */
export function snapIntervalToCadence(gapDays) {
  if (gapDays >= 300 && gapDays <= 400) return 365;
  if (gapDays >= 75 && gapDays <= 120) return 91;
  if (gapDays >= 25 && gapDays <= 40) return 30;
  if (gapDays >= 12 && gapDays <= 18) return 14;
  if (gapDays >= 5 && gapDays <= 10) return 7;
  return Math.round(gapDays);
}

/** Human label for an interval, for the card subtitle. */
export function cadenceLabelFor(intervalDays) {
  if (intervalDays >= 300 && intervalDays <= 400) return 'annual';
  if (intervalDays >= 75 && intervalDays <= 120) return 'quarterly';
  if (intervalDays >= 25 && intervalDays <= 40) return 'monthly';
  if (intervalDays >= 12 && intervalDays <= 18) return 'fortnightly';
  if (intervalDays >= 5 && intervalDays <= 10) return 'weekly';
  return `every ~${Math.round(intervalDays)} days`;
}

/**
 * How often this loan is expected to pay interest.
 *
 * Rent deliberately skips the schedule-derived step: buildRentSchedule
 * (RentScheduler.js:205-273) is backward-looking - one row per quarter already paid plus
 * at most one prediction - so a late rent loan often has no future rows to measure. Rent
 * must also never fall back on `period`: the Rent product's period is 'Monthly', so every
 * quarterly payer would be flagged at day 31. That is the exact false positive this whole
 * per-loan-cadence design exists to prevent, so an unmeasurable rent loan is excluded
 * rather than guessed at.
 *
 * @param {Object} loan
 * @param {string} schedulerType
 * @param {Array} phaseRows - servicing-phase schedule rows
 * @param {Array<Date>} paymentDays - interest payment days, any order
 * @returns {{intervalDays: number, source: string}|null} null = not measurable
 */
export function deriveExpectedInterval(loan, schedulerType, phaseRows, paymentDays) {
  const isRent = schedulerType === 'rent';

  if (!isRent) {
    // Median, not mean - survives a stub first period and a balloon last period.
    const scheduleGaps = gapsBetween((phaseRows || []).map(r => toUtcDay(r.due_date)));
    if (scheduleGaps.length >= 2) {
      return { intervalDays: median(scheduleGaps), source: 'schedule' };
    }
  }

  const paymentGaps = gapsBetween(paymentDays);
  if (paymentGaps.length >= 1) {
    return { intervalDays: snapIntervalToCadence(median(paymentGaps)), source: 'payments' };
  }

  if (isRent) return null;

  if (loan?.period === 'Weekly') return { intervalDays: 7, source: 'period' };
  if (loan?.period === 'Quarterly') return { intervalDays: 91, source: 'period' };
  if (loan?.period === 'Yearly') return { intervalDays: 365, source: 'period' };
  return { intervalDays: MONTH_DAYS, source: loan?.period ? 'period' : 'default' };
}

// ============================================================================
// PAYMENTS
// ============================================================================

/**
 * Every interest payment on a loan, oldest first, plus the most recent one.
 *
 * Fixed Charge loans settle their charge through `fees_applied`, not `interest_applied` -
 * see RepaymentScheduleTable.jsx:173-176, while FixedChargeScheduler.js:81 writes the
 * charge into the schedule's interest_amount. A uniform interest_applied filter makes
 * every FC loan look like it has never paid and, combined with the never-paid gate below,
 * silently drops them all with no error. On non-FC loans `fees_applied` is an
 * exit/arrangement fee and is correctly ignored, so a fee must not reset the clock.
 *
 * @param {Array} loanTransactions - transactions for THIS loan
 * @param {string} schedulerType
 * @returns {{days: Array<Date>, lastDay: Date|null, lastAmount: number, count: number}}
 */
export function lastInterestPayment(loanTransactions, schedulerType) {
  const field = schedulerType === 'fixed_charge' ? 'fees_applied' : 'interest_applied';
  const paid = [];

  for (const t of loanTransactions || []) {
    if (!t || t.is_deleted) continue;
    if (t.type !== 'Repayment') continue;
    const applied = toNumber(t[field]);
    if (applied <= EPSILON) continue;
    const day = toUtcDay(t.date);
    if (!day) continue;
    paid.push({ day, amount: applied });
  }

  paid.sort((a, b) => a.day.getTime() - b.day.getTime());
  const last = paid[paid.length - 1] || null;

  return {
    days: paid.map(p => p.day),
    lastDay: last ? last.day : null,
    lastAmount: last ? last.amount : 0,
    count: paid.length
  };
}

/**
 * Typical scheduled interest for one period, used only to detect paying ahead.
 * Median over servicing-phase rows that carry an amount.
 */
export function scheduledInterestPerPeriod(phaseRows) {
  return median(
    (phaseRows || [])
      .map(r => toNumber(r?.interest_amount))
      .filter(a => a > EPSILON)
  );
}

// ============================================================================
// SEVERITY
// ============================================================================

/**
 * Tier 1-5 from days late. Cut on the same key the list sorts on, so colour descends
 * monotonically down the card.
 */
export function severityTier(daysLate) {
  for (let i = 0; i < SEVERITY_TIERS.length; i++) {
    if (daysLate <= SEVERITY_TIERS[i]) return i + 1;
  }
  return SEVERITY_TIERS.length + 1;
}

// ============================================================================
// THE LIST
// ============================================================================

/**
 * Live loans that were servicing interest and have lapsed, worst first.
 *
 * Pure - no I/O, no React, no date-fns. Safe to import from plain node.
 *
 * @param {Object} [params]
 * @param {Array} [params.loans]
 * @param {Array} [params.transactions] - ALL transactions, all loans
 * @param {Array} [params.schedules] - ALL repayment_schedules rows, all loans
 * @param {Array} [params.products] - loan_products; [] falls back to the loan's own fields
 * @param {Date|string} [params.asOf] - defaults to now
 * @param {number} [params.graceDays]
 * @param {boolean} [params.includeNeverPaid] - also list loans that never paid at all
 * @param {boolean} [params.debug] - populate `excluded`
 * @returns {{rows: Array, excluded: Array<{loanId: string, loanNumber: string,
 *            reason: string}>}}
 */
export function buildLatePaymentRows({
  loans = [],
  transactions = [],
  schedules = [],
  products = [],
  asOf = new Date(),
  graceDays = GRACE_DAYS,
  includeNeverPaid = false,
  debug = false
} = {}) {
  const asOfDay = toUtcDay(asOf);
  const rows = [];
  const excluded = [];

  if (!asOfDay) return { rows, excluded };

  const productById = new Map(products.map(p => [p.id, p]));

  const txByLoan = new Map();
  for (const t of transactions) {
    if (!t?.loan_id) continue;
    const list = txByLoan.get(t.loan_id);
    if (list) list.push(t);
    else txByLoan.set(t.loan_id, [t]);
  }

  const rowsByLoan = new Map();
  for (const s of schedules) {
    if (!s?.loan_id) continue;
    const list = rowsByLoan.get(s.loan_id);
    if (list) list.push(s);
    else rowsByLoan.set(s.loan_id, [s]);
  }

  const drop = (loan, reason) => {
    if (debug) excluded.push({ loanId: loan.id, loanNumber: loan.loan_number, reason });
  };

  for (const loan of loans) {
    if (!loan?.id) continue;

    // principal_remaining IS trigger-maintained (migration 054). A null cache falls back
    // to the original advance, erring toward inclusion rather than hiding a live loan.
    const outstanding = loan.principal_remaining != null
      ? toNumber(loan.principal_remaining)
      : toNumber(loan.principal_amount);
    if (outstanding <= 0.01) {
      drop(loan, 'redeemed');
      continue;
    }

    const product = productById.get(loan.product_id);
    const schedulerType = resolveSchedulerType(loan, product);
    const loanRows = rowsByLoan.get(loan.id) || [];
    const { expectsInterest, servicingStartDay, phaseRows, reason } =
      classifyServicing(loan, schedulerType, loanRows);

    if (!expectsInterest) {
      drop(loan, reason || 'no-periodic-interest');
      continue;
    }
    if (!servicingStartDay || servicingStartDay > asOfDay) {
      drop(loan, reason || 'not-yet-servicing');
      continue;
    }

    // Catches last week's drawdowns: a schedule entirely in the future owes nothing yet.
    if (loanRows.length) {
      const firstDue = loanRows
        .map(r => toUtcDay(r.due_date))
        .filter(Boolean)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      if (firstDue && firstDue > asOfDay) {
        drop(loan, 'no-due-period-yet');
        continue;
      }
    }

    const payments = lastInterestPayment(txByLoan.get(loan.id) || [], schedulerType);

    // SCOPE GATE: a total non-payer is arguably worse, but "never started" and "stopped"
    // are different problems. Merging them buries lapsed payers under freshly-drawn loans
    // that simply are not due yet - and the question this card answers is "who was paying
    // me and has stopped". includeNeverPaid flips it; servicingStartDay is the baseline it
    // then measures from.
    if (!payments.lastDay && !includeNeverPaid) {
      drop(loan, 'never-paid');
      continue;
    }

    const interval = deriveExpectedInterval(loan, schedulerType, phaseRows, payments.days);
    if (!interval) {
      drop(loan, 'cadence-unknown');
      continue;
    }

    // Else a roll-up loan whose borrower paid an arrangement fee on day one would start
    // life "180 days late".
    const effectiveLastPaid = payments.lastDay && payments.lastDay > servicingStartDay
      ? payments.lastDay
      : servicingStartDay;

    // Paying a quarter up front on a monthly loan buys that many periods of silence.
    const perPeriod = scheduledInterestPerPeriod(phaseRows);
    const prepaidPeriods = perPeriod > EPSILON && payments.lastAmount > EPSILON
      ? Math.max(0, Math.floor(payments.lastAmount / perPeriod) - 1)
      : 0;

    const daysSinceLastPayment = daysBetweenUtc(effectiveLastPaid, asOfDay);
    const daysLate = Math.round(
      daysSinceLastPayment - interval.intervalDays - prepaidPeriods * interval.intervalDays
    );

    if (daysLate <= graceDays) {
      drop(loan, 'current');
      continue;
    }

    rows.push({
      loan,
      schedulerType,
      daysSinceLastPayment,
      expectedIntervalDays: interval.intervalDays,
      cadenceSource: interval.source,
      cadenceLabel: cadenceLabelFor(interval.intervalDays),
      daysLate,
      periodsLate: Math.max(1, Math.floor(daysLate / interval.intervalDays) + 1),
      tier: severityTier(daysLate),
      lastPaidDay: payments.lastDay,
      lastPaidLabel: payments.lastDay
        ? formatUtcDay(payments.lastDay, { day: 'numeric', month: 'short', year: 'numeric' })
        : null,
      lastPaidAmount: payments.lastAmount,
      paymentCount: payments.count,
      prepaidPeriods
    });
  }

  // Worst first. Then by last payment size, so the bigger relationship leads a tie.
  rows.sort((a, b) =>
    b.daysLate - a.daysLate ||
    b.lastPaidAmount - a.lastPaidAmount ||
    String(a.loan.loan_number || '').localeCompare(String(b.loan.loan_number || ''))
  );

  return { rows, excluded };
}
