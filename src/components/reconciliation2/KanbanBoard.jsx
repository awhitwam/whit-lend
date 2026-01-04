import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import PotColumn from './PotColumn';

const POT_CONFIG = {
  unclassified: {
    id: 'unclassified',
    title: 'Unclassified',
    icon: '📋',
    color: 'slate',
    description: 'Needs manual classification'
  },
  loans: {
    id: 'loans',
    title: 'Loans',
    icon: '💰',
    color: 'emerald',
    description: 'Repayments & Disbursements'
  },
  investors: {
    id: 'investors',
    title: 'Investors',
    icon: '👥',
    color: 'blue',
    description: 'Capital & Interest'
  },
  expenses: {
    id: 'expenses',
    title: 'Expenses',
    icon: '📝',
    color: 'amber',
    description: 'Operating expenses'
  }
};

const POT_ORDER = ['unclassified', 'loans', 'investors', 'expenses'];

export default function KanbanBoard({
  entriesByPot = {},
  onDragEnd,
  onCardClick,
  expandedCardId,
  loans = [],
  investors = [],
  expenseTypes = [],
  onReconcile,
  onConfirmMatch
}) {
  const handleDragEnd = (result) => {
    const { destination, source, draggableId } = result;

    // Dropped outside a droppable
    if (!destination) return;

    // Dropped in same position
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    // Call parent handler with move details
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

  // Calculate totals per pot
  const getPotStats = (potId) => {
    const entries = entriesByPot[potId] || [];
    const count = entries.length;
    const credits = entries.filter(e => e.amount > 0).reduce((sum, e) => sum + e.amount, 0);
    const debits = entries.filter(e => e.amount < 0).reduce((sum, e) => sum + Math.abs(e.amount), 0);
    const confirmed = entries.filter(e => e.matchConfirmed).length;
    return { count, credits, debits, confirmed };
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-4 h-[calc(100vh-280px)] min-h-[500px]">
        {POT_ORDER.map(potId => {
          const config = POT_CONFIG[potId];
          const entries = entriesByPot[potId] || [];
          const stats = getPotStats(potId);

          return (
            <Droppable key={potId} droppableId={potId}>
              {(provided, snapshot) => (
                <PotColumn
                  config={config}
                  entries={entries}
                  stats={stats}
                  provided={provided}
                  isDraggingOver={snapshot.isDraggingOver}
                  onCardClick={onCardClick}
                  expandedCardId={expandedCardId}
                  loans={loans}
                  investors={investors}
                  expenseTypes={expenseTypes}
                  onReconcile={onReconcile}
                  onConfirmMatch={onConfirmMatch}
                />
              )}
            </Droppable>
          );
        })}
      </div>
    </DragDropContext>
  );
}

export { POT_CONFIG, POT_ORDER };
