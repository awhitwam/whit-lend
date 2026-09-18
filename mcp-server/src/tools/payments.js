import { z } from 'zod';
import { columnsOf, borrowerColumns, orIlike } from '../db.js';
import { money, moneyShort, isoDate, num, row, section, footer, borrowerLabel } from '../format.js';
import { ACTIVE_STATUSES, assessScheduleQuality, scheduleArrears, cashflowArrears } from '../caveats.js';
import { text } from './shared.js';

const today = () => new Date().toISOString().slice(0, 10);

/** Loan id -> { number, borrower } for labelling schedule rows. */
async function loanIndex(db, { activeOnly }) {
  let q = db.notDeleted(db.scoped('loans'))
    .select(`id,loan_number,status,borrowers(${borrowerColumns().join(',')})`);
  if (activeOnly) q = q.in('status', ACTIVE_STATUSES);
  const { data, error } = await q.limit(2000).abortSignal(db.signal());
  if (error) throw error;
  const index = new Map();
  for (const l of data || []) {
    index.set(l.id, {
      number: l.loan_number || '(no number)',
      borrower: borrowerLabel(l.borrowers),
      status: l.status
    });
  }
  return index;
}

export function registerPaymentTools(server, session) {
  server.registerTool(
    'list_transactions',
    {
      title: 'List transactions',
      description:
        'Loan transactions (repayments and disbursements) with filters for loan, ' +
        'borrower, type, date range and amount. Ends with totals for the rows shown - ' +
        'use this to answer "how much did we collect in August".',
      inputSchema: {
        loan_id: z.string().uuid().optional(),
        loan_number: z.string().optional(),
        borrower_id: z.string().uuid().optional(),
        borrower_query: z.string().optional(),
        type: z.enum(['Repayment', 'Disbursement']).optional(),
        from: z.string().optional().describe('YYYY-MM-DD, inclusive'),
        to: z.string().optional().describe('YYYY-MM-DD, inclusive'),
        min_amount: z.number().optional(),
        max_amount: z.number().optional(),
        limit: z.number().int().positive().optional().default(100),
        offset: z.number().int().min(0).optional().default(0),
        sort_dir: z.enum(['asc', 'desc']).optional().default('desc')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (args) =>
      session.run(async (db) => {
        const limit = db.clampLimit(args.limit, 100);
        const offset = args.offset || 0;

        const needsBorrowerJoin = Boolean(args.borrower_query || args.borrower_id);
        const embed = needsBorrowerJoin
          ? `loans!inner(loan_number,status,borrowers!inner(${borrowerColumns().join(',')}))`
          : `loans(loan_number,status,borrowers(${borrowerColumns().join(',')}))`;

        let q = db.notDeleted(db.scoped('transactions'))
          .select(`${columnsOf('transactions')},${embed}`, { count: 'exact' });

        if (args.loan_id) q = q.eq('loan_id', args.loan_id);
        if (args.loan_number) q = q.eq('loans.loan_number', String(args.loan_number));
        if (args.borrower_id) q = q.eq('loans.borrower_id', args.borrower_id);
        if (args.borrower_query) {
          q = q.or(orIlike(['full_name', 'business', 'first_name', 'last_name'], args.borrower_query), {
            referencedTable: 'loans.borrowers'
          });
        }
        if (args.type) q = q.eq('type', args.type);
        if (args.from) q = q.gte('date', args.from);
        if (args.to) q = q.lte('date', args.to);
        if (args.min_amount != null) q = q.gte('amount', args.min_amount);
        if (args.max_amount != null) q = q.lte('amount', args.max_amount);

        const { data, error, count } = await q
          .order('date', { ascending: (args.sort_dir || 'desc') === 'asc' })
          .range(offset, offset + limit - 1)
          .abortSignal(db.signal());
        if (error) throw error;

        const rows = data || [];
        if (rows.length === 0) {
          return text(`No transactions matched.\n\n${footer({ orgName: session.org.name, shown: 0 })}`);
        }

        const total = rows.reduce((s, t) => s + num(t.amount), 0);
        const principal = rows.reduce((s, t) => s + num(t.principal_applied), 0);
        const interest = rows.reduce((s, t) => s + num(t.interest_applied), 0);
        const fees = rows.reduce((s, t) => s + num(t.fees_applied), 0);

        const body = [
          `${rows.length} transaction${rows.length === 1 ? '' : 's'}` +
            (count && count > rows.length ? ` (of ${count} matching)` : ''),
          'date | loan | borrower | type | amount | principal | interest | fees | reference',
          ...rows.map((t) => row([
            isoDate(t.date),
            t.loans?.loan_number || '-',
            borrowerLabel(t.loans?.borrowers),
            t.type,
            money(t.amount),
            `p ${moneyShort(t.principal_applied)}`,
            `i ${moneyShort(t.interest_applied)}`,
            num(t.fees_applied) ? `f ${moneyShort(t.fees_applied)}` : null,
            t.reference
          ])),
          '',
          section('Totals for the rows shown', [
            `amount: ${money(total)}`,
            `principal ${money(principal)} | interest ${money(interest)} | fees ${money(fees)}`,
            count && count > rows.length
              ? `NOTE: ${count} rows match the filter; these totals cover only the ${rows.length} shown. Raise limit or page with offset for a complete total.`
              : null
          ]),
          '',
          footer({ orgName: session.org.name, shown: rows.length, total: count ?? rows.length })
        ];
        return text(body.filter(Boolean).join('\n'));
      })
  );

  server.registerTool(
    'payments_due',
    {
      title: 'Payments due',
      description:
        'Scheduled installments in a date window, showing what was due and what the ' +
        'schedule records as paid. This is the raw evidence behind arrears - if the ' +
        'recorded-paid column is uniformly zero, the schedule payment data is not ' +
        'populated on this book and arrears cannot be computed from it.',
      inputSchema: {
        window: z.enum(['overdue', 'next_7_days', 'next_30_days', 'custom']).optional().default('next_30_days'),
        from: z.string().optional().describe('YYYY-MM-DD, required when window is custom'),
        to: z.string().optional().describe('YYYY-MM-DD, required when window is custom'),
        active_only: z.boolean().optional().default(true),
        limit: z.number().int().positive().optional().default(100)
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (args) =>
      session.run(async (db) => {
        const limit = db.clampLimit(args.limit, 100);
        const now = today();
        let from = null;
        let to = null;
        const win = args.window || 'next_30_days';
        if (win === 'overdue') { to = now; }
        else if (win === 'next_7_days' || win === 'next_30_days') {
          const days = win === 'next_7_days' ? 7 : 30;
          const end = new Date();
          end.setDate(end.getDate() + days);
          from = now;
          to = end.toISOString().slice(0, 10);
        } else {
          if (!args.from && !args.to) return text('window: custom needs from and/or to (YYYY-MM-DD).');
          from = args.from || null;
          to = args.to || null;
        }

        const loans = await loanIndex(db, { activeOnly: args.active_only !== false });
        if (loans.size === 0) return text('No matching loans.');

        let q = db.scoped('repayment_schedules')
          .select(columnsOf('repayment_schedules'), { count: 'exact' })
          .in('loan_id', [...loans.keys()]);
        if (from) q = q.gte('due_date', from);
        if (to) q = q.lte('due_date', to);

        const { data, error, count } = await q
          .order('due_date', { ascending: true })
          .limit(limit)
          .abortSignal(db.signal());
        if (error) throw error;

        const rows = data || [];
        if (rows.length === 0) {
          return text(`No scheduled installments in that window.\n\n${footer({ orgName: session.org.name, shown: 0 })}`);
        }

        const totalDue = rows.reduce((s, r) => s + num(r.total_due), 0);
        const totalPaid = rows.reduce((s, r) => s + num(r.principal_paid) + num(r.interest_paid), 0);
        const withPayment = rows.filter((r) => num(r.principal_paid) > 0 || num(r.interest_paid) > 0).length;

        const body = [
          `${rows.length} installment${rows.length === 1 ? '' : 's'} ` +
            `${win === 'overdue' ? 'overdue (due on or before today)' : `due ${from || 'any'} to ${to || 'any'}`}` +
            (count && count > rows.length ? ` - of ${count} matching` : ''),
          'due | loan | borrower | total due | recorded paid | shortfall | status',
          ...rows.map((r) => {
            const meta = loans.get(r.loan_id) || { number: '?', borrower: '?' };
            const paid = num(r.principal_paid) + num(r.interest_paid);
            return row([
              isoDate(r.due_date),
              meta.number,
              meta.borrower,
              money(r.total_due),
              money(paid),
              money(Math.max(0, num(r.total_due) - paid)),
              r.status
            ]);
          }),
          '',
          section('Totals for the rows shown', [
            `due: ${money(totalDue)}`,
            `recorded as paid: ${money(totalPaid)}`,
            withPayment === 0
              ? 'NOTE: none of these rows record any payment. On a bulk-imported book the ' +
                'repayment_schedules payment columns are typically never backfilled, so ' +
                '"recorded paid" here is not evidence that nothing was paid. Check ' +
                'list_transactions for the same period.'
              : `${withPayment} of ${rows.length} rows record a payment`
          ]),
          '',
          footer({ orgName: session.org.name, shown: rows.length, total: count ?? rows.length })
        ];
        return text(body.filter(Boolean).join('\n'));
      })
  );

  server.registerTool(
    'arrears_report',
    {
      title: 'Arrears report',
      description:
        'Loans behind on payments, computed two independent ways: schedule-based (the ' +
        'formula the app dashboard uses) and cashflow-based (scheduled to date minus ' +
        'received to date). If the schedule payment columns are unpopulated the tool ' +
        'reports data_quality: unreliable and withholds a headline figure rather than ' +
        'stating a wrong one.',
      inputSchema: {
        as_of: z.string().optional().describe('YYYY-MM-DD, defaults to today'),
        active_only: z.boolean().optional().default(true),
        min_shortfall: z.number().optional().default(0.01),
        limit: z.number().int().positive().optional().default(100)
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (args) =>
      session.run(async (db) => {
        const asOf = args.as_of || today();
        const limit = db.clampLimit(args.limit, 100);
        const minShortfall = args.min_shortfall ?? 0.01;

        const loans = await loanIndex(db, { activeOnly: args.active_only !== false });
        if (loans.size === 0) return text('No matching loans.');
        const loanIds = [...loans.keys()];

        const { data: dueRows, error: dueErr } = await db.scoped('repayment_schedules')
          .select(columnsOf('repayment_schedules'))
          .in('loan_id', loanIds)
          .lte('due_date', asOf)
          .limit(5000)
          .abortSignal(db.signal());
        if (dueErr) throw dueErr;

        const { data: repayments, error: repayErr } = await db.notDeleted(db.scoped('transactions'))
          .select('loan_id,amount,date,type')
          .in('loan_id', loanIds)
          .eq('type', 'Repayment')
          .lte('date', asOf)
          .limit(20000)
          .abortSignal(db.signal());
        if (repayErr) throw repayErr;

        const pastDue = (dueRows || []).filter((r) => r.due_date < asOf);
        const quality = assessScheduleQuality(pastDue, (repayments || []).length);
        const bySchedule = scheduleArrears(pastDue);
        const byCashflow = cashflowArrears(dueRows || [], repayments || []);

        const loanRows = loanIds
          .map((id) => ({
            id,
            meta: loans.get(id),
            schedule: bySchedule.get(id) || 0,
            cashflow: byCashflow.get(id) || 0
          }))
          .filter((r) => r.schedule >= minShortfall || r.cashflow >= minShortfall)
          .sort((a, b) => Math.max(b.schedule, b.cashflow) - Math.max(a.schedule, a.cashflow))
          .slice(0, limit);

        const scheduleTotal = [...bySchedule.values()].reduce((s, v) => s + v, 0);
        const cashflowTotal = [...byCashflow.values()].reduce((s, v) => s + v, 0);

        const header = quality.reliable
          ? [
              `Arrears as at ${asOf}`,
              `data_quality: ok - ${quality.verdict}`,
              `schedule-based total: ${money(scheduleTotal)}`,
              `cashflow-based total: ${money(cashflowTotal)}`
            ]
          : [
              `Arrears as at ${asOf}`,
              'data_quality: UNRELIABLE - no headline arrears figure is being reported.',
              `Reason: ${quality.verdict}`,
              '',
              'For reference only, and not to be quoted as an arrears figure:',
              `  the schedule-based formula would produce ${money(scheduleTotal)}`,
              `  the cashflow-based measure produces ${money(cashflowTotal)}`,
              '',
              'To get a usable arrears figure the repayment_schedules payment columns need ' +
              'backfilling from the transactions ledger. Until then, use list_transactions ' +
              'and payments_due to look at specific loans.'
            ];

        const divergent = loanRows.filter((r) => {
          const bigger = Math.max(r.schedule, r.cashflow);
          return bigger > 0 && Math.abs(r.schedule - r.cashflow) / bigger > 0.05;
        }).length;

        const body = [
          header.join('\n'),
          '',
          loanRows.length
            ? [
                `${loanRows.length} loan${loanRows.length === 1 ? '' : 's'} showing a shortfall on at least one measure:`,
                'loan | borrower | schedule-based | cashflow-based',
                ...loanRows.map((r) => row([
                  r.meta.number,
                  r.meta.borrower,
                  money(r.schedule),
                  money(r.cashflow)
                ])),
                divergent
                  ? `\n${divergent} loan${divergent === 1 ? '' : 's'} where the two measures differ by more than 5% - treat those figures with caution.`
                  : null
              ].filter(Boolean).join('\n')
            : 'No loan shows a shortfall on either measure.',
          '',
          footer({
            orgName: session.org.name,
            shown: loanRows.length,
            extra: `past-due schedule rows: ${quality.total}, of which recording a payment: ${quality.rowsWithPayments}`
          })
        ];
        return text(body.join('\n'));
      })
  );
}
