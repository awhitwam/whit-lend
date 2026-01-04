import { Draggable } from '@hello-pangea/dnd';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { Check, ChevronDown, ChevronRight, AlertCircle, HelpCircle } from 'lucide-react';

// Confidence level colors
const getConfidenceBadge = (confidence) => {
  if (confidence >= 90) {
    return { className: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'High' };
  }
  if (confidence >= 70) {
    return { className: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Medium' };
  }
  if (confidence > 0) {
    return { className: 'bg-red-100 text-red-700 border-red-200', label: 'Low' };
  }
  return { className: 'bg-slate-100 text-slate-500 border-slate-200', label: '?' };
};

export default function BankEntryCard({
  entry,
  index,
  potId,
  isExpanded,
  onClick,
  loans,
  investors,
  expenseTypes,
  onReconcile,
  onConfirmMatch
}) {
  const isCredit = entry.amount > 0;
  const match = entry.match;
  const confidence = match?.confidence || 0;
  const confidenceBadge = getConfidenceBadge(confidence);
  const isConfirmed = entry.matchConfirmed;

  // Get display name for the match
  const getMatchDisplay = () => {
    if (!match) return null;

    switch (potId) {
      case 'loans':
        if (match.loan) {
          return {
            primary: match.loan.borrower_name,
            secondary: match.loan.loan_number
          };
        }
        break;
      case 'investors':
        if (match.investor) {
          return {
            primary: match.investor.name || match.investor.business_name,
            secondary: match.transactionType === 'capital_in' ? 'Capital In' :
                       match.transactionType === 'capital_out' ? 'Capital Out' : 'Interest'
          };
        }
        break;
      case 'expenses':
        if (match.expenseType) {
          return {
            primary: match.expenseType.name,
            secondary: match.loan ? `Linked to ${match.loan.loan_number}` : 'Platform expense'
          };
        }
        break;
    }
    return null;
  };

  const matchDisplay = getMatchDisplay();

  return (
    <Draggable draggableId={entry.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
        >
          <Card
            className={`cursor-pointer transition-all ${
              snapshot.isDragging ? 'shadow-lg rotate-2' : 'hover:shadow-md'
            } ${isExpanded ? 'ring-2 ring-blue-400' : ''} ${
              isConfirmed ? 'border-emerald-300 bg-emerald-50/30' : ''
            }`}
            onClick={onClick}
          >
            <CardContent className="p-3 space-y-2">
              {/* Header: Amount + Date */}
              <div className="flex items-center justify-between">
                <span className={`font-mono font-bold text-lg ${
                  isCredit ? 'text-emerald-600' : 'text-red-600'
                }`}>
                  {isCredit ? '+' : ''}{formatCurrency(entry.amount)}
                </span>
                <span className="text-xs text-slate-500">
                  {entry.statement_date
                    ? format(new Date(entry.statement_date), 'dd MMM')
                    : '-'}
                </span>
              </div>

              {/* Description */}
              <p className="text-sm text-slate-700 truncate" title={entry.description}>
                {entry.description || entry.counterparty || '-'}
              </p>

              {/* Match info / Confidence */}
              <div className="flex items-center justify-between gap-2">
                {matchDisplay ? (
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-800 truncate">
                      {matchDisplay.primary}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {matchDisplay.secondary}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-slate-400">
                    <HelpCircle className="w-3 h-3" />
                    <span>No match</span>
                  </div>
                )}

                <div className="flex items-center gap-1">
                  {isConfirmed ? (
                    <Badge className="bg-emerald-500 text-white">
                      <Check className="w-3 h-3 mr-1" />
                      Ready
                    </Badge>
                  ) : confidence > 0 ? (
                    <Badge variant="outline" className={confidenceBadge.className}>
                      {confidence}%
                    </Badge>
                  ) : potId === 'unclassified' ? (
                    <Badge variant="outline" className="bg-slate-100 text-slate-500">
                      <AlertCircle className="w-3 h-3 mr-1" />
                      Review
                    </Badge>
                  ) : null}

                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  )}
                </div>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div className="pt-3 mt-3 border-t space-y-3" onClick={(e) => e.stopPropagation()}>
                  {/* Reference */}
                  {entry.reference && (
                    <div className="text-xs">
                      <span className="text-slate-500">Ref: </span>
                      <span className="text-slate-700">{entry.reference}</span>
                    </div>
                  )}

                  {/* Match details */}
                  {match && matchDisplay && (
                    <div className="p-2 bg-slate-50 rounded text-xs space-y-1">
                      <p className="font-medium">{matchDisplay.primary}</p>
                      <p className="text-slate-500">{matchDisplay.secondary}</p>
                      {match.reason && (
                        <p className="text-slate-400 italic">{match.reason}</p>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    {!isConfirmed && match && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-xs"
                        onClick={() => onConfirmMatch?.(entry.id)}
                      >
                        <Check className="w-3 h-3 mr-1" />
                        Confirm Match
                      </Button>
                    )}
                    {isConfirmed && (
                      <Button
                        size="sm"
                        className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => onReconcile?.(entry)}
                      >
                        Reconcile
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </Draggable>
  );
}
