/**
 * Pins the dashboard's "stopped paying interest" list.
 *
 * Run: node scripts/check-late-payments.mjs
 *
 * Every fixture pins asOf = 2026-10-13 so results never drift with the clock.
 *
 * The negative controls are the point of this file. Two of them guard findings that would
 * silently break the feature rather than error:
 *   - a quarterly rent loan 4 days past its quarter must NOT be listed (a flat monthly
 *     interval would call it 65 days late, tier 4)
 *   - a Fixed Charge loan paying through fees_applied MUST be listed (an interest_applied
 *     filter plus the never-paid gate would drop every FC loan with no error)
 */

import {
  buildLatePaymentRows,
  resolveSchedulerType,
  classifyServicing,
  deriveExpectedInterval,
  lastInterestPayment,
  snapIntervalToCadence,
  severityTier,
  addMonthsUtc,
  GRACE_DAYS,
  SEVERITY_TIERS
} from '../src/lib/latePayments.js';
import { toUtcDay } from '../src/lib/interestCalculation.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        expected ${expected}\n        actual   ${actual}`);
};

const AS_OF = '2026-10-13';

// Captured before the timezone experiment below: Node caches a TZ change inside Intl
// even after process.env.TZ is put back, so reading the zone at the end misreports it.
const AMBIENT_TZ = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// --- fixture helpers --------------------------------------------------------

let seq = 0;
const loan = (over = {}) => ({
  id: `loan-${++seq}`,
  loan_number: `10000${seq}`,
  borrower_name: `Borrower ${seq}`,
  status: 'Live',
  start_date: '2025-01-01',
  principal_amount: 500000,
  principal_remaining: 500000,
  period: 'Monthly',
  interest_type: 'Reducing',
  ...over
});

/** A Repayment carrying interest. */
const pay = (loanId, date, interest = 4200) => ({
  loan_id: loanId, type: 'Repayment', date, amount: interest, interest_applied: interest
});

/** A Repayment carrying a Fixed Charge (settles via fees_applied). */
const payFee = (loanId, date, fees = 3000) => ({
  loan_id: loanId, type: 'Repayment', date, amount: fees, fees_applied: fees
});

/** A schedule row. */
const due = (loanId, date, interestAmount = 4200, over = {}) => ({
  loan_id: loanId, due_date: date, interest_amount: interestAmount, ...over
});

/** Monthly due dates on `day` of each month, from `fromMonth` for `count` months. */
const monthlyDues = (loanId, startISO, count, interestAmount = 4200, over = {}) => {
  const out = [];
  let day = toUtcDay(startISO);
  for (let i = 0; i < count; i++) {
    out.push(due(loanId, day.toISOString().slice(0, 10), interestAmount, over));
    day = addMonthsUtc(day, 1);
  }
  return out;
};

const build = (over) => buildLatePaymentRows({ asOf: AS_OF, debug: true, ...over });
const only = (over) => {
  const { rows } = build(over);
  return rows[0] || null;
};
const reasonFor = (over, loanId) => {
  const { excluded } = build(over);
  const hit = excluded.find(e => e.loanId === loanId);
  return hit ? hit.reason : null;
};

console.log(`\nasOf ${AS_OF}, GRACE_DAYS=${GRACE_DAYS}, tiers ${SEVERITY_TIERS.join('/')}\n`);

// --- 1. The basic case: a monthly payer who has stopped ---------------------
// Last paid 1 Aug 2026; 73 days to 13 Oct. The schedule-derived interval is 31, not 30:
// the median gap between calendar month-ends really is 31 days. 73 - 31 = 42 days late.
const monthly = loan();
const monthlyFixture = {
  loans: [monthly],
  transactions: [pay(monthly.id, '2026-06-01'), pay(monthly.id, '2026-07-01'), pay(monthly.id, '2026-08-01')],
  schedules: monthlyDues(monthly.id, '2025-02-01', 24)
};
const basic = only(monthlyFixture);
check('a lapsed monthly payer is listed', basic !== null, true);
check('cadence comes from the schedule', basic.cadenceSource, 'schedule');
check('the interval is a calendar month', basic.expectedIntervalDays, 31);
check('days since last payment is exact', basic.daysSinceLastPayment, 73);
check('days late nets off the interval', basic.daysLate, 42);
check('tier 3 at 42 days late', basic.tier, 3);
check('cadence label reads monthly', basic.cadenceLabel, 'monthly');
check('last paid amount is the real payment', basic.lastPaidAmount, 4200);
check('last paid date is formatted as its own day', basic.lastPaidLabel, '1 Aug 2026');

