/**
 * useReconciliation Hook
 *
 * Main state management hook for the bank reconciliation tool.
 * Manages bank entries, suggestions, selections, and dialog state.
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/dataClient';
import { generateAllSuggestions } from '@/lib/reconciliation/matchers';
import { parseBankStatement, detectBankFormat, parseCSV } from '@/lib/bankStatementParsers';
import {
  executeReconciliation,
  createLoanRepayment,
  createLoanDisbursement,
  createInvestorCredit,
  createInvestorWithdrawal,
  createExpense,
  unreconcile,
  executeManualMatch
} from '@/lib/reconciliation/reconcileHandler';

/**
 * Hook for managing bank reconciliation state and operations
 */
export function useReconciliation() {
  const queryClient = useQueryClient();

  // ==================== Data Queries ====================

  // Bank statements
  const { data: bankStatements = [], isLoading: statementsLoading } = useQuery({
    queryKey: ['bank-statements'],
    queryFn: () => api.entities.BankStatement.list('-statement_date')
  });

  // Loans and borrowers
  const { data: loans = [] } = useQuery({
    queryKey: ['loans'],
    queryFn: () => api.entities.Loan.list('-created_at')
  });

  const { data: borrowers = [] } = useQuery({
    queryKey: ['borrowers'],
    queryFn: () => api.entities.Borrower.list('full_name')
  });

  // Loan transactions
  const { data: loanTransactions = [] } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api.entities.Transaction.listAll('-date')
  });

  // Investors
  const { data: investors = [] } = useQuery({
    queryKey: ['investors'],
    queryFn: () => api.entities.Investor.list('name')
  });

  // Investor transactions
  const { data: investorTransactions = [] } = useQuery({
    queryKey: ['investor-transactions'],
    queryFn: () => api.entities.InvestorTransaction.list('-date')
  });

  // Investor interest entries
  const { data: investorInterestEntries = [] } = useQuery({
    queryKey: ['investor-interest'],
    queryFn: () => api.entities.InvestorInterest.list('-date')
  });

  // Investor products
  const { data: investorProducts = [] } = useQuery({
    queryKey: ['investor-products'],
    queryFn: () => api.entities.InvestorProduct.list('name')
  });

  // Expenses
  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => api.entities.Expense.list('-date')
  });

  // Expense types
  const { data: expenseTypes = [] } = useQuery({
    queryKey: ['expense-types'],
    queryFn: () => api.entities.ExpenseType.list('name')
  });

  // Reconciliation patterns
  const { data: patterns = [] } = useQuery({
    queryKey: ['reconciliation-patterns'],
    queryFn: () => api.entities.ReconciliationPattern.list('-match_count')
  });

  // Reconciliation entries
  const { data: reconciliationEntries = [] } = useQuery({
    queryKey: ['reconciliation-entries'],
    queryFn: () => api.entities.ReconciliationEntry.listAll('-id')
  });

  // ==================== Local State ====================

  // Dismissed suggestions (can be undone)
  const [dismissedIds, setDismissedIds] = useState(new Set());

  // Selection state for manual matching
  const [selectedEntryIds, setSelectedEntryIds] = useState(new Set());

  // Dialog state
  const [activeDialog, setActiveDialog] = useState(null); // 'review' | 'create' | 'manual-match'
  const [dialogEntry, setDialogEntry] = useState(null);
  const [dialogSuggestion, setDialogSuggestion] = useState(null);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);

  // ==================== Derived Data ====================

  // Build set of already reconciled transaction IDs
  const reconciledTxIds = useMemo(() => {
    const ids = new Set();
    for (const entry of reconciliationEntries) {
      if (entry.loan_transaction_id) ids.add(entry.loan_transaction_id);
      if (entry.investor_transaction_id) ids.add(entry.investor_transaction_id);
      if (entry.expense_id) ids.add(entry.expense_id);
      if (entry.interest_id) ids.add(entry.interest_id);
    }
    return ids;
  }, [reconciliationEntries]);

  // Build set of bank statement IDs that have reconciliation entries
  // This handles cases where is_reconciled flag might be out of sync
  const reconciledBankStatementIds = useMemo(() => {
    const ids = new Set();
    for (const entry of reconciliationEntries) {
      if (entry.bank_statement_id) ids.add(entry.bank_statement_id);
    }
    return ids;
  }, [reconciliationEntries]);

  // Generate suggestions for all unreconciled entries
  const suggestions = useMemo(() => {
    if (!bankStatements.length) return new Map();

    const context = {
      loanTransactions,
      loans,
      borrowers,
      investorTransactions,
      investors,
      investorInterestEntries,
      expenses,
      patterns,
      reconciledTxIds
    };

    return generateAllSuggestions(bankStatements, context);
  }, [
    bankStatements,
    loanTransactions,
    loans,
    borrowers,
    investorTransactions,
    investors,
    investorInterestEntries,
    expenses,
    patterns,
    reconciledTxIds
  ]);

  // Entries with MATCH suggestions (existing tx, not create mode, not dismissed)
  const suggestedEntries = useMemo(() => {
    // Check if entry is reconciled (either by flag OR has reconciliation entry)
    const isReconciled = (e) => e.is_reconciled || reconciledBankStatementIds.has(e.id);

    return bankStatements.filter(e => {
      if (isReconciled(e)) return false;
      if (dismissedIds.has(e.id)) return false;
      const suggestion = suggestions.get(e.id);
      // Only include if suggestion exists AND is a match (not create)
      return suggestion && suggestion.matchMode !== 'create';
    });
  }, [bankStatements, suggestions, dismissedIds, reconciledBankStatementIds]);

  // Unmatched: no suggestion OR create-mode suggestion OR dismissed
  const unmatchedEntries = useMemo(() => {
    // Check if entry is reconciled (either by flag OR has reconciliation entry)
    const isReconciled = (e) => e.is_reconciled || reconciledBankStatementIds.has(e.id);

    return bankStatements.filter(e => {
      if (isReconciled(e)) return false;
      if (dismissedIds.has(e.id)) return true; // Dismissed goes to unmatched
      const suggestion = suggestions.get(e.id);
      // Include if no suggestion OR create-mode suggestion
      return !suggestion || suggestion.matchMode === 'create';
    });
  }, [bankStatements, suggestions, dismissedIds, reconciledBankStatementIds]);

  // Reconciled entries (either by flag OR has reconciliation entry)
  const reconciledEntries = useMemo(() => {
    return bankStatements.filter(e =>
      e.is_reconciled || reconciledBankStatementIds.has(e.id)
    );
  }, [bankStatements, reconciledBankStatementIds]);

  // Dismissed entries (with their original suggestions)
  const dismissedEntries = useMemo(() => {
    // Check if entry is reconciled (either by flag OR has reconciliation entry)
    const isReconciled = (e) => e.is_reconciled || reconciledBankStatementIds.has(e.id);

    return bankStatements.filter(e =>
      !isReconciled(e) &&
      dismissedIds.has(e.id) &&
      suggestions.has(e.id)
    );
  }, [bankStatements, dismissedIds, suggestions, reconciledBankStatementIds]);

  // Stats
  const stats = useMemo(() => ({
    total: bankStatements.length,
    unreconciled: bankStatements.filter(e => !e.is_reconciled).length,
    suggested: suggestedEntries.length,
    unmatched: unmatchedEntries.length,
    dismissed: dismissedEntries.length,
    reconciled: reconciledEntries.length
  }), [bankStatements, suggestedEntries, unmatchedEntries, dismissedEntries, reconciledEntries]);

  // ==================== Actions ====================

  /**
   * Accept a suggestion and reconcile
   */
  const acceptSuggestion = useCallback(async (entryId) => {
    const entry = bankStatements.find(e => e.id === entryId);
    const suggestion = suggestions.get(entryId);
    if (!entry || !suggestion) return;

    setIsProcessing(true);
    try {
      await executeReconciliation({ bankEntry: entry, suggestion });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });

      // Clear dismissed state
      setDismissedIds(prev => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });

      // Close dialog
      setActiveDialog(null);
      setDialogEntry(null);
      setDialogSuggestion(null);
    } catch (error) {
      console.error('Error accepting suggestion:', error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [bankStatements, suggestions, queryClient]);

  /**
   * Dismiss a suggestion (move to unmatched)
   */
  const dismissSuggestion = useCallback((entryId) => {
    setDismissedIds(prev => {
      const next = new Set(prev);
      next.add(entryId);
      return next;
    });

    // Close dialog if open
    if (dialogEntry?.id === entryId) {
      setActiveDialog(null);
      setDialogEntry(null);
      setDialogSuggestion(null);
    }
  }, [dialogEntry]);

  /**
   * Restore a dismissed suggestion
   */
  const restoreSuggestion = useCallback((entryId) => {
    setDismissedIds(prev => {
      const next = new Set(prev);
      next.delete(entryId);
      return next;
    });
  }, []);

  /**
   * Create a new transaction and reconcile
   */
  const createTransaction = useCallback(async (entryId, { type, loan, investor, expenseType, split, description }) => {
    const entry = bankStatements.find(e => e.id === entryId);
    if (!entry) return;

    setIsProcessing(true);
    try {
      switch (type) {
        case 'loan_repayment':
          await createLoanRepayment({ bankEntry: entry, loan, split });
          break;
        case 'loan_disbursement':
          await createLoanDisbursement({ bankEntry: entry, loan });
          break;
        case 'investor_credit':
          await createInvestorCredit({ bankEntry: entry, investor });
          break;
        case 'investor_withdrawal': {
          const investorProduct = investorProducts.find(p => p.id === investor.product_id);
          await createInvestorWithdrawal({ bankEntry: entry, investor, split, investorProduct });
          break;
        }
        case 'expense':
          await createExpense({ bankEntry: entry, expenseType, description });
          break;
        default:
          throw new Error(`Unknown transaction type: ${type}`);
      }

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });

      // Clear state
      setDismissedIds(prev => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
      setActiveDialog(null);
      setDialogEntry(null);
    } catch (error) {
      console.error('Error creating transaction:', error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [bankStatements, investorProducts, queryClient]);

  /**
   * Manual match selected entries to targets
   */
  const manualMatch = useCallback(async (targetTransactions, matchType, relationshipType) => {
    if (selectedEntryIds.size === 0) return;

    // Get the actual bank entries (with amounts) for validation
    const selectedBankEntries = bankStatements.filter(e => selectedEntryIds.has(e.id));

    setIsProcessing(true);
    try {
      await executeManualMatch({
        bankEntryIds: Array.from(selectedEntryIds),
        bankEntries: selectedBankEntries,
        targetTransactions,
        matchType,
        relationshipType
      });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });

      // Clear selection
      setSelectedEntryIds(new Set());
      setActiveDialog(null);
    } catch (error) {
      console.error('Error in manual match:', error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [selectedEntryIds, bankStatements, queryClient]);

  /**
   * Un-reconcile an entry
   */
  const unreconcileEntry = useCallback(async (entryId, deleteCreated = true) => {
    const entries = reconciliationEntries.filter(e => e.bank_statement_id === entryId);
    if (entries.length === 0) return;

    setIsProcessing(true);
    try {
      await unreconcile({
        bankEntryId: entryId,
        reconciliationEntries: entries,
        deleteCreatedTransactions: deleteCreated
      });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    } catch (error) {
      console.error('Error un-reconciling:', error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [reconciliationEntries, queryClient]);

  /**
   * Delete bank entries
   */
  const deleteEntries = useCallback(async (entryIds) => {
    setIsProcessing(true);
    try {
      for (const id of entryIds) {
        await api.entities.BankStatement.delete(id);
      }

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });

      // Clear selection
      setSelectedEntryIds(new Set());
    } catch (error) {
      console.error('Error deleting entries:', error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [queryClient]);

  /**
   * Import bank statements from CSV
   */
  const importStatements = useCallback(async (csvText, bankSource) => {
    console.log('[importStatements] Starting import, bankSource:', bankSource);

    // Auto-detect bank format if not specified
    let detectedSource = bankSource;
    if (!detectedSource) {
      const rows = parseCSV(csvText);
      console.log('[importStatements] Auto-detect: parsed rows:', rows.length);
      if (rows.length > 0) {
        const headers = Object.keys(rows[0]);
        console.log('[importStatements] Auto-detect: headers:', headers);
        detectedSource = detectBankFormat(headers);
        console.log('[importStatements] Auto-detect: detected source:', detectedSource);
      }
    }

    if (!detectedSource) {
      throw new Error('Could not detect bank format. Please select a bank.');
    }

    // Parse the CSV
    const { entries, errors } = parseBankStatement(csvText, detectedSource);
    console.log('[importStatements] Parsed entries:', entries.length, 'errors:', errors.length);

    if (errors.length > 0) {
      console.warn('Import warnings:', errors);
    }

    if (entries.length === 0) {
      throw new Error('No valid entries found in CSV');
    }

    // Check for duplicates
    const existingRefs = new Set(bankStatements.map(s => s.external_reference).filter(Boolean));
    console.log('[importStatements] Existing references in DB:', existingRefs.size);
    console.log('[importStatements] Sample existing refs:', Array.from(existingRefs).slice(0, 5));

    const newEntries = entries.filter(e => {
      const isDupe = existingRefs.has(e.external_reference);
      if (isDupe) {
        console.log('[importStatements] DUPLICATE:', e.external_reference);
      }
      return !isDupe;
    });
    console.log('[importStatements] New entries after duplicate check:', newEntries.length);

    // Log first few new entry references for debugging
    if (newEntries.length > 0) {
      console.log('[importStatements] Sample new refs:', newEntries.slice(0, 5).map(e => e.external_reference));
    }

    if (newEntries.length === 0) {
      throw new Error('All entries already exist (duplicates detected)');
    }

    // Import new entries
    setIsProcessing(true);
    try {
      for (const entry of newEntries) {
        await api.entities.BankStatement.create({
          ...entry,
          bank_source: detectedSource
        });
      }

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });

      return {
        imported: newEntries.length,
        skipped: entries.length - newEntries.length,
        errors
      };
    } catch (error) {
      console.error('Error importing statements:', error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [bankStatements, queryClient]);

  // ==================== Dialog Helpers ====================

  const openReviewDialog = useCallback((entry) => {
    setDialogEntry(entry);
    setDialogSuggestion(suggestions.get(entry.id));
    setActiveDialog('review');
  }, [suggestions]);

  const openCreateDialog = useCallback((entry) => {
    setDialogEntry(entry);
    setDialogSuggestion(suggestions.get(entry.id) || null);
    setActiveDialog('create');
  }, [suggestions]);

  const openManualMatchDialog = useCallback(() => {
    setActiveDialog('manual-match');
  }, []);

  const closeDialog = useCallback(() => {
    setActiveDialog(null);
    setDialogEntry(null);
    setDialogSuggestion(null);
  }, []);

  // ==================== Selection Helpers ====================

  const toggleEntrySelection = useCallback((entryId) => {
    setSelectedEntryIds(prev => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }, []);

  const selectAllUnmatched = useCallback(() => {
    setSelectedEntryIds(new Set(unmatchedEntries.map(e => e.id)));
  }, [unmatchedEntries]);

  const clearSelection = useCallback(() => {
    setSelectedEntryIds(new Set());
  }, []);

  // ==================== Return ====================

  return {
    // Data
    bankStatements,
    suggestedEntries,
    unmatchedEntries,
    reconciledEntries,
    dismissedEntries,
    suggestions,
    stats,
    isLoading: statementsLoading,

    // Reference data
    loans,
    borrowers,
    investors,
    investorProducts,
    expenseTypes,
    reconciliationEntries,

    // Selection
    selectedEntryIds,
    toggleEntrySelection,
    selectAllUnmatched,
    clearSelection,

    // Dialog state
    activeDialog,
    dialogEntry,
    dialogSuggestion,
    openReviewDialog,
    openCreateDialog,
    openManualMatchDialog,
    closeDialog,

    // Actions
    acceptSuggestion,
    dismissSuggestion,
    restoreSuggestion,
    createTransaction,
    manualMatch,
    unreconcileEntry,
    deleteEntries,
    importStatements,

    // Processing state
    isProcessing
  };
}

export default useReconciliation;
