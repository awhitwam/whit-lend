/**
 * Pins the capital/interest split suggester for investor withdrawals.
 *
 * The headline fixture is the reported case: a GBP 44,749.32 debit described
 * "To ADW Enterprises Ltd, Oct26 Interest" against an investor holding an unwithdrawn
 * interest credit of exactly that amount. It used to default to all capital.
 *
 * Run: node scripts/check-withdrawal-split.mjs
 *
 * The invariant that matters most is #12: capital + interest must always close to the
 * bank amount exactly. The form disables Create unless the split balances to within a
 * penny, so a suggester that cannot close is worse than no suggester at all.
 */

import {
  suggestWithdrawalSplit,
  computeUnwithdrawnCredits,
  interestMention,
  capitalMention,
  SPLIT_SIGNAL_CONFIDENCE
} from '../src/lib/reconciliation/withdrawalSplit.js';
import { calculateSegmentedInterest } from '../src/lib/interestCalculation.js';
import { formKeyForSuggestion, SUGGESTION_FORM_KEYS } from '../src/lib/reconciliation/formKeys.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        expected ${expected}\n        actual   ${actual}`);
};

const credit = (id, amount, date) => ({ id, type: 'credit', amount, date });
const debit = (id, amount, date) => ({ id, type: 'debit', amount, date });

const ADW = { id: 'inv-adw', name: 'ADW Enterprises Ltd', last_accrual_date: '2026-10-01' };

const split = (over) => suggestWithdrawalSplit({
  investor: ADW,
  statementDate: '2026-10-01',
  description: '',
  ...over
});

// --- 1. The reported case ---------------------------------------------------
const reported = split({
  amount: 44749.32,
  description: 'To ADW Enterprises Ltd, Oct26 Interest',
  interestEntries: [credit('c1', 44749.32, '2026-10-01')]
});
check('reported case is a single-credit match', reported.signal, 'single_credit');
check('reported case allocates all to interest', reported.interest, 44749.32);
check('reported case allocates nothing to capital', reported.capital, 0);
check('reported case is interest-only', reported.isInterestOnly, true);
check('reported case names the credit', reported.reason.includes('44,749.32'), true);
check('reported case cites the credit id', reported.matchedCreditIds[0], 'c1');
console.log(`        reason: ${reported.reason}`);

// --- 2. FIFO consumption ----------------------------------------------------
const fifo = computeUnwithdrawnCredits([
  credit('c1', 100, '2026-09-01'),
  credit('c2', 200, '2026-10-01'),
  debit('d1', 100, '2026-09-03')
]);
check('FIFO leaves the later credit', fifo.total, 200);
check('FIFO consumes the earlier credit entirely', fifo.credits.length, 1);
check('FIFO keeps the right credit', fifo.credits[0].id, 'c2');

// --- 3. Partial payment -----------------------------------------------------
const partialEntries = [credit('c1', 200, '2026-10-01'), debit('d1', 50, '2026-10-05')];
check('a partial payment leaves a residual',
  computeUnwithdrawnCredits(partialEntries).total, 150);
check('the residual is matchable',
  split({ amount: 150, interestEntries: partialEntries }).signal, 'single_credit');
check('the original amount no longer matches',
  split({ amount: 200, interestEntries: partialEntries }).signal, 'default');

// --- 4. Forward spill: paid 30 Sep for interest posted 1 Oct ----------------
const spill = [credit('c1', 55.54, '2026-10-01'), debit('d1', 55.54, '2026-09-30')];
check('forward spill consumes the later credit',
  computeUnwithdrawnCredits(spill).total, 0);
check('forward spill prevents a phantom match',
  split({ amount: 55.54, interestEntries: spill }).signal, 'default');

// --- 5. Cross-month settlement (where month-pairing would fail) -------------
check('a credit settled in the next month is consumed',
  computeUnwithdrawnCredits([
    credit('c1', 100, '2026-10-01'),
    debit('d1', 100, '2026-11-03')
  ]).total, 0);

