/**
 * Accountant Report - match classification
 *
 * Every bank entry in a reporting period is expected to be matched to something. This module
 * decides, for one bank entry, whether that holds - and if not, which kind of exception it is.
 *
 * The vocabulary deliberately mirrors the reconciliation screen (ReconciledPanel.jsx), so an
 * entry called "Orphaned" here is the same thing the reconciliation screen flags red.
 *
 * The question asked is deliberately structural - is this entry linked to something that exists -
 * and never "do the amounts agree". Nothing in the app enforces that one bank line's
 * reconciliation rows sum to that line's amount: reconcileHandler validates bank movement against
 * transaction value in aggregate, and a net receipt group is written as a cross product where
 * every member line carries the full amount of every transaction. An amount test per bank line
 * therefore has no invariant to stand on and reports correctly reconciled entries as broken.
 *
 * This file imports nothing on purpose: the predicates are pure data-in/data-out, which keeps
 * them directly runnable under node for verification without bundling or alias resolution.
 */

export const MATCH_STATUS = {
  MATCHED: 'matched',
  UNMATCHED: 'unmatched',
  ORPHANED: 'orphaned',
  BROKEN_LINK: 'broken_link',
  UNRECONCILABLE: 'unreconcilable'
};

// Presentation kept beside the predicates so the summary cards, the exceptions panel and the
// main table cannot drift apart on what a status is called or coloured.
export const MATCH_STATUS_META = {
  matched: { label: 'Matched', rowClass: '', badge: 'outline' },
  unmatched: { label: 'Not reconciled', rowClass: 'bg-amber-50/50', badge: 'secondary' },
  orphaned: { label: 'Orphaned', rowClass: 'bg-red-50/50', badge: 'destructive' },
  broken_link: { label: 'Broken link', rowClass: 'bg-red-50/50', badge: 'destructive' },
  unreconcilable: { label: 'Unreconcilable', rowClass: 'bg-slate-50', badge: 'outline' }
};

// Exceptions the user is expected to act on, in the order they are shown. 'unreconcilable' is
// absent by design - it was marked deliberately, so it is reported as accepted, not as a fault.
export const EXCEPTION_ORDER = ['unmatched', 'orphaned', 'broken_link'];

/**
 * Classify a single bank entry.
 *
 * @param {Object} input
 * @param {number} input.amount - the bank movement, signed
 * @param {boolean} input.isReconciled - bank_statements.is_reconciled
 * @param {boolean} input.isUnreconcilable - bank_statements.is_unreconcilable
 * @param {string} [input.unreconcilableReason] - the reason the user gave
 * @param {number} input.allocationCount - allocations resolved from this entry's reconciliation rows
 * @param {number} input.brokenCount - how many of those point at a record that no longer exists
 * @returns {{status: string, reason: string|null, residual: number,
 *            brokenCount: number, allocationCount: number}}
 */
export function classifyBankEntry({
  amount,
  isReconciled,
  isUnreconcilable,
  unreconcilableReason,
  allocationCount = 0,
  brokenCount = 0
}) {
  const bankAmount = Number.isFinite(amount) ? amount : 0;

  // An entry either accounts for its whole movement or none of it - there is no partial state,
  // so the residual is the whole bank line for every exception.
  const verdict = (status, reason, residual) => ({
    status,
    reason: reason || null,
    residual,
    brokenCount,
    allocationCount
  });

  // Deliberately marked unmatchable. Must be tested before 'orphaned': these entries are written
  // with is_reconciled true and no reconciliation rows, which is otherwise the orphan signature.
  if (isUnreconcilable) {
    return verdict(MATCH_STATUS.UNRECONCILABLE, unreconcilableReason || 'Marked unreconcilable', bankAmount);
  }

  if (allocationCount === 0) {
    return isReconciled
      ? verdict(MATCH_STATUS.ORPHANED, 'Marked reconciled but has no reconciliation links', bankAmount)
      : verdict(MATCH_STATUS.UNMATCHED, 'No reconciliation link', bankAmount);
  }

  // One dead link makes the whole entry untrustworthy, so the full bank line is reported rather
  // than trying to credit the surviving legs.
  if (brokenCount > 0) {
    const detail = brokenCount === allocationCount
      ? 'Reconciled to a record that no longer exists'
      : `${brokenCount} of ${allocationCount} links point to a record that no longer exists`;
    return verdict(MATCH_STATUS.BROKEN_LINK, detail, bankAmount);
  }

  return verdict(MATCH_STATUS.MATCHED, null, 0);
}

const emptyBucket = () => ({ count: 0, credits: 0, debits: 0, gross: 0 });

/**
 * Fold the report rows into the figures the page shows. Pure - reads only fields the page has
 * already stamped onto each row, so it can be exercised without any of the entity data.
 *
 * Credits and debits are kept apart throughout. A netted total would let an unmatched credit and
 * an equal unmatched debit cancel, which is exactly the failure this report had.
 *
 * @param {Array<Object>} rows - reportData, one row per allocation, grouped by bank entry
 */
export function summariseAccountantReport(rows = []) {
  // A bank entry split across several transactions produces one row per allocation. Only the
  // entry's first line carries the bank movement and the match verdict.
  const entryLines = rows.filter(r => r.isFirstLine);

  const totalCredits = entryLines.filter(r => r.amount > 0).reduce((sum, r) => sum + r.amount, 0);
  const totalDebits = entryLines.filter(r => r.amount < 0).reduce((sum, r) => sum + Math.abs(r.amount), 0);
  const netMovement = totalCredits - totalDebits;
  const totalAllocated = rows.reduce((sum, r) => sum + (r.allocatedAmount || 0), 0);

  const byStatus = {};
  Object.values(MATCH_STATUS).forEach(status => { byStatus[status] = emptyBucket(); });

  const exceptions = [];
  const accepted = [];

  entryLines.forEach(row => {
    const status = row.matchStatus || MATCH_STATUS.MATCHED;
    const bucket = byStatus[status] || (byStatus[status] = emptyBucket());
    const residual = row.unallocatedAmount || 0;

    bucket.count += 1;
    if (residual > 0) bucket.credits += residual;
    if (residual < 0) bucket.debits += Math.abs(residual);
    bucket.gross += Math.abs(residual);

    if (status === MATCH_STATUS.UNRECONCILABLE) accepted.push(row);
    else if (status !== MATCH_STATUS.MATCHED) exceptions.push(row);
  });

  // Gross, and actionable only - an entry the user deliberately marked unreconcilable is
  // accounted for, so it does not count against them here.
  const unallocatedCredits = EXCEPTION_ORDER.reduce((sum, s) => sum + byStatus[s].credits, 0);
  const unallocatedDebits = EXCEPTION_ORDER.reduce((sum, s) => sum + byStatus[s].debits, 0);

  const total = entryLines.length;
  const acceptedCount = byStatus[MATCH_STATUS.UNRECONCILABLE].count;
  const accountedCount = byStatus[MATCH_STATUS.MATCHED].count + acceptedCount;

  return {
    total,
    totalCredits,
    totalDebits,
    netMovement,
    totalAllocated,

    accountedCount,
    accountedPercent: total > 0 ? Math.round((accountedCount / total) * 100) : 0,
    acceptedCount,
    exceptionCount: exceptions.length,

    unallocatedCredits,
    unallocatedDebits,
    unallocatedGross: unallocatedCredits + unallocatedDebits,

    byStatus,
    // Incoming order is preserved, so the page's date-order selection carries through untouched
    exceptions,
    accepted
  };
}
