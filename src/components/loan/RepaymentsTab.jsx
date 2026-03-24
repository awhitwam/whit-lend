import { useState, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Edit,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Landmark,
  AlertTriangle,
} from 'lucide-react';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { format } from 'date-fns';

export default function RepaymentsTab({
  transactions,
  loan,
  reconciledTransactionIds,
  reconciliationMap,
  onEditRepayment,
  onDeleteRepayment,
}) {
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('asc');

  const repayments = useMemo(() => {
    return transactions
      .filter(t => !t.is_deleted && t.type === 'Repayment')
      .map(tx => {
        const principal = tx.principal_applied || 0;
        const interest = tx.interest_applied || 0;
        const fees = tx.fees_applied || 0;
        const allocated = principal + interest + fees;
        const unallocated = Math.max(0, tx.amount - allocated);

        return {
          ...tx,
          principal,
          interest,
          fees,
          allocated,
          unallocated,
          hasAllocationIssue: unallocated > 0.01,
        };
      });
  }, [transactions]);

  const sorted = useMemo(() => {
    return [...repayments].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date': cmp = new Date(a.date) - new Date(b.date); break;
        case 'amount': cmp = a.amount - b.amount; break;
        case 'principal': cmp = a.principal - b.principal; break;
        case 'interest': cmp = a.interest - b.interest; break;
        case 'fees': cmp = a.fees - b.fees; break;
        default: cmp = new Date(a.date) - new Date(b.date);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [repayments, sortField, sortDir]);

  const totals = useMemo(() => {
    return repayments.reduce((acc, tx) => ({
      amount: acc.amount + tx.amount,
      principal: acc.principal + tx.principal,
      interest: acc.interest + tx.interest,
      fees: acc.fees + tx.fees,
      unallocated: acc.unallocated + tx.unallocated,
    }), { amount: 0, principal: 0, interest: 0, fees: 0, unallocated: 0 });
  }, [repayments]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 ml-1" />
      : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const issueCount = repayments.filter(r => r.hasAllocationIssue).length;

  return (
    <div className="p-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">
            {repayments.length} repayment{repayments.length !== 1 ? 's' : ''}
          </span>
          {issueCount > 0 && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 gap-1">
              <AlertTriangle className="w-3 h-3" />
              {issueCount} with unallocated amount
            </Badge>
          )}
        </div>
        <div className="text-sm text-slate-500">
          Total: <span className="font-mono font-medium text-slate-700">{formatCurrency(totals.amount)}</span>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead
                className="font-semibold text-xs py-0.5 cursor-pointer select-none"
                onClick={() => handleSort('date')}
              >
                <span className="flex items-center">Date <SortIcon field="date" /></span>
              </TableHead>
              <TableHead
                className="font-semibold text-xs text-right py-0.5 cursor-pointer select-none"
                onClick={() => handleSort('amount')}
              >
                <span className="flex items-center justify-end">Amount <SortIcon field="amount" /></span>
              </TableHead>
              <TableHead
                className="font-semibold text-xs text-right py-0.5 cursor-pointer select-none"
                onClick={() => handleSort('principal')}
              >
                <span className="flex items-center justify-end">Principal <SortIcon field="principal" /></span>
              </TableHead>
              <TableHead
                className="font-semibold text-xs text-right py-0.5 cursor-pointer select-none"
                onClick={() => handleSort('interest')}
              >
                <span className="flex items-center justify-end">Interest <SortIcon field="interest" /></span>
              </TableHead>
              <TableHead
                className="font-semibold text-xs text-right py-0.5 cursor-pointer select-none"
                onClick={() => handleSort('fees')}
              >
                <span className="flex items-center justify-end">Fees <SortIcon field="fees" /></span>
              </TableHead>
              <TableHead className="font-semibold text-xs text-right py-0.5">Unallocated</TableHead>
              <TableHead className="font-semibold text-xs py-0.5">Reference</TableHead>
              <TableHead className="font-semibold text-xs w-8 py-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Landmark className="w-3 h-3 text-slate-400" />
                  </TooltipTrigger>
                  <TooltipContent><p>Bank Reconciled</p></TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead className="font-semibold text-xs w-10 py-0.5"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-slate-500 py-8">
                  No repayments recorded
                </TableCell>
              </TableRow>
            ) : (
              <>
                {sorted.map(tx => (
                  <TableRow
                    key={tx.id}
                    className={tx.hasAllocationIssue ? 'bg-amber-50/40' : 'hover:bg-slate-50/50'}
                  >
                    <TableCell className="text-sm font-mono py-0.5 whitespace-nowrap">
                      {format(new Date(tx.date), 'dd/MM/yy')}
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono py-0.5">
                      <span className="text-emerald-600 font-medium">{formatCurrency(tx.amount)}</span>
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono py-0.5">
                      {tx.principal > 0 ? (
                        <span className="text-emerald-600">{formatCurrency(tx.principal)}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono py-0.5">
                      {tx.interest > 0 ? (
                        formatCurrency(tx.interest)
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono py-0.5">
                      {tx.fees > 0 ? (
                        <span className="text-purple-600">{formatCurrency(tx.fees)}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono py-0.5">
                      {tx.hasAllocationIssue ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-amber-600 font-medium cursor-help flex items-center justify-end gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              {formatCurrency(tx.unallocated)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{formatCurrency(tx.unallocated)} not allocated to principal, interest, or fees.</p>
                            <p className="text-xs mt-1">Click Edit to reallocate.</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500 py-0.5 max-w-[150px] truncate">
                      {tx.reference || '—'}
                    </TableCell>
                    <TableCell className="text-center py-0.5">
                      {reconciledTransactionIds?.has(tx.id) ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Landmark className="w-3 h-3 text-emerald-500 mx-auto" />
                          </TooltipTrigger>
                          <TooltipContent><p>Bank reconciled</p></TooltipContent>
                        </Tooltip>
                      ) : null}
                    </TableCell>
                    <TableCell className="py-0.5">
                      <div className="flex items-center gap-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => onEditRepayment(tx)}
                            >
                              <Edit className="w-3.5 h-3.5 text-slate-400 hover:text-slate-700" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Edit allocation</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => onDeleteRepayment?.(tx)}
                            >
                              <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Delete repayment</p></TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}

                {/* Totals row */}
                <TableRow className="bg-slate-100 border-t-2 border-black font-medium">
                  <TableCell className="text-sm py-0.5">Totals</TableCell>
                  <TableCell className="text-sm text-right font-mono text-emerald-600 py-0.5">
                    {formatCurrency(totals.amount)}
                  </TableCell>
                  <TableCell className="text-sm text-right font-mono text-emerald-600 py-0.5">
                    {totals.principal > 0 ? formatCurrency(totals.principal) : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-right font-mono py-0.5">
                    {totals.interest > 0 ? formatCurrency(totals.interest) : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-right font-mono text-purple-600 py-0.5">
                    {totals.fees > 0 ? formatCurrency(totals.fees) : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-right font-mono py-0.5">
                    {totals.unallocated > 0.01 ? (
                      <span className="text-amber-600">{formatCurrency(totals.unallocated)}</span>
                    ) : '—'}
                  </TableCell>
                  <TableCell colSpan={3} className="py-0.5"></TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Fee info */}
      {loan && (loan.exit_fee > 0 || loan.arrangement_fee > 0) && (
        <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
          {loan.arrangement_fee > 0 && (
            <span>Arrangement fee: <span className="font-mono font-medium">{formatCurrency(loan.arrangement_fee)}</span></span>
          )}
          {loan.exit_fee > 0 && (
            <span>Exit fee: <span className="font-mono font-medium text-purple-600">{formatCurrency(loan.exit_fee)}</span></span>
          )}
        </div>
      )}
    </div>
  );
}