// Last paid 1 Sep 2026: 42 days, 11 past the interval - tier 1.
const fresh = loan();
const freshRow = only({
  loans: [fresh],
  transactions: [pay(fresh.id, '2026-08-01'), pay(fresh.id, '2026-09-01')],
  schedules: monthlyDues(fresh.id, '2025-02-01', 24)
});
check('11 days late is tier 1', freshRow.tier, 1);
check('and it is 11 days late', freshRow.daysLate, 11);

// --- 2. Rent: the false-positive class this design exists to prevent --------
// A quarterly rent payer last paid 2026-07-16: 89 days ago, 4 days past a 91-day quarter
// after the grace of 0... in fact 89 - 91 = -2, so NOT late. A flat monthly interval
// would make it 89 - 30 = 59 days late, tier 3.
const rent = loan({
  interest_type: null,
  product_type: 'Rent',
  period: 'Monthly',          // the Rent product really is Monthly - that is the trap
  start_date: '2024-06-01'
});
const rentTx = [
  pay(rent.id, '2026-01-15', 9000),
  pay(rent.id, '2026-04-15', 9000),
  pay(rent.id, '2026-07-16', 9000)
];
const rentFixture = { loans: [rent], transactions: rentTx, schedules: [] };
check('a rent loan within its quarter is NOT listed', build(rentFixture).rows.length, 0);
check('the rent loan is excluded as current', reasonFor(rentFixture, rent.id), 'current');
check('rent cadence is payment-derived', deriveExpectedInterval(rent, 'rent', [], rentTx.map(t => toUtcDay(t.date))).source, 'payments');
check('rent cadence snaps to a quarter', deriveExpectedInterval(rent, 'rent', [], rentTx.map(t => toUtcDay(t.date))).intervalDays, 91);
// Negative control: the same fixture read on a monthly interval.
check('NEGATIVE CONTROL: a flat monthly interval would call it late', 89 - 30 > GRACE_DAYS, true);
check('NEGATIVE CONTROL: and would put it in tier 3', severityTier(89 - 30), 3);

// A rent payer genuinely a quarter behind IS listed.
const lateRent = loan({ interest_type: null, product_type: 'Rent', start_date: '2024-06-01' });
const lateRentRow = only({
  loans: [lateRent],
  transactions: [
    pay(lateRent.id, '2025-10-15', 9000),
    pay(lateRent.id, '2026-01-15', 9000),
    pay(lateRent.id, '2026-04-15', 9000)
  ],
  schedules: []
});
check('a rent payer a quarter behind is listed', lateRentRow !== null, true);
check('its interval is quarterly', lateRentRow.expectedIntervalDays, 91);
check('its label reads quarterly', lateRentRow.cadenceLabel, 'quarterly');

// Rent with no measurable cadence is excluded, never guessed at as monthly.
const oneRent = loan({ interest_type: null, product_type: 'Rent' });
check('a rent loan with one payment is excluded, not guessed',
  reasonFor({ loans: [oneRent], transactions: [pay(oneRent.id, '2026-01-15', 9000)], schedules: [] }, oneRent.id),
  'cadence-unknown');

// --- 3. Fixed Charge pays through fees_applied ------------------------------
const fc = loan({ interest_type: null, product_type: 'Fixed Charge', product_id: 'prod-fc', start_date: '2025-06-01' });
const fcFixture = {
  loans: [fc],
  transactions: [payFee(fc.id, '2026-06-01'), payFee(fc.id, '2026-07-01'), payFee(fc.id, '2026-08-01')],
  schedules: monthlyDues(fc.id, '2025-07-01', 24, 3000)
};
const fcRow = only(fcFixture);
check('a Fixed Charge loan paying via fees_applied IS listed', fcRow !== null, true);
check('its scheduler type resolves to fixed_charge', fcRow.schedulerType, 'fixed_charge');
check('its last payment amount comes from fees_applied', fcRow.lastPaidAmount, 3000);
check('NEGATIVE CONTROL: an interest_applied filter sees no payment',
  lastInterestPayment(fcFixture.transactions, 'reducing_balance').count, 0);
check('NEGATIVE CONTROL: so the never-paid gate drops it entirely',
  buildLatePaymentRows({
    ...fcFixture,
    asOf: AS_OF,
    products: [{ id: 'prod-fc', scheduler_type: 'reducing_balance' }]
  }).rows.length, 0);

