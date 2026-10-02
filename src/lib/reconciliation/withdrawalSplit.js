/**
 * Capital/interest split suggestion for investor withdrawals.
 *
 * A bank debit paid to an investor can be capital, interest, or both, and the two post
 * to completely different places: capital writes a `capital_out` InvestorTransaction and
 * decrements Investor.current_capital_balance, while interest writes a `debit` to the
 * investor_interest ledger and leaves capital alone (reconcileHandler.js
 * createInvestorWithdrawal). Defaulting everything to capital - which is what the form
 * used to do - silently corrupts the capital balance on every interest payout.
 *
 * This module decides the split from evidence: unwithdrawn interest credits sitting on
 * the investor's ledger, interest accrued but not yet posted, and the bank narrative.
 *
 * DEPENDENCY RULE: import only from '../interestCalculation.js'. That module has no
 * imports of its own and uses no path aliases, so this one loads under plain `node` and
 * is pinned by scripts/check-withdrawal-split.mjs. Importing './utils.js' would drag in
 * '@/components/loan/LoanCalculator' (utils.js line 10) and make that impossible. Its
 * amountsMatch() is percentage-based and its findSubsetSum() hardcodes a 1% tolerance
 * and requires a must-include id - both wrong here, where 1% of £44,749 is £447 and the
 * match needs to be to the penny.
 */

import {
  calculateAccruingInterest,
  resolveInvestorAnnualRate,
  toUtcDay,
  formatUtcDay
} from '../interestCalculation.js';

/** Interest amounts must agree to the penny. Anything looser matches the wrong credit. */
const PENNY = 0.01;

/** Half a penny: the threshold for "this is a real amount, not a rounding artefact". */
const EPSILON = 0.005;

/**
 * A payment settling more than 4 months of interest at once is rare, and the number of
 * spurious subset sums grows fast with size. 12 source credits caps the search at
 * C(12,4) = 495 combinations.
 */
const MAX_SUBSET_SIZE = 4;
const MAX_SUBSET_SOURCE = 12;

/** Strength of each interest finding. Consumed by ExpenditurePanel to score the suggestion. */
export const SPLIT_SIGNAL_CONFIDENCE = {
  single_credit: 0.95,
  credit_subset: 0.88,
  accrued: 0.80,
  // The accrual period started at the first ever transaction because nothing has been
  // posted and last_accrual_date was never set - it could span years, so trust it less.
  accrued_long: 0.72,
  interest_first: 0.70,
  capital_keyword: 0.60,
  default: 0
};

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

const toNumber = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
};

/** 'YYYY-MM-DD', stripping any time component the column may carry. */
const toDayString = (v) => String(v || '').slice(0, 10);