// --- 6. Subset matching -----------------------------------------------------
const three = [
  credit('c1', 100, '2026-09-01'),
  credit('c2', 200, '2026-10-01'),
  credit('c3', 300, '2026-11-01')
];
check('a single credit is preferred over a subset',
  split({ amount: 300, interestEntries: three }).signal, 'single_credit');
const subsetOnly = split({
  amount: 300,
  interestEntries: [credit('c1', 100, '2026-09-01'), credit('c2', 200, '2026-10-01')]
});
check('two credits summing to the amount match', subsetOnly.signal, 'credit_subset');
check('the subset match is interest-only', subsetOnly.interest, 300);
check('the subset cites both credits', subsetOnly.matchedCreditIds.join(','), 'c1,c2');
console.log(`        reason: ${subsetOnly.reason}`);

// --- 7. Accrued but not yet posted (the `manual` product path) --------------
const manualInvestor = { id: 'inv-m', name: 'Manual Co', last_accrual_date: null };
const manualTx = [{ type: 'capital_in', amount: 100000, date: '2026-09-01' }];
const expectedAccrual = calculateSegmentedInterest(manualTx, 10, '2026-09-01', '2026-10-01').totalInterest;
const accruedCase = suggestWithdrawalSplit({
  amount: expectedAccrual,
  description: 'Manual Co interest',
  statementDate: '2026-10-01',
  investor: manualInvestor,
  investorProduct: { interest_rate_per_annum: 10 },
  interestEntries: [],
  investorTransactions: manualTx
});
check('accrued-but-unposted interest matches', accruedCase.signal, 'accrued');
check('accrued match allocates all to interest', accruedCase.interest, expectedAccrual);
check('accrued match allocates nothing to capital', accruedCase.capital, 0);
check('accrued over an unbounded period is trusted less',
  accruedCase.confidence, SPLIT_SIGNAL_CONFIDENCE.accrued_long);
console.log(`        reason: ${accruedCase.reason}`);

// --- 8/9. Interest-first, and its suppression without the keyword -----------
const poolOf500 = [credit('c1', 500, '2026-10-01')];
const interestFirst = split({
  amount: 10500,
  description: 'ADW interest and capital',
  interestEntries: poolOf500
});
check('interest-first takes the available interest', interestFirst.interest, 500);
check('interest-first puts the rest to capital', interestFirst.capital, 10000);
check('interest-first is signalled', interestFirst.signal, 'interest_first');
console.log(`        reason: ${interestFirst.reason}`);

const noKeyword = split({ amount: 10500, description: 'ADW payment', interestEntries: poolOf500 });
check('without the keyword it stays all capital', noKeyword.capital, 10500);
check('without the keyword interest is zero', noKeyword.interest, 0);
check('without the keyword the signal is the fallback', noKeyword.signal, 'default');

// --- 10/11. Description vs amount ------------------------------------------
const capitalWins = split({
  amount: 44749.32,
  description: 'ADW capital redemption',
  interestEntries: [credit('c1', 44749.32, '2026-10-01')]
});
check('an explicit capital narrative beats an exact credit match',
  capitalWins.signal, 'capital_keyword');
check('capital narrative allocates nothing to interest', capitalWins.interest, 0);
check('capital narrative allocates everything to capital', capitalWins.capital, 44749.32);

const bothWords = split({
  amount: 44749.32,
  description: 'ADW capital and interest',
  interestEntries: [credit('c1', 44749.32, '2026-10-01')]
});
check('naming both words does not short-circuit to capital',
  bothWords.signal, 'single_credit');

check('interestMention detects the strong form', interestMention('Oct26 Interest'), 'strong');
check('interestMention detects an abbreviation', interestMention('ADW int payment'), 'weak');
check('interestMention ignores an unrelated word', interestMention('printer supplies'), null);
check('capitalMention detects redemption', capitalMention('capital redemption'), true);
check('capitalMention ignores withdrawal', capitalMention('ADW withdrawal'), false);

