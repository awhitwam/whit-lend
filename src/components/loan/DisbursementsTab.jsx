import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Banknote,
  Plus,
  Trash2,
  Edit,
  MoreHorizontal,
  Landmark,
  ShieldCheck,
} from 'lucide-react';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { format } from 'date-fns';

export default function DisbursementsTab({
  transactions,
  loan,
  disbursementSort,
  setDisbursementSort,
  selectedDisbursements,
  setSelectedDisbursements,
  setIsAddDisbursementOpen,
  setDeleteDisbursementsDialogOpen,
  reconciledTransactionIds,
  reconciliationMap,
  acceptedOrphanMap,
  setEditDisbursementTarget,
  setEditDisbursementValues,
  setEditDisbursementDialogOpen,
}) {
  // Get all disbursement transactions sorted by date (ONLY disbursements, no repayments)
  const disbursementTransactions = transactions
    .filter(t => !t.is_deleted && t.type === 'Disbursement')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // Build entries from disbursement transactions only
  // First disbursement is "Initial Disbursement", rest are "Additional Drawdown"
  // For initial disbursement, include additional_deducted_fees from loan record
  const disbursementEntries = disbursementTransactions.map((t, index) => {
    const isInitial = index === 0;
    const deductedFee = t.deducted_fee || 0;
    const deductedInterest = t.deducted_interest || 0;
    // For initial disbursement, get additional fees from loan record
    const additionalFees = isInitial ? (loan?.additional_deducted_fees || 0) : 0;
    const additionalFeesNote = isInitial ? (loan?.additional_deducted_fees_note || '') : '';
    const totalDeductions = deductedFee + deductedInterest + additionalFees;

    return {
      id: t.id,
      date: new Date(t.date),
      description: isInitial ? 'Initial Disbursement' : 'Additional Drawdown',
      gross_amount: t.gross_amount ?? t.amount,  // Gross amount (or amount for legacy)
      deducted_fee: deductedFee,
      deducted_interest: deductedInterest,
      additional_fees: additionalFees,
      additional_fees_note: additionalFeesNote,
      total_deductions: totalDeductions,
      // Calculate net dynamically: gross - all deductions (handles legacy data where t.amount was wrong)
      amount: (t.gross_amount ?? t.amount) - deductedFee - deductedInterest - additionalFees,
      notes: t.notes || (isInitial ? 'Loan originated' : ''),
      hasDeductions: totalDeductions > 0
    };
  });

  // Sort based on selection
  const sortedEntries = [...disbursementEntries].sort((a, b) => {
    switch (disbursementSort) {
      case 'date-asc': return a.date - b.date;
      case 'date-desc': return b.date - a.date;
      case 'amount-asc': return a.amount - b.amount;
      case 'amount-desc': return b.amount - a.amount;
      default: return b.date - a.date;
    }
  });

  // Calculate running balance (in date order) - use GROSS for principal tracking
  const dateOrderedEntries = [...disbursementEntries].sort((a, b) => a.date - b.date);
  let runningBalance = 0;
  const balanceMap = {};
  dateOrderedEntries.forEach(entry => {
    runningBalance += entry.gross_amount;  // Use gross for principal balance
    balanceMap[entry.id] = runningBalance;
  });

  const totalGross = disbursementEntries.reduce((sum, e) => sum + e.gross_amount, 0);
  const totalNet = disbursementEntries.reduce((sum, e) => sum + e.amount, 0);
  const totalDeductions = disbursementEntries.reduce((sum, e) => sum + e.total_deductions, 0);
  const totalArrangementFees = disbursementEntries.reduce((sum, e) => sum + e.deducted_fee, 0);
  const totalAdditionalFees = disbursementEntries.reduce((sum, e) => sum + e.additional_fees, 0);
  const totalAdvanceInterest = disbursementEntries.reduce((sum, e) => sum + e.deducted_interest, 0);
  const hasDeductionBreakdown = totalArrangementFees > 0 || totalAdditionalFees > 0 || totalAdvanceInterest > 0;

  // Toggle select all
  const allSelected = disbursementEntries.length > 0 && disbursementEntries.every(e => selectedDisbursements.has(e.id));
  const someSelected = disbursementEntries.some(e => selectedDisbursements.has(e.id));

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedDisbursements(new Set());
    } else {
      setSelectedDisbursements(new Set(disbursementEntries.map(e => e.id)));
    }
  };

  const handleSelectOne = (id) => {
    const newSelected = new Set(selectedDisbursements);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedDisbursements(newSelected);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Disbursements</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setIsAddDisbursementOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Disbursement
            </Button>
            {selectedDisbursements.size > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteDisbursementsDialogOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Delete ({selectedDisbursements.size})
              </Button>
            )}
            <Select
              value={disbursementSort}
              onValueChange={setDisbursementSort}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date-desc">Date (Newest)</SelectItem>
                <SelectItem value="date-asc">Date (Oldest)</SelectItem>
                <SelectItem value="amount-desc">Amount (High-Low)</SelectItem>
                <SelectItem value="amount-asc">Amount (Low-High)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 p-3 bg-slate-50 rounded-lg">
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5">Gross Disbursed</p>
              <p className="text-sm font-bold text-slate-900">{formatCurrency(totalGross)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5">Deductions</p>
              {hasDeductionBreakdown ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className="text-sm font-bold text-amber-600 cursor-help">
                      {totalDeductions > 0 ? `-${formatCurrency(totalDeductions)}` : '-'}
                    </p>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <div className="text-xs space-y-1">
                      {totalArrangementFees > 0 && (
                        <p>Arrangement Fees: {formatCurrency(totalArrangementFees)}</p>
                      )}
                      {totalAdditionalFees > 0 && (
                        <p>
                          Additional Fees: {formatCurrency(totalAdditionalFees)}
                          {loan?.additional_deducted_fees_note && (
                            <span className="text-slate-400 block">({loan.additional_deducted_fees_note})</span>
                          )}
                        </p>
                      )}
                      {totalAdvanceInterest > 0 && (
                        <p>Advance Interest: {formatCurrency(totalAdvanceInterest)}</p>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <p className="text-sm font-bold text-amber-600">{totalDeductions > 0 ? `-${formatCurrency(totalDeductions)}` : '-'}</p>
              )}
            </div>
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5">Net Paid Out</p>
              <p className="text-sm font-bold text-emerald-600">{formatCurrency(totalNet)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5">Count</p>
              <p className="text-sm font-bold text-slate-900">{disbursementEntries.length}</p>
            </div>
          </div>

          {sortedEntries.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Banknote className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p>No disbursements yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="w-8 py-1 px-2">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={handleSelectAll}
                        className={someSelected && !allSelected ? 'data-[state=checked]:bg-slate-400' : ''}
                      />
                    </th>
                    <th className="text-left py-1 px-2 text-sm font-semibold text-slate-700">Date</th>
                    <th className="text-left py-1 px-2 text-sm font-semibold text-slate-700">Description</th>
                    <th className="text-right py-1 px-2 text-sm font-semibold text-slate-700">Gross</th>
                    <th className="text-right py-1 px-2 text-sm font-semibold text-amber-600">Deductions</th>
                    <th className="text-right py-1 px-2 text-sm font-semibold text-emerald-700">Net</th>
                    <th className="text-right py-1 px-2 text-sm font-semibold text-slate-700">Principal</th>
                    <th className="w-6 py-1 px-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Landmark className="w-3 h-3 text-slate-400" />
                        </TooltipTrigger>
                        <TooltipContent><p>Bank Reconciled</p></TooltipContent>
                      </Tooltip>
                    </th>
                    <th className="w-8 py-1 px-1"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedEntries.map((entry) => (
                    <tr key={entry.id} className={`hover:bg-slate-50 ${selectedDisbursements.has(entry.id) ? 'bg-blue-50' : ''}`}>
                      <td className="py-1 px-2">
                        <Checkbox
                          checked={selectedDisbursements.has(entry.id)}
                          onCheckedChange={() => handleSelectOne(entry.id)}
                        />
                      </td>
                      <td className="py-1 px-2 text-base">{format(entry.date, 'dd/MM/yy')}</td>
                      <td className="py-1 px-2 text-base">
                        <Badge variant="default" className="text-xs px-1.5 py-0 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                          {entry.description}
                        </Badge>
                        {entry.notes && (
                          <p className="text-sm text-slate-400 mt-0.5 truncate max-w-[150px]" title={entry.notes}>
                            {entry.notes}
                          </p>
                        )}
                      </td>
                      <td className="py-1 px-2 text-base font-mono text-slate-700 text-right font-medium">
                        {formatCurrency(entry.gross_amount)}
                      </td>
                      <td className="py-1 px-2 text-base text-right">
                        {entry.hasDeductions ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="font-mono text-amber-600 cursor-help">
                                -{formatCurrency(entry.total_deductions)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              <div className="text-xs space-y-1">
                                {entry.deducted_fee > 0 && (
                                  <p>Arrangement Fee: {formatCurrency(entry.deducted_fee)}</p>
                                )}
                                {entry.additional_fees > 0 && (
                                  <p>
                                    Additional Fees: {formatCurrency(entry.additional_fees)}
                                    {entry.additional_fees_note && (
                                      <span className="text-slate-400 ml-1">({entry.additional_fees_note})</span>
                                    )}
                                  </p>
                                )}
                                {entry.deducted_interest > 0 && (
                                  <p>Advance Interest: {formatCurrency(entry.deducted_interest)}</p>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                      <td className="py-1 px-2 text-base font-mono text-emerald-600 text-right font-medium">
                        {formatCurrency(entry.amount)}
                      </td>
                      <td className="py-1 px-2 text-base font-mono text-slate-700 text-right font-semibold">
                        {formatCurrency(balanceMap[entry.id])}
                      </td>
                      <td className="py-1 px-1 text-center">
                        {reconciledTransactionIds.has(entry.id) ? (
                          (() => {
                            const matches = reconciliationMap.get(entry.id) || [];
                            return (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Landmark className="w-3.5 h-3.5 text-emerald-500 cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <div className="space-y-2">
                                    <p className="font-medium text-emerald-400">
                                      Matched to {matches.length > 1 ? `${matches.length} bank entries` : 'Bank Statement'}
                                    </p>
                                    {matches.map((match, idx) => {
                                      const bs = match?.bankStatement;
                                      return (
                                        <div key={idx} className={matches.length > 1 ? 'border-t border-slate-600 pt-1' : ''}>
                                          {bs ? (
                                            <>
                                              <p className="text-xs"><span className="text-slate-400">Date:</span> {format(new Date(bs.statement_date), 'dd/MM/yyyy')}</p>
                                              <p className="text-xs"><span className="text-slate-400">Amount:</span> {formatCurrency(Math.abs(bs.amount))}</p>
                                              <p className="text-xs"><span className="text-slate-400">Source:</span> {bs.bank_source}</p>
                                              {bs.description && <p className="text-xs text-slate-300 truncate max-w-[200px]">{bs.description}</p>}
                                            </>
                                          ) : (
                                            <p className="text-xs text-slate-400">Bank statement details loading...</p>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })()
                        ) : acceptedOrphanMap.has(entry.id) ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <ShieldCheck className="w-3.5 h-3.5 text-amber-500 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="font-medium text-amber-400">Accepted Orphan</p>
                              <p className="text-xs text-slate-300 mt-1">{acceptedOrphanMap.get(entry.id).reason}</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-slate-300">&mdash;</span>
                        )}
                      </td>
                      <td className="py-0.5 px-1">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                // Find the original transaction to get all fields
                                const tx = transactions.find(t => t.id === entry.id);
                                setEditDisbursementTarget(tx);
                                setEditDisbursementValues({
                                  date: tx?.date || '',
                                  gross_amount: (tx?.gross_amount ?? tx?.amount)?.toString() || '',
                                  deducted_fee: (tx?.deducted_fee || 0).toString(),
                                  deducted_interest: (tx?.deducted_interest || 0).toString(),
                                  notes: tx?.notes || ''
                                });
                                setEditDisbursementDialogOpen(true);
                              }}
                            >
                              <Edit className="w-4 h-4 mr-2" />
                              Edit Disbursement
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onClick={() => {
                                // Select just this disbursement and open delete dialog
                                setSelectedDisbursements(new Set([entry.id]));
                                setDeleteDisbursementsDialogOpen(true);
                              }}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete Disbursement
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      </CardContent>
    </Card>
  );
}