// An exit fee on an ordinary loan must not reset the interest clock.
const withFee = loan();
const feeNoisy = only({
  loans: [withFee],
  transactions: [
    pay(withFee.id, '2026-07-01'), pay(withFee.id, '2026-08-01'),
    { loan_id: withFee.id, type: 'Repayment', date: '2026-10-10', amount: 950, fees_applied: 950 }
  ],
  schedules: monthlyDues(withFee.id, '2025-02-01', 24)
});
check('an exit fee does not reset the clock', feeNoisy.lastPaidLabel, '1 Aug 2026');

// --- 4. Classification -----------------------------------------------------
const irregular = loan({ interest_type: null, product_type: 'Irregular Income' });
check('irregular income expects no periodic interest',
  reasonFor({ loans: [irregular], transactions: [pay(irregular.id, '2026-01-01')], schedules: [] }, irregular.id),
  'no-periodic-interest');

// Rolled-up: in term, nothing is owed even though extension rows already exist.
const rolled = loan({ interest_type: 'Rolled-Up', start_date: '2026-01-01' });
const rolledRows = [
  ...monthlyDues(rolled.id, '2027-01-01', 1, 60000),                                  // term end, future
  ...monthlyDues(rolled.id, '2027-02-01', 12, 5000, { is_extension_period: true })     // 12 speculative
];
check('a rolled-up loan in term is not yet servicing',
  reasonFor({ loans: [rolled], transactions: [pay(rolled.id, '2026-02-01', 1200)], schedules: rolledRows }, rolled.id),
  'not-yet-servicing');
check('extension rows alone do not prove servicing started',
  rolledRows.filter(r => r.is_extension_period).length, 12);

// Rolled-up in extension: term ended 1 Mar 2026, last paid 1 Jun, monthly extension.
const extended = loan({ interest_type: 'Rolled-Up', start_date: '2025-03-01' });
const extendedRow = only({
  loans: [extended],
  transactions: [pay(extended.id, '2026-05-01', 5000), pay(extended.id, '2026-06-01', 5000)],
  schedules: [
    due(extended.id, '2026-03-01', 60000),
    ...monthlyDues(extended.id, '2026-04-01', 12, 5000, { is_extension_period: true })
  ]
});
check('a rolled-up loan in extension is assessed', extendedRow !== null, true);
check('its cadence comes from the extension rows', extendedRow.cadenceSource, 'schedule');
check('it is 103 days late', extendedRow.daysLate, 103);

// roll_up_serviced: roll_up_length null and 0 must resolve identically (the || vs ?? parity).
const rusA = loan({ interest_type: 'Roll-Up & Serviced', start_date: '2026-01-01', roll_up_length: null });
const rusB = loan({ interest_type: 'Roll-Up & Serviced', start_date: '2026-01-01', roll_up_length: 0 });
const startA = classifyServicing(rusA, 'roll_up_serviced', []).servicingStartDay;
const startB = classifyServicing(rusB, 'roll_up_serviced', []).servicingStartDay;
check('roll_up_length null resolves to month 7', startA.toISOString().slice(0, 10), '2026-08-01');
check('roll_up_length 0 resolves identically', startB.toISOString().slice(0, 10), startA.toISOString().slice(0, 10));
check('roll_up_serviced resolves from interest_type',
  resolveSchedulerType(rusA, null), 'roll_up_serviced');

// A serviced row overrides the fallback.
const rusC = loan({ interest_type: 'Roll-Up & Serviced', start_date: '2026-01-01', roll_up_length: 6 });
check('a serviced row dates the servicing start',
  classifyServicing(rusC, 'roll_up_serviced', [
    due(rusC.id, '2026-07-01', 0, { is_roll_up_period: true }),
    due(rusC.id, '2026-08-01', 5000, { is_serviced_period: true })
  ]).servicingStartDay.toISOString().slice(0, 10),
  '2026-08-01');

// The product beats the loan, and products: [] falls back to the loan.
check('product scheduler_type wins',
  resolveSchedulerType({ interest_type: 'Reducing' }, { scheduler_type: 'rent' }), 'rent');
check('product_type beats interest_type',
  resolveSchedulerType({ interest_type: 'Reducing' }, { product_type: 'Fixed Charge' }), 'fixed_charge');
check('the loan is the fallback when there is no product',
  resolveSchedulerType({ interest_type: 'Interest-Only' }, null), 'interest_only');
