/**
 * EntryCard - Compact horizontal layout for bank statement entries
 */

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { format, parseISO } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import {
  Check,
  X,
  ChevronRight,
  Undo2,
  Users,
  Building2,
  Receipt,
  FileText
} from 'lucide-react';

// Match type icons
const getMatchTypeIcon = (type) => {
  switch (type) {
    case 'loan_repayment':
    case 'loan_disbursement':
      return <FileText className="w-3.5 h-3.5" />;
    case 'investor_credit':
    case 'investor_withdrawal':
    case 'interest_withdrawal':
      return <Building2 className="w-3.5 h-3.5" />;
    case 'expense':
      return <Receipt className="w-3.5 h-3.5" />;
    default:
      return null;
  }
};

// Match type short labels
const getMatchTypeLabel = (type) => {
  const labels = {
    loan_repayment: 'Repay',
    loan_disbursement: 'Disb',
    investor_credit: 'Inv In',
    investor_withdrawal: 'Inv Out',
    interest_withdrawal: 'Interest',
    expense: 'Expense'
  };
  return labels[type] || '';
};

// Confidence color
const getConfidenceColor = (confidence) => {
  const pct = confidence * 100;
  if (pct >= 90) return 'bg-emerald-100 text-emerald-700 border-emerald-300';
  if (pct >= 70) return 'bg-amber-100 text-amber-700 border-amber-300';
  return 'bg-orange-100 text-orange-700 border-orange-300';
};

export default function EntryCard({
  entry,
  suggestion,
  showCheckbox = false,
  isSelected = false,
  onToggleSelect,
  onAccept,
  onDismiss,
  onRestore,
  onCreateNew,
  onViewDetails,
  isDismissed = false,
  isReconciled = false
}) {
  const isCredit = entry.amount > 0;
  const confidence = suggestion?.confidence || 0;
  const confidencePct = Math.round(confidence * 100);
  const isGrouped = suggestion?.groupedEntries?.length > 1;
  const matchModeLabel = suggestion?.matchMode === 'create' ? 'Create' :
                         suggestion?.matchMode === 'match_group' ? 'Multi' :
                         (suggestion?.matchMode === 'grouped_disbursement' || suggestion?.matchMode === 'grouped_investor') ? 'Group' : '';

  // Handle row click - open details dialog
  const handleRowClick = (e) => {
    // Don't trigger if clicking on interactive elements
    if (e.target.closest('button') || e.target.closest('[role="checkbox"]')) {
      return;
    }
    if (suggestion && !isReconciled && !isDismissed) {
      onViewDetails?.(entry);
    } else if (!suggestion && !isReconciled) {
      onCreateNew?.(entry);
    }
  };

  return (
    <Card className={`transition-all ${
      isReconciled ? 'opacity-60 bg-slate-50' :
      isDismissed ? 'opacity-75 bg-amber-50/30' :
      isSelected ? 'ring-2 ring-blue-300 bg-blue-50/50' :
      'hover:shadow-sm hover:bg-slate-50/50 cursor-pointer'
    }`}>
      <CardContent className="py-2 px-3" onClick={handleRowClick}>
        <div className="flex items-center gap-2">
          {/* Checkbox */}
          {showCheckbox && !isReconciled && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect?.(entry.id)}
              className="shrink-0"
            />
          )}

          {/* Amount - fixed width */}
          <div className="w-24 shrink-0">
            <span className={`font-mono font-bold text-sm ${
              isCredit ? 'text-emerald-600' : 'text-red-600'
            }`}>
              {isCredit ? '+' : ''}{formatCurrency(entry.amount)}
            </span>
          </div>

          {/* Date - fixed width */}
          <div className="w-16 shrink-0 text-xs text-slate-500">
            {entry.statement_date
              ? format(parseISO(entry.statement_date), 'dd MMM')
              : '-'}
          </div>

          {/* Description - limited width */}
          <div className="w-64 shrink-0 min-w-0">
            <p className="text-sm text-slate-700 truncate" title={entry.description}>
              {entry.description || '-'}
            </p>
          </div>

          {/* Suggestion info - flexible, takes remaining space */}
          {suggestion && !isReconciled && (
            <div className="flex-1 flex items-center gap-2 min-w-0">
              {/* Type + Mode */}
              <div className="flex items-center gap-1 text-slate-500 shrink-0">
                {getMatchTypeIcon(suggestion.type)}
                <span className="text-xs">{getMatchTypeLabel(suggestion.type)}</span>
                {matchModeLabel && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                    {matchModeLabel}
                  </Badge>
                )}
              </div>

              {/* Grouped indicator */}
              {isGrouped && (
                <div className="flex items-center gap-0.5 text-blue-600 shrink-0" title={`${suggestion.groupedEntries.length} bank entries`}>
                  <Users className="w-3 h-3" />
                  <span className="text-[10px]">{suggestion.groupedEntries.length}</span>
                </div>
              )}

              {/* Reason - flexible width */}
              <span className="text-xs text-slate-600 truncate flex-1" title={suggestion.reason}>
                {suggestion.reason}
              </span>
            </div>
          )}

          {/* Spacer when no suggestion */}
          {(!suggestion || isReconciled) && <div className="flex-1" />}

          {/* Status badges */}
          <div className="shrink-0">
            {isDismissed && (
              <Badge variant="outline" className="bg-amber-100 text-amber-700 text-[10px] h-5">
                Dismissed
              </Badge>
            )}
            {isReconciled && (
              <Badge className="bg-emerald-500 text-white text-[10px] h-5">
                <Check className="w-3 h-3 mr-0.5" />
                Done
              </Badge>
            )}
            {!isReconciled && !isDismissed && suggestion && (
              <Badge variant="outline" className={`${getConfidenceColor(confidence)} text-[10px] h-5 font-medium`}>
                {confidencePct}%
              </Badge>
            )}
          </div>

          {/* Actions */}
          {!isReconciled && (
            <div className="flex items-center gap-1 shrink-0">
              {isDismissed ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => onRestore?.(entry.id)}
                >
                  <Undo2 className="w-3 h-3" />
                </Button>
              ) : suggestion ? (
                <>
                  <Button
                    size="sm"
                    className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => onAccept?.(entry.id)}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-slate-500 hover:text-slate-700"
                    onClick={() => onDismiss?.(entry.id)}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-slate-500 hover:text-slate-700"
                    onClick={() => onViewDetails?.(entry)}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => onCreateNew?.(entry)}
                >
                  Create
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
