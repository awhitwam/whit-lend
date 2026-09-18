import { columnsOf, orIlike } from '../db.js';
import { num } from '../format.js';

/** Page through a scoped table without tripping PostgREST's 1000-row cap. */
export async function fetchAll(db, table, build, { pageSize = 1000, cap = 20000 } = {}) {
  const rows = [];
  for (let offset = 0; offset < cap; offset += pageSize) {
    const query = build(db.scoped(table).select(columnsOf(table)))
      .range(offset, offset + pageSize - 1)
      .abortSignal(db.signal());
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

/** Live (non-deleted) loans. */
export function loansQuery(db) {
  return db.notDeleted(db.scoped('loans'));
}

/** Live (non-deleted) transactions. */
export function transactionsQuery(db) {
  return db.notDeleted(db.scoped('transactions'));
}

/**
 * Resolve one loan by loan_number or id. loan_number is text with no unique constraint,
 * so more than one row is possible and must be reported rather than silently truncated.
 */
export async function resolveLoan(db, { loan_id, loan_number }) {
  if (!loan_id && !loan_number) {
    return { error: 'Provide either loan_id or loan_number.' };
  }
  let q = db.notDeleted(db.scoped('loans')).select(columnsOf('loans'));
  q = loan_id ? q.eq('id', loan_id) : q.eq('loan_number', String(loan_number));
  const { data, error } = await q.limit(5).abortSignal(db.signal());
  if (error) throw error;
  if (!data || data.length === 0) {
    return { error: `No loan found for ${loan_id ? `id ${loan_id}` : `loan number ${loan_number}`}.` };
  }
  if (data.length > 1) {
    return {
      loan: data[0],
      warning:
        `${data.length} loans share loan_number ${loan_number} (the column has no unique ` +
        `constraint). Showing the first; ids: ${data.map((l) => l.id).join(', ')}.`
    };
  }
  return { loan: data[0] };
}

/** Resolve borrowers by free-text query or unique_number. */
export async function findBorrowerRows(db, { query, unique_number, includeArchived, columns, limit }) {
  let q = db.scoped('borrowers').select(columns.join(','), { count: 'exact' });
  if (!includeArchived) q = q.or('is_archived.is.null,is_archived.eq.false');
  if (unique_number) q = q.eq('unique_number', String(unique_number));
  if (query) q = q.or(orIlike(['full_name', 'business', 'first_name', 'last_name'], query));
  const { data, error, count } = await q
    .order('full_name', { ascending: true })
    .limit(limit)
    .abortSignal(db.signal());
  if (error) throw error;
  return { rows: data || [], count: count ?? (data || []).length };
}

/** Sum repayment transactions per loan id. */
export function summariseRepayments(transactions) {
  const byLoan = new Map();
  for (const t of transactions) {
    if (t.type !== 'Repayment') continue;
    const acc = byLoan.get(t.loan_id) || { count: 0, amount: 0, principal: 0, interest: 0, fees: 0, first: null, last: null };
    acc.count += 1;
    acc.amount += num(t.amount);
    acc.principal += num(t.principal_applied);
    acc.interest += num(t.interest_applied);
    acc.fees += num(t.fees_applied);
    if (!acc.first || t.date < acc.first) acc.first = t.date;
    if (!acc.last || t.date > acc.last) acc.last = t.date;
    byLoan.set(t.loan_id, acc);
  }
  return byLoan;
}

/**
 * Further advances: every Disbursement after the first, by (date, id).
 * Mirrors the ROW_NUMBER window in migration 054 so the figure reconciles with
 * principal_remaining.
 */
export function furtherAdvances(transactions) {
  const disbursements = transactions
    .filter((t) => t.type === 'Disbursement')
    .sort((a, b) => (a.date === b.date ? String(a.id).localeCompare(String(b.id)) : String(a.date).localeCompare(String(b.date))));
  return disbursements.slice(1).reduce((sum, t) => sum + num(t.gross_amount), 0);
}

/** The oldest balance_updated_at across a set of loans - the honest as-of for an aggregate. */
export function oldestBalanceAsOf(loans) {
  const stamps = loans.map((l) => l.balance_updated_at).filter(Boolean).sort();
  return stamps.length ? stamps[0] : null;
}

export function text(body) {
  return { content: [{ type: 'text', text: body }] };
}

export function toolError(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}
