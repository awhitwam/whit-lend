/**
 * Interest Calculation Utilities for Investor Accounts
 *
 * Interest is calculated daily based on the balance and annual interest rate.
 * Formula: Daily Interest = Balance * (Annual Rate / 100) / 365
 *
 * The balance is NOT constant across a period. Capital moves in and out, so interest
 * must be summed segment by segment, cutting at every capital change. The authority on
 * how that is done is `calculateInvestorInterestForMonth` in
 * supabase/functions/nightly-jobs/index.ts - it is what actually posts the credits, so
 * anything shown in the UI has to agree with it to the penny.
 *
 * `calculateSegmentedInterest` below is a deliberate mirror of that function. If you
 * change one, change the other; the verification path is in scripts/check-accrual.mjs.
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
 * Normalise a date-ish value to a Date at UTC midnight.
 *
 * Dates arrive here two ways and they must not be mixed:
 *   - 'YYYY-MM-DD' from Postgres `date` columns. These are calendar dates with no
 *     timezone. `new Date(str)` reads them as UTC midnight, which then shifts a day
 *     earlier for any viewer west of Greenwich once local fields are read off it.
 *     So the string is split and rebuilt, never parsed.
 *   - Date objects representing "now". Their LOCAL calendar date is what the user
 *     means by today, so those fields are read and re-pinned to UTC midnight.
 *
 * Everything downstream then does arithmetic between UTC midnights, where a day is
 * always exactly 86,400,000ms - no DST short days, no floor() losing a day in March.
 *
 * @param {Date|string|null|undefined} value
 * @returns {Date|null} UTC-midnight Date, or null if unparseable
 */