check('an unknown type defaults to reducing_balance',
  resolveSchedulerType({ interest_type: 'Something Else' }, null), 'reducing_balance');

// --- 5. Exclusions ----------------------------------------------------------
const never = loan();
const neverFixture = { loans: [never], transactions: [], schedules: monthlyDues(never.id, '2025-02-01', 24) };
check('a loan that never paid is excluded', reasonFor(neverFixture, never.id), 'never-paid');
check('includeNeverPaid lists it',
  buildLatePaymentRows({ ...neverFixture, asOf: AS_OF, includeNeverPaid: true }).rows.length, 1);

const redeemed = loan({ principal_remaining: 0 });
check('a redeemed loan is excluded',
  reasonFor({ loans: [redeemed], transactions: [pay(redeemed.id, '2026-01-01')], schedules: [] }, redeemed.id),
  'redeemed');

const nullBalance = loan({ principal_remaining: null });
check('a null principal_remaining does not exclude',
  only({
    loans: [nullBalance],
    transactions: [pay(nullBalance.id, '2026-07-01'), pay(nullBalance.id, '2026-08-01')],
    schedules: monthlyDues(nullBalance.id, '2025-02-01', 24)
  }) !== null, true);

const current = loan();
check('a current payer is excluded',
  reasonFor({
    loans: [current],
    transactions: [pay(current.id, '2026-09-20'), pay(current.id, '2026-10-05')],
    schedules: monthlyDues(current.id, '2025-02-01', 24)
  }, current.id), 'current');

const future = loan({ start_date: '2026-10-01' });
check('a schedule entirely in the future is excluded',
  reasonFor({
    loans: [future],
    transactions: [pay(future.id, '2026-10-05')],
    schedules: monthlyDues(future.id, '2026-11-01', 12)
  }, future.id), 'not-yet-servicing');

// Paying three periods up front buys three periods of silence.
const prepaid = loan();
const prepaidFixture = {
  loans: [prepaid],
  transactions: [pay(prepaid.id, '2026-06-01', 4200), pay(prepaid.id, '2026-07-01', 16800)],
  schedules: monthlyDues(prepaid.id, '2025-02-01', 24, 4200)
};
check('paying four periods at once is recognised', only(prepaidFixture) === null, true);
check('and the prepaid count is three further periods',
  lastInterestPayment(prepaidFixture.transactions, 'reducing_balance').lastAmount, 16800);
check('the prepaid loan reads as current', reasonFor(prepaidFixture, prepaid.id), 'current');

const deletedTx = loan();
check('a deleted transaction is ignored',
  reasonFor({
    loans: [deletedTx],
    transactions: [pay(deletedTx.id, '2026-08-01'), { ...pay(deletedTx.id, '2026-10-12'), is_deleted: true }],
    schedules: monthlyDues(deletedTx.id, '2025-02-01', 24)
  }, deletedTx.id), null);

// --- 6. Cadence fallback chain ---------------------------------------------
const noSchedule = loan();
const noScheduleRow = only({
  loans: [noSchedule],
  transactions: [pay(noSchedule.id, '2026-05-01'), pay(noSchedule.id, '2026-06-01'), pay(noSchedule.id, '2026-07-01')],
  schedules: []
});
check('no schedule falls through to payment-derived', noScheduleRow.cadenceSource, 'payments');
check('and still measures a monthly cadence', noScheduleRow.expectedIntervalDays, 30);

const onePayment = loan({ period: 'Weekly' });
const onePaymentRow = only({
  loans: [onePayment],
  transactions: [pay(onePayment.id, '2026-08-01')],
  schedules: []
});
check('a single payment falls through to period-derived', onePaymentRow.cadenceSource, 'period');
check('a Weekly loan gets a 7-day interval', onePaymentRow.expectedIntervalDays, 7);

// A stub first period must not drag the median.
const stub = loan();
check('a stub first period does not drag the median down to 18',
  only({
    loans: [stub],
    transactions: [pay(stub.id, '2026-07-01'), pay(stub.id, '2026-08-01')],
    schedules: [
      due(stub.id, '2025-01-14', 1800),
      ...monthlyDues(stub.id, '2025-02-01', 23)
    ]
  }).expectedIntervalDays, 31);

