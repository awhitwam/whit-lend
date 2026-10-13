/**
 * Pins roll-up/serviced interest accrual across a capital repayment.
 *
 * The fixture is loan 1000043 (Howard & Ward Properties Ltd, Cockleberry Sawmills), taken from
 * the real ledger: GBP 1,202,500 at 15% from 03/06/2025, a 6-month roll-up of GBP 97,500
 * capitalised on 03/12/2025, then serviced monthly on (capital + roll-up) = GBP 1,300,000.
 *
 * A redemption of GBP 1,450,000 on 18/09/2026 settles outstanding interest, then the GBP 13,000
 * exit fee, with the balance to capital - leaving GBP 17,397.24 accruing at GBP 7.15/day.
 *
 * Before the fix the engine kept charging GBP 534.25/day on the full pre-repayment balance,
 * because the serviced period was never split at the repayment date and the tail accrual read a
 * frozen calculation_principal_start. That overstated interest by GBP 13,177.42 and grew by
 * GBP 527.10 a day.
 *
 * Run: node scripts/check-rollup-serviced.mjs
 */

import {
  calculateSegmentedInterest,
  calculateRollUpOutstandingAtDate,
  getCurrentInterestBase,
  getRollUpInterestFromSchedule,
  interestAccruedOnRow,
  calculateInterestOutstandingAtDate,
  allocateSettlement,
  getDailyRate,
  roundCurrency
} from '../src/lib/schedule/utils/interestCalculations.js';

const PRINCIPAL = 1202500;
const ROLL_UP = 97500;
const RATE = 15;
const EXIT_FEE = 13000;
const PAYMENT = 1450000;

const dailyRate = getDailyRate(RATE);
const START = new Date(2025, 5, 3);          // 03 Jun 2025
const PAID_ON = new Date(2026, 8, 18);       // 18 Sep 2026
const AS_OF = new Date(2026, 9, 13);         // 13 Oct 2026

// Interest accrued to the payment date, from the issued schedule: roll-up plus the nine
// serviced periods to 03/09/26, plus 15 days of the period in progress.
const INTEREST_TO_PAYMENT = 251897.24;
const TO_PAYMENT_CAPITAL = PAYMENT - INTEREST_TO_PAYMENT - EXIT_FEE;
const RESIDUAL_CAPITAL = roundCurrency(PRINCIPAL - TO_PAYMENT_CAPITAL);

const transactions = [
  {
    type: 'Disbursement',
    is_initial_disbursement: true,
    date: '2025-06-03',
    amount: 1189500,
    gross_amount: PRINCIPAL
  },
  {
    type: 'Repayment',
    date: '2026-09-18',
    amount: PAYMENT,
    interest_applied: INTEREST_TO_PAYMENT,
    fees_applied: EXIT_FEE,
    principal_applied: TO_PAYMENT_CAPITAL
  }
];

// The schedule as issued, with the roll-up flagged so the helpers can find it.
const schedule = [
  { installment_number: 1, due_date: '2025-12-03', interest_amount: ROLL_UP, calculation_days: 183, is_roll_up_period: true },
  { installment_number: 2, due_date: '2026-01-03', interest_amount: 16561.64, calculation_days: 31, is_serviced_period: true },
  { installment_number: 10, due_date: '2026-09-03', interest_amount: 16561.64, calculation_days: 31, is_serviced_period: true },
  { installment_number: 11, due_date: '2026-10-03', interest_amount: 16027.40, calculation_days: 30, is_serviced_period: true },
  { installment_number: 12, due_date: '2026-11-03', interest_amount: 16561.64, calculation_days: 31, is_serviced_period: true }
];

let failures = 0;
// Within a penny. The row in progress is pro-rated from interest_amount, which the DB already
// rounded to 2dp, so it can differ from the raw daily rate by a fraction of a penny.
const checkClose = (label, actual, expected, tolerance = 0.01) => {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        expected ${expected} +/- ${tolerance}, got ${actual}`);
};

const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        expected ${expected}, got ${actual}`);
};

const segmentedFor = (startY, startM, startD, endY, endM, endD) =>
  calculateSegmentedInterest({
    initialPrincipal: PRINCIPAL,
    rollUpInterest: ROLL_UP,
    transactions,
    periodStart: new Date(startY, startM, startD),
    periodEnd: new Date(endY, endM, endD),
    loanStartDate: START,
    dailyRate
  });

