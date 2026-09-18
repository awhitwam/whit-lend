import { z } from 'zod';
import { columnsOf, borrowerColumns, orIlike } from '../db.js';
import {
  money, moneyShort, percent, isoDate, isoDateTime, num, row, section, labelled,
  footer, contractEndDate, borrowerLabel
} from '../format.js';
import { ACTIVE_STATUSES, isActiveStatus } from '../caveats.js';
import {
  fetchAll, loansQuery, transactionsQuery, resolveLoan, summariseRepayments,
  furtherAdvances, oldestBalanceAsOf, text
} from './shared.js';

const LOAN_COLS = columnsOf('loans');

/** One line per loan, in a fixed column order. */
function loanLine(loan, borrowerName) {
  return row([
    loan.loan_number || '(no number)',
    borrowerName,
    loan.status,
    `start ${isoDate(loan.start_date)}`,
    loan.duration && loan.period ? `${loan.duration} ${loan.period}` : null,
    contractEndDate(loan) ? `end ${contractEndDate(loan)}` : null,
    `principal ${moneyShort(loan.principal_amount)}`,
    `outstanding ${moneyShort(loan.principal_remaining)}`,
    loan.interest_rate != null ? percent(num(loan.interest_rate), 1) : null,
    loan.interest_type
  ]);
}

