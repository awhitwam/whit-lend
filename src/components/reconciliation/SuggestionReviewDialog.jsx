/**
 * SuggestionReviewDialog - Review a suggested match before accepting
 *
 * Handles both:
 * - "match" mode: Matching to existing transactions (balances must match)
 * - "create" mode: Suggesting creation of new transactions (pattern-based)
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { format, parseISO, differenceInDays } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import {
  Check,
  X,
  ArrowRight,
  AlertCircle,
  AlertTriangle,
  FileText,
  Building2,
  Receipt,
  Users,
  Calendar,
  Hash,
  Plus
} from 'lucide-react';

// Confidence badge styling
const getConfidenceColor = (confidence) => {
  const pct = confidence * 100;
  if (pct >= 90) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (pct >= 70) return 'bg-amber-100 text-amber-700 border-amber-200';
  if (pct >= 50) return 'bg-orange-100 text-orange-700 border-orange-200';
  return 'bg-red-100 text-red-700 border-red-200';
};

// Match type display
const getMatchTypeInfo = (type) => {
  const info = {
    loan_repayment: { icon: FileText, label: 'Loan Repayment', color: 'text-emerald-600' },
    loan_disbursement: { icon: FileText, label: 'Loan Disbursement', color: 'text-red-600' },
    investor_credit: { icon: Building2, label: 'Investor Credit', color: 'text-blue-600' },
    investor_withdrawal: { icon: Building2, label: 'Investor Withdrawal', color: 'text-purple-600' },
    interest_withdrawal: { icon: Building2, label: 'Interest Withdrawal', color: 'text-purple-600' },
    expense: { icon: Receipt, label: 'Expense', color: 'text-orange-600' }
  };
  return info[type] || { icon: AlertCircle, label: type, color: 'text-slate-600' };
};

export default function SuggestionReviewDialog({
  open,
  onClose,
  entry,
  suggestion,
  onAccept,
  onDismiss,
  isProcessing
}) {
  if (!entry || !suggestion) return null;

  const isCredit = entry.amount > 0;
  const confidence = suggestion.confidence || 0;
  const confidencePct = Math.round(confidence * 100);
  const typeInfo = getMatchTypeInfo(suggestion.type);
  const TypeIcon = typeInfo.icon;

  // Get the matched entity name
  const getMatchedEntityName = () => {
    if (suggestion.borrower) {
      return suggestion.borrower.business_name || suggestion.borrower.name;
    }
    if (suggestion.loan) {
      return suggestion.loan.borrower_name;
    }
    if (suggestion.investor) {
      return suggestion.investor.business_name || suggestion.investor.name;
    }
    if (suggestion.existingExpense) {
      return suggestion.existingExpense.type_name || 'Expense';
    }
    return 'Unknown';
  };

  // Check if this is a "create" vs "match" suggestion
  const isCreateMode = suggestion.matchMode === 'create';

  // Check if this is a grouped match
  const isGroupedMatch = suggestion.matchMode === 'grouped_disbursement' ||
                        suggestion.matchMode === 'grouped_investor' ||
                        suggestion.matchMode === 'match_group';

  // Check if we have an existing transaction to match
  const hasExistingTransaction = !!(
    suggestion.existingTransaction ||
    suggestion.existingTransactions?.length ||
    suggestion.existingExpense ||
    suggestion.existingInterest ||
    suggestion.existingInterestEntries?.length
  );

  // Get match mode description
  const getMatchModeDescription = () => {
    if (isCreateMode) {
      return 'No existing transaction found - will create new';
    }
    switch (suggestion.matchMode) {
      case 'match':
        return 'Match to existing transaction';
      case 'match_group':
        return 'Match to multiple existing transactions';
      case 'grouped_disbursement':
        return 'Match multiple bank debits → single disbursement';
      case 'grouped_investor':
        return 'Match multiple bank entries → single investor transaction';
      default:
        return suggestion.matchMode;
    }
  };

  // Get the transaction amount we're matching to (for balance check display)
  const getTransactionAmount = () => {
    if (suggestion.existingTransaction) {
      return Math.abs(parseFloat(suggestion.existingTransaction.amount) || 0);
    }
    if (suggestion.existingTransactions?.length) {
      return suggestion.existingTransactions.reduce(
        (sum, tx) => sum + Math.abs(parseFloat(tx.amount) || 0), 0
      );
    }
    if (suggestion.existingExpense) {
      return Math.abs(parseFloat(suggestion.existingExpense.amount) || 0);
    }
    if (suggestion.existingInterest) {
      return Math.abs(parseFloat(suggestion.existingInterest.amount) || 0);
    }
    if (suggestion.existingInterestEntries?.length) {
      return suggestion.existingInterestEntries.reduce(
        (sum, i) => sum + Math.abs(parseFloat(i.amount) || 0), 0
      );
    }
    return 0;
  };

  // For grouped matches, sum all bank entries; otherwise use single entry amount
  const bankAmount = (isGroupedMatch && suggestion.groupedEntries?.length)
    ? suggestion.groupedEntries.reduce((sum, e) => sum + Math.abs(e.amount), 0)
    : Math.abs(entry.amount);
  const transactionAmount = getTransactionAmount();
  const amountsMatch = Math.abs(bankAmount - transactionAmount) < 0.01;

  // Get transaction date for comparison
  const getTransactionDate = () => {
    if (suggestion.existingTransaction?.date) {
      return suggestion.existingTransaction.date;
    }
    if (suggestion.existingTransactions?.[0]?.date) {
      return suggestion.existingTransactions[0].date;
    }
    if (suggestion.existingExpense?.date) {
      return suggestion.existingExpense.date;
    }
    if (suggestion.existingInterest?.date) {
      return suggestion.existingInterest.date;
    }
    if (suggestion.existingInterestEntries?.[0]?.date) {
      return suggestion.existingInterestEntries[0].date;
    }
    return null;
  };

  // Calculate date difference
  const bankDate = entry.statement_date ? parseISO(entry.statement_date) : null;
  const txDateStr = getTransactionDate();
  const txDate = txDateStr ? parseISO(txDateStr) : null;
  const dateDiff = bankDate && txDate ? Math.abs(differenceInDays(bankDate, txDate)) : null;

  // Get date match status
  const getDateMatchStatus = () => {
    if (dateDiff === null) return { status: 'unknown', label: 'Unknown', color: 'text-slate-500' };
    if (dateDiff === 0) return { status: 'exact', label: 'Same day', color: 'text-emerald-600' };
    if (dateDiff <= 3) return { status: 'close', label: `${dateDiff} day${dateDiff > 1 ? 's' : ''} apart`, color: 'text-emerald-600' };
    if (dateDiff <= 7) return { status: 'week', label: `${dateDiff} days apart`, color: 'text-amber-600' };
    return { status: 'far', label: `${dateDiff} days apart`, color: 'text-red-600' };
  };

  const dateStatus = getDateMatchStatus();

  // Get investor details for display
  const getInvestorDetails = () => {
    if (!suggestion.investor) return null;
    return {
      name: suggestion.investor.name || '-',
      businessName: suggestion.investor.business_name || '-',
      displayName: suggestion.investor.display_name || suggestion.investor.business_name || suggestion.investor.name || '-'
    };
  };

  // Get borrower details for display
  const getBorrowerDetails = () => {
    if (!suggestion.borrower) return null;
    return {
      name: suggestion.borrower.name || '-',
      businessName: suggestion.borrower.business_name || '-'
    };
  };

  const investorDetails = getInvestorDetails();
  const borrowerDetails = getBorrowerDetails();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isCreateMode ? (
              <Plus className="w-5 h-5 text-amber-600" />
            ) : (
              <TypeIcon className={`w-5 h-5 ${typeInfo.color}`} />
            )}
            {isCreateMode ? 'Review Create Suggestion' : 'Review Existing Match'}
          </DialogTitle>
          <DialogDescription>
            {getMatchModeDescription()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Bank Entry/Entries */}
          <div className="p-4 border rounded-lg bg-slate-50">
            <p className="text-xs text-slate-500 mb-2">
              {isGroupedMatch && suggestion.groupedEntries?.length > 1
                ? `Bank Entries (${suggestion.groupedEntries.length})`
                : 'Bank Entry'}
            </p>

            {/* For grouped matches, show all bank entries */}
            {isGroupedMatch && suggestion.groupedEntries?.length > 1 ? (
              <>
                <div className="space-y-2 mb-3">
                  {suggestion.groupedEntries.map((e) => (
                    <div key={e.id} className="flex items-center justify-between text-sm p-2 bg-white rounded border">
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-700 truncate" title={e.description}>
                          {e.description}
                        </p>
                        <p className="text-xs text-slate-500">
                          {e.statement_date ? format(parseISO(e.statement_date), 'dd MMM yyyy') : '-'}
                        </p>
                      </div>
                      <span className={`font-mono font-bold ml-2 ${
                        e.amount > 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {e.amount > 0 ? '+' : ''}{formatCurrency(e.amount)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-600">Total</span>
                  <span className={`font-mono text-lg font-bold ${
                    bankAmount > 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    {isCredit ? '+' : ''}{formatCurrency(bankAmount)}
                  </span>
                </div>
              </>
            ) : (
              /* Single bank entry */
              <>
                <div className="flex items-center justify-between mb-2">
                  <span className={`font-mono text-xl font-bold ${
                    isCredit ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    {isCredit ? '+' : ''}{formatCurrency(entry.amount)}
                  </span>
                  <div className="flex items-center gap-1 text-sm text-slate-600">
                    <Calendar className="w-4 h-4" />
                    {entry.statement_date
                      ? format(parseISO(entry.statement_date), 'dd MMM yyyy')
                      : '-'}
                  </div>
                </div>
                <p className="text-sm text-slate-700">{entry.description}</p>
                {entry.external_reference && (
                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                    <Hash className="w-3 h-3" />
                    {entry.external_reference}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Arrow */}
          <div className="flex justify-center">
            <ArrowRight className="w-6 h-6 text-slate-400" />
          </div>

          {/* Suggested Match */}
          <div className={`p-4 border rounded-lg ${isCreateMode ? 'border-amber-200 bg-amber-50/30' : ''}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Badge className={typeInfo.color + ' bg-opacity-10'}>
                  {typeInfo.label}
                </Badge>
                {isCreateMode && (
                  <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-300">
                    Create New
                  </Badge>
                )}
              </div>
              <Badge variant="outline" className={getConfidenceColor(confidence)}>
                {confidencePct}% confidence
              </Badge>
            </div>

            <p className="font-medium text-lg">{getMatchedEntityName()}</p>
            <p className="text-sm text-slate-600 mt-1">{suggestion.reason}</p>

            {/* Warning for "create" mode - no existing transaction */}
            {isCreateMode && (
              <Alert className="mt-3 border-amber-200 bg-amber-50">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-amber-800 text-sm">
                  No matching transaction found in the system. Accepting will create a new {typeInfo.label.toLowerCase()}.
                </AlertDescription>
              </Alert>
            )}

            {/* Loan details - only show for create mode since Match Summary handles it for matches */}
            {suggestion.loan && isCreateMode && (
              <div className="mt-3 p-2 bg-slate-50 rounded text-sm">
                <p><span className="text-slate-500">Loan:</span> {suggestion.loan.loan_number}</p>
                {suggestion.loan.original_amount && (
                  <p><span className="text-slate-500">Loan Amount:</span> {formatCurrency(suggestion.loan.original_amount)}</p>
                )}
              </div>
            )}

            {/* Existing transaction details - single match */}
            {suggestion.existingTransaction && !isGroupedMatch && (
              <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded text-sm">
                <p className="font-medium text-emerald-800 mb-1">Existing Transaction</p>
                <div className="grid grid-cols-2 gap-2 text-slate-700">
                  <p><span className="text-slate-500">Amount:</span> {formatCurrency(suggestion.existingTransaction.amount)}</p>
                  <p><span className="text-slate-500">Date:</span> {suggestion.existingTransaction.date
                    ? format(parseISO(suggestion.existingTransaction.date), 'dd MMM yyyy')
                    : '-'}
                  </p>
                  {suggestion.existingTransaction.type && (
                    <p><span className="text-slate-500">Type:</span> {suggestion.existingTransaction.type}</p>
                  )}
                  {suggestion.existingTransaction.reference && (
                    <p className="col-span-2"><span className="text-slate-500">Ref:</span> {suggestion.existingTransaction.reference}</p>
                  )}
                </div>
              </div>
            )}

            {/* Existing expense details */}
            {suggestion.existingExpense && (
              <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded text-sm">
                <p className="font-medium text-emerald-800 mb-1">Existing Expense</p>
                <div className="grid grid-cols-2 gap-2 text-slate-700">
                  <p><span className="text-slate-500">Amount:</span> {formatCurrency(suggestion.existingExpense.amount)}</p>
                  <p><span className="text-slate-500">Date:</span> {suggestion.existingExpense.date
                    ? format(parseISO(suggestion.existingExpense.date), 'dd MMM yyyy')
                    : '-'}
                  </p>
                  {suggestion.existingExpense.type_name && (
                    <p className="col-span-2"><span className="text-slate-500">Type:</span> {suggestion.existingExpense.type_name}</p>
                  )}
                </div>
              </div>
            )}

            {/* Existing interest entry details */}
            {suggestion.existingInterest && (
              <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded text-sm">
                <p className="font-medium text-emerald-800 mb-1">Existing Interest Entry</p>
                <div className="grid grid-cols-2 gap-2 text-slate-700">
                  <p><span className="text-slate-500">Amount:</span> {formatCurrency(suggestion.existingInterest.amount)}</p>
                  <p><span className="text-slate-500">Date:</span> {suggestion.existingInterest.date
                    ? format(parseISO(suggestion.existingInterest.date), 'dd MMM yyyy')
                    : '-'}
                  </p>
                </div>
              </div>
            )}

            {/* Target transaction for grouped matches */}
            {isGroupedMatch && suggestion.existingTransaction && (
              <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded text-sm">
                <p className="font-medium text-emerald-800 mb-1">Target Transaction</p>
                <div className="grid grid-cols-2 gap-2 text-slate-700">
                  <p><span className="text-slate-500">Amount:</span> {formatCurrency(suggestion.existingTransaction.amount)}</p>
                  <p><span className="text-slate-500">Date:</span> {suggestion.existingTransaction.date
                    ? format(parseISO(suggestion.existingTransaction.date), 'dd MMM yyyy')
                    : '-'}
                  </p>
                  {suggestion.existingTransaction.type && (
                    <p><span className="text-slate-500">Type:</span> {suggestion.existingTransaction.type}</p>
                  )}
                  {suggestion.existingTransaction.reference && (
                    <p className="col-span-2"><span className="text-slate-500">Ref:</span> {suggestion.existingTransaction.reference}</p>
                  )}
                </div>
              </div>
            )}

            {/* Multiple transactions (match_group) */}
            {suggestion.existingTransactions && (
              <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded text-sm">
                <p className="font-medium text-emerald-800 mb-2">
                  {suggestion.existingTransactions.length} Existing Transactions
                </p>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {suggestion.existingTransactions.map((tx, i) => (
                    <div key={tx.id || i} className="flex justify-between text-xs">
                      <span>{tx.date ? format(parseISO(tx.date), 'dd MMM') : '-'}</span>
                      <span>{formatCurrency(tx.amount)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 pt-2 border-t border-emerald-200 font-medium">
                  Total: {formatCurrency(suggestion.existingTransactions.reduce((sum, tx) =>
                    sum + (parseFloat(tx.amount) || 0), 0
                  ))}
                </div>
              </div>
            )}

            {/* Match Summary - shows all comparison factors */}
            {!isCreateMode && hasExistingTransaction && (
              <div className="mt-4 border rounded-lg overflow-hidden">
                <div className="bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 border-b">
                  Match Summary
                </div>
                <div className="divide-y">
                  {/* Entity Row - Investor or Borrower */}
                  {(investorDetails || borrowerDetails) && (
                    <div className="px-3 py-2 flex items-center justify-between text-sm">
                      <span className="text-slate-500">
                        {investorDetails ? 'Investor' : 'Borrower'}
                      </span>
                      <div className="text-right">
                        <p className="font-medium text-slate-800">
                          {investorDetails?.businessName || borrowerDetails?.businessName}
                        </p>
                        {investorDetails?.name && investorDetails.name !== investorDetails.businessName && (
                          <p className="text-xs text-slate-500">{investorDetails.name}</p>
                        )}
                        {borrowerDetails?.name && borrowerDetails.name !== borrowerDetails.businessName && (
                          <p className="text-xs text-slate-500">{borrowerDetails.name}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Date Row */}
                  <div className="px-3 py-2 flex items-center justify-between text-sm">
                    <span className="text-slate-500">Date</span>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-slate-700">
                          Bank: {bankDate ? format(bankDate, 'dd MMM yyyy') : '-'}
                        </p>
                        <p className="text-slate-700">
                          Transaction: {txDate ? format(txDate, 'dd MMM yyyy') : '-'}
                        </p>
                      </div>
                      <div className={`flex items-center gap-1 ${dateStatus.color}`}>
                        {dateStatus.status === 'exact' || dateStatus.status === 'close' ? (
                          <Check className="w-4 h-4" />
                        ) : dateStatus.status === 'far' ? (
                          <AlertTriangle className="w-4 h-4" />
                        ) : (
                          <AlertCircle className="w-4 h-4" />
                        )}
                        <span className="text-xs font-medium">{dateStatus.label}</span>
                      </div>
                    </div>
                  </div>

                  {/* Amount Row */}
                  <div className={`px-3 py-2 flex items-center justify-between text-sm ${
                    amountsMatch ? 'bg-emerald-50' : 'bg-red-50'
                  }`}>
                    <span className="text-slate-500">Amount</span>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-slate-700">Bank: {formatCurrency(bankAmount)}</p>
                        <p className="text-slate-700">Transaction: {formatCurrency(transactionAmount)}</p>
                      </div>
                      <div className={`flex items-center gap-1 ${amountsMatch ? 'text-emerald-600' : 'text-red-600'}`}>
                        {amountsMatch ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <X className="w-4 h-4" />
                        )}
                        <span className="text-xs font-medium">
                          {amountsMatch ? 'Match' : `Diff: ${formatCurrency(Math.abs(bankAmount - transactionAmount))}`}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Loan Reference (if applicable) */}
                  {suggestion.loan && (
                    <div className="px-3 py-2 flex items-center justify-between text-sm">
                      <span className="text-slate-500">Loan</span>
                      <div className="text-right">
                        <p className="font-medium text-slate-800">{suggestion.loan.loan_number}</p>
                        {suggestion.loan.original_amount && (
                          <p className="text-xs text-slate-500">
                            Principal: {formatCurrency(suggestion.loan.original_amount)}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Warning if amounts don't match */}
                {!amountsMatch && (
                  <div className="px-3 py-2 bg-red-100 border-t border-red-200 text-red-800 text-xs">
                    <AlertTriangle className="w-3 h-3 inline mr-1" />
                    Cannot accept match - amounts must balance exactly
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Warning for low confidence */}
          {confidencePct < 70 && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-800 text-sm">
                This match has {confidencePct}% confidence. Please verify before accepting.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <Separator />

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              onDismiss?.(entry.id);
              onClose();
            }}
            disabled={isProcessing}
          >
            <X className="w-4 h-4 mr-2" />
            Dismiss
          </Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => onAccept?.(entry.id)}
            disabled={isProcessing || (!isCreateMode && hasExistingTransaction && !amountsMatch)}
            title={(!isCreateMode && hasExistingTransaction && !amountsMatch) ? 'Cannot accept: amounts do not match' : ''}
          >
            <Check className="w-4 h-4 mr-2" />
            {isProcessing ? 'Processing...' : 'Accept Match'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
