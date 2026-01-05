import { useRef, forwardRef } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2, GripVertical } from 'lucide-react';
import DateAmountCell from './cells/DateAmountCell';
import BorrowerCell from './cells/BorrowerCell';
import LoanAllocationCell from './cells/LoanAllocationCell';
import { cn } from '@/lib/utils';

/**
 * A single row in the receipts spreadsheet
 * Composes all cell components and handles row-level actions
 *
 * Mode props control column visibility:
 * - hideBorrowerColumn: skips borrower cell rendering
 * - lockedBorrowerId/lockedLoanId: passed to child cells
 */
const ReceiptRow = forwardRef(function ReceiptRow({
  row,
  rowIndex,
  focusedCell,
  isEditing,
  borrowers,
  loans,
  lastPayments,
  schedules,
  bankEntry,
  onUpdate,
  onDelete,
  onOpenBankPicker,
  cellRefs,
  // Mode props
  mode = 'standalone',
  hideBorrowerColumn = false,
  lockedBorrowerId = null,
  lockedBorrower = null,
  lockedLoanId = null
}, _ref) {
  const rowRef = useRef(null);

  // Column indices depend on whether borrower column is hidden
  const COLS = hideBorrowerColumn
    ? {
        DATE_AMOUNT: 0,
        LOANS_ALLOCATION: 1
      }
    : {
        DATE_AMOUNT: 0,
        BORROWER: 1,
        LOANS_ALLOCATION: 2
      };

  // Check if a specific cell is focused
  const isCellFocused = (colIndex) => {
    return focusedCell.rowIndex === rowIndex && focusedCell.colIndex === colIndex;
  };

  // Update row data
  const handleUpdate = (updates) => {
    onUpdate(rowIndex, updates);
  };

  // Register cell refs
  const setCellRef = (colIndex, el) => {
    if (cellRefs?.current) {
      const key = `${rowIndex}-${colIndex}`;
      cellRefs.current[key] = el;
    }
  };

  // Check if row is complete (has valid allocation matching amount)
  const isComplete = () => {
    if (!row.borrowerId || !row.amount || row.amount <= 0) return false;
    if (!row.selectedLoanIds || row.selectedLoanIds.length === 0) return false;

    let totalAllocated = 0;
    for (const loanId of row.selectedLoanIds) {
      const alloc = row.allocations?.[loanId] || {};
      totalAllocated += (parseFloat(alloc.principal) || 0);
      totalAllocated += (parseFloat(alloc.interest) || 0);
      totalAllocated += (parseFloat(alloc.fees) || 0);
    }

    return Math.abs(totalAllocated - row.amount) < 0.01;
  };

  return (
    <tr
      ref={rowRef}
      className={cn(
        'border-b transition-colors',
        focusedCell.rowIndex === rowIndex && 'bg-blue-50/50',
        isComplete() && 'bg-green-50/30'
      )}
    >
      {/* Row handle */}
      <td className="w-6 px-0.5 border-r bg-slate-50">
        <div className="flex items-center justify-center text-slate-400">
          <GripVertical className="w-3 h-3" />
        </div>
      </td>

      {/* Date & Amount */}
      <td className="border-r p-0">
        <DateAmountCell
          ref={(el) => setCellRef(COLS.DATE_AMOUNT, el)}
          row={row}
          isFocused={isCellFocused(COLS.DATE_AMOUNT)}
          isEditing={isEditing && isCellFocused(COLS.DATE_AMOUNT)}
          onUpdate={handleUpdate}
          onOpenBankPicker={onOpenBankPicker}
          bankEntry={bankEntry}
        />
      </td>

      {/* Borrower - conditionally rendered */}
      {!hideBorrowerColumn && (
        <td className="border-r p-0">
          <BorrowerCell
            ref={(el) => setCellRef(COLS.BORROWER, el)}
            row={row}
            borrowers={borrowers}
            isFocused={isCellFocused(COLS.BORROWER)}
            isEditing={isEditing && isCellFocused(COLS.BORROWER)}
            onUpdate={handleUpdate}
            locked={!!lockedBorrowerId}
            lockedBorrower={lockedBorrower}
          />
        </td>
      )}

      {/* Loans & Allocation (combined) */}
      <td className="border-r p-0">
        <LoanAllocationCell
          ref={(el) => setCellRef(COLS.LOANS_ALLOCATION, el)}
          row={row}
          loans={loans}
          lastPayments={lastPayments}
          schedules={schedules}
          isFocused={isCellFocused(COLS.LOANS_ALLOCATION)}
          isEditing={isEditing && isCellFocused(COLS.LOANS_ALLOCATION)}
          onUpdate={handleUpdate}
          mode={mode}
          lockedLoanId={lockedLoanId}
        />
      </td>

      {/* Actions */}
      <td className="w-8 px-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-slate-400 hover:text-red-500"
          onClick={() => onDelete?.(rowIndex)}
          title="Delete row"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </td>
    </tr>
  );
});

export default ReceiptRow;
