/**
 * BankReconciliationV2 - Refactored bank reconciliation page
 *
 * Features:
 * - Import CSV bank statements
 * - Auto-match suggestions with confidence scores
 * - Accept/Dismiss workflow for suggestions
 * - Manual matching with multi-select support
 * - Reconciled archive with undo capability
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/dataClient';
import useReconciliation from '@/hooks/useReconciliation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload,
  Sparkles,
  FileQuestion,
  CheckCircle2,
  RefreshCw,
  Loader2,
  AlertCircle
} from 'lucide-react';

// Components
import ImportPanel from '@/components/reconciliation/ImportPanel';
import SuggestionsList from '@/components/reconciliation/SuggestionsList';
import UnmatchedList from '@/components/reconciliation/UnmatchedList';
import ReconciledArchive from '@/components/reconciliation/ReconciledArchive';
import SuggestionReviewDialog from '@/components/reconciliation/SuggestionReviewDialog';
import CreateTransactionDialog from '@/components/reconciliation/CreateTransactionDialog';
import ManualMatchDialog from '@/components/reconciliation/ManualMatchDialog';

export default function BankReconciliationV2() {
  const [activeTab, setActiveTab] = useState('suggestions');

  // Use the reconciliation hook
  const {
    // Data
    bankStatements,
    suggestedEntries,
    unmatchedEntries,
    reconciledEntries,
    dismissedEntries,
    suggestions,
    stats,
    isLoading,

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

    // Processing
    isProcessing
  } = useReconciliation();

  // Fetch additional data for transactions
  const { data: loanTransactions = [] } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api.entities.Transaction.list('-date')
  });

  const { data: investorTransactions = [] } = useQuery({
    queryKey: ['investor-transactions'],
    queryFn: () => api.entities.InvestorTransaction.list('-date')
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => api.entities.Expense.list('-date')
  });

  // Handle accept all high confidence
  const handleAcceptAllHighConfidence = useCallback(async () => {
    const highConfidence = suggestedEntries.filter(e => {
      const suggestion = suggestions.get(e.id);
      return suggestion && suggestion.confidence >= 0.9;
    });

    for (const entry of highConfidence) {
      try {
        await acceptSuggestion(entry.id);
      } catch (error) {
        console.error(`Error accepting suggestion for ${entry.id}:`, error);
        break; // Stop on first error
      }
    }
  }, [suggestedEntries, suggestions, acceptSuggestion]);

  // Get selected bank entries for manual match
  const selectedBankEntries = useMemo(() => {
    return unmatchedEntries.filter(e => selectedEntryIds.has(e.id));
  }, [unmatchedEntries, selectedEntryIds]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-3 text-slate-600">Loading reconciliation data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bank Reconciliation</h1>
          <p className="text-slate-500">Match bank statements to transactions</p>
        </div>

        {/* Stats Summary */}
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-sm py-1">
            <Sparkles className="w-4 h-4 mr-1 text-amber-500" />
            {stats.suggested} Suggestions
          </Badge>
          <Badge variant="outline" className="text-sm py-1">
            <FileQuestion className="w-4 h-4 mr-1 text-slate-500" />
            {stats.unmatched} Unmatched
          </Badge>
          <Badge variant="outline" className="text-sm py-1 bg-emerald-50 text-emerald-700 border-emerald-200">
            <CheckCircle2 className="w-4 h-4 mr-1" />
            {stats.reconciled} Reconciled
          </Badge>
        </div>
      </div>

      {/* No data message */}
      {stats.total === 0 && (
        <Alert>
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>
            No bank statements found. Import a CSV file to get started.
          </AlertDescription>
        </Alert>
      )}

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="import" className="gap-2">
            <Upload className="w-4 h-4" />
            Import
          </TabsTrigger>
          <TabsTrigger value="suggestions" className="gap-2">
            <Sparkles className="w-4 h-4" />
            Suggestions
            {stats.suggested > 0 && (
              <Badge variant="secondary" className="ml-1">{stats.suggested}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="unmatched" className="gap-2">
            <FileQuestion className="w-4 h-4" />
            Unmatched
            {stats.unmatched > 0 && (
              <Badge variant="secondary" className="ml-1">{stats.unmatched}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="reconciled" className="gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Reconciled
            {stats.reconciled > 0 && (
              <Badge variant="secondary" className="ml-1">{stats.reconciled}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Import Tab */}
        <TabsContent value="import" className="mt-6">
          <ImportPanel
            onImport={importStatements}
            isProcessing={isProcessing}
          />
        </TabsContent>

        {/* Suggestions Tab */}
        <TabsContent value="suggestions" className="mt-6">
          <SuggestionsList
            entries={suggestedEntries}
            suggestions={suggestions}
            onAccept={(id) => {
              const entry = suggestedEntries.find(e => e.id === id);
              openReviewDialog(entry);
            }}
            onDismiss={dismissSuggestion}
            onViewDetails={openReviewDialog}
            onAcceptAllHighConfidence={handleAcceptAllHighConfidence}
            isProcessing={isProcessing}
          />
        </TabsContent>

        {/* Unmatched Tab */}
        <TabsContent value="unmatched" className="mt-6">
          <UnmatchedList
            unmatchedEntries={unmatchedEntries}
            dismissedEntries={dismissedEntries}
            suggestions={suggestions}
            selectedIds={selectedEntryIds}
            onToggleSelect={toggleEntrySelection}
            onSelectAll={selectAllUnmatched}
            onClearSelection={clearSelection}
            onCreateNew={openCreateDialog}
            onManualMatch={openManualMatchDialog}
            onDelete={deleteEntries}
            onRestore={restoreSuggestion}
            isProcessing={isProcessing}
          />
        </TabsContent>

        {/* Reconciled Tab */}
        <TabsContent value="reconciled" className="mt-6">
          <ReconciledArchive
            entries={reconciledEntries}
            reconciliationEntries={reconciliationEntries}
            onUnreconcile={unreconcileEntry}
            isProcessing={isProcessing}
          />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}

      {/* Review Suggestion Dialog */}
      <SuggestionReviewDialog
        open={activeDialog === 'review'}
        onClose={closeDialog}
        entry={dialogEntry}
        suggestion={dialogSuggestion}
        onAccept={acceptSuggestion}
        onDismiss={dismissSuggestion}
        isProcessing={isProcessing}
      />

      {/* Create Transaction Dialog */}
      <CreateTransactionDialog
        open={activeDialog === 'create'}
        onClose={closeDialog}
        entry={dialogEntry}
        suggestion={dialogSuggestion}
        loans={loans}
        borrowers={borrowers}
        investors={investors}
        expenseTypes={expenseTypes}
        onCreate={createTransaction}
        isProcessing={isProcessing}
      />

      {/* Manual Match Dialog */}
      <ManualMatchDialog
        open={activeDialog === 'manual-match'}
        onClose={closeDialog}
        selectedBankEntries={selectedBankEntries}
        loanTransactions={loanTransactions.filter(t => !t.is_deleted)}
        investorTransactions={investorTransactions}
        expenses={expenses}
        loans={loans}
        borrowers={borrowers}
        investors={investors}
        onMatch={manualMatch}
        isProcessing={isProcessing}
      />
    </div>
  );
}
