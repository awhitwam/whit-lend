/**
 * Simplified Bank Reconciliation Page
 *
 * Two-tab layout:
 * - Receipts (Credits): Loan repayments, investor deposits, other income
 * - Expenditure (Debits): Loan disbursements, investor withdrawals, expenses
 *
 * Each bank entry shows inline suggestions and expandable "create new" forms.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/dataClient';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
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
import { Loader2, Upload, ArrowDownCircle, ArrowUpCircle, RefreshCw, FileText, CheckCircle2, AlertCircle, History, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { parseBankStatement, getBankSources, parseCSV, detectBankFormat } from '@/lib/bankStatementParsers';
import { toast } from 'sonner';
import ReceiptsPanel from '@/components/reconciliation-simple/ReceiptsPanel';
import ExpenditurePanel from '@/components/reconciliation-simple/ExpenditurePanel';
import ReconciledPanel from '@/components/reconciliation-simple/ReconciledPanel';

export default function BankReconciliationSimple() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('receipts');
  const [showImport, setShowImport] = useState(false);
  const [selectedBank, setSelectedBank] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const bankSources = getBankSources();

  // Load bank statements (unreconciled only)
  const { data: bankStatements = [], isLoading: loadingBank } = useQuery({
    queryKey: ['bank-statements-unreconciled'],
    queryFn: () => api.entities.BankStatement.filter({ is_reconciled: false }, '-statement_date')
  });

  // Load reconciled bank statements
  const { data: reconciledStatements = [], isLoading: loadingReconciled } = useQuery({
    queryKey: ['bank-statements-reconciled'],
    queryFn: () => api.entities.BankStatement.filter({ is_reconciled: true }, '-reconciled_at')
  });

  // Load loans for matching
  const { data: loans = [], isLoading: loadingLoans } = useQuery({
    queryKey: ['loans'],
    queryFn: () => api.entities.Loan.list('-created_at')
  });

  // Load borrowers for display
  const { data: borrowers = [], isLoading: loadingBorrowers } = useQuery({
    queryKey: ['borrowers'],
    queryFn: () => api.entities.Borrower.list()
  });

  // Load investors for matching
  const { data: investors = [], isLoading: loadingInvestors } = useQuery({
    queryKey: ['investors'],
    queryFn: () => api.entities.Investor.list()
  });

  // Load transactions for matching
  const { data: transactions = [], isLoading: loadingTx } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api.entities.Transaction.list('-date')
  });

  // Load investor transactions for matching
  const { data: investorTransactions = [], isLoading: loadingInvTx } = useQuery({
    queryKey: ['investor-transactions'],
    queryFn: () => api.entities.InvestorTransaction.list('-date')
  });

  // Load expenses for matching
  const { data: expenses = [], isLoading: loadingExpenses } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => api.entities.Expense.list('-date')
  });

  // Load expense types for creating new expenses
  const { data: expenseTypes = [] } = useQuery({
    queryKey: ['expense-types'],
    queryFn: () => api.entities.ExpenseType.list('name')
  });

  // Load reconciliation entries for linking display
  const { data: reconciliationEntries = [] } = useQuery({
    queryKey: ['reconciliation-entries'],
    queryFn: () => api.entities.ReconciliationEntry.list()
  });

  // Load other income for linking display
  const { data: otherIncome = [] } = useQuery({
    queryKey: ['other-income'],
    queryFn: () => api.entities.OtherIncome.list('-date')
  });

  // Load investor interest entries for matching withdrawals
  const { data: investorInterestEntries = [] } = useQuery({
    queryKey: ['investor-interest'],
    queryFn: () => api.entities.InvestorInterest.list('-date')
  });

  // Split bank statements into credits (receipts) and debits (expenditure)
  const { credits, debits } = useMemo(() => {
    const credits = bankStatements.filter(e => e.amount > 0);
    const debits = bankStatements.filter(e => e.amount < 0);
    return { credits, debits };
  }, [bankStatements]);

  // Calculate summary stats
  const stats = useMemo(() => ({
    totalCredits: credits.reduce((sum, e) => sum + Math.abs(e.amount), 0),
    totalDebits: debits.reduce((sum, e) => sum + Math.abs(e.amount), 0),
    creditCount: credits.length,
    debitCount: debits.length
  }), [credits, debits]);

  const isLoading = loadingBank || loadingLoans || loadingBorrowers || loadingInvestors ||
                    loadingTx || loadingInvTx || loadingExpenses || loadingReconciled;

  // Clean up orphaned ReconciliationEntry records on page load
  // These can occur if un-reconcile was called before the fix that properly deletes them
  useEffect(() => {
    const cleanupOrphanedReconciliationEntries = async () => {
      if (reconciliationEntries.length === 0 || bankStatements.length === 0) return;

      // Build set of unreconciled bank statement IDs
      const unreconciledBankStatementIds = new Set(bankStatements.map(s => s.id));

      // Find ReconciliationEntry records that point to unreconciled bank statements
      const orphanedEntries = reconciliationEntries.filter(re =>
        unreconciledBankStatementIds.has(re.bank_statement_id)
      );

      if (orphanedEntries.length > 0) {
        console.log(`[Cleanup] Found ${orphanedEntries.length} orphaned ReconciliationEntry records, deleting...`);
        try {
          for (const entry of orphanedEntries) {
            await api.entities.ReconciliationEntry.delete(entry.id);
          }
          console.log(`[Cleanup] Deleted ${orphanedEntries.length} orphaned records`);
          // Refresh the reconciliation entries
          queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
        } catch (error) {
          console.error('[Cleanup] Error deleting orphaned entries:', error);
        }
      }
    };

    cleanupOrphanedReconciliationEntries();
  }, [reconciliationEntries, bankStatements, queryClient]);

  // Refresh all data
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['bank-statements-unreconciled'] });
    queryClient.invalidateQueries({ queryKey: ['bank-statements-reconciled'] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });
    queryClient.invalidateQueries({ queryKey: ['investor-interest'] });
    queryClient.invalidateQueries({ queryKey: ['expenses'] });
    queryClient.invalidateQueries({ queryKey: ['loans'] });
    queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
    queryClient.invalidateQueries({ queryKey: ['other-income'] });
  };

  // Handle file import
  const handleImport = useCallback(async (file) => {
    if (!file) return;

    setIsImporting(true);
    setImportResult(null);

    try {
      const text = await file.text();

      // Auto-detect bank format if not selected
      let bankSource = selectedBank;
      if (!bankSource) {
        const rows = parseCSV(text);
        if (rows.length > 0) {
          const headers = Object.keys(rows[0]);
          bankSource = detectBankFormat(headers);
        }
      }

      if (!bankSource) {
        toast.error('Could not detect bank format. Please select a bank source.');
        setIsImporting(false);
        return;
      }

      const { entries, errors } = parseBankStatement(text, bankSource);

      if (entries.length === 0) {
        toast.error(errors.length > 0 ? 'Failed to parse file: ' + errors[0] : 'No valid entries found in CSV');
        setIsImporting(false);
        return;
      }

      // Combine all existing bank statements (both reconciled and unreconciled)
      const allExistingStatements = [...bankStatements, ...reconciledStatements];

      // Check for duplicates using hybrid lookup:
      // 1. Match by external_reference (primary)
      // 2. Match by date + amount + description (fallback for old format references)
      const existingRefs = new Set(allExistingStatements.map(s => s.external_reference).filter(Boolean));

      // Build composite keys for fallback matching (date|amount)
      const existingCompositeKeys = new Set(
        allExistingStatements.map(s => {
          const date = s.statement_date || '';
          const amount = Math.round((parseFloat(s.amount) || 0) * 100);
          return `${date}|${amount}`;
        })
      );

      // Build map for detailed matching (date+amount -> array of descriptions)
      const existingByDateAmount = new Map();
      allExistingStatements.forEach(s => {
        const date = s.statement_date || '';
        const amount = Math.round((parseFloat(s.amount) || 0) * 100);
        const key = `${date}|${amount}`;
        if (!existingByDateAmount.has(key)) {
          existingByDateAmount.set(key, []);
        }
        existingByDateAmount.get(key).push((s.description || '').toLowerCase().trim());
      });

      const newEntries = entries.filter(e => {
        // Check by external_reference first
        if (existingRefs.has(e.external_reference)) {
          return false;
        }

        // Fallback: check by date + amount + description
        // This catches duplicates when reference format changed
        const date = e.statement_date;
        const amount = Math.round((parseFloat(e.amount) || 0) * 100);
        const compositeKey = `${date}|${amount}`;
        const newDesc = (e.description || '').toLowerCase().trim();

        if (existingCompositeKeys.has(compositeKey)) {
          const existingDescs = existingByDateAmount.get(compositeKey) || [];
          const descMatch = existingDescs.some(existingDesc => {
            if (existingDesc === newDesc) return true;
            if (existingDesc.includes(newDesc) || newDesc.includes(existingDesc)) return true;
            if (existingDesc.slice(0, 20) === newDesc.slice(0, 20) && existingDesc.length > 10) return true;
            return false;
          });
          if (descMatch) {
            return false;
          }
        }

        return true;
      });

      const duplicates = entries.length - newEntries.length;

      if (newEntries.length === 0) {
        setImportResult({ created: 0, duplicates, skipped: 0, errors: errors?.length || 0 });
        toast.info(duplicates > 0 ? `All ${duplicates} entries already exist in the system` : 'No new entries to import');
        setIsImporting(false);
        return;
      }

      // Create all new entries in batch
      const entriesToCreate = newEntries.map(e => ({
        ...e,
        bank_source: bankSource,
        is_reconciled: false
      }));

      await api.entities.BankStatement.createMany(entriesToCreate);

      setImportResult({ created: newEntries.length, duplicates, skipped: 0, errors: errors?.length || 0 });
      toast.success(`Imported ${newEntries.length} bank entries${duplicates > 0 ? ` (${duplicates} duplicates skipped)` : ''}`);
      handleRefresh();

    } catch (err) {
      console.error('Import error:', err);
      toast.error('Failed to import: ' + err.message);
    } finally {
      setIsImporting(false);
    }
  }, [selectedBank, bankStatements, reconciledStatements]);

  // Handle file drop
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (file && file.name.toLowerCase().endsWith('.csv')) {
      handleImport(file);
    } else {
      toast.error('Please upload a CSV file');
    }
  }, [handleImport]);

  // Handle file select
  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImport(file);
    }
  }, [handleImport]);

  // Close import dialog
  const closeImportDialog = () => {
    setShowImport(false);
    setImportResult(null);
    setSelectedBank('');
  };

  // Delete all unreconciled bank statement entries
  const handleDeleteAllUnreconciled = async () => {
    setIsDeleting(true);
    try {
      let deleted = 0;

      for (const entry of bankStatements) {
        // Delete any reconciliation entries just in case
        await api.entities.ReconciliationEntry.deleteWhere({ bank_statement_id: entry.id });
        // Delete the bank statement entry
        await api.entities.BankStatement.delete(entry.id);
        deleted++;
      }

      queryClient.invalidateQueries({ queryKey: ['bank-statements-unreconciled'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });

      setShowDeleteDialog(false);
      toast.success(`Deleted ${deleted} unreconciled entries`);
    } catch (error) {
      console.error('Error deleting entries:', error);
      toast.error(`Error deleting entries: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bank Reconciliation</h1>
          <p className="text-sm text-slate-500 mt-1">
            Match bank entries to transactions or create new ones
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowImport(true)}>
            <Upload className="w-4 h-4 mr-2" />
            Import Bank Statement
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <ArrowDownCircle className="w-5 h-5 text-green-500" />
              <div>
                <p className="text-sm text-slate-500">Receipts</p>
                <p className="text-lg font-semibold text-green-600">{formatCurrency(stats.totalCredits)}</p>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-1">{stats.creditCount} entries</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <ArrowUpCircle className="w-5 h-5 text-red-500" />
              <div>
                <p className="text-sm text-slate-500">Expenditure</p>
                <p className="text-lg font-semibold text-red-600">{formatCurrency(stats.totalDebits)}</p>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-1">{stats.debitCount} entries</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div>
              <p className="text-sm text-slate-500">Net Position</p>
              <p className={`text-lg font-semibold ${stats.totalCredits - stats.totalDebits >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(stats.totalCredits - stats.totalDebits)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Unreconciled</p>
                <p className="text-lg font-semibold text-slate-900">{stats.creditCount + stats.debitCount}</p>
              </div>
              {(stats.creditCount + stats.debitCount) > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDeleteDialog(true)}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content - Tabs */}
      {isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            <span className="ml-2 text-slate-500">Loading...</span>
          </CardContent>
        </Card>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="receipts" className="flex items-center gap-2">
              <ArrowDownCircle className="w-4 h-4" />
              Receipts
              <Badge variant="secondary" className="ml-1">{stats.creditCount}</Badge>
            </TabsTrigger>
            <TabsTrigger value="expenditure" className="flex items-center gap-2">
              <ArrowUpCircle className="w-4 h-4" />
              Expenditure
              <Badge variant="secondary" className="ml-1">{stats.debitCount}</Badge>
            </TabsTrigger>
            <TabsTrigger value="reconciled" className="flex items-center gap-2">
              <History className="w-4 h-4" />
              Reconciled
              <Badge variant="secondary" className="ml-1">{reconciledStatements.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="receipts">
            {credits.length === 0 ? (
              <Card>
                <CardContent className="text-center py-8 text-slate-500">
                  No credit entries to reconcile
                </CardContent>
              </Card>
            ) : (
              <ReceiptsPanel
                entries={credits}
                loans={loans}
                borrowers={borrowers}
                investors={investors}
                transactions={transactions}
                investorTransactions={investorTransactions}
                reconciliationEntries={reconciliationEntries}
                onReconciled={handleRefresh}
              />
            )}
          </TabsContent>

          <TabsContent value="expenditure">
            {debits.length === 0 ? (
              <Card>
                <CardContent className="text-center py-8 text-slate-500">
                  No debit entries to reconcile
                </CardContent>
              </Card>
            ) : (
              <ExpenditurePanel
                entries={debits}
                loans={loans}
                borrowers={borrowers}
                investors={investors}
                transactions={transactions}
                investorTransactions={investorTransactions}
                investorInterestEntries={investorInterestEntries}
                expenses={expenses}
                expenseTypes={expenseTypes}
                reconciliationEntries={reconciliationEntries}
                onReconciled={handleRefresh}
              />
            )}
          </TabsContent>

          <TabsContent value="reconciled">
            <ReconciledPanel
              entries={reconciledStatements}
              reconciliationEntries={reconciliationEntries}
              loans={loans}
              borrowers={borrowers}
              transactions={transactions}
              investors={investors}
              investorTransactions={investorTransactions}
              investorInterestEntries={investorInterestEntries}
              expenses={expenses}
              expenseTypes={expenseTypes}
              otherIncome={otherIncome}
              onUnreconcile={handleRefresh}
            />
          </TabsContent>
        </Tabs>
      )}

      {/* Import Dialog */}
      <Dialog open={showImport} onOpenChange={closeImportDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import Bank Statement</DialogTitle>
            <DialogDescription>
              Upload a CSV file from your bank to import transactions
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Bank Source Select */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Bank Source (Optional)</label>
              <Select value={selectedBank} onValueChange={setSelectedBank}>
                <SelectTrigger>
                  <SelectValue placeholder="Auto-detect bank format" />
                </SelectTrigger>
                <SelectContent>
                  {bankSources.map(source => (
                    <SelectItem key={source.value} value={source.value}>
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Drop Zone */}
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragActive ? 'border-primary bg-primary/5' : 'border-slate-200'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              {isImporting ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="text-sm text-slate-500">Importing...</p>
                </div>
              ) : (
                <>
                  <FileText className="w-10 h-10 mx-auto text-slate-400 mb-2" />
                  <p className="text-sm text-slate-600 mb-2">
                    Drag and drop a CSV file here, or
                  </p>
                  <label className="cursor-pointer">
                    <span className="text-primary hover:underline text-sm">browse to upload</span>
                    <input
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                  </label>
                </>
              )}
            </div>

            {/* Import Result */}
            {importResult && (
              <div className="p-3 bg-slate-50 rounded-lg space-y-1 text-sm">
                {importResult.created > 0 && (
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{importResult.created} entries imported</span>
                  </div>
                )}
                {importResult.duplicates > 0 && (
                  <div className="flex items-center gap-2 text-amber-600">
                    <AlertCircle className="w-4 h-4" />
                    <span>{importResult.duplicates} duplicates skipped</span>
                  </div>
                )}
                {importResult.skipped > 0 && (
                  <div className="flex items-center gap-2 text-slate-500">
                    <span>{importResult.skipped} rows skipped</span>
                  </div>
                )}
                {importResult.errors > 0 && (
                  <div className="flex items-center gap-2 text-red-600">
                    <AlertCircle className="w-4 h-4" />
                    <span>{importResult.errors} errors</span>
                  </div>
                )}
              </div>
            )}

            {/* Close Button */}
            <div className="flex justify-end">
              <Button variant="outline" onClick={closeImportDialog}>
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete All Unreconciled Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              Delete All Unreconciled Entries?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {stats.creditCount + stats.debitCount} unreconciled bank statement entries.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              <strong>Note:</strong> Only unreconciled entries will be deleted. Reconciled entries will be preserved.
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAllUnreconciled}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete All
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