export function toUtcDay(value) {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/**
 * Whole days between two UTC-midnight Dates. Exact - both ends must come from toUtcDay().
 * @param {Date} fromDay
 * @param {Date} toDay
 * @returns {number}
 */
export function daysBetweenUtc(fromDay, toDay) {
  return Math.floor((toDay.getTime() - fromDay.getTime()) / 86400000);
}

/**
 * Display a UTC-midnight Date as its own calendar day.
 *
 * date-fns format() and friends render in local time, which would show these a day early
 * for any viewer west of Greenwich - the very shift toUtcDay() exists to prevent. Use
 * this for anything derived from a date column.
 *
 * @param {Date} day
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string}
 */
export function formatUtcDay(day, options = { day: 'numeric', month: 'short' }) {
  if (!day) return '';
  return day.toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' });
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
 * The annual rate to use for an investor.
 *
 * Product first, because that is the only rate the nightly job looks at
 * (nightly-jobs/index.ts passes `product.interest_rate_per_annum` and never reads
 * `investor.annual_interest_rate`). Preferring the investor field here would show a
 * figure that can never match the credit that gets posted.
 *
 * @param {Object} investor
 * @param {Object} product - the investor's InvestorProduct
 * @returns {number} percent per annum, 0 when neither is set
 */
export function resolveInvestorAnnualRate(investor, product) {
  return Number(product?.interest_rate_per_annum) || Number(investor?.annual_interest_rate) || 0;
}

const zeroAccrual = () => ({
  accruedInterest: 0,
  days: 0,
  dailyRate: 0,
  segments: [],
  description: '',
  periodStart: null,
  periodStartSource: 'none',
  balanceAtPeriodEnd: 0
});

/**
 * Segmented interest for a period, cutting at every capital change.
 *
 * Mirrors calculateInvestorInterestForMonth() in supabase/functions/nightly-jobs/index.ts.
 * The conventions below are that function's, not choices made here:
 *
 *   - Any transaction type other than 'capital_in' reduces the balance. That includes
 *     legacy interest_credit/interest_debit rows sitting in InvestorTransaction, which
 *     the job also subtracts. Pass the RAW transaction list, unfiltered, or this will
 *     not agree with what gets posted.
 *   - A transaction dated D means the new balance applies FROM D inclusive.
 *   - The final segment includes periodEnd, so a clean month yields its full day count.
 *   - Interest accumulates unrounded and is rounded once at the end.
 *
 * @param {Array<{type: string, amount: number|string, date: string}>} transactions
 * @param {number} annualRate - percent per annum
 * @param {Date|string} periodStart - inclusive
 * @param {Date|string} periodEnd - inclusive
 * @param {Object} [options]
 * @param {string} [options.label] - month name for the description; defaults from periodStart
 * @returns {Object} { totalInterest, segments, description, balanceAtPeriodStart,
 *                     balanceAtPeriodEnd, totalDays }
 */
export function calculateSegmentedInterest(transactions, annualRate, periodStart, periodEnd, options = {}) {
  const start = toUtcDay(periodStart);
  const end = toUtcDay(periodEnd);

  const empty = {
    totalInterest: 0,
    segments: [],
    description: '',
    balanceAtPeriodStart: 0,
    balanceAtPeriodEnd: 0,
    totalDays: 0
  };
  if (!start || !end || end < start) return empty;

  const rows = (transactions || [])
    .map(tx => ({
      day: toUtcDay(tx.date),
      amount: typeof tx.amount === 'string' ? parseFloat(tx.amount) : tx.amount,
      isIn: tx.type === 'capital_in'
    }))
    .filter(tx => tx.day && !Number.isNaN(tx.amount))
    .sort((a, b) => a.day - b.day);

  let balanceAtPeriodStart = 0;
  for (const tx of rows) {
    if (tx.day < start) balanceAtPeriodStart += tx.isIn ? tx.amount : -tx.amount;
  }

  // Balance after each movement inside the period. Several movements can share a day;
  // they collapse into zero-length segments below, so their order within the day is
  // irrelevant to the total.
  const changeEvents = [];
  let running = balanceAtPeriodStart;
  for (const tx of rows) {
    if (tx.day >= start && tx.day <= end) {
      running += tx.isIn ? tx.amount : -tx.amount;
      changeEvents.push({ day: tx.day, newBalance: running });
    }
  }

  const dailyRateFactor = (Number(annualRate) || 0) / 100 / 365;
  const segments = [];
  let totalInterest = 0;
  let totalDays = 0;
  let segmentStart = start;
  let segmentBalance = balanceAtPeriodStart;

  const pushSegment = (days, balance, endDay) => {
    if (days <= 0 || balance <= 0) return;
    const dailyRate = balance * dailyRateFactor;
    totalInterest += dailyRate * days;
    totalDays += days;
    segments.push({
      days,
      balance: Math.round(balance * 100) / 100,
      dailyRate: Math.round(dailyRate * 100) / 100,
      interest: Math.round(dailyRate * days * 100) / 100,
      startDate: segmentStart,
      endDate: endDay
    });
  };

  for (const event of changeEvents) {
    const days = daysBetweenUtc(segmentStart, event.day);
    pushSegment(days, segmentBalance, new Date(event.day.getTime() - 86400000));
    segmentStart = event.day;
    segmentBalance = event.newBalance;
  }

  pushSegment(daysBetweenUtc(segmentStart, end) + 1, segmentBalance, end);

  const roundedTotal = Math.round(totalInterest * 100) / 100;
  const label = options.label
    || start.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  let description;
  if (segments.length === 0) {
    description = `Interest for ${label}: No balance`;
  } else if (segments.length === 1) {
    description = `Interest for ${label}: ${segments[0].days}d @ £${segments[0].dailyRate.toFixed(2)} = £${roundedTotal.toFixed(2)}`;
  } else {
    const working = segments.map(s => `${s.days}d @ £${s.dailyRate.toFixed(2)}`).join(' + ');
    description = `Interest for ${label}: ${working} = £${roundedTotal.toFixed(2)}`;
  }

  return {
    totalInterest: roundedTotal,
    segments,
    description,
    balanceAtPeriodStart: Math.round(balanceAtPeriodStart * 100) / 100,
    balanceAtPeriodEnd: Math.round(segmentBalance * 100) / 100,
    totalDays
  };
}

/**
 * Interest accrued since the last posting, up to and including `asOf`.
 *
 * Inclusive of today, so that on the last day of a month this returns exactly what the
 * nightly job will credit on the 1st.
 *
 * @param {Array} transactions - RAW InvestorTransaction rows for one investor
 * @param {number} annualRate - percent per annum
 * @param {Date|string|null} lastAccrualDate - Investor.last_accrual_date
 * @param {Object} [options]
 * @param {Date|string} [options.asOf] - defaults to today
 * @param {Array<{type: string, date: string}>} [options.interestEntries] - for the fallback
 * @returns {Object} { accruedInterest, days, dailyRate, segments, description,
 *                     periodStart, periodStartSource, balanceAtPeriodEnd }
 */
export function calculateAccruingInterest(transactions, annualRate, lastAccrualDate, options = {}) {
  if (!annualRate || annualRate <= 0) return zeroAccrual();

  // The job sets last_accrual_date to the 1st of the month it runs in - the day after
  // the period it just posted - so it is already the next period's start.
  let periodStart = toUtcDay(lastAccrualDate);
  let periodStartSource = 'last_accrual_date';

  if (!periodStart) {
    // The job stamps each credit with the same date it writes to last_accrual_date, so
    // the latest credit is a faithful stand-in when the field was never set or was lost.
    const credits = (options.interestEntries || [])
      .filter(e => e.type === 'credit')
      .map(e => toUtcDay(e.date))
      .filter(Boolean);
    if (credits.length > 0) {
      periodStart = new Date(Math.max(...credits.map(d => d.getTime())));
      periodStartSource = 'last_interest_credit';
    }
  }

  if (!periodStart) {
    // Nothing has ever been posted. Accruing from the first contribution is the honest
    // answer; the old code returned zero here, which hid real money.
    const days = (transactions || []).map(tx => toUtcDay(tx.date)).filter(Boolean);
    if (days.length > 0) {
      periodStart = new Date(Math.min(...days.map(d => d.getTime())));
      periodStartSource = 'first_transaction';
    }
  }

  if (!periodStart) return zeroAccrual();

  const asOf = toUtcDay(options.asOf || new Date());
  if (!asOf || asOf < periodStart) {
    return { ...zeroAccrual(), periodStart, periodStartSource };
  }

  const result = calculateSegmentedInterest(transactions, annualRate, periodStart, asOf);
  const lastSegment = result.segments[result.segments.length - 1];

  return {
    accruedInterest: result.totalInterest,
    days: result.totalDays,
    // The current rate, for the single-segment subtitle. With several segments the
    // subtitle switches to a breakdown instead, so this is only a fallback.
    dailyRate: lastSegment ? lastSegment.dailyRate : 0,
    segments: result.segments,
    description: result.description,
    periodStart,
    periodStartSource,
    balanceAtPeriodEnd: result.balanceAtPeriodEnd
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
