import { num } from './format.js';

/**
 * What this book's data can and cannot support.
 *
 * The January 2026 export showed all 2,149 repayment_schedules rows with
 * principal_paid = 0, interest_paid = 0 and status = 'Pending' - the book was bulk
 * imported and those columns were never backfilled. The app writes them when payments
 * go through the UI (src/pages/LoanDetails.jsx:589), so this may have improved since;
 * the gate below measures it at query time rather than assuming either way.
 *
 * Running the Dashboard.jsx:422-433 arrears formula over that data reports GBP 26.6m
 * of arrears on a GBP 9.4m book. So arrears are computed two independent ways and the
 * headline is withheld when the schedule data cannot support it.
 */

/** Text the model sees on initialize, so it never treats these figures as gospel. */
export const SERVER_INSTRUCTIONS = `Read-only access to the WhitLend loan book (borrowers, loans, transactions, repayment schedules, security).

Data caveats that matter when answering:
- There is no maturity_date column. Contract end is computed as start_date + duration and is reported as contract_end_date. Most live loans have auto_extend set, so a past contract end does not mean the loan matured.
- loans.principal_remaining is trigger-maintained and trustworthy; it is always reported with an as-of timestamp. loans.interest_remaining is NOT maintained and is only shown, clearly labelled, by get_loan.
- loans.principal_paid and interest_paid are stale and are never returned. Amounts repaid are summed from the transactions table instead.
- The organization_summary table is client-written and is never read by this server.
- Loan status is free text with no constraint. Observed values include Live, Closed, Restructured, Default, Cancelled. Use active_only for the Live/Active set.
- Arrears depend on repayment_schedules payment columns, which are unpopulated on bulk-imported books. arrears_report checks this and will refuse to state a headline figure rather than report a wrong one. Do not work around that refusal by computing arrears yourself from other tools.

Every response ends with a footer naming the organization, the row count, and the balance as-of time. Report figures with their as-of date rather than as bare facts.`;

export const DATA_CAVEATS_RESOURCE = `# WhitLend data caveats

## Balances
| Field | Trust | Why |
|---|---|---|
| loans.principal_remaining | Yes | Maintained by trigger trg_update_loan_balance (migration 054). principal_amount + further advances - SUM(principal_applied), excluding soft-deleted rows. balance_updated_at records freshness. |
| loans.interest_remaining | No | The column exists but migration 054 does not populate it. Written only opportunistically from the browser. Shown by get_loan under an explicit "cached, unverified" label; never used in aggregates. |
| loans.principal_paid / interest_paid / charges_paid | No | Initialised to 0 at creation and never maintained. Loan 1000036 shows principal_paid = 0 while principal_remaining reflects GBP 1.28m repaid. Not in the column allowlist. |
| organization_summary | No | Client-written. Its total_principal_outstanding matched, but total_repaid was 0 against 1,622 repayment transactions. Never read. |

Repayment totals are summed from the transactions table: SUM(amount), SUM(principal_applied), SUM(interest_applied), SUM(fees_applied) over type = 'Repayment', excluding soft-deleted rows. That is addition over stored rows, not interest modelling.

## Arrears
Two independent measures, both reported:
- schedule-based: over past-due schedule rows on active loans with status != 'Paid', SUM(max(0, total_due - principal_paid - interest_paid)). This is the formula src/pages/Dashboard.jsx:422-433 uses.
- cashflow-based: SUM(total_due) for rows due on or before the as-of date, minus SUM(repayment amounts) up to that date, floored at zero.

If past-due schedule rows carry no recorded payments at all while the loans do have repayment transactions, the schedule columns are unpopulated and the schedule-based figure is meaningless. The tool then reports data_quality: unreliable and withholds a headline number.

## Dates
No maturity_date column exists. contract_end_date = start_date + duration, with the unit taken from period (Monthly, Weekly, Quarterly, Yearly). period is null on many closed loans, in which case no end date is reported. Note src/lib/letterGenerator.js:128 always adds months regardless of period - that is a bug in the app, not mirrored here.

## Interest
This server does not model interest. It reports stored values and sums stored rows. Questions like "what is the payoff figure on 30 September" need the interest engine and cannot be answered here.

## Not readable
audit_logs, bank_statements, reconciliation_entries, reconciliation_patterns, accepted_orphans, google_drive_tokens, trusted_devices, invitations, receipt_drafts, letter_templates, generated_letters, loan_comments. Investor tables are also out of scope for this version.
borrowers.id_number and borrowers.gender are never returned. Contact details and notes are withheld unless a tool call opts in.`;

const ACTIVE_STATUSES = ['Live', 'Active'];

export function isActiveStatus(status) {
  return ACTIVE_STATUSES.includes(String(status || ''));
}

export { ACTIVE_STATUSES };

/**
 * Does the schedule data support an arrears figure at all?
 *
 * @param {Array} pastDueRows  schedule rows already past their due date
 * @param {number} repaymentCount  repayment transactions on the same loan set
 */
export function assessScheduleQuality(pastDueRows, repaymentCount) {
  const total = pastDueRows.length;
  if (total === 0) {
    return { reliable: true, verdict: 'no past-due schedule rows', rowsWithPayments: 0, total: 0 };
  }
  const rowsWithPayments = pastDueRows.filter(
    (r) => num(r.principal_paid) > 0 || num(r.interest_paid) > 0 || String(r.status) === 'Paid'
  ).length;

  if (rowsWithPayments === 0 && repaymentCount > 0) {
    return {
      reliable: false,
      rowsWithPayments,
      total,
      verdict:
        `none of the ${total} past-due schedule rows record any payment, yet the same loans ` +
        `have ${repaymentCount} repayment transactions. The repayment_schedules payment ` +
        'columns are unpopulated on this book (typical of a bulk import), so the ' +
        'schedule-based arrears figure would be meaningless.'
    };
  }
  return {
    reliable: true,
    rowsWithPayments,
    total,
    verdict: `${rowsWithPayments} of ${total} past-due schedule rows record a payment`
  };
}

/** Dashboard.jsx:422-433 formula, per loan. */
export function scheduleArrears(pastDueRows) {
  const byLoan = new Map();
  for (const r of pastDueRows) {
    if (String(r.status) === 'Paid') continue;
    const shortfall = Math.max(0, num(r.total_due) - num(r.principal_paid) - num(r.interest_paid));
    if (shortfall <= 0) continue;
    byLoan.set(r.loan_id, num(byLoan.get(r.loan_id)) + shortfall);
  }
  return byLoan;
}

/** Scheduled-to-date minus actually-received, floored at zero, per loan. */
export function cashflowArrears(dueRows, repayments) {
  const dueByLoan = new Map();
  for (const r of dueRows) {
    dueByLoan.set(r.loan_id, num(dueByLoan.get(r.loan_id)) + num(r.total_due));
  }
  const paidByLoan = new Map();
  for (const t of repayments) {
    paidByLoan.set(t.loan_id, num(paidByLoan.get(t.loan_id)) + num(t.amount));
  }
  const out = new Map();
  for (const [loanId, due] of dueByLoan) {
    const shortfall = due - num(paidByLoan.get(loanId));
    if (shortfall > 0.005) out.set(loanId, shortfall);
  }
  return out;
}