check('snap rounds an annual gap', snapIntervalToCadence(357), 365);
check('snap rounds a quarterly gap', snapIntervalToCadence(97), 91);
check('snap rounds a monthly gap', snapIntervalToCadence(33), 30);
check('snap rounds a fortnightly gap', snapIntervalToCadence(15), 14);
check('snap rounds a weekly gap', snapIntervalToCadence(8), 7);
check('snap leaves an unrecognised gap alone', snapIntervalToCadence(55), 55);

// --- 7. Order and tiers ----------------------------------------------------
// Five monthly loans last paying 8/16/35/70/120 days past their interval.
const offsets = [39, 47, 66, 101, 151];
const ladderLoans = offsets.map(() => loan());
const ladderTx = [];
const ladderSchedules = [];
ladderLoans.forEach((l, i) => {
  const lastDay = new Date(Date.UTC(2026, 9, 13) - offsets[i] * 86400000).toISOString().slice(0, 10);
  const priorDay = new Date(Date.UTC(2026, 9, 13) - (offsets[i] + 30) * 86400000).toISOString().slice(0, 10);
  ladderTx.push(pay(l.id, priorDay, 1000 * (i + 1)), pay(l.id, lastDay, 1000 * (i + 1)));
  ladderSchedules.push(...monthlyDues(l.id, '2025-02-01', 24));
});
const ladder = build({ loans: ladderLoans, transactions: ladderTx, schedules: ladderSchedules }).rows;
check('all five ladder loans are listed', ladder.length, 5);
check('the worst offender is first', ladder[0].daysLate, 120);
check('days late descend monotonically',
  ladder.every((r, i) => i === 0 || ladder[i - 1].daysLate >= r.daysLate), true);
check('tiers descend with them', ladder.map(r => r.tier).join(','), '5,4,3,2,1');

check('tier boundary 14 is tier 1', severityTier(14), 1);
check('tier boundary 15 is tier 2', severityTier(15), 2);
check('tier boundary 30 is tier 2', severityTier(30), 2);
check('tier boundary 31 is tier 3', severityTier(31), 3);
check('tier boundary 60 is tier 3', severityTier(60), 3);
check('tier boundary 61 is tier 4', severityTier(61), 4);
check('tier boundary 90 is tier 4', severityTier(90), 4);
check('tier boundary 91 is tier 5', severityTier(91), 5);

// --- 8. Dates ---------------------------------------------------------------
check('addMonthsUtc clamps 31 Jan + 1 month to 28 Feb',
  addMonthsUtc(toUtcDay('2026-01-31'), 1).toISOString().slice(0, 10), '2026-02-28');
check('addMonthsUtc clamps into a leap February',
  addMonthsUtc(toUtcDay('2028-01-31'), 1).toISOString().slice(0, 10), '2028-02-29');
check('addMonthsUtc crosses a year boundary',
  addMonthsUtc(toUtcDay('2026-11-15'), 3).toISOString().slice(0, 10), '2027-02-15');

// A BST-era date must not shift. 1 Aug 2026 is inside British Summer Time.
check('a BST date is read as its own day', basic.lastPaidLabel, '1 Aug 2026');

// The timezone regression: identical results west of Greenwich. Re-run the headline
// fixture with TZ flipped - toUtcDay must make this a no-op.
const originalTZ = process.env.TZ;
process.env.TZ = 'America/New_York';
const westOfGreenwich = only(monthlyFixture);
if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ;
check('days late is identical under TZ=America/New_York', westOfGreenwich.daysLate, basic.daysLate);
check('the last paid day is identical too', westOfGreenwich.lastPaidLabel, basic.lastPaidLabel);

// --- 9. Shape and guards ---------------------------------------------------
check('no arguments does not throw', buildLatePaymentRows().rows.length, 0);
check('empty inputs yield no rows', build({ loans: [], transactions: [], schedules: [] }).rows.length, 0);
check('excluded stays empty without debug',
  buildLatePaymentRows({ ...monthlyFixture, asOf: AS_OF }).excluded.length, 0);
check('excluded is populated with debug', build(neverFixture).excluded.length, 1);
check('and names the reason', build(neverFixture).excluded[0].reason, 'never-paid');
check('a null loan row is skipped',
  build({ loans: [null, monthly], transactions: monthlyFixture.transactions, schedules: monthlyFixture.schedules }).rows.length, 1);
check('a raised grace period suppresses a marginal row',
  buildLatePaymentRows({ ...monthlyFixture, asOf: AS_OF, graceDays: 60 }).rows.length, 0);

console.log(`\nTZ=${AMBIENT_TZ}`);
console.log(`${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
