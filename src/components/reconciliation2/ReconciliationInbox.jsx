import { useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import {
  ChevronDown,
  ChevronRight,
  Check,
  AlertCircle,
  GripVertical,
  ArrowRight
} from 'lucide-react';

// Section configuration
const SECTION_CONFIG = {
  unclassified: {
    id: 'unclassified',
    title: 'Needs Classification',
    icon: '📋',
    color: 'slate',
    bgColor: 'bg-slate-50',
    borderColor: 'border-slate-200',
    badgeColor: 'bg-slate-200 text-slate-700'
  },
  loans: {
    id: 'loans',
    title: 'Loan Transactions',
    icon: '💰',
    color: 'emerald',
    bgColor: 'bg-emerald-50/50',
    borderColor: 'border-emerald-200',
    badgeColor: 'bg-emerald-100 text-emerald-700'
  },
  investors: {
    id: 'investors',
    title: 'Investor Transactions',
    icon: '👥',
    color: 'blue',
    bgColor: 'bg-blue-50/50',
    borderColor: 'border-blue-200',
    badgeColor: 'bg-blue-100 text-blue-700'
  },
  expenses: {
    id: 'expenses',
    title: 'Expenses',
    icon: '📝',
    color: 'amber',
    bgColor: 'bg-amber-50/50',
    borderColor: 'border-amber-200',
    badgeColor: 'bg-amber-100 text-amber-700'
  }
};

// Confidence badge helper
const getConfidenceBadge = (confidence) => {
  if (confidence >= 90) {
    return { className: 'bg-emerald-100 text-emerald-700', label: 'High' };
  }
  if (confidence >= 70) {
    return { className: 'bg-amber-100 text-amber-700', label: 'Med' };
  }
  if (confidence > 0) {
    return { className: 'bg-red-100 text-red-700', label: 'Low' };
  }
  return { className: 'bg-slate-100 text-slate-500', label: '?' };
};

// Quick pot selector buttons - text labels with colors
const POT_BUTTONS = [
  { id: 'loans', label: 'Loans', bgClass: 'bg-emerald-100 hover:bg-emerald-200 text-emerald-700' },
  { id: 'investors', label: 'Investors', bgClass: 'bg-blue-100 hover:bg-blue-200 text-blue-700' },
  { id: 'expenses', label: 'Expenses', bgClass: 'bg-amber-100 hover:bg-amber-200 text-amber-700' },
  { id: 'unclassified', label: 'Unclassified', bgClass: 'bg-slate-100 hover:bg-slate-200 text-slate-600' }
];

// Single entry row component
function EntryRow({
  entry,
  index,
  sectionId,
  isExpanded,
  onClick,
  onConfirmMatch,
  onReconcile,
  onReclassify
}) {
  const isCredit = entry.amount > 0;
  const match = entry.match;
  const confidence = match?.confidence || 0;
  const isConfirmed = entry.matchConfirmed;

  // Get match display info
  const getMatchInfo = () => {
    if (!match) return null;

    if (sectionId === 'loans' && match.loan) {
      return `${match.loan.borrower_name} • ${match.loan.loan_number}`;
    }
    if (sectionId === 'investors' && match.investor) {
      const type = match.transactionType === 'capital_in' ? 'Capital In' :
                   match.transactionType === 'capital_out' ? 'Capital Out' : 'Interest';
      return `${match.investor.name || match.investor.business_name} • ${type}`;
    }
    if (sectionId === 'expenses' && match.expenseType) {
      return `${match.expenseType.name}${match.loan ? ` • ${match.loan.loan_number}` : ''}`;
    }
    return match.reason;
  };

  const matchInfo = getMatchInfo();

  return (
    <Draggable draggableId={entry.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={`
            border-b last:border-b-0
            ${snapshot.isDragging ? 'shadow-lg bg-white z-50' : ''}
            ${isConfirmed ? 'bg-emerald-50/50' : ''}
          `}
        >
          {/* Main row - single line */}
          <div
            className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer"
            onClick={onClick}
          >
            {/* Drag handle */}
            <div
              {...provided.dragHandleProps}
              className="text-slate-300 hover:text-slate-500 cursor-grab"
            >
              <GripVertical className="w-4 h-4" />
            </div>

            {/* Date */}
            <span className="text-xs text-slate-500 w-16 shrink-0">
              {entry.statement_date
                ? format(new Date(entry.statement_date), 'dd MMM')
                : '-'}
            </span>

            {/* Amount */}
            <span className={`font-mono text-sm font-semibold w-24 shrink-0 text-right ${
              isCredit ? 'text-emerald-600' : 'text-red-600'
            }`}>
              {isCredit ? '+' : ''}{formatCurrency(entry.amount)}
            </span>

            {/* Description */}
            <span className="text-sm text-slate-700 truncate flex-1 min-w-0 px-2">
              {entry.description || entry.counterparty || '-'}
            </span>

            {/* Quick pot reclassify buttons */}
            <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
              {POT_BUTTONS.filter(p => p.id !== sectionId).map(pot => (
                <button
                  key={pot.id}
                  className={`text-xs px-2 py-0.5 rounded ${pot.bgClass} transition-colors`}
                  onClick={() => onReclassify?.(entry.id, pot.id)}
                >
                  {pot.label}
                </button>
              ))}
            </div>

            {/* Match info / arrow */}
            {matchInfo && sectionId !== 'unclassified' && (
              <>
                <ArrowRight className="w-3 h-3 text-slate-300 shrink-0" />
                <span className="text-xs text-slate-500 truncate max-w-[180px]">
                  {matchInfo}
                </span>
              </>
            )}

            {/* Status badges */}
            <div className="flex items-center gap-1 shrink-0 ml-2">
              {isConfirmed ? (
                <Badge className="bg-emerald-500 text-white text-xs px-2 py-0">
                  Ready
                </Badge>
              ) : confidence > 0 ? (
                <Badge variant="outline" className={`${getConfidenceBadge(confidence).className} text-xs px-2 py-0`}>
                  {confidence}%
                </Badge>
              ) : sectionId === 'unclassified' ? (
                <Badge variant="outline" className="bg-slate-100 text-slate-500 text-xs px-2 py-0">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Review
                </Badge>
              ) : null}

              {/* Expand indicator */}
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
            </div>
          </div>

          {/* Expanded details */}
          {isExpanded && (
            <div
              className="px-3 pb-3 ml-6 border-l-2 border-slate-200 mx-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-slate-50 rounded-lg p-3 space-y-3">
                {/* Reference */}
                {entry.reference && (
                  <div className="text-xs">
                    <span className="text-slate-500">Reference: </span>
                    <span className="text-slate-700">{entry.reference}</span>
                  </div>
                )}

                {/* Match details */}
                {match && (
                  <div className="text-xs space-y-1">
                    <div className="font-medium text-slate-700">{matchInfo}</div>
                    {match.reason && (
                      <div className="text-slate-500 italic">{match.reason}</div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  {!isConfirmed && match && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7"
                      onClick={() => onConfirmMatch?.(entry.id)}
                    >
                      <Check className="w-3 h-3 mr-1" />
                      Confirm Match
                    </Button>
                  )}
                  {isConfirmed && (
                    <Button
                      size="sm"
                      className="text-xs h-7 bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => onReconcile?.(entry)}
                    >
                      Reconcile
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
}

// Section component
function Section({
  config,
  entries = [],
  expandedCardId,
  onCardClick,
  onConfirmMatch,
  onReconcile,
  onReclassify,
  defaultOpen = true
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const credits = entries.filter(e => e.amount > 0).reduce((sum, e) => sum + e.amount, 0);
  const debits = entries.filter(e => e.amount < 0).reduce((sum, e) => sum + Math.abs(e.amount), 0);
  const confirmedCount = entries.filter(e => e.matchConfirmed).length;

  // Always render the section so it can be a drop target, even if empty
  return (
    <Droppable droppableId={config.id}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={`
            rounded-lg border mb-3
            ${config.borderColor}
            ${snapshot.isDraggingOver ? `${config.bgColor} ring-2 ring-offset-2` : ''}
          `}
        >
          {/* Header - clickable to toggle */}
          <div
            className={`
              flex items-center justify-between px-4 py-2 cursor-pointer rounded-t-lg
              ${config.bgColor} ${entries.length > 0 ? `border-b ${config.borderColor}` : ''}
            `}
            onClick={() => setIsOpen(!isOpen)}
          >
            <div className="flex items-center gap-2">
              {entries.length > 0 ? (
                isOpen ? (
                  <ChevronDown className="w-4 h-4 text-slate-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-500" />
                )
              ) : (
                <div className="w-4 h-4" /> // Spacer when empty
              )}
              <span className="text-lg">{config.icon}</span>
              <span className="font-semibold text-slate-800">{config.title}</span>
              <Badge variant="secondary" className={config.badgeColor}>
                {entries.length}
              </Badge>
            </div>

            <div className="flex items-center gap-4 text-xs">
              {credits > 0 && (
                <span className="text-emerald-600">+{formatCurrency(credits)}</span>
              )}
              {debits > 0 && (
                <span className="text-red-600">-{formatCurrency(debits)}</span>
              )}
              {confirmedCount > 0 && (
                <span className="text-slate-500">{confirmedCount} ready</span>
              )}
            </div>
          </div>

          {/* Content - always in DOM for drag target, just hidden when collapsed */}
          <div
            className={`bg-white ${!isOpen && entries.length > 0 ? 'hidden' : ''}`}
          >
            {entries.length > 0 ? (
              entries.map((entry, index) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  index={index}
                  sectionId={config.id}
                  isExpanded={expandedCardId === entry.id}
                  onClick={() => onCardClick?.(entry.id)}
                  onConfirmMatch={onConfirmMatch}
                  onReconcile={onReconcile}
                  onReclassify={onReclassify}
                />
              ))
            ) : (
              <div className="text-center py-4 text-slate-400 text-sm">
                {snapshot.isDraggingOver ? 'Drop here to classify' : 'No items - drag here to add'}
              </div>
            )}
            {provided.placeholder}
          </div>
        </div>
      )}
    </Droppable>
  );
}

// Main inbox component
export default function ReconciliationInbox({
  entriesByPot = {},
  onDragEnd,
  onCardClick,
  expandedCardId,
  onReconcile,
  onConfirmMatch,
  onReclassify
}) {
  const handleDragEnd = (result) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    if (onDragEnd) {
      onDragEnd({
        entryId: draggableId,
        fromPot: source.droppableId,
        toPot: destination.droppableId,
        fromIndex: source.index,
        toIndex: destination.index
      });
    }
  };

  // Handle reclassify via quick buttons - reuse the same handler as drag
  const handleReclassify = (entryId, toPot) => {
    // Find which pot the entry is currently in
    for (const [potId, entries] of Object.entries(entriesByPot)) {
      const entry = entries.find(e => e.id === entryId);
      if (entry) {
        if (potId !== toPot) {
          onReclassify?.({
            entryId,
            fromPot: potId,
            toPot,
            fromIndex: entries.indexOf(entry),
            toIndex: 0
          });
        }
        break;
      }
    }
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Card className="flex-1">
        <CardHeader className="py-3 px-4 border-b">
          <CardTitle className="text-sm font-medium text-slate-600">
            Drag items between sections to reclassify. Click to expand. Confirm matches before reconciling.
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <ScrollArea className="h-[calc(100vh-320px)] min-h-[400px]">
            {/* Unclassified at the top */}
            <Section
              config={SECTION_CONFIG.unclassified}
              entries={entriesByPot.unclassified || []}
              expandedCardId={expandedCardId}
              onCardClick={onCardClick}
              onConfirmMatch={onConfirmMatch}
              onReconcile={onReconcile}
              onReclassify={handleReclassify}
              defaultOpen={true}
            />

            {/* Classified sections below */}
            <Section
              config={SECTION_CONFIG.loans}
              entries={entriesByPot.loans || []}
              expandedCardId={expandedCardId}
              onCardClick={onCardClick}
              onConfirmMatch={onConfirmMatch}
              onReconcile={onReconcile}
              onReclassify={handleReclassify}
              defaultOpen={true}
            />

            <Section
              config={SECTION_CONFIG.investors}
              entries={entriesByPot.investors || []}
              expandedCardId={expandedCardId}
              onCardClick={onCardClick}
              onConfirmMatch={onConfirmMatch}
              onReconcile={onReconcile}
              onReclassify={handleReclassify}
              defaultOpen={true}
            />

            <Section
              config={SECTION_CONFIG.expenses}
              entries={entriesByPot.expenses || []}
              expandedCardId={expandedCardId}
              onCardClick={onCardClick}
              onConfirmMatch={onConfirmMatch}
              onReconcile={onReconcile}
              onReclassify={handleReclassify}
              defaultOpen={true}
            />
          </ScrollArea>
        </CardContent>
      </Card>
    </DragDropContext>
  );
}
