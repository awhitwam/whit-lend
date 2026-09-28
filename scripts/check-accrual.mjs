/**
 * Pins the segmented investor-interest calculation against known-good figures.
 *
 * The fixture is investor 1000001 (ADW Enterprises) for September 2026, taken from the
 * real ledger. That month is a good test because capital moves seven times: a GBP 1.4m
 * drawdown mid-month and six repayments over three consecutive days.
 *
 * Run: node scripts/check-accrual.mjs
 *
 * The authority this is checking against is calculateInvestorInterestForMonth() in
 * supabase/functions/nightly-jobs/index.ts. If that changes, this must too.
 */

import {
  calculateSegmentedInterest,
  calculateAccruingInterest,
  toUtcDay,
  daysBetweenUtc,
  formatUtcDay
} from '../src/lib/interestCalculation.js';

const RATE = 10;

// Opening balance of 5,134,500 as at 1 Sep 2026, then September's movements.
const transactions = [
  { type: 'capital_in', amount: 5134500, date: '2026-08-01' },
  { type: 'capital_in', amount: 1400000, date: '2026-09-15' },
  { type: 'capital_out', amount: 250000, date: '2026-09-21' },
  { type: 'capital_out', amount: 250000, date: '2026-09-21' },
  { type: 'capital_out', amount: 250000, date: '2026-09-22' },
  { type: 'capital_out', amount: 250000, date: '2026-09-22' },
  { type: 'capital_out', amount: 200000, date: '2026-09-23' },
  { type: 'capital_out', amount: 250000, date: '2026-09-23' }
];

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        expected ${expected}\n        actual   ${actual}`);
};

// --- 1. The reported case: through 27 Sep, the old card's 27-day window ---
const to27 = calculateSegmentedInterest(transactions, RATE, '2026-09-01', '2026-09-27');
console.log('\nSegments 1-27 Sep:');
for (const s of to27.segments) {
  console.log(`  ${s.days}d @ ${s.balance.toFixed(2)} -> ${s.dailyRate.toFixed(2)}/day = ${s.interest.toFixed(2)}`);
}
check('through 27 Sep totals 40570.27', to27.totalInterest, 40570.27);
check('through 27 Sep spans 27 days', to27.totalDays, 27);
check('through 27 Sep has 5 segments', to27.segments.length, 5);

// The flat calculation the card used to do, for contrast.
const flat = Math.round((5084500 * (RATE / 100) / 365) * 27 * 100) / 100;
console.log(`\n  flat (old) would give ${flat.toFixed(2)} - understated by ${(to27.totalInterest - flat).toFixed(2)}`);

// --- 2. Inclusivity: on 28 Sep the card must count 28 days, not 27 ---
const asOf28 = calculateAccruingInterest(transactions, RATE, '2026-09-01', { asOf: '2026-09-28' });
check('as of 28 Sep counts 28 days', asOf28.days, 28);

// --- 3. Acceptance criterion: on 30 Sep the card equals what the 1 Oct job posts ---
const asOf30 = calculateAccruingInterest(transactions, RATE, '2026-09-01', { asOf: '2026-09-30' });
const whatJobPosts = calculateSegmentedInterest(transactions, RATE, '2026-09-01', '2026-09-30');
check('30 Sep card == full-month posting', asOf30.accruedInterest, whatJobPosts.totalInterest);
check('30 Sep card counts 30 days', asOf30.days, 30);
console.log(`\n  description: ${whatJobPosts.description}`);

// --- 4. A clean month yields its exact calendar length ---
const steady = [{ type: 'capital_in', amount: 1000000, date: '2026-01-01' }];
check('Feb 2026 (no movement) is 28 days',
  calculateSegmentedInterest(steady, RATE, '2026-02-01', '2026-02-28').totalDays, 28);
check('Jul 2026 (no movement) is 31 days',
  calculateSegmentedInterest(steady, RATE, '2026-07-01', '2026-07-31').totalDays, 31);

// --- 5. DST: local-midnight arithmetic loses a day here; UTC must not ---
check('March 2026 spans 31 days across the spring shift',
  calculateSegmentedInterest(steady, RATE, '2026-03-01', '2026-03-31').totalDays, 31);
check('October 2026 spans 31 days across the autumn shift',
  calculateSegmentedInterest(steady, RATE, '2026-10-01', '2026-10-31').totalDays, 31);
check('daysBetweenUtc across the spring shift',
  daysBetweenUtc(toUtcDay('2026-03-01'), toUtcDay('2026-03-31')), 30);

// --- 6. A transaction takes effect on its own date, not the day after ---
const sameDay = [
  { type: 'capital_in', amount: 1000000, date: '2026-05-01' },
  { type: 'capital_in', amount: 1000000, date: '2026-05-02' }
];
const twoDays = calculateSegmentedInterest(sameDay, RATE, '2026-05-01', '2026-05-02');
// 1 May at 1m, 2 May at 2m
const expected = Math.round(((1000000 + 2000000) * (RATE / 100) / 365) * 100) / 100;
check('new balance applies from its own date', twoDays.totalInterest, expected);

// --- 7. Non-capital_in rows are deductions, matching the job ---
const withLegacy = [
  { type: 'capital_in', amount: 1000000, date: '2026-06-01' },
  { type: 'interest_credit', amount: 5000, date: '2026-06-01' }
];
check('a non-capital_in row reduces the balance',
  calculateSegmentedInterest(withLegacy, RATE, '2026-06-01', '2026-06-01').balanceAtPeriodEnd, 995000);

// --- 8. Period-start fallbacks ---
check('falls back to the latest interest credit',
  calculateAccruingInterest(transactions, RATE, null, {
    asOf: '2026-09-30',
    interestEntries: [
      { type: 'credit', date: '2026-08-01' },
      { type: 'credit', date: '2026-09-01' },
      { type: 'debit', date: '2026-09-20' }
    ]
  }).periodStartSource, 'last_interest_credit');

check('falls back to the first transaction',
  calculateAccruingInterest(transactions, RATE, null, { asOf: '2026-09-30' }).periodStartSource,
  'first_transaction');

check('no rate yields no accrual',
  calculateAccruingInterest(transactions, 0, '2026-09-01', { asOf: '2026-09-30' }).accruedInterest, 0);

// --- 9. Dates must render as their own calendar day, not shifted by the viewer's zone.
// Run under TZ=America/New_York to prove it; local formatting shows 14 Sep there.
// Assert the day number, not the month spelling - en-GB renders September as "Sept"
// and that varies with the ICU build.
check('a date column renders as its own day',
  formatUtcDay(toUtcDay('2026-09-15')).startsWith('15 '), true);
check('segment boundaries are not zone-shifted',
  formatUtcDay(to27.segments[1].startDate).startsWith('15 '), true);
check('a date string is not shifted on parse',
  toUtcDay('2026-09-15').toISOString().slice(0, 10), '2026-09-15');
check('a Date is read by its local calendar day',
  toUtcDay(new Date(2026, 8, 15, 23, 30)).toISOString().slice(0, 10), '2026-09-15');

console.log(`\nTZ=${process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone}`);
console.log(`${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
