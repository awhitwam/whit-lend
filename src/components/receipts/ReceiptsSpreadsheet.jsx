import { useRef, useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import ReceiptRow from './ReceiptRow';
import BankEntryPicker from './BankEntryPicker';
import { useSpreadsheetNavigation } from '@/hooks/useSpreadsheetNavigation';

/**
 * Main spreadsheet component for receipts
 * Handles keyboard navigation, row management, and cell refs
 *
 * Modes:
 * - standalone: Full flexibility, all columns visible
 * - borrower: Borrower column hidden (locked externally)
 * - loan: Borrower column hidden, single row mode
 */
export default function ReceiptsSpreadsheet({
  rows,
  borrowers,
  loans,
  lastPayments,
  schedules,
  bankEntries,
  onUpdateRow,
  onDeleteRow,
  onAddRow,
  // Mode props
  mode = 'standalone',
  hideBorrowerColumn = false,
  singleRowMode = false,
  lockedBorrowerId = null,
  lockedBorrower = null,
  lockedLoanId = null
}) {
  // Column count depends on whether borrower column is hidden
  const COL_COUNT = hideBorrowerColumn ? 2 : 3;
  const cellRefs = useRef({});
  const tableRef = useRef(null);

  // Navigation state
  const [focusedCell, setFocusedCell] = useState({ rowIndex: 0, colIndex: 0 });
  const [isEditing, setIsEditing] = useState(false);

  // Bank entry picker state
  const [bankPickerOpen, setBankPickerOpen] = useState(false);
  const [bankPickerRowIndex, setBankPickerRowIndex] = useState(null);

  // Set up keyboard navigation
  const { handleKeyDown } = useSpreadsheetNavigation({
    rowCount: rows.length,
    colCount: COL_COUNT,
    focusedCell,
    setFocusedCell,
    isEditing,
    setIsEditing,
    onAddRow,
    cellRefs
  });

  // Get bank entries already used by other rows
  const usedBankEntryIds = rows
    .filter(r => r.bankStatementId)
    .map(r => r.bankStatementId);

  // Handle opening bank picker for a specific row
  const handleOpenBankPicker = useCallback((rowIndex) => {
    setBankPickerRowIndex(rowIndex);
    setBankPickerOpen(true);
  }, []);

  // Handle bank entry selection
  const handleBankEntrySelect = useCallback((entry) => {
    if (bankPickerRowIndex !== null) {
      onUpdateRow(bankPickerRowIndex, {
        entryMode: 'bank_entry',
        bankStatementId: entry.id,
        date: entry.statement_date,
        amount: parseFloat(entry.amount) || 0,
        // Capture bank statement details for transaction reference
        bankDescription: entry.description || '',
        bankReference: entry.external_reference || entry.reference || ''
      });
    }
    setBankPickerOpen(false);
    setBankPickerRowIndex(null);
  }, [bankPickerRowIndex, onUpdateRow]);

  // Get bank entry for a row
  const getBankEntry = (row) => {
    if (!row.bankStatementId) return null;
    return bankEntries?.find(e => e.id === row.bankStatementId);
  };

  // Attach keyboard listener to table
  useEffect(() => {
    const table = tableRef.current;
    if (table) {
      table.addEventListener('keydown', handleKeyDown);
      return () => table.removeEventListener('keydown', handleKeyDown);
    }
  }, [handleKeyDown]);

  return (
    <div className="border rounded-lg overflow-hidden bg-white">
      {/* Spreadsheet table */}
      <div className="overflow-x-auto">
        <table
          ref={tableRef}
          className="w-full border-collapse"
          tabIndex={0}
        >
          <thead>
            <tr className="bg-slate-100 border-b">
              <th className="w-8 px-1 py-2 border-r"></th>
              <th className="px-2 py-2 text-left text-xs font-medium text-slate-600 uppercase tracking-wider border-r w-[160px]">
                Date / Amount
              </th>
              {!hideBorrowerColumn && (
                <th className="px-2 py-2 text-left text-xs font-medium text-slate-600 uppercase tracking-wider border-r w-[180px]">
                  Borrower
                </th>
              )}
              <th className="px-2 py-2 text-left text-xs font-medium text-slate-600 uppercase tracking-wider border-r">
                Loan(s) & Allocation
              </th>
              <th className="w-10 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={hideBorrowerColumn ? 4 : 5} className="py-12 text-center text-slate-500">
                  No receipts yet. Click "Add Receipt" to start.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <ReceiptRow
                  key={row.id}
                  row={row}
                  rowIndex={index}
                  focusedCell={focusedCell}
                  isEditing={isEditing}
                  borrowers={borrowers}
                  loans={loans}
                  lastPayments={lastPayments}
                  schedules={schedules}
                  bankEntry={getBankEntry(row)}
                  onUpdate={onUpdateRow}
                  onDelete={onDeleteRow}
                  onOpenBankPicker={() => handleOpenBankPicker(index)}
                  cellRefs={cellRefs}
                  // Mode props
                  mode={mode}
                  hideBorrowerColumn={hideBorrowerColumn}
                  lockedBorrowerId={lockedBorrowerId}
                  lockedBorrower={lockedBorrower}
                  lockedLoanId={lockedLoanId}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add row button - hide in single row mode */}
      {!singleRowMode && (
        <div className="px-4 py-3 bg-slate-50 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={onAddRow}
            className="gap-1"
          >
            <Plus className="w-4 h-4" />
            Add Receipt
          </Button>
        </div>
      )}

      {/* Bank entry picker modal */}
      <BankEntryPicker
        open={bankPickerOpen}
        onOpenChange={setBankPickerOpen}
        onSelect={handleBankEntrySelect}
        excludeIds={usedBankEntryIds}
      />
    </div>
  );
}