// --- 1. The period containing the repayment is split on the day it lands ---
const straddling = segmentedFor(2026, 8, 3, 2026, 9, 3);   // 03 Sep -> 03 Oct 2026
check('straddling period splits in two', straddling.segments.length, 2);
check('days before the repayment', straddling.segments[0].days, 15);
check('days after the repayment', straddling.segments[1].days, 15);
check('base before is capital + roll-up', straddling.segments[0].base, PRINCIPAL + ROLL_UP);
check('base after is the residual capital', roundCurrency(straddling.segments[1].base), RESIDUAL_CAPITAL);
check('daily rate before the repayment', roundCurrency(straddling.segments[0].dailyInterest), 534.25);
check('daily rate after the repayment', roundCurrency(straddling.segments[1].dailyInterest), 7.15);
check('straddling period interest', roundCurrency(straddling.interest), 8120.94);

// --- 2. Regression: periods before the repayment are untouched ---
check('period 03/08 -> 03/09 unchanged',
  roundCurrency(segmentedFor(2026, 7, 3, 2026, 8, 3).interest), 16561.64);
check('period 03/01 -> 03/02 unchanged',
  roundCurrency(segmentedFor(2025, 11, 3, 2026, 0, 3).interest), 16561.64);
check('a pre-repayment period does not split',
  segmentedFor(2026, 7, 3, 2026, 8, 3).segments.length, 1);

// --- 3. The capitalised roll-up leaves the base once settled ---
check('roll-up outstanding before the payment',
  calculateRollUpOutstandingAtDate(ROLL_UP, transactions, new Date(2026, 8, 1)), ROLL_UP);
check('roll-up cleared after the payment',
  calculateRollUpOutstandingAtDate(ROLL_UP, transactions, new Date(2026, 8, 19)), 0);
check('roll-up read from the schedule row',
  getRollUpInterestFromSchedule(schedule, { roll_up_amount: 0 }), ROLL_UP);

// --- 4. The live base is the residual capital, not the frozen pre-repayment figure ---
const base = getCurrentInterestBase({
  initialPrincipal: PRINCIPAL,
  rollUpInterest: ROLL_UP,
  transactions,
  asOfDate: AS_OF,
  loanStartDate: START
});
check('capital outstanding', roundCurrency(base.principal), RESIDUAL_CAPITAL);
check('no roll-up left in the base', base.rollUpOutstanding, 0);
check('interest base', roundCurrency(base.base), RESIDUAL_CAPITAL);
check('daily accrual after redemption', roundCurrency(base.base * dailyRate), 7.15);

// --- 5. Interest outstanding as at 13 Oct 2026 ---
// Nine serviced periods and the roll-up to 03/09/26, then the split period, then the tail.
const TO_SEP_3 = 243883.54;
const tailDays = Math.round((AS_OF - new Date(2026, 9, 3)) / 86400000);
check('tail is 10 days', tailDays, 10);
const interestDue = roundCurrency(TO_SEP_3 + straddling.interest + base.base * dailyRate * tailDays);
check('interest due to 13/10/26', interestDue, 252075.98);
check('interest outstanding', roundCurrency(interestDue - INTEREST_TO_PAYMENT), 178.74);
check('capital outstanding at 13/10/26', RESIDUAL_CAPITAL, 17397.24);

// --- 6. A payment cannot settle interest that has not accrued ---
const rowInProgress = schedule.find(r => r.due_date === '2026-10-03');
check('future period accrues nothing at the payment date',
  interestAccruedOnRow(schedule.find(r => r.due_date === '2026-11-03'), PAID_ON), 0);
check('period in progress is pro-rated',
  roundCurrency(interestAccruedOnRow(rowInProgress, PAID_ON)), 8013.70);
check('a past period accrues in full',
  interestAccruedOnRow(schedule.find(r => r.due_date === '2026-09-03'), PAID_ON), 16561.64);
check('no cut-off leaves the row whole',
  interestAccruedOnRow(rowInProgress, null), 16027.40);

// Roll-up (183d) + nine serviced periods + the pro-rated period in progress must reproduce the
// figure the redemption actually settled.
check('accrued interest at the payment date reconciles',
  roundCurrency(TO_SEP_3 + interestAccruedOnRow(rowInProgress, PAID_ON)), INTEREST_TO_PAYMENT);

// --- 6b. An advance loan is never pro-rated: its due date is the period START ---
check('advance loan: not yet due accrues nothing',
  interestAccruedOnRow(rowInProgress, new Date(2026, 8, 18), true), 0);
check('advance loan: due in full on the due date',
  interestAccruedOnRow(rowInProgress, new Date(2026, 9, 3), true), 16027.40);

// --- 7. A full redemption accrues nothing, whatever the frozen columns say ---
const redeemed = getCurrentInterestBase({
  initialPrincipal: PRINCIPAL,
  rollUpInterest: ROLL_UP,
  transactions: [
    transactions[0],
    { type: 'Repayment', date: '2026-09-18', interest_applied: INTEREST_TO_PAYMENT, principal_applied: PRINCIPAL }
  ],
  asOfDate: AS_OF,
  loanStartDate: START
});
check('fully repaid capital accrues nothing', redeemed.base, 0);

