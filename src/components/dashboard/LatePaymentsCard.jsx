/**
 * Borrowers who were servicing interest and have stopped, worst first.
 *
 * Purely presentational: it receives finished rows from buildLatePaymentRows and does no
 * queries and no date maths, exactly as the other dashboard cards do.
 *
 * The only money figure shown is the last payment actually made. That is the one amount
 * mcp-server/src/caveats.js blesses, and it does the real work: "they normally pay £4,200
 * a month and haven't since March." Deliberately absent: loan.interest_remaining (the
 * column exists but migration 054 never populates it) and any estimated total missed
 * (periodsLate x perPeriod multiplies two derived quantities and would read as a hard
 * arrears figure - precisely what the caveats exist to prevent).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

const COLLAPSED_ROWS = 5;

/**
 * Three coordinated maps keyed by tier, with literal class strings throughout.
 * tailwind.config.js has no `safelist`, so an interpolated class name would be purged
 * from the build and the row would render unstyled.
 *
 * Escalation is carried by the badge and the accent bar; the row tint stays weak so the
 * slate-900 borrower name keeps its contrast at every tier. White on red-500 is 3.99:1
 * and fails AA at this size, hence red-600 and red-800 for the top two.
 */
const BADGE_CLASS = {
  1: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  2: 'bg-red-100 text-red-800 ring-1 ring-red-300',
  3: 'bg-red-200 text-red-900 ring-1 ring-red-400',
  4: 'bg-red-600 text-white',
  5: 'bg-red-800 text-white'
};

const ROW_CLASS = {
  1: 'border-l-4 border-l-red-200',
  2: 'border-l-4 border-l-red-300 bg-red-50/30',
  3: 'border-l-4 border-l-red-400 bg-red-50/60',
  4: 'border-l-4 border-l-red-600 bg-red-50',
  5: 'border-l-4 border-l-red-800 bg-red-100/70'
};

const RANK_CLASS = {
  1: 'bg-red-50 text-red-700',
  2: 'bg-red-100 text-red-800',
  3: 'bg-red-200 text-red-900',
  4: 'bg-red-600 text-white',
  5: 'bg-red-800 text-white'
};

/**
 * What the borrower has stopped paying. Rent loans service a rent charge rather than
 * interest and Fixed Charge loans settle through `fees_applied` (see
 * lastInterestPayment in src/lib/latePayments.js), so calling all three "interest"
 * misdescribes two of them. Keyed on row.schedulerType, which buildLatePaymentRows
 * already resolves through the same product/scheduler authority the engine uses.
 */
const KIND_LABEL = {
  rent: 'Rent',
  fixed_charge: 'Charge'
};

const KIND_CLASS = {
  rent: 'bg-amber-50 text-amber-700 ring-amber-200',
  fixed_charge: 'bg-violet-50 text-violet-700 ring-violet-200'
};

const DEFAULT_KIND_CLASS = 'bg-white text-slate-600 ring-slate-200';

export default function LatePaymentsCard({ rows = [], isLoading = false }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const hidden = rows.length - visible.length;

  return (
    <Card className="bg-white border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            Stopped Paying Interest
          </CardTitle>
          {!isLoading && rows.length > 0 && (
            <span className="text-sm font-semibold text-red-700 bg-red-50 px-2.5 py-1 rounded-full shrink-0">
              {rows.length} {rows.length === 1 ? 'loan' : 'loans'}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Live loans that were servicing interest or rent and have lapsed, measured against
          each loan&apos;s own payment interval
        </p>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          // The dashboard has no skeletons anywhere, but this one case matters: before
          // transactions resolve the list is empty and the card would show a confident
          // all-clear. A false all-clear on an exceptions card is worse than a spinner.
          <div className="flex items-center justify-center gap-2 p-6 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking payment history&hellip;
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-6 text-sm text-slate-500">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            All servicing loans are up to date
          </div>
        ) : (
          <>
            <div className={`divide-y divide-slate-100 ${expanded ? 'max-h-96 overflow-y-auto' : ''}`}>
              {visible.map((row, idx) => (
                <Link
                  key={row.loan.id}
                  to={createPageUrl(`LoanDetails?id=${row.loan.id}`)}
                  className={`flex items-center gap-2 px-3 py-2 hover:bg-slate-50 transition-colors ${ROW_CLASS[row.tier]}`}
                  title={row.lastPaidLabel
                    ? `Last paid ${formatCurrency(row.lastPaidAmount)} on ${row.lastPaidLabel} · ${row.cadenceLabel}`
                    : `Never paid · ${row.cadenceLabel} expected`}
                >
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${RANK_CLASS[row.tier]}`}>
                    {idx + 1}
                  </div>

                  {/* flex-1 + min-w-0 on this group, shrink-0 on everything after it:
                      the borrower name is the only thing that truncates, so the loan
                      number, the kind and the badge always stay readable. */}
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900 truncate">
                      {row.loan.borrower_name}
                    </span>
                    <span className="text-xs text-slate-400 shrink-0">
                      #{row.loan.loan_number}
                    </span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ring-1 shrink-0 ${KIND_CLASS[row.schedulerType] || DEFAULT_KIND_CLASS}`}>
                      {KIND_LABEL[row.schedulerType] || 'Interest'}
                    </span>
                  </div>

                  {/* Hidden below lg, where there is no room for it; the row `title`
                      carries the same sentence for every width. */}
                  <span className="text-xs text-slate-400 whitespace-nowrap shrink-0 hidden lg:block">
                    {row.lastPaidLabel
                      ? `${formatCurrency(row.lastPaidAmount)} · ${row.lastPaidLabel} · ${row.cadenceLabel}`
                      : `Never paid · ${row.cadenceLabel}`}
                  </span>

                  <div className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${BADGE_CLASS[row.tier]}`}>
                    {row.daysLate}d late
                  </div>
                </Link>
              ))}
            </div>

            {hidden > 0 && (
              // Expands in place rather than linking to Loans, which has no arrears
              // filter - "View All" would land somewhere that cannot answer the question.
              <div className="p-2 border-t border-slate-100">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-slate-600"
                  onClick={() => setExpanded(true)}
                >
                  Show all {rows.length}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
