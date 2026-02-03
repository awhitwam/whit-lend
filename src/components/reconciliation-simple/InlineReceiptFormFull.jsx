/**
 * InlineReceiptFormFull - Opens receipt module dialog pre-populated with bank entry
 * Uses the existing ReceiptEntryContent that supports multi-loan allocations
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/dataClient';
import { toast } from 'sonner';
import { logTransactionEvent, AuditAction } from '@/lib/auditLog';
import { maybeRegenerateScheduleAfterCapitalChange } from '@/components/loan/LoanScheduleManager';
import { Button } from '@/components/ui/button';
import { Loader2, X, FileText } from 'lucide-react';
import ReceiptsSpreadsheet from '@/components/receipts/ReceiptsSpreadsheet';
import { formatCurrency } from '@/lib/formatters';
import { v4 as uuidv4 } from 'uuid';

/**
 * Compact receipt form that supports multi-loan allocations
 * Pre-populated with bank entry data
 */
export default function InlineReceiptFormFull({
  bankEntry,
  loans,
  borrowers,
  onSuccess,
  onCancel
}) {
  const queryClient = useQueryClient();
  const amount = Math.abs(bankEntry.amount);

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

  // Calculate last payment per loan
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

  // Filter to active loans only
  const activeLoans = useMemo(() => {
    return loans.filter(l =>
      !l.is_deleted && (l.status === 'Live' || l.status === 'Active' || l.status === 'Defaulted')
    );
  }, [loans]);

  // Fuzzy match borrower from bank description
  const suggestedBorrowerId = useMemo(() => {
    const description = (bankEntry.description || '').toLowerCase();
    if (!description || !borrowers?.length) return null;

    // Normalize text for matching (keep letters, numbers, spaces)
    const normalize = (str) => (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const descNorm = normalize(description);

    let bestMatch = null;
    let bestScore = 0;

    for (const borrower of borrowers) {
      // Check all possible name fields
      const names = [
        borrower.name,
        borrower.full_name,
        borrower.business_name,
        borrower.business,
        borrower.display_name,
        borrower.trading_name
      ].filter(Boolean);

      for (const name of names) {
        const nameNorm = normalize(name);

        // Check for exact/near-exact substring match first (highest priority)
        if (descNorm.includes(nameNorm) && nameNorm.length > 3) {
          const exactScore = 1.0 + (nameNorm.length / 100); // Longer matches score higher
          if (exactScore > bestScore) {
            bestScore = exactScore;
            bestMatch = borrower.id;
          }
          continue;
        }

        // Get all words (including short ones for company initials like "C F")
        const allWords = nameNorm.split(/\s+/).filter(w => w.length > 0);
        const longWords = allWords.filter(w => w.length > 2);

        if (allWords.length === 0) continue;

        // Check if consecutive words appear in description (better for "C F Developments")
        let consecutiveMatch = false;
        if (allWords.length >= 2) {
          // Try matching 2+ consecutive words as a phrase
          for (let i = 0; i < allWords.length - 1; i++) {
            const phrase = allWords.slice(i, i + 2).join(' ');
            if (phrase.length > 3 && descNorm.includes(phrase)) {
              consecutiveMatch = true;
              break;
            }
          }
        }

        // Score based on word matches
        let matchedLongWords = 0;
        let matchedShortWords = 0;

        for (const word of longWords) {
          if (descNorm.includes(word)) {
            matchedLongWords++;
          }
        }

        // Also check short words (initials) but only if they appear near other matched words
        const shortWords = allWords.filter(w => w.length <= 2 && w.length > 0);
        for (const word of shortWords) {
          // Check if this short word appears in description
          const wordRegex = new RegExp(`\\b${word}\\b|\\s${word}\\s|^${word}\\s|\\s${word}$`);
          if (wordRegex.test(descNorm) || descNorm.includes(` ${word} `)) {
            matchedShortWords++;
          }
        }

        // Calculate score
        let score = 0;
        if (longWords.length > 0) {
          score = matchedLongWords / longWords.length;
        }

        // Bonus for consecutive phrase match
        if (consecutiveMatch) {
          score += 0.2;
        }

        // Bonus for matching short words (initials)
        if (shortWords.length > 0 && matchedShortWords > 0) {
          score += (matchedShortWords / shortWords.length) * 0.15;
        }

        if (score > bestScore && score >= 0.5) {
          bestScore = score;
          bestMatch = borrower.id;
        }
      }
    }

    return bestMatch;
  }, [bankEntry.description, borrowers]);

  // Create initial row with bank entry data
  const createInitialRow = useCallback(() => {
    return {
      id: `temp-${uuidv4()}`,
      entryMode: 'bank_entry',
      bankStatementId: bankEntry.id,
      date: bankEntry.statement_date,
      amount: amount,
      borrowerId: suggestedBorrowerId,
      selectedLoanIds: [],
      allocations: {},
      reference: bankEntry.external_reference || '',
      bankDescription: bankEntry.description || '',
      isDirty: true,
      isNew: true,
      rowOrder: 0
    };
  }, [bankEntry, amount, suggestedBorrowerId]);

  // Local state for rows
  const [localRows, setLocalRows] = useState(() => [createInitialRow()]);
  const [isFiling, setIsFiling] = useState(false);

  // Update row when suggestion changes (e.g., when borrowers data loads)
  useEffect(() => {
    if (suggestedBorrowerId && localRows[0] && !localRows[0].borrowerId) {
      setLocalRows(prev => prev.map((row, i) =>
        i === 0 ? { ...row, borrowerId: suggestedBorrowerId } : row
      ));
    }
  }, [suggestedBorrowerId, localRows]);

  // Update row
  const handleUpdateRow = useCallback((rowIndex, updates) => {
    setLocalRows(prev => prev.map((row, i) => {
      if (i !== rowIndex) return row;
      return { ...row, ...updates, isDirty: true };
    }));
  }, []);

  // Delete row (for multi-row support if needed)
  const handleDeleteRow = useCallback((rowIndex) => {
    setLocalRows(prev => prev.filter((_, i) => i !== rowIndex));
  }, []);

  // Add row (if multi-row needed)
  const handleAddRow = useCallback(() => {
    const newRow = {
      id: `temp-${uuidv4()}`,
      entryMode: 'manual',
      bankStatementId: null,
      date: bankEntry.statement_date,
      amount: 0,
      borrowerId: null,
      selectedLoanIds: [],
      allocations: {},
      reference: '',
      isDirty: true,
      isNew: true,
      rowOrder: localRows.length
    };
    setLocalRows(prev => [...prev, newRow]);
  }, [bankEntry.statement_date, localRows.length]);

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

      if (!row.borrowerId) {
        errors.push(`Row ${rowNum}: Select a borrower`);
        continue;
      }

      if (!row.selectedLoanIds || row.selectedLoanIds.length === 0) {
        errors.push(`Row ${rowNum}: Select at least one loan`);
        continue;
      }

      // Check allocation totals
      let totalAllocated = 0;
      for (const loanId of row.selectedLoanIds) {
        const alloc = row.allocations?.[loanId] || {};
        totalAllocated += (parseFloat(alloc.principal) || 0);
        totalAllocated += (parseFloat(alloc.interest) || 0);
        totalAllocated += (parseFloat(alloc.fees) || 0);
      }

      const receiptAmount = parseFloat(row.amount) || 0;
      if (Math.abs(totalAllocated - receiptAmount) >= 0.01) {
        errors.push(`Row ${rowNum}: Allocation (${formatCurrency(totalAllocated)}) doesn't match amount (${formatCurrency(receiptAmount)})`);
      }
    }

    return errors;
  }, [localRows]);

  // Calculate summary
  const summary = useMemo(() => {
    let totalAmount = 0;
    let completeCount = 0;
    let totalTransactions = 0;

    for (const row of localRows) {
      totalAmount += parseFloat(row.amount) || 0;

      const loanIds = row.selectedLoanIds || [];
      if (row.borrowerId && loanIds.length > 0) {
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
  }, [localRows]);

  // File receipts
  const handleFile = useCallback(async () => {
    const errors = validateForFiling();
    if (errors.length > 0) {
      toast.error(
        <div>
          <div className="font-medium">Cannot file receipt:</div>
          <ul className="mt-1 text-sm list-disc pl-4">
            {errors.slice(0, 3).map((e, i) => <li key={i}>{e}</li>)}
            {errors.length > 3 && <li>...and {errors.length - 3} more</li>}
          </ul>
        </div>
      );
      return;
    }

    setIsFiling(true);
    try {
      // Create transactions for each row
      for (const row of localRows) {
        const allocations = row.allocations || {};

        for (const loanId of row.selectedLoanIds) {
          const alloc = allocations[loanId] || {};
          const principal = parseFloat(alloc.principal) || 0;
          const interest = parseFloat(alloc.interest) || 0;
          const fees = parseFloat(alloc.fees) || 0;
          const totalAmount = principal + interest + fees;

          if (totalAmount <= 0) continue;

          // Get loan to get borrower_id
          const loan = activeLoans.find(l => l.id === loanId);
          if (!loan) continue;

          // Build reference from bank statement details
          const bankAmount = formatCurrency(Math.abs(parseFloat(bankEntry.amount) || 0));
          const desc = bankEntry.description || '';
          const txReference = `${bankAmount} ${desc}`.trim();

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

          // Create reconciliation entry to link bank statement to transaction
          if (row.bankStatementId) {
            await api.entities.ReconciliationEntry.create({
              bank_statement_id: row.bankStatementId,
              loan_transaction_id: newTransaction.id,
              amount: totalAmount,
              reconciliation_type: 'loan_repayment',
              notes: 'Created via bank reconciliation',
              was_created: true
            });
          }

          // Get borrower name for audit log
          const borrower = borrowers?.find(b => b.id === loan.borrower_id);
          const borrowerName = borrower?.name || null;

          // Audit log: transaction creation
          await logTransactionEvent(
            AuditAction.TRANSACTION_CREATE,
            { id: newTransaction.id, type: 'Repayment', amount: totalAmount, loan_id: loanId },
            { loan_number: loan.loan_number, borrower_name: borrowerName },
            {
              source: 'bank_reconciliation',
              principal_applied: principal,
              interest_applied: interest,
              fees_applied: fees,
              date: row.date,
              notes: alloc.description,
              borrower_id: loan.borrower_id,
              bank_statement_id: row.bankStatementId
            }
          );

          // Update loan paid amounts
          const previousPrincipalPaid = parseFloat(loan.principal_paid) || 0;
          const previousInterestPaid = parseFloat(loan.interest_paid) || 0;
          await api.entities.Loan.update(loanId, {
            principal_paid: previousPrincipalPaid + principal,
            interest_paid: previousInterestPaid + interest
          });

          // Regenerate schedule if principal was applied
          if (principal > 0) {
            await maybeRegenerateScheduleAfterCapitalChange(loanId, {
              type: 'Repayment',
              principal_applied: principal,
              date: row.date
            }, 'create');
          }
        }

        // Mark bank statement as reconciled
        if (row.bankStatementId) {
          await api.entities.BankStatement.update(row.bankStatementId, {
            is_reconciled: true,
            reconciled_at: new Date().toISOString()
          });
        }
      }

      toast.success('Receipt filed and reconciled');

      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      queryClient.invalidateQueries({ queryKey: ['bank-statements-unreconciled'] });
      queryClient.invalidateQueries({ queryKey: ['bank-statements-reconciled'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });

      onSuccess?.();
    } catch (error) {
      console.error('Error filing receipt:', error);
      toast.error('Failed to file receipt: ' + error.message);
    } finally {
      setIsFiling(false);
    }
  }, [localRows, validateForFiling, activeLoans, borrowers, bankEntry, queryClient, onSuccess]);

  return (
    <div className="rounded-lg bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b">
        <h4 className="font-medium text-sm">Loan Repayment - Multi-loan allocation</h4>
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 w-7 p-0">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Spreadsheet */}
      <div className="max-h-[300px] overflow-auto">
        <ReceiptsSpreadsheet
          rows={localRows}
          borrowers={borrowers}
          loans={activeLoans}
          lastPayments={lastPayments}
          schedules={schedules}
          bankEntries={[bankEntry]}
          onUpdateRow={handleUpdateRow}
          onDeleteRow={handleDeleteRow}
          onAddRow={handleAddRow}
          mode="standalone"
          hideBorrowerColumn={false}
          singleRowMode={true}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-t">
        <div className="text-sm text-slate-600">
          Bank: <span className="font-medium text-green-600">{formatCurrency(amount)}</span>
          {summary.allComplete && (
            <span className="ml-2 text-green-600">✓ Allocated</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={isFiling}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleFile}
            disabled={!summary.allComplete || isFiling}
          >
            {isFiling ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <FileText className="w-4 h-4 mr-1" />
            )}
            File Receipt
          </Button>
        </div>
      </div>
    </div>
  );
}
