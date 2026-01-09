import { useState, useMemo, useCallback } from 'react';
import { api } from '@/api/dataClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Settings, ArrowDownToLine, ArrowUpFromLine, AlertCircle, CheckCircle2, Loader2, Zap } from 'lucide-react';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import ReconciliationInbox from '@/components/reconciliation2/ReconciliationInbox';
import { classifyEntriesToPots } from '@/lib/reconciliation2/classifyToPot';
import { matchAllPots } from '@/lib/reconciliation2/matchWithinPot';
import { parseBankStatement, getBankSources, parseCSV, detectBankFormat } from '@/lib/bankStatementParsers';
import { format } from 'date-fns';

export default function BankReconciliation2() {
  const queryClient = useQueryClient();

  // UI state
  const [selectedBank, setSelectedBank] = useState('all');
  const [expandedCardId, setExpandedCardId] = useState(null);
  const [confirmedMatches, setConfirmedMatches] = useState(new Set());
  const [potOverrides, setPotOverrides] = useState(new Map()); // Track manual pot reclassifications

  // Import state
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [bankSource, setBankSource] = useState('allica');
  const [file, setFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [isImporting, setIsImporting] = useState(false);

  // Get available bank sources
  const bankSources = getBankSources();

  // Fetch bank statements (unreconciled only for Kanban)
  const { data: bankStatements = [], isLoading: statementsLoading } = useQuery({
    queryKey: ['bankStatements2'],
    queryFn: () => api.entities.BankStatement.list('-statement_date')
  });

  // Fetch loans for matching
  const { data: loans = [] } = useQuery({
    queryKey: ['loans'],
    queryFn: () => api.entities.Loan.list()
  });

  // Fetch investors for matching
  const { data: investors = [] } = useQuery({
    queryKey: ['investors'],
    queryFn: () => api.entities.Investor.list()
  });

  // Fetch borrowers for grouped payment matching
  const { data: borrowers = [] } = useQuery({
    queryKey: ['borrowers'],
    queryFn: () => api.entities.Borrower.list()
  });

  // Fetch reconciliation patterns for learned matching
  const { data: patterns = [] } = useQuery({
    queryKey: ['reconciliationPatterns'],
    queryFn: () => api.entities.ReconciliationPattern.list()
  });

  // Fetch expense types
  const { data: expenseTypes = [] } = useQuery({
    queryKey: ['expenseTypes'],
    queryFn: () => api.entities.ExpenseType.list()
  });

  // Fetch loan transactions for matching against existing
  const { data: loanTransactions = [] } = useQuery({
    queryKey: ['loanTransactions'],
    queryFn: () => api.entities.LoanTransaction.list('-date')
  });

  // Fetch investor transactions for matching against existing
  const { data: investorTransactions = [] } = useQuery({
    queryKey: ['investorTransactions'],
    queryFn: () => api.entities.InvestorTransaction.list('-date')
  });

  // Fetch expenses for matching against existing
  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => api.entities.Expense.list('-date')
  });

  // Fetch reconciliation entries to know which transactions are already reconciled
  const { data: reconciliationEntries = [] } = useQuery({
    queryKey: ['reconciliationEntries'],
    queryFn: () => api.entities.ReconciliationEntry.listAll()
  });

  // Build set of already-reconciled transaction IDs for quick lookup
  const reconciledTxIds = useMemo(() => {
    const ids = new Set();
    reconciliationEntries.forEach(re => {
      if (re.loan_transaction_id) ids.add(re.loan_transaction_id);
      if (re.investor_transaction_id) ids.add(re.investor_transaction_id);
      if (re.expense_id) ids.add(re.expense_id);
      if (re.interest_id) ids.add(re.interest_id);
    });
    return ids;
  }, [reconciliationEntries]);

  // Filter unreconciled entries and optionally by bank
  const filteredEntries = useMemo(() => {
    let entries = bankStatements.filter(e => !e.is_reconciled);

    if (selectedBank !== 'all') {
      entries = entries.filter(e => e.bank_source === selectedBank);
    }

    return entries;
  }, [bankStatements, selectedBank]);

  // Context for classification and matching
  const matchContext = useMemo(() => ({
    loans,
    investors,
    borrowers,
    patterns,
    expenseTypes,
    loanTransactions,
    investorTransactions,
    expenses,
    reconciledTxIds
  }), [loans, investors, borrowers, patterns, expenseTypes, loanTransactions, investorTransactions, expenses, reconciledTxIds]);

  // Step 1: Classify entries into pots, applying any manual overrides
  const entriesByPot = useMemo(() => {
    const classified = classifyEntriesToPots(filteredEntries, matchContext);

    // Apply pot overrides from drag-and-drop reclassifications
    if (potOverrides.size > 0) {
      const result = {
        unclassified: [],
        loans: [],
        investors: [],
        expenses: []
      };

      // Move all entries through, applying overrides
      for (const potId of Object.keys(classified)) {
        for (const entry of classified[potId]) {
          const overridePot = potOverrides.get(entry.id);
          const targetPot = overridePot || entry.pot;

          // Update entry's pot if overridden
          const entryWithOverride = overridePot
            ? { ...entry, pot: overridePot, classification: { ...entry.classification, pot: overridePot, reason: 'Manually reclassified', signals: [...(entry.classification?.signals || []), 'manual_override'] } }
            : entry;

          result[targetPot].push(entryWithOverride);
        }
      }

      return result;
    }

    return classified;
  }, [filteredEntries, matchContext, potOverrides]);

  // Step 2: Match within each pot
  const matchedEntriesByPot = useMemo(() => {
    const matched = matchAllPots(entriesByPot, matchContext);

    // Apply confirmed state
    for (const potId of Object.keys(matched)) {
      matched[potId] = matched[potId].map(entry => ({
        ...entry,
        matchConfirmed: confirmedMatches.has(entry.id)
      }));
    }

    return matched;
  }, [entriesByPot, matchContext, confirmedMatches]);

  // Get unique bank sources for filter
  const importedBanks = useMemo(() => {
    const sources = new Set(bankStatements.map(e => e.bank_source).filter(Boolean));
    return Array.from(sources).sort();
  }, [bankStatements]);

  // Summary stats
  const stats = useMemo(() => {
    const allEntries = [
      ...matchedEntriesByPot.unclassified,
      ...matchedEntriesByPot.loans,
      ...matchedEntriesByPot.investors,
      ...matchedEntriesByPot.expenses
    ];
    const credits = allEntries.filter(e => e.amount > 0);
    const debits = allEntries.filter(e => e.amount < 0);
    const readyToReconcile = allEntries.filter(e => e.matchConfirmed);

    return {
      totalEntries: allEntries.length,
      totalCredits: credits.reduce((sum, e) => sum + e.amount, 0),
      totalDebits: Math.abs(debits.reduce((sum, e) => sum + e.amount, 0)),
      unclassifiedCount: matchedEntriesByPot.unclassified.length,
      readyCount: readyToReconcile.length
    };
  }, [matchedEntriesByPot]);

  // Handle drag end - move entry between pots
  const handleDragEnd = useCallback(({ entryId, fromPot, toPot }) => {
    if (fromPot === toPot) return;

    // Update pot overrides to persist the reclassification
    setPotOverrides(prev => {
      const next = new Map(prev);
      next.set(entryId, toPot);
      return next;
    });

    // Clear any confirmed match since pot changed
    setConfirmedMatches(prev => {
      const next = new Set(prev);
      next.delete(entryId);
      return next;
    });
  }, []);

  // Handle card click
  const handleCardClick = useCallback((entryId) => {
    setExpandedCardId(prev => prev === entryId ? null : entryId);
  }, []);

  // Handle confirm match
  const handleConfirmMatch = useCallback((entryId) => {
    setConfirmedMatches(prev => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }, []);

  // Handle reconciliation action
  const handleReconcile = async (entry) => {
    try {
      // Guard against double reconciliation (race condition)
      if (entry.is_reconciled) {
        console.log('Entry already reconciled, skipping');
        return;
      }

      const match = entry.match;
      if (!match) {
        throw new Error('No match found for this entry');
      }

      const transactionDate = entry.statement_date || format(new Date(), 'yyyy-MM-dd');
      const amount = Math.abs(entry.amount);
      const pot = entry.pot;

      // Handle based on pot and match type
      if (pot === 'loans') {
        if (match.matchType === 'existing_transaction') {
          // Link to existing transaction
          await api.entities.ReconciliationEntry.create({
            bank_statement_id: entry.id,
            loan_transaction_id: match.transaction.id,
            amount: match.transaction.amount,
            type: match.transactionType.toLowerCase()
          });
        } else if (match.matchType === 'grouped_payment') {
          // Link to multiple transactions
          for (const tx of match.transactions) {
            await api.entities.ReconciliationEntry.create({
              bank_statement_id: entry.id,
              loan_transaction_id: tx.id,
              amount: tx.amount,
              type: 'loan_repayment'
            });
          }
        } else if (match.matchType === 'create_new' && match.loan) {
          // Create new loan transaction and link via reconciliation entry
          const isRepayment = entry.amount > 0;
          const newTx = await api.entities.LoanTransaction.create({
            loan_id: match.loan.id,
            type: isRepayment ? 'Repayment' : 'Disbursement',
            amount: amount,
            principal_amount: isRepayment ? amount : 0,
            interest_amount: 0,
            fees_amount: 0,
            date: transactionDate,
            description: entry.description || `Bank reconciliation ${isRepayment ? 'repayment' : 'disbursement'}`,
            bank_statement_id: entry.id
          });

          // Create reconciliation entry to link bank statement to transaction
          await api.entities.ReconciliationEntry.create({
            bank_statement_id: entry.id,
            loan_transaction_id: newTx.id,
            amount: amount,
            type: isRepayment ? 'loan_repayment' : 'loan_disbursement'
          });

          // Update loan balance
          if (isRepayment) {
            const newBalance = Math.max(0, (match.loan.outstanding_balance || match.loan.principal_amount) - amount);
            await api.entities.Loan.update(match.loan.id, {
              outstanding_balance: newBalance
            });
          }
        }
      } else if (pot === 'investors') {
        if (match.matchType === 'existing_transaction') {
          // Link to existing transaction
          await api.entities.ReconciliationEntry.create({
            bank_statement_id: entry.id,
            investor_transaction_id: match.transaction.id,
            amount: match.transaction.amount,
            type: match.transactionType
          });
        } else if (match.matchType === 'create_new' && match.investor) {
          // Create new investor transaction and link via reconciliation entry
          const isCapitalIn = entry.amount > 0;
          const newTx = await api.entities.InvestorTransaction.create({
            investor_id: match.investor.id,
            type: isCapitalIn ? 'capital_in' : 'capital_out',
            amount: amount,
            date: transactionDate,
            description: entry.description || `Capital ${isCapitalIn ? 'in' : 'out'}`,
            reference: entry.reference,
            bank_statement_id: entry.id
          });

          // Create reconciliation entry to link bank statement to transaction
          await api.entities.ReconciliationEntry.create({
            bank_statement_id: entry.id,
            investor_transaction_id: newTx.id,
            amount: amount,
            type: isCapitalIn ? 'investor_credit' : 'investor_withdrawal'
          });

          // Update investor balance
          const currentBalance = match.investor.current_capital_balance || 0;
          const newBalance = isCapitalIn ? currentBalance + amount : Math.max(0, currentBalance - amount);
          await api.entities.Investor.update(match.investor.id, {
            current_capital_balance: newBalance
          });
        }
      } else if (pot === 'expenses') {
        if (match.matchType === 'existing_expense') {
          // Link to existing expense
          await api.entities.ReconciliationEntry.create({
            bank_statement_id: entry.id,
            expense_id: match.expense.id,
            amount: match.expense.amount,
            type: 'expense'
          });
        } else if (match.matchType === 'create_new' && match.expenseType) {
          // Create new expense and link via reconciliation entry
          const newExpense = await api.entities.Expense.create({
            type_id: match.expenseType.id,
            type_name: match.expenseType.name,
            amount: amount,
            date: transactionDate,
            description: entry.description || 'Operating expense',
            loan_id: match.loan?.id || null
          });

          // Create reconciliation entry to link bank statement to expense
          await api.entities.ReconciliationEntry.create({
            bank_statement_id: entry.id,
            expense_id: newExpense.id,
            amount: amount,
            type: 'expense'
          });
        }
      }

      // Mark bank statement as reconciled
      await api.entities.BankStatement.update(entry.id, {
        is_reconciled: true
      });

      // Remove from confirmed set
      setConfirmedMatches(prev => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['bankStatements2'] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      queryClient.invalidateQueries({ queryKey: ['investors'] });
      queryClient.invalidateQueries({ queryKey: ['loanTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['investorTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliationEntries'] });

      // Close expanded card
      setExpandedCardId(null);

    } catch (error) {
      console.error('Reconciliation error:', error);
    }
  };

  // Handle file selection - auto-detect bank format
  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setImportResult(null);

    if (selectedFile) {
      const text = await selectedFile.text();
      const rows = parseCSV(text);
      if (rows.length > 0) {
        const headers = Object.keys(rows[0]);
        const detected = detectBankFormat(headers);
        if (detected) {
          setBankSource(detected);
        }
      }
    }
  };

  // Handle CSV import
  const handleImport = async () => {
    if (!file) return;

    setIsImporting(true);
    setImportResult(null);

    try {
      const text = await file.text();
      const { entries, errors } = parseBankStatement(text, bankSource);

      if (entries.length === 0) {
        setImportResult({
          success: false,
          error: 'No valid entries found in CSV',
          errors
        });
        return;
      }

      // Check for duplicates
      const existingRefs = new Set(bankStatements.map(s => s.external_reference));
      const newEntries = entries.filter(e => !existingRefs.has(e.external_reference));
      const duplicates = entries.length - newEntries.length;

      if (newEntries.length === 0) {
        setImportResult({
          success: true,
          created: 0,
          duplicates,
          errors,
          message: 'All entries already exist in the system'
        });
        return;
      }

      // Create entries with bank source
      const entriesToCreate = newEntries.map(e => ({
        ...e,
        bank_source: bankSource,
        reconciliation_state: 'unclassified'
      }));

      await api.entities.BankStatement.createMany(entriesToCreate);

      setImportResult({
        success: true,
        created: newEntries.length,
        duplicates,
        errors,
        total: entries.length
      });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['bankStatements2'] });
      setFile(null);

    } catch (error) {
      setImportResult({
        success: false,
        error: error.message
      });
    } finally {
      setIsImporting(false);
    }
  };

  // Bulk reconcile high confidence matches
  const handleBulkReconcile = async () => {
    const readyEntries = [
      ...matchedEntriesByPot.loans,
      ...matchedEntriesByPot.investors,
      ...matchedEntriesByPot.expenses
    ].filter(e => e.matchConfirmed && e.match?.confidence >= 90);

    if (readyEntries.length === 0) {
      return;
    }

    for (const entry of readyEntries) {
      try {
        await handleReconcile(entry);
      } catch {
        // Continue with other entries even if one fails
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Bank Reconciliation</h1>
            <p className="text-slate-500 mt-1">Drag transactions between pots, confirm matches, then reconcile</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsSettingsOpen(true)}>
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </Button>
            <Button onClick={() => setIsImportDialogOpen(true)}>
              <Upload className="w-4 h-4 mr-2" />
              Import CSV
            </Button>
          </div>
        </div>

        {/* Summary Row */}
        <div className="flex flex-wrap items-center gap-4">
          <Card className="flex-1 min-w-[150px]">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100">
                <ArrowDownToLine className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500">Credits</p>
                <p className="font-bold text-emerald-600">{formatCurrency(stats.totalCredits)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-1 min-w-[150px]">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-100">
                <ArrowUpFromLine className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500">Debits</p>
                <p className="font-bold text-red-600">{formatCurrency(stats.totalDebits)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-1 min-w-[150px]">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100">
                <AlertCircle className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500">Unclassified</p>
                <p className="font-bold text-amber-600">{stats.unclassifiedCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-1 min-w-[150px]">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500">Ready</p>
                <p className="font-bold text-green-600">{stats.readyCount}</p>
              </div>
            </CardContent>
          </Card>

          {/* Bank Filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">Bank:</span>
            <Select value={selectedBank} onValueChange={setSelectedBank}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Banks</SelectItem>
                {importedBanks.map(source => {
                  const bankInfo = bankSources.find(b => b.value === source);
                  return (
                    <SelectItem key={source} value={source}>
                      {bankInfo?.label || source}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Bulk Action */}
          {stats.readyCount > 0 && (
            <Button
              onClick={handleBulkReconcile}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Zap className="w-4 h-4 mr-2" />
              Reconcile {stats.readyCount} Ready
            </Button>
          )}
        </div>

        {/* Reconciliation Inbox */}
        {statementsLoading ? (
          <Card>
            <CardContent className="p-4 space-y-3">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
              ))}
            </CardContent>
          </Card>
        ) : (
          <ReconciliationInbox
            entriesByPot={matchedEntriesByPot}
            onDragEnd={handleDragEnd}
            onCardClick={handleCardClick}
            expandedCardId={expandedCardId}
            onReconcile={handleReconcile}
            onConfirmMatch={handleConfirmMatch}
            onReclassify={handleDragEnd}
          />
        )}

        {/* Import Dialog */}
        <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Import Bank Statement</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Bank Source</Label>
                <Select value={bankSource} onValueChange={setBankSource}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {bankSources.map(source => (
                      <SelectItem key={source.value} value={source.value}>
                        <div>
                          <span className="font-medium">{source.label}</span>
                          <span className="text-slate-500 ml-2 text-xs">{source.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>CSV File</Label>
                <Input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileChange}
                  disabled={isImporting}
                />
                <p className="text-xs text-slate-500">
                  Upload a CSV export from your bank. The format will be auto-detected.
                </p>
              </div>

              {importResult && (
                <Alert className={importResult.success ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}>
                  {importResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-600" />
                  )}
                  <AlertDescription className={importResult.success ? "text-emerald-800" : "text-red-800"}>
                    {importResult.success ? (
                      <span>
                        Imported {importResult.created} entries
                        {importResult.duplicates > 0 && ` (${importResult.duplicates} duplicates skipped)`}
                      </span>
                    ) : (
                      <span>{importResult.error}</span>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {importResult?.errors?.length > 0 && (
                <div className="text-xs text-amber-600 max-h-24 overflow-y-auto">
                  {importResult.errors.slice(0, 5).map((err, i) => (
                    <p key={i}>{err}</p>
                  ))}
                  {importResult.errors.length > 5 && (
                    <p>...and {importResult.errors.length - 5} more warnings</p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsImportDialogOpen(false);
                    setFile(null);
                    setImportResult(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={!file || isImporting}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Import
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Settings Dialog */}
        <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Reconciliation Settings</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Default Bank Source</Label>
                <Select value={bankSource} onValueChange={setBankSource}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {bankSources.map(source => (
                      <SelectItem key={source.value} value={source.value}>
                        {source.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">
                  Default bank format for CSV imports
                </p>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg space-y-2">
                <h4 className="font-medium text-sm">Classification Thresholds</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-500">High Confidence:</span>
                    <span className="ml-2 font-medium text-green-600">90%+</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Needs Review:</span>
                    <span className="ml-2 font-medium text-amber-600">&lt;70%</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t">
                <Button onClick={() => setIsSettingsOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
