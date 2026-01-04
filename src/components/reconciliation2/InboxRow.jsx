import { Fragment } from 'react';
import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import IntentBadge from './IntentBadge';
import InboxRowExpanded from './InboxRowExpanded';

export default function InboxRow({
  entry,
  isExpanded,
  onToggleExpand,
  loans = [],
  investors = [],
  schedules = [],
  expenseTypes = [],
  onReconcile
}) {
  const classification = entry.classification || {};
  const isCredit = entry.amount > 0;

  return (
    <Fragment>
      <TableRow
        className={`hover:bg-slate-50 cursor-pointer ${isExpanded ? 'bg-slate-50' : ''}`}
        onClick={onToggleExpand}
      >
        <TableCell className="font-medium text-slate-600">
          {entry.statement_date
            ? format(new Date(entry.statement_date), 'dd MMM yyyy')
            : '-'}
        </TableCell>
        <TableCell className={`text-right font-mono font-semibold ${isCredit ? 'text-emerald-600' : 'text-red-600'}`}>
          {isCredit ? '+' : ''}{formatCurrency(entry.amount)}
        </TableCell>
        <TableCell className="max-w-md truncate text-slate-700">
          {entry.description || entry.counterparty || '-'}
        </TableCell>
        <TableCell>
          <IntentBadge
            intent={classification.intent || 'unknown'}
            confidence={classification.confidence || 0}
            compact
          />
        </TableCell>
        <TableCell>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </Button>
        </TableCell>
      </TableRow>

      {isExpanded && (
        <TableRow>
          <TableCell colSpan={5} className="p-0 bg-slate-50">
            <InboxRowExpanded
              entry={entry}
              classification={classification}
              loans={loans}
              investors={investors}
              schedules={schedules}
              expenseTypes={expenseTypes}
              onClose={onToggleExpand}
              onReconcile={onReconcile}
            />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
