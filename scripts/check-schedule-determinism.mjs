/**
 * Pins the schedule-duration rule that made the same loan generate different schedules
 * depending on which button was pressed.
 *
 * calculateScheduleDuration() branches on whether `options.endDate` was supplied AT ALL, so
 * passing it changes the duration rule rather than just the horizon:
 *
 *   endDate + principal <= 0.01   -> schedule TRUNCATED at the settlement date
 *   endDate + auto_extend         -> periods to cover the horizon, plus one future period
 *   endDate + principal > 0.01    -> loan.duration || 6
 *   no endDate                    -> loan.duration
 *
 * Nine call sites each decided this for themselves and disagreed. The worst case was
 * SuperAdmin, which passed `{ endDate: new Date() }` for every Live loan regardless of
 * auto_extend: a Live loan whose capital was fully repaid hit the isSettledLoan branch and had
 * its schedule truncated, while every other entry point generated the full duration.
 *
 * buildScheduleOptions() in LoanScheduleManager.jsx now resolves this once, from the loan's own
 * status and auto_extend. The cases below encode what each of those entry points used to pass,
 * so a future change that reintroduces the divergence fails here.
 *
 * DEPENDENCY RULE: import only from './schedule/utils/**'. durationCalculation.js pulls in
 * date-fns and dateUtils.js and nothing else, so this file loads under plain `node`. Importing
 * from '../src/components/**' would drag in '@/' path aliases, which node cannot resolve.
 *
 * Run: node scripts/check-schedule-determinism.mjs
 */

import { calculateScheduleDuration } from '../src/lib/schedule/utils/durationCalculation.js';

let failures = 0;

const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        expected ${expected}\n        actual   ${actual}`);
};

// A monthly loan, 12 months, started a year and a half ago, so "today" is well past maturity.
const START = '2025-01-15';
const product = { period: 'Monthly', interest_alignment: 'period_based' };

const loan = (over = {}) => ({
  id: 'loan-1',
  start_date: START,
  duration: 12,
  auto_extend: false,
  status: 'Live',
  ...over
});

const duration = (loanRec, options, outstanding) =>
  calculateScheduleDuration({
    loan: loanRec,
    product,
    options,
    currentPrincipalOutstanding: outstanding
  }).duration;

const settled = (loanRec, options, outstanding) =>
  calculateScheduleDuration({
    loan: loanRec,
    product,
    options,
    currentPrincipalOutstanding: outstanding
  }).isSettledLoan;

console.log('--- the four branches, stated explicitly ---');

// No endDate: contractual duration, whatever else is true.
check('no endDate, principal outstanding    -> loan.duration',
  duration(loan(), { duration: 12 }, 100000), 12);

check('no endDate, capital fully repaid     -> loan.duration (NOT truncated)',
  duration(loan(), { duration: 12 }, 0), 12);

check('no endDate, capital repaid           -> isSettledLoan false',
  settled(loan(), { duration: 12 }, 0), false);

// endDate + no capital: the truncating branch.
check('endDate, capital fully repaid        -> isSettledLoan true',
  settled(loan(), { endDate: '2025-07-15', duration: 12 }, 0), true);

// endDate + capital outstanding, not auto_extend: falls back to the contractual duration.
check('endDate, principal outstanding       -> loan.duration',
  duration(loan(), { endDate: '2026-10-30', duration: 12 }, 100000), 12);

console.log('\n--- the SuperAdmin regression: endDate forced on every Live loan ---');

// This is the bug. A Live loan whose capital is repaid gets a DIFFERENT duration depending
// only on whether the caller volunteered an endDate.
const repaidLive = loan({ status: 'Live' });
const withEndDate = duration(repaidLive, { endDate: '2025-07-15', duration: 12 }, 0);
const withoutEndDate = duration(repaidLive, { duration: 12 }, 0);

check('forcing endDate truncates a repaid Live loan (6 periods to settlement)',
  withEndDate, 6);
check('omitting endDate leaves it at the full 12',
  withoutEndDate, 12);
check('...so the two disagree - which is exactly what buildScheduleOptions prevents',
  withEndDate !== withoutEndDate, true);

console.log('\n--- buildScheduleOptions: the shape each loan state should now produce ---');

// buildScheduleOptions itself touches the data client, so it cannot be imported here. These
// assertions pin the CONTRACT it implements, against the same duration engine.
const asBuilt = {
  // status Live, auto_extend false -> { duration }
  liveFixed: { duration: 12 },
  // status Live, auto_extend true  -> { endDate: today, duration }
  liveAutoExtend: { endDate: '2026-10-30', duration: 12 },
  // status Closed -> { endDate: <settlement date>, duration }
  closed: { endDate: '2025-07-15', duration: 12 }
};

check('Live + fixed term     -> full duration',
  duration(loan(), asBuilt.liveFixed, 100000), 12);

check('Live + auto_extend    -> extended past maturity',
  duration(loan({ auto_extend: true }), asBuilt.liveAutoExtend, 100000) > 12, true);

check('Closed                -> truncated at settlement',
  settled(loan({ status: 'Closed' }), asBuilt.closed, 0), true);

console.log('\n--- idempotence: the same inputs must give the same answer ---');

const once = duration(loan({ auto_extend: true }), asBuilt.liveAutoExtend, 100000);
const twice = duration(loan({ auto_extend: true }), asBuilt.liveAutoExtend, 100000);
check('repeated generation is stable', once === twice, true);

console.log(
  `\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`
);
process.exit(failures === 0 ? 0 : 1);
