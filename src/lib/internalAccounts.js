/**
 * Internal account balances and bank-description matching.
 *
 * An internal account is one of the organisation's own pots - a savings pot, a reserve,
 * a second current account. Money moved into one leaves the current account and shows in
 * the bank feed as a debit, but nothing has been spent, so these movements are kept out
 * of every income, expenditure and investor figure.
 *
 * Pure: no imports, no React, no I/O. Loadable from a plain node script.
 */

/**
 * Running balance of every internal account.
 *
 * Direction is relative to the pot: 'in' is money placed into it (a bank debit), 'out' is
 * money coming back to the current account (a bank credit).
 *
 * @param {Array<{internal_account_id: string, amount: number|string, direction: 'in'|'out'}>} transfers
 * @returns {Map<string, number>} account id -> balance, rounded to 2dp
 */
export function internalAccountBalances(transfers) {
  const balances = new Map();

  for (const t of transfers || []) {
    if (!t?.internal_account_id) continue;
    const amount = Math.abs(parseFloat(String(t.amount)) || 0);
    if (amount === 0) continue;
    const signed = t.direction === 'out' ? -amount : amount;
    balances.set(t.internal_account_id, (balances.get(t.internal_account_id) || 0) + signed);
  }

  for (const [id, value] of balances) {
    balances.set(id, Math.round(value * 100) / 100);
  }
  return balances;
}

/**
 * Totals for one account, for the detail view.
 *
 * @param {Array} transfers - all transfers, any account
 * @param {string} accountId
 * @returns {{ in: number, out: number, balance: number, count: number }}
 */
export function internalAccountTotals(transfers, accountId) {
  let into = 0;
  let outOf = 0;
  let count = 0;

  for (const t of transfers || []) {
    if (t?.internal_account_id !== accountId) continue;
    const amount = Math.abs(parseFloat(String(t.amount)) || 0);
    if (amount === 0) continue;
    count += 1;
    if (t.direction === 'out') outOf += amount;
    else into += amount;
  }

  const r2 = (v) => Math.round(v * 100) / 100;
  return { in: r2(into), out: r2(outOf), balance: r2(into - outOf), count };
}

const normalise = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Pick the internal account a bank description most likely refers to.
 *
 * Matches on `match_keyword` first - that is the literal text the bank puts on the line,
 * which is what the user configured it for - then falls back to the account name. A name
 * must be at least 4 characters to match on, so an account called "Pot" does not catch
 * every line containing the word.
 *
 * @param {string} description - bank entry description
 * @param {Array<{id: string, name: string, match_keyword?: string}>} accounts
 * @returns {Object|null} the matching account, or null
 */
export function suggestInternalAccount(description, accounts) {
  const desc = normalise(description);
  if (!desc || !accounts?.length) return null;

  let best = null;
  let bestLength = 0;

  for (const account of accounts) {
    // An explicit keyword is what the user configured for this, so it may be short.
    // A name has to be longer to match, or an account called "Pot" catches every line
    // containing the word.
    const candidates = [
      { text: account.match_keyword, minLength: 2 },
      { text: account.name, minLength: 4 }
    ];
    for (const { text, minLength } of candidates) {
      const term = normalise(text);
      // Longest match wins, so "Savings Pot 2" beats "Savings Pot" on a line naming both.
      if (term.length >= minLength && desc.includes(term) && term.length > bestLength) {
        bestLength = term.length;
        best = account;
      }
    }
  }

  return best;
}
