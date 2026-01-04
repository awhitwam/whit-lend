import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency } from '@/components/loan/LoanCalculator';
import BankEntryCard from './BankEntryCard';

const COLOR_CLASSES = {
  slate: {
    header: 'bg-slate-100 border-slate-200',
    badge: 'bg-slate-200 text-slate-700',
    dragOver: 'bg-slate-50 border-slate-300'
  },
  emerald: {
    header: 'bg-emerald-50 border-emerald-200',
    badge: 'bg-emerald-100 text-emerald-700',
    dragOver: 'bg-emerald-50/50 border-emerald-300'
  },
  blue: {
    header: 'bg-blue-50 border-blue-200',
    badge: 'bg-blue-100 text-blue-700',
    dragOver: 'bg-blue-50/50 border-blue-300'
  },
  amber: {
    header: 'bg-amber-50 border-amber-200',
    badge: 'bg-amber-100 text-amber-700',
    dragOver: 'bg-amber-50/50 border-amber-300'
  }
};

export default function PotColumn({
  config,
  entries = [],
  stats,
  provided,
  isDraggingOver,
  onCardClick,
  expandedCardId,
  loans,
  investors,
  expenseTypes,
  onReconcile,
  onConfirmMatch
}) {
  const colors = COLOR_CLASSES[config.color] || COLOR_CLASSES.slate;

  return (
    <Card
      className={`flex-1 min-w-[280px] max-w-[350px] flex flex-col transition-colors ${
        isDraggingOver ? colors.dragOver : ''
      }`}
    >
      <CardHeader className={`p-3 ${colors.header} border-b rounded-t-lg`}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <span>{config.icon}</span>
            <span>{config.title}</span>
          </CardTitle>
          <Badge variant="secondary" className={colors.badge}>
            {stats.count}
          </Badge>
        </div>
        <p className="text-xs text-slate-500 mt-1">{config.description}</p>

        {/* Stats row */}
        {stats.count > 0 && (
          <div className="flex gap-3 mt-2 text-xs">
            {stats.credits > 0 && (
              <span className="text-emerald-600">
                +{formatCurrency(stats.credits)}
              </span>
            )}
            {stats.debits > 0 && (
              <span className="text-red-600">
                -{formatCurrency(stats.debits)}
              </span>
            )}
            {stats.confirmed > 0 && (
              <span className="text-slate-500">
                {stats.confirmed} ready
              </span>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent
        ref={provided.innerRef}
        {...provided.droppableProps}
        className="flex-1 p-2 overflow-hidden"
      >
        <ScrollArea className="h-full">
          <div className="space-y-2 pr-2">
            {entries.map((entry, index) => (
              <BankEntryCard
                key={entry.id}
                entry={entry}
                index={index}
                potId={config.id}
                isExpanded={expandedCardId === entry.id}
                onClick={() => onCardClick?.(entry.id)}
                loans={loans}
                investors={investors}
                expenseTypes={expenseTypes}
                onReconcile={onReconcile}
                onConfirmMatch={onConfirmMatch}
              />
            ))}
            {provided.placeholder}

            {entries.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-sm">
                {isDraggingOver ? 'Drop here' : 'No items'}
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
