/**
 * GroupedEntryCard - Display multiple bank entries that match to a single transaction
 *
 * Used for grouped_investor and grouped_disbursement match modes where
 * multiple bank entries sum to a single transaction.
 */

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format, parseISO } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import {
  Check,
  X,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Users,
  Building2,
  FileText
} from 'lucide-react';
import { useState } from 'react';

// Confidence color
const getConfidenceColor = (confidence) => {
  const pct = confidence * 100;
  if (pct >= 90) return 'bg-emerald-100 text-emerald-700 border-emerald-300';
  if (pct >= 70) return 'bg-amber-100 text-amber-700 border-amber-300';
  return 'bg-orange-100 text-orange-700 border-orange-300';
};

// Match type icon
const getMatchTypeIcon = (type) => {
  if (type === 'investor_credit' || type === 'investor_withdrawal') {
    return <Building2 className="w-3.5 h-3.5" />;
  }
  return <FileText className="w-3.5 h-3.5" />;
};

export default function GroupedEntryCard({
  entries,
  suggestion,
  onAccept,
  onDismiss,
  onViewDetails
}) {
  const [expanded, setExpanded] = useState(false);

  if (!entries?.length || !suggestion) return null;

  const primaryEntry = entries[0];
  const totalAmount = entries.reduce((sum, e) => sum + e.amount, 0);
  const isCredit = totalAmount > 0;
  const confidence = suggestion.confidence || 0;
  const confidencePct = Math.round(confidence * 100);

  // Get target description
  const getTargetDescription = () => {
    if (suggestion.investor) {
      return suggestion.investor.business_name || suggestion.investor.name || 'Unknown Investor';
    }
    if (suggestion.borrower) {
      return suggestion.borrower.business_name || suggestion.borrower.name || 'Unknown Borrower';
    }
    if (suggestion.loan) {
      return `Loan ${suggestion.loan.loan_number}`;
    }
    return 'Unknown';
  };

  // Get transaction amount
  const getTransactionAmount = () => {
    if (suggestion.existingTransaction) {
      return Math.abs(suggestion.existingTransaction.amount);
    }
    return Math.abs(totalAmount);
  };

  // Handle row click - open details dialog
  const handleRowClick = (e) => {
    // Don't trigger if clicking on interactive elements
    if (e.target.closest('button')) {
      return;
    }
    onViewDetails?.(primaryEntry);
  };

  return (
    <Card className="transition-all hover:shadow-sm hover:bg-blue-50/50 cursor-pointer border-blue-200 bg-blue-50/30">
      <CardContent className="py-2 px-3" onClick={handleRowClick}>
        {/* Main row - summary */}
        <div className="flex items-center gap-2">
          {/* Group indicator with expand toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 shrink-0"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-blue-600" />
            ) : (
              <ChevronDown className="w-4 h-4 text-blue-600" />
            )}
          </Button>

          {/* Group icon and count */}
          <div className="flex items-center gap-1 text-blue-600 shrink-0" title={`${entries.length} bank entries grouped`}>
            <Users className="w-4 h-4" />
            <span className="text-xs font-medium">{entries.length}</span>
          </div>

          {/* Total amount */}
          <div className="w-24 shrink-0">
            <span className={`font-mono font-bold text-sm ${
              isCredit ? 'text-emerald-600' : 'text-red-600'
            }`}>
              {isCredit ? '+' : ''}{formatCurrency(totalAmount)}
            </span>
          </div>

          {/* Date range */}
          <div className="w-20 shrink-0 text-xs text-slate-500">
            {format(parseISO(primaryEntry.statement_date), 'dd MMM')}
            {entries.length > 1 && entries[entries.length - 1].statement_date !== primaryEntry.statement_date && (
              <span> - {format(parseISO(entries[entries.length - 1].statement_date), 'dd MMM')}</span>
            )}
          </div>

          {/* Arrow to target */}
          <div className="text-slate-400 shrink-0">→</div>

          {/* Target info - flexible */}
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-1 text-slate-500 shrink-0">
              {getMatchTypeIcon(suggestion.type)}
              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-blue-100 text-blue-700 border-blue-300">
                Group
              </Badge>
            </div>

            <span className="text-sm text-slate-700 truncate" title={getTargetDescription()}>
              {getTargetDescription()}
            </span>

            <span className="text-xs text-slate-500 shrink-0">
              ({formatCurrency(getTransactionAmount())})
            </span>
          </div>

          {/* Confidence badge */}
          <Badge variant="outline" className={`${getConfidenceColor(confidence)} text-[10px] h-5 font-medium shrink-0`}>
            {confidencePct}%
          </Badge>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700"
              onClick={() => onAccept?.(primaryEntry.id)}
            >
              <Check className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-slate-500 hover:text-slate-700"
              onClick={() => onDismiss?.(primaryEntry.id)}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-slate-500 hover:text-slate-700"
              onClick={() => onViewDetails?.(primaryEntry)}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Expanded detail - shows individual entries */}
        {expanded && (
          <div className="mt-2 pt-2 border-t border-blue-200 space-y-1">
            <div className="text-xs text-slate-500 mb-1 pl-8">Individual bank entries:</div>
            {entries.map((entry, idx) => (
              <div key={entry.id} className="flex items-center gap-2 pl-8 text-sm">
                <span className="text-slate-400 w-4">{idx + 1}.</span>
                <span className={`font-mono w-20 ${entry.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {formatCurrency(entry.amount)}
                </span>
                <span className="text-slate-500 w-16">
                  {format(parseISO(entry.statement_date), 'dd MMM')}
                </span>
                <span className="text-slate-600 truncate flex-1" title={entry.description}>
                  {entry.description}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