// --- 12. The balance invariant, fuzzed --------------------------------------
let imbalances = 0;
let negatives = 0;
const descriptions = ['', 'interest', 'capital', 'ADW payment', 'capital and interest'];
for (let i = 0; i < 2000; i++) {
  const amount = Math.round(Math.random() * 10000000) / 100;
  const pool = Math.round(Math.random() * 10000000) / 100;
  const r = split({
    amount,
    description: descriptions[i % descriptions.length],
    interestEntries: pool > 0 ? [credit('c1', pool, '2026-09-01')] : []
  });
  const expected = Math.round(amount * 100) / 100;
  if (Math.abs(r.capital + r.interest - expected) > 1e-9) imbalances++;
  if (r.capital < 0 || r.interest < 0) negatives++;
}
check('2000 fuzzed splits all close exactly', imbalances, 0);
check('2000 fuzzed splits are never negative', negatives, 0);

// --- 13. Degenerate inputs --------------------------------------------------
check('a zero amount is reported as such', split({ amount: 0 }).signal, 'zero');
check('a zero amount splits to nothing', split({ amount: 0 }).capital, 0);
check('an empty ledger falls back to capital',
  split({ amount: 100, interestEntries: [] }).capital, 100);
check('a null ledger does not throw',
  split({ amount: 100, interestEntries: null }).capital, 100);
check('a null investor does not throw',
  suggestWithdrawalSplit({ amount: 100, investor: null, statementDate: '2026-10-01' }).capital, 100);
check('a zero rate yields no accrual',
  suggestWithdrawalSplit({
    amount: 100, investor: ADW, statementDate: '2026-10-01',
    investorProduct: { interest_rate_per_annum: 0 },
    investorTransactions: manualTx
  }).accruedInterest, 0);

const overdrawn = computeUnwithdrawnCredits([
  credit('c1', 100, '2026-09-01'),
  debit('d1', 300, '2026-09-05')
]);
check('an overdrawn ledger never goes negative', overdrawn.total, 0);
check('an overdrawn ledger reports the shortfall', overdrawn.overdrawn, 200);

check('string amounts are parsed',
  split({ amount: 44749.32, interestEntries: [credit('c1', '44749.32', '2026-10-01')] }).signal,
  'single_credit');
check('a timestamped date is read as its day',
  split({
    amount: 44749.32,
    interestEntries: [credit('c1', 44749.32, '2026-10-01T00:00:00Z')]
  }).signal, 'single_credit');

// --- 14. ignoreDebitIds: a draft of the payment being reconciled ------------
const drafted = [credit('c1', 44749.32, '2026-10-01'), debit('d1', 44749.32, '2026-10-01')];
check('a drafted debit hides the credit',
  split({ amount: 44749.32, interestEntries: drafted }).signal, 'default');
check('ignoring the draft restores the match',
  split({
    amount: 44749.32,
    interestEntries: drafted,
    options: { ignoreDebitIds: new Set(['d1']) }
  }).signal, 'single_credit');

// --- 15. Suggestion type -> form key ----------------------------------------
check('loan_repayment_new maps to its form',
  formKeyForSuggestion({ type: 'loan_repayment_new' }), 'loan_repayment');
check('investor_credit_new maps to the deposit form',
  formKeyForSuggestion({ type: 'investor_credit_new' }), 'investor_deposit');
check('loan_disbursement_new maps to its form',
  formKeyForSuggestion({ type: 'loan_disbursement_new' }), 'loan_disbursement');
check('investor_withdrawal_new maps to its form',
  formKeyForSuggestion({ type: 'investor_withdrawal_new' }), 'investor_withdrawal');
check('all four create types are mapped', Object.keys(SUGGESTION_FORM_KEYS).length, 4);
check('an unmapped type passes through',
  formKeyForSuggestion({ type: 'expense' }), 'expense');
check('no suggestion yields no form key', formKeyForSuggestion(null), null);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
