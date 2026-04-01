/**
 * BankEntryRow - Displays a single bank entry with suggestions and create forms
 *
 * Shows:
 * - Entry header (date, amount, description)
 * - Suggestions section with Accept buttons
 * - Create New section with expandable forms
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Check,
  Target,
  Plus,
  Receipt,
  TrendingUp,
  Coins,
  Banknote,
  FileText,
  ArrowLeftRight,
  Loader2
} from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { reconcileSingleMatch, reconcileMatchGroup, reconcileGroupedDisbursement } from '@/lib/reconciliation/reconcileHandler';
import InlineReceiptFormFull from './InlineReceiptFormFull';
import InlineInvestorDepositForm from './InlineInvestorDepositForm';
import InlineOtherIncomeForm from './InlineOtherIncomeForm';
import InlineDisbursementForm from './InlineDisbursementForm';
import InlineWithdrawalForm from './InlineWithdrawalForm';
import InlineExpenseForm from './InlineExpenseForm';
import InlineOffsetForm from './InlineOffsetForm';

export default function BankEntryRow({
  entry,
  suggestions,
  expenseTypeSuggestion,
  type, // 'receipt' or 'expenditure'
  loans,
  borrowers,
  investors,
  expenseTypes,
  patterns = [],
  oppositeEntries = [],
  onReconciled
}) {
  const [expanded, setExpanded] = useState(false);
  const [expandedForm, setExpandedForm] = useState(null);
  const [isAccepting, setIsAccepting] = useState(null);

  const isCredit = entry.amount > 0;
  const absAmount = Math.abs(entry.amount);

  // Accept a suggestion (match to existing transaction)
  const handleAcceptSuggestion = async (suggestion) => {
    if (suggestion.matchMode !== 'match' && suggestion.matchMode !== 'match_group' && suggestion.matchMode !== 'grouped_disbursement') {
      // For 'create' mode suggestions, expand the form
      setExpandedForm(suggestion.type);
      setExpanded(true);
      return;
    }

    setIsAccepting(suggestion);
    try {
      if (suggestion.matchMode === 'grouped_disbursement') {
        // Handle grouped disbursement (multiple bank debits → single disbursement)
        await reconcileGroupedDisbursement({ suggestion });
        const entryCount = suggestion.groupedEntries?.length || 0;
        toast.success(`Reconciled ${entryCount} bank entries to disbursement`);
      } else if (suggestion.matchMode === 'match_group') {
        // Handle grouped match (one bank entry → multiple transactions)
        await reconcileMatchGroup({
          bankEntry: entry,
          suggestion
        });
        const txCount = suggestion.existingTransactions?.length || 0;
        toast.success(`Reconciled to ${txCount} transactions`);
      } else {
        // Handle single match
        await reconcileSingleMatch({
          bankEntry: entry,
          suggestion
        });
        toast.success('Entry reconciled successfully');
      }
      onReconciled?.();
    } catch (error) {
      console.error('Reconciliation error:', error);
      toast.error(`Failed to reconcile: ${error.message}`);
    } finally {
      setIsAccepting(null);
    }
  };

  // Handle form close
  const handleFormClose = () => {
    setExpandedForm(null);
  };

  // Handle successful reconciliation from inline form
  const handleFormSuccess = () => {
    setExpandedForm(null);
    onReconciled?.();
  };

  // Get confidence badge color
  const getConfidenceBadge = (confidence) => {
    if (confidence >= 0.9) return 'bg-green-100 text-green-700';
    if (confidence >= 0.7) return 'bg-amber-100 text-amber-700';
    return 'bg-slate-100 text-slate-600';
  };

  // Top suggestions (max 3)
  const topSuggestions = suggestions.slice(0, 3);
  const hasMoreSuggestions = suggestions.length > 3;
  const bestSuggestion = topSuggestions[0] || null;

  // Only expand on row click if there are suggestions
  const handleRowClick = () => {
    if (topSuggestions.length > 0) {
      setExpanded(!expanded);
    }
  };

  // Determine if there's content to show in expanded section
  const hasExpandedContent = topSuggestions.length > 0 || expandedForm !== null;

  return (
    <div className="overflow-hidden border-b last:border-b-0">
      {/* Entry Row - Compact Single Line */}
      <div
        className={`px-4 py-2 hover:bg-slate-50 transition-colors border-l-4 ${
          isCredit ? 'border-l-green-500' : 'border-l-red-500'
        } ${topSuggestions.length > 0 ? 'cursor-pointer' : ''}`}
        onClick={handleRowClick}
      >
        <div className="flex items-center gap-4">
          {/* Date */}
          <div className="text-sm text-slate-500 w-24 shrink-0">
            {format(new Date(entry.statement_date), 'dd MMM yyyy')}
          </div>
          {/* Amount */}
          <div className={`font-semibold w-28 shrink-0 text-right ${isCredit ? 'text-green-600' : 'text-red-600'}`}>
            {isCredit ? '+' : '-'}{formatCurrency(absAmount)}
          </div>
          {/* Description */}
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-700 truncate">
              {entry.description || 'No description'}
            </div>
            {entry.external_reference && (
              <div className="text-xs text-slate-400 truncate">
                Ref: {entry.external_reference}
              </div>
            )}
          </div>
          {/* Best match suggestion - separate column */}
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {bestSuggestion ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-2 py-1 bg-blue-50 rounded border border-blue-200">
                  <Target className="w-3 h-3 text-blue-500 shrink-0" />
                  <span className="text-sm text-blue-700">
                    {bestSuggestion.label}
                  </span>
                  <Badge variant="secondary" className={`${getConfidenceBadge(bestSuggestion.confidence)} text-xs px-1.5 py-0 shrink-0`}>
                    {Math.round(bestSuggestion.confidence * 100)}%
                  </Badge>
                  {bestSuggestion.matchReasons && bestSuggestion.matchReasons.length > 0 && (
                    <span className="text-sm text-emerald-600">
                      {bestSuggestion.matchReasons.join(' • ')}
                    </span>
                  )}
                  <Button
                    size="sm"
                    className="h-6 px-2 text-xs shrink-0"
                    onClick={() => handleAcceptSuggestion(bestSuggestion)}
                    disabled={isAccepting === bestSuggestion}
                  >
                    {isAccepting === bestSuggestion ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : bestSuggestion.matchMode === 'match' ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <Plus className="w-3 h-3" />
                    )}
                  </Button>
                </div>
                {suggestions.length > 1 && (
                  <span className="text-xs text-slate-400 shrink-0">+{suggestions.length - 1}</span>
                )}
              </div>
            ) : (
              <span className="text-xs text-slate-400 italic">No matches</span>
            )}
          </div>
          {/* Create New Icons */}
          <div className="flex items-center gap-1 shrink-0 w-32 justify-center" onClick={(e) => e.stopPropagation()}>
            {type === 'receipt' ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={expandedForm === 'loan_repayment' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setExpandedForm(expandedForm === 'loan_repayment' ? null : 'loan_repayment');
                        if (expandedForm !== 'loan_repayment') setExpanded(true);
                      }}
                    >
                      <Receipt className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Loan Repayment</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={expandedForm === 'investor_deposit' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setExpandedForm(expandedForm === 'investor_deposit' ? null : 'investor_deposit');
                        if (expandedForm !== 'investor_deposit') setExpanded(true);
                      }}
                    >
                      <TrendingUp className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Investor Deposit</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={expandedForm === 'other_income' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setExpandedForm(expandedForm === 'other_income' ? null : 'other_income');
                        if (expandedForm !== 'other_income') setExpanded(true);
                      }}
                    >
                      <Coins className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Other Income</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={expandedForm === 'offset' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setExpandedForm(expandedForm === 'offset' ? null : 'offset');
                        if (expandedForm !== 'offset') setExpanded(true);
                      }}
                    >
                      <ArrowLeftRight className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Funds Returned / Offset</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={expandedForm === 'loan_disbursement' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setExpandedForm(expandedForm === 'loan_disbursement' ? null : 'loan_disbursement');
                        if (expandedForm !== 'loan_disbursement') setExpanded(true);
                      }}
                    >
                      <FileText className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Loan Disbursement</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={expandedForm === 'investor_withdrawal' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setExpandedForm(expandedForm === 'investor_withdrawal' ? null : 'investor_withdrawal');
                        if (expandedForm !== 'investor_withdrawal') setExpanded(true);
                      }}
                    >
                      <TrendingUp className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Investor Withdrawal</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={expandedForm === 'expense' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setExpandedForm(expandedForm === 'expense' ? null : 'expense');
                        if (expandedForm !== 'expense') setExpanded(true);
                      }}
                    >
                      <Banknote className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Expense</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={expandedForm === 'offset' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setExpandedForm(expandedForm === 'offset' ? null : 'offset');
                        if (expandedForm !== 'offset') setExpanded(true);
                      }}
                    >
                      <ArrowLeftRight className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Funds Returned / Offset</TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Expanded Content - only render if there's content */}
      {hasExpandedContent && (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleContent>
            <div className={`ml-6 mr-4 mb-3 mt-1 p-3 bg-slate-200/80 rounded-lg border-l-4 ${isCredit ? 'border-l-green-400' : 'border-l-red-400'} space-y-3`}>
            {/* Suggestions Section */}
            {topSuggestions.length > 0 && (
              <div>
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                  Suggested Matches
                </div>
                <div className="space-y-2">
                  {topSuggestions.map((suggestion, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 bg-white rounded-lg shadow-sm"
                    >
                      <div className="flex items-center gap-3">
                        <Target className="w-4 h-4 text-slate-400" />
                        <div>
                          <div className="text-sm font-medium">{suggestion.label}</div>
                          {suggestion.existingTransaction && (
                            <div className="text-xs text-slate-500">
                              {formatCurrency(Math.abs(suggestion.existingTransaction.amount))} on{' '}
                              {format(new Date(suggestion.existingTransaction.date), 'dd MMM yyyy')}
                            </div>
                          )}
                          {suggestion.matchMode === 'grouped_disbursement' && suggestion.groupedEntries && (
                            <div className="text-xs text-slate-500 mt-1.5">
                              <div className="font-medium text-slate-600 mb-1">Payments in this split:</div>
                              <div className="ml-2 space-y-0.5">
                                {suggestion.groupedEntries.map((e, eIdx) => (
                                  <div key={eIdx} className={`flex items-center gap-2 ${e.id === entry.id ? 'font-medium text-blue-700' : ''}`}>
                                    <span className="text-slate-300">•</span>
                                    <span>{format(new Date(e.statement_date), 'dd MMM yyyy')}</span>
                                    <span>{formatCurrency(Math.abs(e.amount))}</span>
                                    <span className={`truncate max-w-[200px] ${e.id === entry.id ? '' : 'text-slate-400'}`}>{e.description}</span>
                                    {e.id === entry.id && <span className="text-blue-500 shrink-0">(this entry)</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {suggestion.existingTransactions && suggestion.existingTransactions.length > 0 && (
                            <div className="text-xs text-slate-500 space-y-1">
                              <div className="font-medium">
                                {suggestion.existingTransactions.length} transactions totalling{' '}
                                {formatCurrency(suggestion.existingTransactions.reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount) || 0), 0))}
                              </div>
                              <div className="ml-2 space-y-0.5">
                                {suggestion.existingTransactions.map((tx, txIdx) => {
                                  const loan = loans.find(l => l.id === tx.loan_id);
                                  const borrower = borrowers.find(b => b.id === loan?.borrower_id) ||
                                                   borrowers.find(b => b.id === tx.borrower_id);
                                  const borrowerName = borrower?.name || borrower?.business_name || loan?.borrower_name || 'Unknown';
                                  const loanNum = loan?.loan_number || '?';
                                  return (
                                    <div key={txIdx} className="flex items-center gap-2">
                                      <span className="text-slate-400">•</span>
                                      <span>{loanNum}</span>
                                      <span className="text-slate-400">-</span>
                                      <span>{borrowerName}</span>
                                      <span className="text-slate-400">:</span>
                                      <span className="font-medium">{formatCurrency(Math.abs(parseFloat(tx.amount) || 0))}</span>
                                      <span className="text-slate-400">({format(new Date(tx.date), 'dd MMM')})</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {suggestion.existingExpense && (
                            <div className="text-xs text-slate-500">
                              {formatCurrency(Math.abs(suggestion.existingExpense.amount))} on{' '}
                              {format(new Date(suggestion.existingExpense.date), 'dd MMM yyyy')}
                            </div>
                          )}
                          {suggestion.existingInterest && (
                            <div className="text-xs text-slate-500">
                              {formatCurrency(Math.abs(suggestion.existingInterest.amount))} on{' '}
                              {format(new Date(suggestion.existingInterest.date), 'dd MMM yyyy')}
                              {suggestion.existingInterest.description && (
                                <span className="ml-1 text-slate-400">- {suggestion.existingInterest.description}</span>
                              )}
                            </div>
                          )}
                          {suggestion.matchReasons && suggestion.matchReasons.length > 0 && (
                            <div className="text-xs text-emerald-600 mt-1">
                              {suggestion.matchReasons.join(' • ')}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={getConfidenceBadge(suggestion.confidence)}>
                          {Math.round(suggestion.confidence * 100)}%
                        </Badge>
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAcceptSuggestion(suggestion);
                          }}
                          disabled={isAccepting === suggestion}
                        >
                          {isAccepting === suggestion ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (suggestion.matchMode === 'match' || suggestion.matchMode === 'match_group' || suggestion.matchMode === 'grouped_disbursement') ? (
                            <>
                              <Check className="w-4 h-4 mr-1" />
                              Accept
                            </>
                          ) : (
                            <>
                              <Plus className="w-4 h-4 mr-1" />
                              Create
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                  {hasMoreSuggestions && (
                    <div className="text-xs text-slate-500 text-center py-1">
                      +{suggestions.length - 3} more suggestions
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Inline Forms */}
            {expandedForm === 'loan_repayment' && (
              <InlineReceiptFormFull
                bankEntry={entry}
                loans={loans}
                borrowers={borrowers}
                onSuccess={handleFormSuccess}
                onCancel={handleFormClose}
              />
            )}

            {expandedForm === 'investor_deposit' && (
              <InlineInvestorDepositForm
                bankEntry={entry}
                investors={investors}
                onSuccess={handleFormSuccess}
                onCancel={handleFormClose}
              />
            )}

            {expandedForm === 'other_income' && (
              <InlineOtherIncomeForm
                bankEntry={entry}
                onSuccess={handleFormSuccess}
                onCancel={handleFormClose}
              />
            )}

            {expandedForm === 'loan_disbursement' && (
              <InlineDisbursementForm
                bankEntry={entry}
                loans={loans}
                borrowers={borrowers}
                onSuccess={handleFormSuccess}
                onCancel={handleFormClose}
              />
            )}

            {expandedForm === 'investor_withdrawal' && (
              <InlineWithdrawalForm
                bankEntry={entry}
                investors={investors}
                onSuccess={handleFormSuccess}
                onCancel={handleFormClose}
              />
            )}

            {expandedForm === 'expense' && (
              <InlineExpenseForm
                bankEntry={entry}
                expenseTypes={expenseTypes}
                expenseTypeSuggestion={expenseTypeSuggestion}
                patterns={patterns}
                loans={loans}
                onSuccess={handleFormSuccess}
                onCancel={handleFormClose}
              />
            )}

            {expandedForm === 'offset' && (
              <InlineOffsetForm
                bankEntry={entry}
                oppositeEntries={oppositeEntries}
                onSuccess={handleFormSuccess}
                onCancel={handleFormClose}
              />
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
      )}
    </div>
  );
}
