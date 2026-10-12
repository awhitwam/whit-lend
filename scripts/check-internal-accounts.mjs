/**
 * Pins internal-account balances and bank-description matching.
 *
 * Direction is relative to the pot, which is the easy thing to get backwards:
 *   'in'  - money placed into the pot   (a DEBIT on the bank statement)
 *   'out' - money coming back out       (a CREDIT on the bank statement)
 *
 * Run: node scripts/check-internal-accounts.mjs
 */

import {
  internalAccountBalances,
  internalAccountTotals,
  suggestInternalAccount
} from '../src/lib/internalAccounts.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        expected ${expected}\n        actual   ${actual}`);
};

const mv = (accountId, amount, direction) => ({
  internal_account_id: accountId,
  amount,
  direction
});

// --- Balances ---------------------------------------------------------------
const transfers = [
  mv('pot', 50000, 'in'),
  mv('pot', 25000, 'in'),
  mv('pot', 20000, 'out'),
  mv('reserve', 10000, 'in')
];
const balances = internalAccountBalances(transfers);

check('money in minus money out', balances.get('pot'), 55000);
check('a second account is tracked separately', balances.get('reserve'), 10000);
check('an unknown account has no balance', balances.get('nope'), undefined);
check('two accounts tracked', balances.size, 2);

// --- The sign convention, stated as an assertion ----------------------------
// A bank DEBIT of 50,000 means money left the current account and entered the pot.
check('a bank debit increases the pot',
  internalAccountBalances([mv('p', 50000, 'in')]).get('p'), 50000);
// A bank CREDIT means it came back.
check('a bank credit decreases the pot',
  internalAccountBalances([mv('p', 50000, 'in'), mv('p', 50000, 'out')]).get('p'), 0);

// --- Totals -----------------------------------------------------------------
const totals = internalAccountTotals(transfers, 'pot');
check('totals in', totals.in, 75000);
check('totals out', totals.out, 20000);
check('totals balance', totals.balance, 55000);
check('totals count', totals.count, 3);
check('totals for an account with no movements', internalAccountTotals(transfers, 'x').count, 0);

// --- Degenerate inputs ------------------------------------------------------
check('no transfers', internalAccountBalances([]).size, 0);
check('null transfers', internalAccountBalances(null).size, 0);
check('string amounts parse', internalAccountBalances([mv('p', '1234.56', 'in')]).get('p'), 1234.56);
check('negative amounts are read as magnitudes',
  internalAccountBalances([mv('p', -500, 'in')]).get('p'), 500);
check('zero-amount rows are ignored', internalAccountBalances([mv('p', 0, 'in')]).size, 0);
check('rows with no account are ignored',
  internalAccountBalances([{ amount: 100, direction: 'in' }]).size, 0);
check('an over-drawn pot goes negative, it is not clamped',
  internalAccountBalances([mv('p', 100, 'out')]).get('p'), -100);
check('pennies do not drift',
  internalAccountBalances([mv('p', 0.1, 'in'), mv('p', 0.2, 'in')]).get('p'), 0.3);

// --- Description matching ---------------------------------------------------
const accounts = [
  { id: 'a1', name: 'Savings Pot', match_keyword: 'SAVINGS POT' },
  { id: 'a2', name: 'Tax Reserve', match_keyword: null },
  { id: 'a3', name: 'Savings Pot 2', match_keyword: 'SAVINGS POT 2' }
];

check('keyword match',
  suggestInternalAccount('TRANSFER TO SAVINGS POT', accounts)?.id, 'a1');
check('match is case and punctuation insensitive',
  suggestInternalAccount('transfer to: savings-pot', accounts)?.id, 'a1');
check('falls back to the account name',
  suggestInternalAccount('MOVED TO TAX RESERVE', accounts)?.id, 'a2');
check('the longest match wins',
  suggestInternalAccount('TRANSFER TO SAVINGS POT 2', accounts)?.id, 'a3');
check('no match returns null',
  suggestInternalAccount('TESCO STORES 3845', accounts), null);
check('empty description returns null',
  suggestInternalAccount('', accounts), null);
check('no accounts returns null',
  suggestInternalAccount('SAVINGS POT', []), null);

// A short account name must not match every line containing the word.
check('a short name does not match on its own',
  suggestInternalAccount('DEPOSIT FOR THE POT', [{ id: 's', name: 'Pot' }]), null);
check('but a short explicit keyword does',
  suggestInternalAccount('REF SP TRANSFER', [{ id: 's', name: 'Pot', match_keyword: 'SP' }])?.id, 's');

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
