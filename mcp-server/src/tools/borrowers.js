import { z } from 'zod';
import { columnsOf, borrowerColumns } from '../db.js';
import { config } from '../config.js';
import {
  money, moneyShort, isoDate, num, row, section, labelled, footer, contractEndDate, borrowerLabel
} from '../format.js';
import { isActiveStatus } from '../caveats.js';
import { findBorrowerRows, summariseRepayments, oldestBalanceAsOf, text } from './shared.js';

export function registerBorrowerTools(server, session) {
  server.registerTool(
    'find_borrowers',
    {
      title: 'Find borrowers',
      description:
        'Search borrowers by name or business (partial match) or by unique_number ' +
        '(e.g. "1000014"). Returns identity plus live loan count and outstanding. ' +
        'Contact details are not included - use get_borrower with include_contact.',
      inputSchema: {
        query: z.string().optional().describe('Name or business, partial match'),
        unique_number: z.string().optional().describe('Borrower reference, e.g. "1000014"'),
        include_archived: z.boolean().optional().default(false),
        limit: z.number().int().positive().optional().default(25)
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (args) =>
      session.run(async (db) => {
        if (!args.query && !args.unique_number) {
          return text('Provide either query (a name or business) or unique_number.');
        }
        const limit = db.clampLimit(args.limit, 25);
        const { rows, count } = await findBorrowerRows(db, {
          query: args.query,
          unique_number: args.unique_number,
          includeArchived: args.include_archived,
          columns: borrowerColumns(),
          limit
        });

        if (rows.length === 0) {
          return text(`No borrowers matched.\n\n${footer({ orgName: session.org.name, shown: 0 })}`);
        }

        const ids = rows.map((b) => b.id);
        const { data: loanRows, error } = await db.notDeleted(db.scoped('loans'))
          .select('id,borrower_id,status,principal_remaining,balance_updated_at')
          .in('borrower_id', ids)
          .limit(1000)
          .abortSignal(db.signal());
        if (error) throw error;

        const byBorrower = new Map();
        for (const l of loanRows || []) {
          const acc = byBorrower.get(l.borrower_id) || { total: 0, active: 0, outstanding: 0 };
          acc.total += 1;
          if (isActiveStatus(l.status)) {
            acc.active += 1;
            acc.outstanding += num(l.principal_remaining);
          }
          byBorrower.set(l.borrower_id, acc);
        }

        const dup = args.unique_number && rows.length > 1
          ? `NOTE: ${rows.length} borrowers share unique_number ${args.unique_number} (the column has no unique constraint).`
          : null;

        const body = [
          `${rows.length} borrower${rows.length === 1 ? '' : 's'}` +
            (count > rows.length ? ` (of ${count} matching)` : ''),
          dup,
          'number | name | business | status | loans | active | outstanding',
          ...rows.map((b) => {
            const agg = byBorrower.get(b.id) || { total: 0, active: 0, outstanding: 0 };
            return row([
              b.unique_number || '(none)',
              [b.first_name, b.last_name].filter(Boolean).join(' ') || b.full_name || '(unnamed)',
              b.business,
              b.is_archived ? 'archived' : b.status,
              `${agg.total} loan${agg.total === 1 ? '' : 's'}`,
              `${agg.active} active`,
              moneyShort(agg.outstanding)
            ]);
          }),
          '',
          footer({
            orgName: session.org.name,
            shown: rows.length,
            total: count,
            asOf: oldestBalanceAsOf(loanRows || [])
          })
        ];
        return text(body.filter(Boolean).join('\n'));
      })
  );

  server.registerTool(
    'get_borrower',
    {
      title: 'Borrower detail',
      description:
        'One borrower with all their loans and lifetime repayments. Contact details and ' +
        'free-text notes are withheld unless include_contact / include_notes is set. ' +
        'ID number and gender are never returned.',
      inputSchema: {
        borrower_id: z.string().uuid().optional(),
        unique_number: z.string().optional(),
        include_contact: z.boolean().optional().default(false)
          .describe('Include phone, email and address. This data is sent to the model.'),
        include_notes: z.boolean().optional().default(false)
          .describe('Include free-text notes and matching keywords.')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (args) =>
      session.run(async (db) => {
        if (!args.borrower_id && !args.unique_number) {
          return text('Provide either borrower_id or unique_number.');
        }
        const cols = borrowerColumns({
          includeContact: args.include_contact,
          includeNotes: args.include_notes
        });

        let q = db.scoped('borrowers').select(cols.join(','));
        q = args.borrower_id ? q.eq('id', args.borrower_id) : q.eq('unique_number', String(args.unique_number));
        const { data, error } = await q.limit(5).abortSignal(db.signal());
        if (error) throw error;
        if (!data || data.length === 0) return text('No borrower found.');

        const borrower = data[0];
        const dup = data.length > 1
          ? `NOTE: ${data.length} borrowers share unique_number ${args.unique_number}; showing the first.`
          : null;

        const { data: loans, error: loanErr } = await db.notDeleted(db.scoped('loans'))
          .select(columnsOf('loans'))
          .eq('borrower_id', borrower.id)
          .order('start_date', { ascending: false })
          .limit(500)
          .abortSignal(db.signal());
        if (loanErr) throw loanErr;

        const loanList = loans || [];
        const loanIds = loanList.map((l) => l.id);
        let transactions = [];
        if (loanIds.length) {
          const { data: tx, error: txErr } = await db.notDeleted(db.scoped('transactions'))
            .select(columnsOf('transactions'))
            .in('loan_id', loanIds)
            .limit(5000)
            .abortSignal(db.signal());
          if (txErr) throw txErr;
          transactions = tx || [];
        }

        const repayTotals = [...summariseRepayments(transactions).values()].reduce(
          (acc, r) => ({
            count: acc.count + r.count,
            amount: acc.amount + r.amount,
            principal: acc.principal + r.principal,
            interest: acc.interest + r.interest,
            fees: acc.fees + r.fees
          }),
          { count: 0, amount: 0, principal: 0, interest: 0, fees: 0 }
        );

        const active = loanList.filter((l) => isActiveStatus(l.status));
        const outstanding = active.reduce((s, l) => s + num(l.principal_remaining), 0);

        const contactLines = args.include_contact || config.pii === 'full'
          ? [
              labelled('email', borrower.email),
              labelled('phone', borrower.phone),
              labelled('mobile', borrower.mobile),
              labelled('landline', borrower.landline),
              labelled('address', [borrower.address, borrower.city, borrower.zipcode, borrower.country].filter(Boolean).join(', '))
            ]
          : ['(withheld - call again with include_contact: true to retrieve)'];

        const parts = [
          `Borrower ${borrower.unique_number || borrower.id} - ${borrowerLabel(borrower)}`,
          dup,
          section('Identity', [
            labelled('name', [borrower.first_name, borrower.last_name].filter(Boolean).join(' ') || borrower.full_name),
            labelled('business', borrower.business),
            labelled('status', borrower.is_archived ? `${borrower.status} (archived)` : borrower.status),
            labelled('on file since', isoDate(borrower.created_at))
          ]),
          section('Contact', contactLines),
          args.include_notes
            ? section('Notes', [
                labelled('notes', borrower.notes),
                labelled('keywords', Array.isArray(borrower.keywords) ? borrower.keywords.join(', ') : borrower.keywords)
              ])
            : null,
          section('Position', [
            `${loanList.length} loan${loanList.length === 1 ? '' : 's'}, ${active.length} active`,
            `principal outstanding: ${money(outstanding)}`,
            `lifetime repaid: ${money(repayTotals.amount)} across ${repayTotals.count} payments`,
            `  principal ${money(repayTotals.principal)} | interest ${money(repayTotals.interest)} | fees ${money(repayTotals.fees)}`
          ]),
          loanList.length
            ? section('Loans', loanList.map((l) => row([
                l.loan_number || '(no number)',
                l.status,
                `start ${isoDate(l.start_date)}`,
                contractEndDate(l) ? `end ${contractEndDate(l)}` : null,
                `principal ${moneyShort(l.principal_amount)}`,
                `outstanding ${moneyShort(l.principal_remaining)}`,
                l.product_name
              ])))
            : null,
          '',
          footer({ orgName: session.org.name, shown: 1, asOf: oldestBalanceAsOf(active) })
        ];
        return text(parts.filter(Boolean).join('\n\n'));
      })
  );
}