const formatMoney = (v) =>
  `£${round2(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDay = (dateStr) => {
  const day = toUtcDay(dateStr);
  return day ? formatUtcDay(day, { day: 'numeric', month: 'short', year: 'numeric' }) : dateStr;
};

// ============================================================================
// DESCRIPTION KEYWORDS
// ============================================================================

const normaliseDesc = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const INTEREST_STRONG = [/\binterest\b/];
const INTEREST_WEAK = [/\bint\b/, /\bintrst\b/, /\bcoupon\b/, /\byield\b/];
// 'return' is deliberately absent - "funds returned" is InlineOffsetForm's concept.
// 'withdrawal' is absent too: it is neutral, an interest withdrawal is still a withdrawal.
const CAPITAL_WORDS = [/\bcapital\b/, /\bprincipal\b/, /\bredemption\b/, /\bredeem\b/];

/**
 * Does the bank narrative name interest?
 * @param {string} description
 * @returns {'strong'|'weak'|null}
 */
export function interestMention(description) {
  const d = normaliseDesc(description);
  if (!d) return null;
  if (INTEREST_STRONG.some(re => re.test(d))) return 'strong';
  if (INTEREST_WEAK.some(re => re.test(d))) return 'weak';
  return null;
}

/**
 * Does the bank narrative name capital?
 * @param {string} description
 * @returns {boolean}
 */
export function capitalMention(description) {
  const d = normaliseDesc(description);
  return d ? CAPITAL_WORDS.some(re => re.test(d)) : false;
}

// ============================================================================
// UNWITHDRAWN INTEREST (FIFO RESIDUALS)
// ============================================================================

/**
 * FIFO residual balance of every posted interest credit for ONE investor.
 *
 * Why FIFO and not the month-pairing in InvestorDetails.jsx: that pairing is
 * all-or-nothing per calendar month. It cannot express a partial payment, and a credit
 * dated 1 Oct settled by a payment on 3 Nov lands in a different month key so the credit
 * looks unwithdrawn forever. It is a display device for striking out a settled row and is
 * fine for that. This needs per-credit residual amounts so the subset search below has
 * something to work with.
 *
 * Reconciled-ness does NOT filter the consumption. A debit row means the money left the
 * interest pot; whether a bank line has been matched to it is a separate fact. Filtering
 * reconciled debits out would double-count that interest as still available. The one
 * exception is entry-specific and handled by the caller via `ignoreDebitIds`: an
 * unreconciled debit that is itself a draft of the very payment being reconciled now.
 *
 * @param {Array<{id?: string, date: string, type: string, amount: number|string,
 *                description?: string, created_at?: string}>} interestEntries
 *        All investor_interest rows for ONE investor. Input order is irrelevant.
 * @param {Object} [options]
 * @param {Set<string>} [options.ignoreDebitIds] - debit ids to treat as non-existent
 * @returns {{credits: Array<{id, date, amount, remaining, description}>,
 *            total: number, overdrawn: number}}
 *          `credits` holds only rows with a residual left, oldest first.
 */
export function computeUnwithdrawnCredits(interestEntries, options = {}) {
  const ignore = options.ignoreDebitIds;
  const rows = [];

  for (const e of interestEntries || []) {
    if (!e) continue;
    const type = e.type;
    if (type !== 'credit' && type !== 'debit') continue;
    if (type === 'debit' && ignore && e.id && ignore.has(e.id)) continue;
    const amount = Math.abs(toNumber(e.amount));
    if (amount <= EPSILON) continue;
    rows.push({
      id: e.id,
      date: toDayString(e.date),
      createdAt: String(e.created_at || ''),
      type,
      amount,
      description: e.description || ''
    });
  }

  // Deterministic ascending order. The page query happens to return '-date', so never
  // rely on input order.
  rows.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    a.createdAt.localeCompare(b.createdAt) ||
    String(a.id || '').localeCompare(String(b.id || ''))
  );

  const credits = rows.filter(r => r.type === 'credit').map(r => ({ ...r, remaining: r.amount }));
  let overdrawn = 0;

  for (const debit of rows) {
    if (debit.type !== 'debit') continue;
    let need = debit.amount;

    // Pass 1: credits already posted when the debit was taken, oldest first.
    for (const c of credits) {
      if (need <= EPSILON) break;
      if (c.remaining <= EPSILON || c.date > debit.date) continue;
      const take = Math.min(need, c.remaining);
      c.remaining -= take;
      need -= take;
    }

    // Pass 2 (forward spill): an investor paid on 30 Sep for interest the nightly job
    // posts on 1 Oct. Without this the September credit is consumed and the October one
    // looks available, so the suggester would offer interest that is already gone.
    for (const c of credits) {
      if (need <= EPSILON) break;
      if (c.remaining <= EPSILON) continue;
      const take = Math.min(need, c.remaining);
      c.remaining -= take;
      need -= take;
    }

    if (need > EPSILON) overdrawn += need;
  }

  const residual = credits
    .map(c => ({ ...c, remaining: round2(c.remaining) }))
    .filter(c => c.remaining > EPSILON);

  return {
    credits: residual,
    total: Math.max(0, round2(residual.reduce((s, c) => s + c.remaining, 0))),
    overdrawn: round2(overdrawn)
  };
}

/**
 * Smallest subset of residual credits summing to `target` within a penny.
 * Sizes are tried ascending so the fewest credits win; within a size, the most recent
 * credits are tried first.
 *
 * @param {Array<{id, date, remaining}>} credits
 * @param {number} target
 * @returns {Array|null} the matching credits, or null
 */
function findCreditSubset(credits, target) {
  // Most recent first, capped - a payment settling interest from years ago is not the
  // case this is for, and the combination count has to stay bounded.
  const pool = [...credits].reverse().slice(0, MAX_SUBSET_SOURCE);
  if (pool.length < 2) return null;

  /** @type {Array|null} */
  let found = null;

  const search = (startIdx, size, picked, sum) => {
    if (found) return;
    if (picked.length === size) {
      if (Math.abs(sum - target) <= PENNY) found = [...picked];
      return;
    }
    for (let i = startIdx; i < pool.length; i++) {
      // Everything left is positive, so once we are a penny past the target we can stop.
      if (sum - target > PENNY) break;
      picked.push(pool[i]);
      search(i + 1, size, picked, round2(sum + pool[i].remaining));
      picked.pop();
      if (found) return;
    }
  };

  for (let size = 2; size <= Math.min(MAX_SUBSET_SIZE, pool.length); size++) {
    search(0, size, [], 0);
    if (found) break;
  }

  // Report oldest-first so the reason string reads chronologically.
  return found ? found.slice().reverse() : null;
}

// ============================================================================
// THE SPLIT
// ============================================================================

/**
 * Split a bank amount so the two halves always close exactly.
 *
 * The form's Create button is disabled unless |capital + interest - amount| < 0.01, so
 * the suggestion must never be the reason it is blocked. Clamping to [0, amount] is also
 * what makes an overdrawn ledger and an oversized interest pool safe. The form compares
 * against the unrounded bank amount; the residual drift is at most half a penny, well
 * inside its window.
 */
function balanceSplit(amount, interestRaw) {
  const amt = round2(amount);
  const wanted = Math.min(Math.max(round2(interestRaw), 0), amt);
  const capital = round2(amt - wanted);
  return { capital, interest: round2(amt - capital) };
}

function result(amount, interestRaw, signal, confidence, reason, extra = {}) {
  const { capital, interest } = balanceSplit(amount, interestRaw);
  return {
    capital,
    interest,
    signal,
    confidence,
    reason,
    isInterestOnly: interest > EPSILON && capital === 0,
    matchedCreditIds: extra.matchedCreditIds || [],
    availableInterest: round2(extra.availableInterest || 0),
    accruedInterest: round2(extra.accruedInterest || 0),
    overdrawnInterest: round2(extra.overdrawnInterest || 0)
  };
}

/**
 * Suggest how to split an investor withdrawal between capital and interest.
 *
 * Pure - no I/O, no React, no date-fns. Safe to import from plain node.
 *
 * @param {Object} [params]
 * @param {number} [params.amount] - positive, Math.abs(bankEntry.amount)
 * @param {string} [params.description] - bankEntry.description
 * @param {string} [params.statementDate] - bankEntry.statement_date, 'YYYY-MM-DD'
 * @param {Object|null} [params.investor]
 * @param {Object|null} [params.investorProduct]
 * @param {Array} [params.interestEntries] - investor_interest rows for THIS investor
 * @param {Array} [params.investorTransactions] - RAW InvestorTransaction rows for THIS
 *        investor. Must be unfiltered: calculateAccruingInterest treats every row that is
 *        not 'capital_in' as a deduction, matching the nightly job, so filtering here
 *        would produce a figure the job will never post.
 * @param {Object} [params.precomputed] - per-investor entry from buildInvestorSplitContext
 * @param {Object} [params.options]
 * @param {Set<string>} [params.options.ignoreDebitIds]
 * @returns {{capital: number, interest: number, signal: string, confidence: number,
 *            reason: string, isInterestOnly: boolean, matchedCreditIds: string[],
 *            availableInterest: number, accruedInterest: number, overdrawnInterest: number}}
 */
export function suggestWithdrawalSplit({
  amount,
  description,
  statementDate,
  investor,
  investorProduct,
  interestEntries,
  investorTransactions,
  precomputed,
  options = {}
} = {}) {
  const amt = toNumber(amount);

  // S0 - nothing to split.
  if (amt <= EPSILON) {
    return result(0, 0, 'zero', 0, 'Zero-value entry - nothing to split');
  }

  // S1 - an explicit capital narrative wins outright, ahead of any amount evidence.
  // A description naming BOTH ("capital and interest") is not a capital override; it
  // falls through to the amount evidence and then to the interest-first rule.
  const mention = interestMention(description);
  if (capitalMention(description) && !mention) {
    return result(amt, 0, 'capital_keyword', SPLIT_SIGNAL_CONFIDENCE.capital_keyword,
      '"capital" in description - allocated in full to capital');
  }

  const ignoreDebitIds = options.ignoreDebitIds;
  const hasIgnores = ignoreDebitIds instanceof Set && ignoreDebitIds.size > 0;

  // The context's residual is precomputed per investor. Only redo the FIFO when the
  // caller needs debits excluded, which is the form's case and runs once per memo.
  const entries = interestEntries || precomputed?.interestEntries || [];
  const residual = (!hasIgnores && precomputed?.residual)
    ? precomputed.residual
    : computeUnwithdrawnCredits(entries, { ignoreDebitIds });

  const available = residual.total;
  const base = {
    availableInterest: available,
    overdrawnInterest: residual.overdrawn
  };

  // S2 - the amount is exactly one unwithdrawn credit.
  const exact = residual.credits.filter(c => Math.abs(c.remaining - amt) <= PENNY);
  if (exact.length > 0) {
    // Several credits of the identical amount: the one nearest the payment date is the
    // likeliest, but say so rather than quietly picking.
    const target = toUtcDay(statementDate)?.getTime() ?? 0;
    const pick = exact.reduce((best, c) => {
      const d = Math.abs((toUtcDay(c.date)?.getTime() ?? 0) - target);
      return d < best.dist ? { c, dist: d } : best;
    }, { c: exact[0], dist: Infinity }).c;

    let reason = `Matches unwithdrawn interest credit of ${formatMoney(pick.remaining)} dated ${formatDay(pick.date)}`;
    if (exact.length > 1) {
      reason += ` (${exact.length - 1} other credit${exact.length > 2 ? 's' : ''} of the same amount)`;
    }
    return result(amt, amt, 'single_credit', SPLIT_SIGNAL_CONFIDENCE.single_credit, reason,
      { ...base, matchedCreditIds: [pick.id] });
  }

  // S3 - the amount settles several credits at once.
  const subset = findCreditSubset(residual.credits, amt);
  if (subset) {
    const dates = subset.map(c => formatDay(c.date)).join(', ');
    return result(amt, amt, 'credit_subset', SPLIT_SIGNAL_CONFIDENCE.credit_subset,
      `Matches ${subset.length} unwithdrawn interest credits totalling ${formatMoney(amt)} (${dates})`,
      { ...base, matchedCreditIds: subset.map(c => c.id) });
  }

  // Accrual is the expensive signal - it sorts and segments the whole transaction
  // history - so it is only reached once the penny comparisons above have missed.
  const annualRate = precomputed?.annualRate ?? resolveInvestorAnnualRate(investor, investorProduct);
  let accrual = null;
  if (annualRate > 0 && investor) {
    const cached = precomputed?.accrualCache?.get(statementDate);
    if (cached) {
      accrual = cached;
    } else {
      accrual = calculateAccruingInterest(
        investorTransactions || precomputed?.transactions || [],
        annualRate,
        investor.last_accrual_date,
        // As at the payment date, not today - the accrual has to be what was owed then.
        { asOf: statementDate, interestEntries: entries }
      );
      precomputed?.accrualCache?.set(statementDate, accrual);
    }
  }
  const accrued = round2(accrual?.accruedInterest || 0);
  const withAccrual = { ...base, accruedInterest: accrued };

  // S4 - interest accrued but not yet posted as a credit. This is the `manual` product
  // path: no credit row exists until the withdrawal itself creates one
  // (reconcileHandler.js createInvestorWithdrawal).
  if (accrued > EPSILON
      && (Math.abs(amt - accrued) <= PENNY || Math.abs(amt - round2(accrued + available)) <= PENNY)) {
    const isLongPeriod = accrual.periodStartSource === 'first_transaction';
    const confidence = isLongPeriod
      ? SPLIT_SIGNAL_CONFIDENCE.accrued_long
      : SPLIT_SIGNAL_CONFIDENCE.accrued;
    const reason = `Matches interest accrued to ${formatDay(statementDate)} but not yet posted `
      + `(${formatMoney(accrued)} over ${accrual.days} day${accrual.days === 1 ? '' : 's'})`;
    return result(amt, amt, 'accrued', confidence, reason, withAccrual);
  }

  // S5 - more than the interest available, and the narrative says interest: take the
  // interest first and put the rest to capital.
  const pool = round2(available + accrued);
  if (mention && pool > EPSILON && amt > pool) {
    const split = balanceSplit(amt, pool);
    const qualifier = mention === 'weak' ? ' (abbreviated)' : '';
    return result(amt, pool, 'interest_first', SPLIT_SIGNAL_CONFIDENCE.interest_first,
      `"interest" in description${qualifier} - allocated ${formatMoney(split.interest)} available interest, `
      + `${formatMoney(split.capital)} to capital`,
      withAccrual);
  }

  // S6 - no evidence either way. Today's behaviour.
  return result(amt, 0, 'default', SPLIT_SIGNAL_CONFIDENCE.default, '', withAccrual);
}

// ============================================================================
// PER-INVESTOR CONTEXT
// ============================================================================

/**
 * One-pass per-investor index, built once and reused for every bank entry.
 *
 * generateExpenditureSuggestions runs per entry, so without this the FIFO walk would
 * repeat over the whole interest ledger for every (entry x investor) pair. Here the
 * grouping and the FIFO happen once per investor per data change.
 *
 * @param {Object} [params]
 * @param {Array} [params.investors]
 * @param {Array} [params.investorProducts]
 * @param {Array} [params.investorInterestEntries] - ALL rows, all investors
 * @param {Array} [params.investorTransactions] - ALL rows, all investors
 * @returns {Map<string, {investor, product, annualRate, interestEntries, transactions,
 *                        residual, accrualCache: Map}>}
 */
export function buildInvestorSplitContext({
  investors = [],
  investorProducts = [],
  investorInterestEntries = [],
  investorTransactions = []
} = {}) {
  const interestByInvestor = new Map();
  for (const e of investorInterestEntries) {
    if (!e?.investor_id) continue;
    const list = interestByInvestor.get(e.investor_id);
    if (list) list.push(e);
    else interestByInvestor.set(e.investor_id, [e]);
  }

  const txByInvestor = new Map();
  for (const t of investorTransactions) {
    if (!t?.investor_id || t.is_deleted) continue;
    const list = txByInvestor.get(t.investor_id);
    if (list) list.push(t);
    else txByInvestor.set(t.investor_id, [t]);
  }

  const productById = new Map(investorProducts.map(p => [p.id, p]));

  const context = new Map();
  for (const investor of investors) {
    if (!investor?.id) continue;
    const entries = interestByInvestor.get(investor.id) || [];
    const product = productById.get(investor.investor_product_id);
    context.set(investor.id, {
      investor,
      product,
      annualRate: resolveInvestorAnnualRate(investor, product),
      interestEntries: entries,
      transactions: txByInvestor.get(investor.id) || [],
      residual: computeUnwithdrawnCredits(entries),
      accrualCache: new Map()
    });
  }

  return context;
}
