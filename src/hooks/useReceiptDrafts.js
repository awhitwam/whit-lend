import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/dataClient';
import { v4 as uuidv4 } from 'uuid';
import { logTransactionEvent, logLoanEvent, AuditAction } from '@/lib/auditLog';

/**
 * Hook for managing receipt drafts
 * Provides CRUD operations, auto-save, and filing functionality
 */
export function useReceiptDrafts() {
  const queryClient = useQueryClient();

  // Load all draft receipts
  const {
    data: drafts = [],
    isLoading,
    error
  } = useQuery({
    queryKey: ['receipt-drafts'],
    queryFn: () => api.entities.ReceiptDraft.filter({ status: 'draft' }, 'row_order')
  });

  // Create a new empty draft row
  const createEmptyRow = useCallback((rowOrder = 0) => {
    return {
      id: `temp-${uuidv4()}`,
      entryMode: 'manual',
      bankStatementId: null,
      date: new Date().toISOString().split('T')[0],
      amount: 0,
      borrowerId: null,
      selectedLoanIds: [],
      allocations: {},
      reference: '',
      isDirty: false,
      isNew: true,
      rowOrder
    };
  }, []);

  // Save draft mutation
  const saveDraftMutation = useMutation({
    mutationFn: async (draft) => {
      const isNew = draft.id?.startsWith('temp-') || draft.isNew;

      const data = {
        entry_mode: draft.entryMode,
        bank_statement_id: draft.bankStatementId || null,
        receipt_date: draft.date,
        receipt_amount: draft.amount || 0,
        reference: draft.reference || null,
        borrower_id: draft.borrowerId || null,
        selected_loan_ids: draft.selectedLoanIds || [],
        allocations: draft.allocations || {},
        row_order: draft.rowOrder,
        status: 'draft'
      };

      if (isNew) {
        return api.entities.ReceiptDraft.create(data);
      } else {
        return api.entities.ReceiptDraft.update(draft.id, data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipt-drafts'] });
    }
  });

  // Delete draft mutation
  const deleteDraftMutation = useMutation({
    mutationFn: async (draftId) => {
      if (draftId?.startsWith('temp-')) {
        // Local-only draft, nothing to delete from server
        return true;
      }
      return api.entities.ReceiptDraft.delete(draftId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipt-drafts'] });
    }
  });

  // File receipts mutation (creates actual transactions)
  const fileReceiptsMutation = useMutation({
    mutationFn: async (draftIds) => {
      const results = [];

      for (const draftId of draftIds) {
        // Skip temp drafts that haven't been saved
        if (draftId?.startsWith('temp-')) continue;

        // Get the draft
        const [draft] = await api.entities.ReceiptDraft.filter({ id: draftId });
        if (!draft || draft.status !== 'draft') continue;

        const allocations = draft.allocations || {};
        const transactionIds = [];

        // Get bank statement details if linked
        let bankEntry = null;
        if (draft.bank_statement_id) {
          const [entry] = await api.entities.BankStatement.filter({ id: draft.bank_statement_id });
          bankEntry = entry;
        }

        // Create transaction for each loan allocation
        for (const [loanId, allocation] of Object.entries(allocations)) {
          const principal = parseFloat(allocation.principal) || 0;
          const interest = parseFloat(allocation.interest) || 0;
          const fees = parseFloat(allocation.fees) || 0;
          const totalAmount = principal + interest + fees;

          if (totalAmount <= 0) continue;

          // Get loan to get borrower_id
          const [loan] = await api.entities.Loan.filter({ id: loanId });
          if (!loan) continue;

          // Build reference from bank statement details if available (amount + description)
          let txReference = draft.reference;
          if (bankEntry) {
            const amount = Math.abs(parseFloat(bankEntry.amount) || 0).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
            const desc = bankEntry.description || '';
            txReference = `${amount} ${desc}`.trim() || draft.reference;
          }

          // Create the transaction
          const transaction = await api.entities.Transaction.create({
            loan_id: loanId,
            borrower_id: loan.borrower_id,
            amount: totalAmount,
            date: draft.receipt_date,
            type: 'Repayment',
            principal_applied: principal,
            interest_applied: interest,
            fees_applied: fees,
            reference: txReference || null,
            notes: allocation.description || null
          });

          // Audit log: transaction creation
          await logTransactionEvent(
            AuditAction.TRANSACTION_CREATE,
            { id: transaction.id, type: 'Repayment', amount: totalAmount, loan_id: loanId },
            { loan_number: loan.loan_number },
            {
              source: 'receipt_draft_filing',
              draft_id: draftId,
              principal_applied: principal,
              interest_applied: interest,
              fees_applied: fees,
              date: draft.receipt_date,
              notes: allocation.description,
              borrower_id: loan.borrower_id
            }
          );

          transactionIds.push(transaction.id);

          // If linked to bank statement, create reconciliation entry
          if (draft.bank_statement_id) {
            await api.entities.ReconciliationEntry.create({
              bank_statement_id: draft.bank_statement_id,
              loan_transaction_id: transaction.id,
              amount: totalAmount,
              reconciliation_type: 'loan_repayment'
            });
          }

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
              source: 'receipt_draft_filing',
              principal_paid: previousPrincipalPaid + principal,
              interest_paid: previousInterestPaid + interest
            },
            {
              principal_paid: previousPrincipalPaid,
              interest_paid: previousInterestPaid
            }
          );
        }

        // Mark bank statement as reconciled if linked
        if (draft.bank_statement_id) {
          await api.entities.BankStatement.update(draft.bank_statement_id, {
            is_reconciled: true,
            reconciled_at: new Date().toISOString()
          });
        }

        // Mark draft as filed
        await api.entities.ReceiptDraft.update(draftId, {
          status: 'filed',
          filed_at: new Date().toISOString()
        });

        results.push({ draftId, transactionIds });
      }

      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipt-drafts'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
    }
  });

  // Convert database drafts to row format
  const rows = useMemo(() => {
    return drafts.map(draft => ({
      id: draft.id,
      entryMode: draft.entry_mode,
      bankStatementId: draft.bank_statement_id,
      date: draft.receipt_date,
      amount: parseFloat(draft.receipt_amount) || 0,
      borrowerId: draft.borrower_id,
      selectedLoanIds: draft.selected_loan_ids || [],
      allocations: draft.allocations || {},
      reference: draft.reference,
      rowOrder: draft.row_order,
      isDirty: false,
      isNew: false
    }));
  }, [drafts]);

  return {
    rows,
    isLoading,
    error,
    createEmptyRow,
    saveDraft: saveDraftMutation.mutate,
    saveDraftAsync: saveDraftMutation.mutateAsync,
    isSaving: saveDraftMutation.isPending,
    deleteDraft: deleteDraftMutation.mutate,
    deleteDraftAsync: deleteDraftMutation.mutateAsync,
    isDeleting: deleteDraftMutation.isPending,
    fileReceipts: fileReceiptsMutation.mutate,
    fileReceiptsAsync: fileReceiptsMutation.mutateAsync,
    isFiling: fileReceiptsMutation.isPending
  };
}

export default useReceiptDrafts;