// --- 8. Loans with no roll-up are unaffected ---
const plain = calculateSegmentedInterest({
  initialPrincipal: PRINCIPAL,
  rollUpInterest: 0,
  transactions: [transactions[0]],
  periodStart: new Date(2026, 7, 3),
  periodEnd: new Date(2026, 8, 3),
  loanStartDate: START,
  dailyRate
});
check('no roll-up means interest on capital alone',
  roundCurrency(plain.interest), roundCurrency(PRINCIPAL * dailyRate * 31));

// --- 8b. Interest outstanding at a date, straight from the issued schedule ---
// This is what the receipt screen's Auto-fill prices the allocation from, so it must agree with
// the schedule on screen to the penny.
const fullSchedule = [
  { due_date: '2025-12-03', interest_amount: 97500,    calculation_days: 183, is_roll_up_period: true },
  { due_date: '2026-01-03', interest_amount: 16561.64, calculation_days: 31, is_serviced_period: true },
  { due_date: '2026-02-03', interest_amount: 16561.64, calculation_days: 31, is_serviced_period: true },
  { due_date: '2026-03-03', interest_amount: 14958.90, calculation_days: 28, is_serviced_period: true },
  { due_date: '2026-04-03', interest_amount: 16561.64, calculation_days: 31, is_serviced_period: true },
  { due_date: '2026-05-03', interest_amount: 16027.40, calculation_days: 30, is_serviced_period: true },
  { due_date: '2026-06-03', interest_amount: 16561.64, calculation_days: 31, is_serviced_period: true },
  { due_date: '2026-07-03', interest_amount: 16027.40, calculation_days: 30, is_serviced_period: true },
  { due_date: '2026-08-03', interest_amount: 16561.64, calculation_days: 31, is_serviced_period: true },
  { due_date: '2026-09-03', interest_amount: 16561.64, calculation_days: 31, is_serviced_period: true },
  { due_date: '2026-10-03', interest_amount: 16027.40, calculation_days: 30, is_serviced_period: true },
  { due_date: '2026-11-03', interest_amount: 16561.64, calculation_days: 31, is_serviced_period: true }
];

const atPayment = calculateInterestOutstandingAtDate({
  schedule: fullSchedule, transactions: [transactions[0]], asOfDate: PAID_ON
});
check('interest outstanding at 18/09/26', roundCurrency(atPayment.outstanding), 251897.24);

// 13 Oct is the figure on the loan header before any repayment: 10 days into the Nov row.
const atToday = calculateInterestOutstandingAtDate({
  schedule: fullSchedule, transactions: [transactions[0]], asOfDate: AS_OF
});
checkClose('interest outstanding at 13/10/26 (pre-repayment)', atToday.outstanding, 265253.41);

// Settled interest comes off.
const afterPaying = calculateInterestOutstandingAtDate({
  schedule: fullSchedule, transactions, asOfDate: PAID_ON
});
check('settled interest is deducted', roundCurrency(afterPaying.outstanding), 0);

// --- 9. Redemption allocation: interest, then fees, then capital ---
const split = allocateSettlement({
  amount: PAYMENT,
  interestOutstanding: INTEREST_TO_PAYMENT,
  feesOutstanding: EXIT_FEE,
  capitalOutstanding: PRINCIPAL
});
check('redemption settles interest first', roundCurrency(split.interest), 251897.24);
check('then the fee', roundCurrency(split.fees), 13000);
check('then capital', roundCurrency(split.capital), 1185102.76);
check('leaving a small capital balance', roundCurrency(split.capitalAfter), 17397.24);
check('with nothing unallocated', roundCurrency(split.excess), 0);
check('legs sum to the payment',
  roundCurrency(split.interest + split.fees + split.capital + split.excess), PAYMENT);

// A payment short of the interest owed never reaches the fee or capital.
const short = allocateSettlement({
  amount: 100000,
  interestOutstanding: INTEREST_TO_PAYMENT,
  feesOutstanding: EXIT_FEE,
  capitalOutstanding: PRINCIPAL
});
check('a short payment is all interest', short.interest, 100000);
check('a short payment pays no fee', short.fees, 0);
check('a short payment pays no capital', short.capital, 0);

// Paying more than the whole debt leaves an excess rather than over-settling a leg.
const over = allocateSettlement({
  amount: 2000000,
  interestOutstanding: INTEREST_TO_PAYMENT,
  feesOutstanding: EXIT_FEE,
  capitalOutstanding: PRINCIPAL
});
check('full redemption clears capital', roundCurrency(over.capitalAfter), 0);
check('excess is left unallocated',
  roundCurrency(over.excess), roundCurrency(2000000 - INTEREST_TO_PAYMENT - EXIT_FEE - PRINCIPAL));

console.log(`\nTZ=${process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone}`);
console.log(`${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
