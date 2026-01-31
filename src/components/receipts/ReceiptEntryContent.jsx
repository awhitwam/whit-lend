import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/dataClient';
import { toast } from 'sonner';
import { logTransactionEvent, logLoanEvent, AuditAction } from '@/lib/auditLog';
import { maybeRegenerateScheduleAfterCapitalChange } from '@/components/loan/LoanScheduleManager';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { FileText, Save, Loader2, AlertCircle, Check } from 'lucide-react';
import ReceiptsSpreadsheet from './ReceiptsSpreadsheet';
import { useReceiptDrafts } from '@/hooks/useReceiptDrafts';
import { v4 as uuidv4 } from 'uuid';
import { formatCurrency } from '@/lib/formatters';

/**
 * Core receipt entry UI component
 * Used by both the standalone Receipts page and the ReceiptEntryPanel
 *
 * Modes:
 * - standalone: Full page, all fields selectable, multi-row, draft persistence
 * - borrower: Panel, borrower locked, select loans, multi-row, no draft persistence
 * - loan: Panel, borrower & loan locked, single row, no draft persistence
 */
export default function ReceiptEntryContent({
  mode = 'standalone',
  lockedBorrowerId = null,
  lockedBorrower = null,
  lockedLoanId = null,
  lockedLoan: _lockedLoan = null,
  compact = false,
  onFileComplete = null
}) {
  const queryClient = useQueryClient();
  const isStandalone = mode === 'standalone';
  const isSingleRowMode = mode === 'loan';
  const hideBorrowerColumn = mode !== 'standalone';

  // Local state for rows (includes unsaved changes)
  const [localRows, setLocalRows] = useState([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [confirmFileOpen, setConfirmFileOpen] = useState(false);

  // Load draft receipts (only for standalone mode)
  const {
    rows: savedRows,
    isLoading: draftsLoading,
    saveDraftAsync,
    isSaving,
    deleteDraftAsync,
    fileReceiptsAsync,
    isFiling
  } = useReceiptDrafts();

  // Load borrowers (only for standalone mode)
  const { data: borrowers = [], isLoading: borrowersLoading } = useQuery({
    queryKey: ['borrowers'],
    queryFn: () => api.entities.Borrower.list(),
    enabled: isStandalone
  });

  // Load loans
  const { data: allLoans = [], isLoading: loansLoading } = useQuery({
    queryKey: ['loans'],
    queryFn: () => api.entities.Loan.list('-created_at')
  });

  // Filter loans based on mode (always exclude deleted loans)
  const loans = useMemo(() => {
    // First, filter out deleted loans
    const activeLoans = allLoans.filter(l => !l.is_deleted);

    if (lockedLoanId) {
      // Loan mode: only the locked loan
      return activeLoans.filter(l => l.id === lockedLoanId);
    }
    if (lockedBorrowerId) {
      // Borrower mode: only loans for this borrower
      return activeLoans.filter(l => l.borrower_id === lockedBorrowerId);
    }
    // Standalone: all active loans
    return activeLoans;
  }, [allLoans, lockedBorrowerId, lockedLoanId]);

  // Load transactions for last payment info
  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions-repayments'],
    queryFn: () => api.entities.Transaction.filter({ type: 'Repayment' }, '-date')
  });

  // Load repayment schedules
  const { data: schedules = [] } = useQuery({
    queryKey: ['repayment-schedules'],
    queryFn: () => api.entities.RepaymentSchedule.listAll('due_date')
  });

  // Load bank statements
  const { data: bankEntries = [] } = useQuery({
    queryKey: ['bank-statements-all'],
    queryFn: () => api.entities.BankStatement.list('-statement_date')
  });

  // Calculate last payment per loan (with allocation breakdown)
  const lastPayments = useMemo(() => {
    const result = {};
    for (const tx of transactions) {
      if (!tx.loan_id) continue;
      if (!result[tx.loan_id] || new Date(tx.date) > new Date(result[tx.loan_id].date)) {
        result[tx.loan_id] = {
          date: tx.date,
          amount: parseFloat(tx.amount) || 0,
          principal: parseFloat(tx.principal_applied) || parseFloat(tx.principal_amount) || 0,
          interest: parseFloat(tx.interest_applied) || parseFloat(tx.interest_amount) || 0,
          fees: parseFloat(tx.fees_applied) || parseFloat(tx.fees_amount) || 0
        };
      }
    }
    return result;
  }, [transactions]);

  // Create a new empty row with locked values pre-filled
  const createEmptyRow = useCallback((rowOrder = 0) => {
    return {
      id: `temp-${uuidv4()}`,
      entryMode: 'manual',
      bankStatementId: null,
      date: new Date().toISOString().split('T')[0],
      amount: 0,
      borrowerId: lockedBorrowerId,
      selectedLoanIds: lockedLoanId ? [lockedLoanId] : [],
      allocations: {},
      reference: '',
      isDirty: true,
      isNew: true,
      rowOrder
    };
  }, [lockedBorrowerId, lockedLoanId]);

  // Initialize local rows
  useEffect(() => {
    if (isStandalone) {
      // Standalone: sync from saved drafts
      // Don't sync while saving or filing (they manage localRows directly)
      if (!draftsLoading && !hasUnsavedChanges && !isFiling && !isSaving) {
        setLocalRows(savedRows);
      }
    } else if (localRows.length === 0) {
      // Dialog modes: start with one empty row
      setLocalRows([createEmptyRow(0)]);
    }
  }, [isStandalone, draftsLoading, savedRows, hasUnsavedChanges, isFiling, isSaving, createEmptyRow, localRows.length]);

  // Add a new row
  const handleAddRow = useCallback(() => {
    const newRow = createEmptyRow(localRows.length);
    setLocalRows(prev => [...prev, newRow]);
    setHasUnsavedChanges(true);
  }, [createEmptyRow, localRows.length]);

  // Update a row
  const handleUpdateRow = useCallback((rowIndex, updates) => {
    setLocalRows(prev => prev.map((row, i) => {
      if (i !== rowIndex) return row;
      return { ...row, ...updates, isDirty: true };
    }));
    setHasUnsavedChanges(true);
  }, []);

  // Delete a row
  const handleDeleteRow = useCallback(async (rowIndex) => {
    const row = localRows[rowIndex];

    // If it's a saved draft (standalone mode), delete from server
    if (isStandalone && row.id && !row.id.startsWith('temp-')) {
      try {
        await deleteDraftAsync(row.id);
        toast.success('Row deleted');
      } catch (error) {
        toast.error('Failed to delete: ' + error.message);
        return;
      }
    }

    setLocalRows(prev => prev.filter((_, i) => i !== rowIndex));
  }, [localRows, deleteDraftAsync, isStandalone]);

  // Save all dirty rows (standalone mode only)
  const handleSaveAll = useCallback(async () => {
    const dirtyRows = localRows.filter(r => r.isDirty);
    if (dirtyRows.length === 0) {
      toast.info('No changes to save');
      return;
    }

    try {
      for (const row of dirtyRows) {
        const saved = await saveDraftAsync(row);
        setLocalRows(prev => prev.map(r =>
          r.id === row.id ? { ...r, id: saved.id, isDirty: false, isNew: false } : r
        ));
      }
      setHasUnsavedChanges(false);
      toast.success(`Saved ${dirtyRows.length} receipt(s)`);
    } catch (error) {
      toast.error('Failed to save: ' + error.message);
    }
  }, [localRows, saveDraftAsync]);

  // Validate rows before filing
  const validateForFiling = useCallback(() => {
    const errors = [];

    for (let i = 0; i < localRows.length; i++) {
      const row = localRows[i];
      const rowNum = i + 1;

      if (!row.amount || row.amount <= 0) {
        errors.push(`Row ${rowNum}: Amount is required`);
        continue;
      }

      // In single-loan mode (loan locked), borrower check is skipped
      if (!lockedLoanId && !row.borrowerId) {
        errors.push(`Row ${rowNum}: Select a borrower`);
        continue;
      }

      // Determine which loans to check - in single-loan mode use the locked loan
      const loanIdsToCheck = lockedLoanId
        ? [lockedLoanId]
        : (row.selectedLoanIds || []);

      if (loanIdsToCheck.length === 0) {
        errors.push(`Row ${rowNum}: Select at least one loan`);
        continue;
      }

      // Check allocation totals - sum across ALL selected loans
      let totalAllocated = 0;
      for (const loanId of loanIdsToCheck) {
        const alloc = row.allocations?.[loanId] || {};
        totalAllocated += (parseFloat(alloc.principal) || 0);
        totalAllocated += (parseFloat(alloc.interest) || 0);
        totalAllocated += (parseFloat(alloc.fees) || 0);
      }

      const receiptAmount = parseFloat(row.amount) || 0;
      if (Math.abs(totalAllocated - receiptAmount) >= 0.01) {
        errors.push(`Row ${rowNum}: Allocation (£${totalAllocated.toFixed(2)}) doesn't match receipt amount (£${receiptAmount.toFixed(2)})`);
      }
    }

    return errors;
  }, [localRows, lockedLoanId]);

  // File all receipts
  const handleFile = useCallback(async () => {
    if (isStandalone) {
      // Standalone: save dirty rows first, collect real IDs, then file
      const savedIds = [];

      try {
        for (const row of localRows) {
          if (row.isDirty || row.id?.startsWith('temp-')) {
            // Save and get the real ID back
            const savedDraft = await saveDraftAsync(row);
            savedIds.push(savedDraft.id);
          } else {
            // Already saved with real ID
            savedIds.push(row.id);
          }
        }
      } catch (error) {
        toast.error('Failed to save before filing: ' + error.message);
        return;
      }

      if (savedIds.length === 0) {
        toast.error('No receipts to file');
        return;
      }

      try {
        await fileReceiptsAsync(savedIds);
        setConfirmFileOpen(false);
        setLocalRows([]);
        setHasUnsavedChanges(false);
        toast.success(`Filed ${savedIds.length} receipt(s) successfully!`);

        // Invalidate queries to refresh data
        queryClient.invalidateQueries({ queryKey: ['receipt-drafts'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        queryClient.invalidateQueries({ queryKey: ['loans'] });
        queryClient.invalidateQueries({ queryKey: ['bank-statements'] });

        onFileComplete?.();
      } catch (error) {
        setConfirmFileOpen(false);
        toast.error('Failed to file receipts: ' + error.message);
      }
    } else {
      // Dialog modes: file directly without saving drafts
      try {
        // Create transactions directly for each row
        for (const row of localRows) {
          const allocations = row.allocations || {};

          // In single-loan mode, use lockedLoanId; otherwise use selectedLoanIds
          const loanIds = (mode === 'loan' && lockedLoanId)
            ? [lockedLoanId]
            : (row.selectedLoanIds || []);

          for (const loanId of loanIds) {
            const alloc = allocations[loanId] || {};
            const principal = parseFloat(alloc.principal) || 0;
            const interest = parseFloat(alloc.interest) || 0;
            const fees = parseFloat(alloc.fees) || 0;
            const totalAmount = principal + interest + fees;

            if (totalAmount <= 0) continue;

            // Get loan to get borrower_id
            const loan = loans.find(l => l.id === loanId);
            if (!loan) continue;

            // Build reference from bank statement details if available (amount + description)
            let txReference = row.reference;
            if (row.bankStatementId) {
              const bankEntry = bankEntries.find(e => e.id === row.bankStatementId);
              if (bankEntry) {
                const amount = Math.abs(parseFloat(bankEntry.amount) || 0).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
                const desc = bankEntry.description || '';
                txReference = `${amount} ${desc}`.trim() || row.reference;
              }
            }

            // Create the transaction
            const newTransaction = await api.entities.Transaction.create({
              loan_id: loanId,
              borrower_id: loan.borrower_id,
              amount: totalAmount,
              date: row.date,
              type: 'Repayment',
              principal_applied: principal,
              interest_applied: interest,
              fees_applied: fees,
              reference: txReference || null,
              notes: alloc.description || null
            });

            // Audit log: transaction creation
            await logTransactionEvent(
              AuditAction.TRANSACTION_CREATE,
              { id: newTransaction.id, type: 'Repayment', amount: totalAmount, loan_id: loanId },
              { loan_number: loan.loan_number },
              {
                source: 'receipt_filing',
                principal_applied: principal,
                interest_applied: interest,
                fees_applied: fees,
                date: row.date,
                notes: alloc.description,
                borrower_id: loan.borrower_id
              }
            );

            // Update loan paid amounts
            const previousPrincipalPaid = parseFloat(loan.principal_paid) || 0;
            const previousInterestPaid = parseFloat(loan.interest_paid) || 0;
            await api.entities.Loan.update(loanId, {
              principal_paid: previousPrincipalPaid + principal,
              interest_paid: previousInterestPaid + interest
            });

            // Audit log: loan payment update
            await logLoanEvent(
              AuditAction.LOAN_UPDATE,
              { id: loanId, loan_number: loan.loan_number },
              {
                source: 'receipt_filing',
                principal_paid: previousPrincipalPaid + principal,
                interest_paid: previousInterestPaid + interest
              },
              {
                principal_paid: previousPrincipalPaid,
                interest_paid: previousInterestPaid
              }
            );

            // Regenerate schedule if principal was applied (affects capital)
            if (principal > 0) {
              await maybeRegenerateScheduleAfterCapitalChange(loanId, {
                type: 'Repayment',
                principal_applied: principal,
                date: row.date
              }, 'create');
            }

            // If linked to bank statement, handle reconciliation
            if (row.bankStatementId) {
              // Mark bank statement as reconciled
              await api.entities.BankStatement.update(row.bankStatementId, {
                is_reconciled: true,
                reconciled_at: new Date().toISOString()
              });
            }
          }
        }

        toast.success(`Filed ${localRows.length} receipt(s) successfully!`);

        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        queryClient.invalidateQueries({ queryKey: ['loans'] });
        queryClient.invalidateQueries({ queryKey: ['bank-statements'] });

        onFileComplete?.();
      } catch (error) {
        toast.error('Failed to file receipts: ' + error.message);
      }
    }
  }, [isStandalone, localRows, saveDraftAsync, fileReceiptsAsync, queryClient, onFileComplete, loans, mode, lockedLoanId]);

  // Handle file button click - validate first
  const handleFileClick = useCallback(() => {
    if (localRows.length === 0) {
      toast.error('No receipts to file');
      return;
    }

    const errors = validateForFiling();
    if (errors.length > 0) {
      toast.error(
        <div>
          <div className="font-medium">Cannot file receipts:</div>
          <ul className="mt-1 text-sm list-disc pl-4">
            {errors.slice(0, 3).map((e, i) => <li key={i}>{e}</li>)}
            {errors.length > 3 && <li>...and {errors.length - 3} more</li>}
          </ul>
        </div>
      );
      return;
    }

    setConfirmFileOpen(true);
  }, [localRows, validateForFiling]);

  // Calculate summary stats
  const summary = useMemo(() => {
    let totalAmount = 0;
    let completeCount = 0;
    let totalTransactions = 0;

    for (const row of localRows) {
      totalAmount += parseFloat(row.amount) || 0;

      // In single-loan mode, use lockedLoanId; otherwise use selectedLoanIds
      const loanIds = (mode === 'loan' && lockedLoanId)
        ? [lockedLoanId]
        : (row.selectedLoanIds || []);

      if ((row.borrowerId || mode === 'loan') && loanIds.length > 0) {
        let allocated = 0;
        for (const loanId of loanIds) {
          const alloc = row.allocations?.[loanId] || {};
          allocated += (parseFloat(alloc.principal) || 0);
          allocated += (parseFloat(alloc.interest) || 0);
          allocated += (parseFloat(alloc.fees) || 0);
        }
        if (Math.abs(allocated - row.amount) < 0.01) {
          completeCount++;
          totalTransactions += loanIds.length;
        }
      }
    }

    return {
      rowCount: localRows.length,
      totalAmount,
      completeCount,
      totalTransactions,
      allComplete: localRows.length > 0 && completeCount === localRows.length
    };
  }, [localRows, mode, lockedLoanId]);

  const isLoading = (isStandalone && draftsLoading) || (isStandalone && borrowersLoading) || loansLoading;

  // For dialog modes, use locked borrower or empty array
  const availableBorrowers = isStandalone
    ? borrowers
    : (lockedBorrower ? [lockedBorrower] : []);

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      {/* Action buttons - shown at top for dialog mode, or inline for standalone */}
      {!isStandalone && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-slate-500">Total:</span>
              <span className="ml-1 font-medium text-green-600">
                {formatCurrency(summary.totalAmount)}
              </span>
            </div>
            {localRows.length > 1 && (
              <div className="flex items-center gap-1">
                {summary.allComplete ? (
                  <>
                    <Check className="w-4 h-4 text-green-500" />
                    <span className="text-green-600">All complete</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    <span className="text-amber-600">
                      {summary.completeCount} of {summary.rowCount} complete
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <Button
            onClick={handleFileClick}
            disabled={localRows.length === 0 || !summary.allComplete || isFiling}
            size="sm"
          >
            {isFiling ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileText className="w-4 h-4 mr-2" />
            )}
            File Receipt{localRows.length > 1 ? 's' : ''}
          </Button>
        </div>
      )}

      {/* Summary bar - standalone mode only */}
      {isStandalone && localRows.length > 0 && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <span className="text-slate-500">Rows:</span>
                  <span className="ml-1 font-medium">{summary.rowCount}</span>
                </div>
                <div>
                  <span className="text-slate-500">Total:</span>
                  <span className="ml-1 font-medium text-green-600">
                    {formatCurrency(summary.totalAmount)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {summary.allComplete ? (
                    <>
                      <Check className="w-4 h-4 text-green-500" />
                      <span className="text-green-600">All complete</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                      <span className="text-amber-600">
                        {summary.completeCount} of {summary.rowCount} complete
                      </span>
                    </>
                  )}
                </div>
              </div>

              {hasUnsavedChanges && (
                <div className="text-sm text-amber-600 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  Unsaved changes
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Spreadsheet */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          <span className="ml-2 text-slate-500">Loading...</span>
        </div>
      ) : (
        <ReceiptsSpreadsheet
          rows={localRows}
          borrowers={availableBorrowers}
          loans={loans}
          lastPayments={lastPayments}
          schedules={schedules}
          bankEntries={bankEntries}
          onUpdateRow={handleUpdateRow}
          onDeleteRow={handleDeleteRow}
          onAddRow={handleAddRow}
          mode={mode}
          hideBorrowerColumn={hideBorrowerColumn}
          singleRowMode={isSingleRowMode}
          lockedBorrowerId={lockedBorrowerId}
          lockedBorrower={lockedBorrower}
          lockedLoanId={lockedLoanId}
        />
      )}

      {/* Standalone mode: action buttons */}
      {isStandalone && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            onClick={handleSaveAll}
            disabled={!hasUnsavedChanges || isSaving}
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save Draft
          </Button>

          <Button
            onClick={handleFileClick}
            disabled={localRows.length === 0 || !summary.allComplete || isFiling}
          >
            {isFiling ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileText className="w-4 h-4 mr-2" />
            )}
            File Receipts
          </Button>
        </div>
      )}

      {/* Confirm file dialog */}
      <AlertDialog open={confirmFileOpen} onOpenChange={setConfirmFileOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>File Receipt{localRows.length > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create {summary.totalTransactions} transaction{summary.totalTransactions !== 1 ? 's' : ''} totaling{' '}
              <strong>{formatCurrency(summary.totalAmount)}</strong>.
              {localRows.some(r => r.bankStatementId) && (
                <span className="block mt-2">
                  Linked bank entries will be marked as reconciled.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleFile}>
              File Receipt{localRows.length > 1 ? 's' : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