export function registerLoanTools(server, session) {
  server.registerTool(
    'portfolio_summary',
    {
      title: 'Portfolio summary',
      description:
        'Headline figures for the whole loan book: counts by status, principal advanced, ' +
        'principal outstanding, and total repaid split into principal/interest/fees. ' +
        'Repayment totals are summed from transactions; the organization_summary table is ' +
        'deliberately not used because it is client-written and was observed to be stale.',
      inputSchema: { include_status_breakdown: z.boolean().optional().default(true) },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ include_status_breakdown = true }) =>
      session.run(async (db) => {
        const loans = await fetchAll(db, 'loans', (q) => db.notDeleted(q));
        const transactions = await fetchAll(db, 'transactions', (q) => db.notDeleted(q));

        const byStatus = new Map();
        for (const l of loans) {
          const s = l.status || '(none)';
          byStatus.set(s, (byStatus.get(s) || 0) + 1);
        }

        const active = loans.filter((l) => isActiveStatus(l.status));
        const outstanding = active.reduce((sum, l) => sum + num(l.principal_remaining), 0);
        const advanced = loans.reduce((sum, l) => sum + num(l.principal_amount), 0);

        const repayments = transactions.filter((t) => t.type === 'Repayment');
        const repaid = repayments.reduce((sum, t) => sum + num(t.amount), 0);
        const repaidPrincipal = repayments.reduce((sum, t) => sum + num(t.principal_applied), 0);
        const repaidInterest = repayments.reduce((sum, t) => sum + num(t.interest_applied), 0);
        const repaidFees = repayments.reduce((sum, t) => sum + num(t.fees_applied), 0);

        const borrowerIds = new Set(loans.map((l) => l.borrower_id).filter(Boolean));
        const activeBorrowerIds = new Set(active.map((l) => l.borrower_id).filter(Boolean));
        const dates = loans.map((l) => l.start_date).filter(Boolean).sort();

        const parts = [
          `Portfolio summary - ${session.org.name}`,
          '',
          section('Loans', [
            `total (excluding deleted): ${loans.length}`,
            `active (${ACTIVE_STATUSES.join('/')}): ${active.length}`,
            dates.length ? `first loan started ${isoDate(dates[0])}, most recent ${isoDate(dates[dates.length - 1])}` : null
          ]),
          include_status_breakdown
            ? section('By status', [...byStatus.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([s, n]) => `${s}: ${n}`))
            : null,
          section('Principal', [
            `advanced (sum of principal_amount, all loans): ${money(advanced)}`,
            `outstanding on active loans: ${money(outstanding)}`
          ]),
          section('Received (summed from transactions)', [
            `repayment transactions: ${repayments.length}`,
            `total received: ${money(repaid)}`,
            `applied to principal: ${money(repaidPrincipal)}`,
            `applied to interest: ${money(repaidInterest)}`,
            `applied to fees: ${money(repaidFees)}`
          ]),
          section('Borrowers', [
            `with any loan: ${borrowerIds.size}`,
            `with an active loan: ${activeBorrowerIds.size}`
          ]),
          '',
          footer({
            orgName: session.org.name,
            shown: loans.length,
            asOf: oldestBalanceAsOf(active),
            extra: 'outstanding from principal_remaining (trigger-maintained)'
          })
        ];
        return text(parts.filter(Boolean).join('\n'));
      })
  );

  server.registerTool(
    'find_loans',
    {
      title: 'Find loans',
      description:
        'Search and filter loans. Combine borrower, status, product, amount and date ' +
        'filters. Returns one line per loan with outstanding principal. Use active_only ' +
        'for the Live/Active set - loan status is free text, so exact values vary.',
      inputSchema: {
        borrower_query: z.string().optional().describe('Borrower name or business, partial match'),
        borrower_id: z.string().uuid().optional(),
        loan_number: z.string().optional(),
        status: z.array(z.string()).optional().describe('Exact status values, e.g. ["Live","Default"]'),
        active_only: z.boolean().optional().describe('Shorthand for status Live or Active'),
        product_name: z.string().optional(),
        min_principal: z.number().optional(),
        max_principal: z.number().optional(),
        min_outstanding: z.number().optional(),
        max_outstanding: z.number().optional(),
        started_after: z.string().optional().describe('YYYY-MM-DD'),
        started_before: z.string().optional().describe('YYYY-MM-DD'),
        sort_by: z.enum(['outstanding', 'principal', 'start_date', 'loan_number']).optional().default('outstanding'),
        sort_dir: z.enum(['asc', 'desc']).optional().default('desc'),
        limit: z.number().int().positive().optional().default(50),
        offset: z.number().int().min(0).optional().default(0)
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (args) =>
      session.run(async (db) => {
        const limit = db.clampLimit(args.limit, 50);
        const offset = args.offset || 0;

        const embed = `borrowers!inner(${borrowerColumns().join(',')})`;
        let q = db.notDeleted(db.scoped('loans')).select(`${LOAN_COLS},${embed}`, { count: 'exact' });

        if (args.borrower_id) q = q.eq('borrower_id', args.borrower_id);
        if (args.loan_number) q = q.eq('loan_number', String(args.loan_number));
        if (args.borrower_query) {
          q = q.or(orIlike(['full_name', 'business', 'first_name', 'last_name'], args.borrower_query), {
            referencedTable: 'borrowers'
          });
        }
        if (args.active_only) q = q.in('status', ACTIVE_STATUSES);
        else if (args.status?.length) q = q.in('status', args.status);
        if (args.product_name) q = q.ilike('product_name', `%${args.product_name}%`);
        if (args.min_principal != null) q = q.gte('principal_amount', args.min_principal);
        if (args.max_principal != null) q = q.lte('principal_amount', args.max_principal);
        if (args.min_outstanding != null) q = q.gte('principal_remaining', args.min_outstanding);
        if (args.max_outstanding != null) q = q.lte('principal_remaining', args.max_outstanding);
        if (args.started_after) q = q.gte('start_date', args.started_after);
        if (args.started_before) q = q.lte('start_date', args.started_before);

        const sortColumn = {
          outstanding: 'principal_remaining',
          principal: 'principal_amount',
          start_date: 'start_date',
          loan_number: 'loan_number'
        }[args.sort_by || 'outstanding'];

        const { data, error, count } = await q
          .order(sortColumn, { ascending: (args.sort_dir || 'desc') === 'asc', nullsFirst: false })
          .range(offset, offset + limit - 1)
          .abortSignal(db.signal());
        if (error) throw error;

        const rows = data || [];
        if (rows.length === 0) {
          return text(`No loans matched.\n\n${footer({ orgName: session.org.name, shown: 0 })}`);
        }

        const totalOutstanding = rows.reduce((s, l) => s + num(l.principal_remaining), 0);
        const body = [
          `${rows.length} loan${rows.length === 1 ? '' : 's'}` +
            (count && count > rows.length ? ` (of ${count} matching)` : ''),
          'number | borrower | status | start | term | end | principal | outstanding | rate | type',
          ...rows.map((l) => loanLine(l, borrowerLabel(l.borrowers))),
          '',
          `outstanding across the rows shown: ${money(totalOutstanding)}`,
          '',
          footer({
            orgName: session.org.name,
            shown: rows.length,
            total: count ?? rows.length,
            asOf: oldestBalanceAsOf(rows)
          })
        ];
        return text(body.join('\n'));
      })
  );

  server.registerTool(
    'get_loan',
    {
      title: 'Loan detail',
      description:
        'Everything on one loan: terms, computed contract end date, outstanding principal ' +
        'reconciled against transactions, repayments to date, security/property, schedule ' +
        'summary and recent transactions. Look up by loan_number (e.g. "1000048") or id.',
      inputSchema: {
        loan_id: z.string().uuid().optional(),
        loan_number: z.string().optional(),
        include_schedule: z.boolean().optional().default(false),
        include_transactions: z.boolean().optional().default(true),
        transaction_limit: z.number().int().positive().optional().default(25)
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (args) =>
      session.run(async (db) => {
        const resolved = await resolveLoan(db, args);
        if (resolved.error) return text(resolved.error);
        const loan = resolved.loan;

        const [borrowerRes, productRes, txRes, schedRes, secRes] = await Promise.all([
          loan.borrower_id
            ? db.scoped('borrowers').select(borrowerColumns().join(',')).eq('id', loan.borrower_id).maybeSingle().abortSignal(db.signal())
            : Promise.resolve({ data: null }),
          loan.product_id
            ? db.scoped('loan_products').select(columnsOf('loan_products')).eq('id', loan.product_id).maybeSingle().abortSignal(db.signal())
            : Promise.resolve({ data: null }),
          db.notDeleted(db.scoped('transactions')).select(columnsOf('transactions'))
            .eq('loan_id', loan.id).order('date', { ascending: false }).limit(1000).abortSignal(db.signal()),
          db.scoped('repayment_schedules').select(columnsOf('repayment_schedules'))
            .eq('loan_id', loan.id).order('installment_number', { ascending: true }).limit(1000).abortSignal(db.signal()),
          db.scoped('loan_properties')
            .select(`${columnsOf('loan_properties')},properties(${columnsOf('properties')}),first_charge_holders(name)`)
            .eq('loan_id', loan.id).abortSignal(db.signal())
        ]);

        const borrower = borrowerRes.data;
        const product = productRes.data;
        const transactions = txRes.data || [];
        const schedule = schedRes.data || [];
        const security = (secRes.data || []).filter((s) => s.status !== 'Removed');

        const repay = summariseRepayments(transactions).get(loan.id) ||
          { count: 0, amount: 0, principal: 0, interest: 0, fees: 0, first: null, last: null };
        const advances = furtherAdvances(transactions);
        const derived = num(loan.principal_amount) + advances - repay.principal;
        const stored = num(loan.principal_remaining);
        const drift = Math.abs(derived - stored);

        const today = new Date().toISOString().slice(0, 10);
        const nextDue = schedule.find((s) => s.due_date >= today && String(s.status) !== 'Paid');
        const scheduledToDate = schedule
          .filter((s) => s.due_date <= today)
          .reduce((sum, s) => sum + num(s.total_due), 0);

        const parts = [
          `Loan ${loan.loan_number || loan.id}`,
          resolved.warning ? `NOTE: ${resolved.warning}` : null,
          '',
          section('Loan', [
            labelled('borrower', borrower ? `${borrowerLabel(borrower)} (${borrower.unique_number || 'no number'})` : loan.borrower_name),
            labelled('product', loan.product_name || product?.name),
            labelled('status', loan.status),
            labelled('started', isoDate(loan.start_date)),
            loan.duration && loan.period ? `term: ${loan.duration} ${loan.period}` : null,
            contractEndDate(loan)
              ? `contract end (start_date + duration): ${contractEndDate(loan)}${loan.auto_extend ? ' - auto_extend is on, so this is not a maturity date' : ''}`
              : 'contract end: not computable (period or duration missing)',
            labelled('rate', loan.interest_rate != null ? percent(num(loan.interest_rate)) : null),
            loan.override_interest_rate ? `rate overridden to ${percent(num(loan.overridden_rate))}` : null,
            loan.has_penalty_rate ? `penalty rate ${percent(num(loan.penalty_rate))} from ${isoDate(loan.penalty_rate_from)}` : null,
            labelled('interest type', loan.interest_type),
            labelled('product type', loan.product_type),
            loan.arrangement_fee ? `arrangement fee: ${money(loan.arrangement_fee)}` : null,
            loan.exit_fee ? `exit fee: ${money(loan.exit_fee)}` : null,
            loan.net_disbursed ? `net disbursed: ${money(loan.net_disbursed)}` : null,
            loan.restructured_from_loan_number ? `restructured from loan ${loan.restructured_from_loan_number}` : null,
            labelled('description', loan.description)
          ]),
          section('Principal', [
            `original: ${money(loan.principal_amount)}`,
            advances > 0 ? `further advances: ${money(advances)}` : null,
            `repaid (sum of principal_applied): ${money(repay.principal)}`,
            `outstanding: ${money(stored)} (as of ${isoDateTime(loan.balance_updated_at)})`,
            drift > 0.01
              ? `WARNING: stored outstanding differs from ${money(derived)} derived from transactions by ${money(drift)}`
              : null
          ]),
          section('Repayments to date', [
            `${repay.count} payment${repay.count === 1 ? '' : 's'} totalling ${money(repay.amount)}`,
            `principal ${money(repay.principal)} | interest ${money(repay.interest)} | fees ${money(repay.fees)}`,
            repay.first ? `first ${isoDate(repay.first)}, last ${isoDate(repay.last)}` : null
          ]),
          loan.interest_remaining != null
            ? section('Cached, unverified', [
                `interest_remaining: ${money(loan.interest_remaining)} - this column is not maintained by any trigger; treat as indicative only`
              ])
            : null,
          schedule.length
            ? section('Schedule', [
                `${schedule.length} installments, ${isoDate(schedule[0].due_date)} to ${isoDate(schedule[schedule.length - 1].due_date)}`,
                `scheduled to date: ${money(scheduledToDate)}`,
                nextDue ? `next due: ${isoDate(nextDue.due_date)} for ${money(nextDue.total_due)}` : 'no future unpaid installment'
              ])
            : null,
          security.length
            ? section('Security', security.map((s) => row([
                s.properties?.address || 'property',
                s.properties?.postcode,
                s.charge_type,
                s.properties?.current_value ? `value ${money(s.properties.current_value)}` : null,
                s.first_charge_holders?.name ? `first charge: ${s.first_charge_holders.name}` : null,
                s.first_charge_balance ? `first charge balance ${money(s.first_charge_balance)}` : null
              ])))
            : null,
          args.include_schedule && schedule.length
            ? section('Schedule rows', schedule.map((s) => row([
                `#${s.installment_number}`,
                isoDate(s.due_date),
                `due ${money(s.total_due)}`,
                `principal ${money(s.principal_amount)}`,
                `interest ${money(s.interest_amount)}`,
                `paid ${money(num(s.principal_paid) + num(s.interest_paid))}`,
                s.status
              ])))
            : null,
          args.include_transactions !== false && transactions.length
            ? section(`Recent transactions (newest first, ${Math.min(transactions.length, db.clampLimit(args.transaction_limit, 25))} of ${transactions.length})`,
                transactions.slice(0, db.clampLimit(args.transaction_limit, 25)).map((t) => row([
                  isoDate(t.date),
                  t.type,
                  money(t.amount),
                  `p ${money(t.principal_applied)}`,
                  `i ${money(t.interest_applied)}`,
                  num(t.fees_applied) ? `f ${money(t.fees_applied)}` : null,
                  t.reference
                ])))
            : null,
          '',
          footer({ orgName: session.org.name, shown: 1, asOf: loan.balance_updated_at })
        ];
        return text(parts.filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n'));
      })
  );

  server.registerTool(
    'list_products',
    {
      title: 'List loan products',
      description:
        'The loan products configured for this organization: rate, interest type, period, ' +
        'calculation method and limits. Useful for interpreting what a loan\'s terms mean.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async () =>
      session.run(async (db) => {
        const { data, error } = await db.scoped('loan_products')
          .select(columnsOf('loan_products'))
          .order('name', { ascending: true })
          .limit(200)
          .abortSignal(db.signal());
        if (error) throw error;
        const rows = data || [];
        const body = [
          `${rows.length} loan product${rows.length === 1 ? '' : 's'}`,
          'name | rate | interest type | period | calculation | product type | limits',
          ...rows.map((p) => row([
            p.name,
            percent(num(p.interest_rate)),
            p.interest_type,
            p.period,
            p.interest_calculation_method,
            p.product_type,
            p.min_amount || p.max_amount
              ? `${moneyShort(p.min_amount || 0)}-${p.max_amount ? moneyShort(p.max_amount) : 'no max'}`
              : null
          ])),
          '',
          footer({ orgName: session.org.name, shown: rows.length })
        ];
        return text(body.join('\n'));
      })
  );
}
