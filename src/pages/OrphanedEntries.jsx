import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, Search, Loader2, ChevronDown, Check, X, Eye, EyeOff, Trash2, AlertTriangle, Unlink } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from 'sonner';

export default function OrphanedEntries() {
  const [activeTab, setActiveTab] = useState('unreconciled');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAccepted, setShowAccepted] = useState(true);
  const [expandedYears, setExpandedYears] = useState(new Set());

  // Accept orphan dialog state
  const [acceptDialogOpen, setAcceptDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [acceptReason, setAcceptReason] = useState('');

  // Cleanup dialog state for orphaned reconciliations
  const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false);
  const [selectedOrphanedReconciliation, setSelectedOrphanedReconciliation] = useState(null);
  const [cleaningUp, setCleaningUp] = useState(false);

  const queryClient = useQueryClient();

  // Query all reconciliation entries to know what's already reconciled
  // IMPORTANT: Use listAll() to avoid 1000 row limit
  const { data: reconciliationEntries = [] } = useQuery({
    queryKey: ['reconciliation-entries-all'],
    queryFn: () => api.entities.ReconciliationEntry.listAll()
  });

  // Query bank statements to show details for orphaned reconciliation entries
  const { data: bankStatements = [] } = useQuery({
    queryKey: ['bank-statements-all'],
    queryFn: () => api.entities.BankStatement.listAll('-date')
  });

  // Query accepted orphans
  const { data: acceptedOrphans = [] } = useQuery({
    queryKey: ['accepted-orphans'],
    queryFn: () => api.entities.AcceptedOrphan.list()
  });

  // Loans (to get borrower names)
  const { data: loans = [], isLoading: loadingLoansData } = useQuery({
    queryKey: ['loans-all'],
    queryFn: () => api.entities.Loan.listAll()
  });

  // Investors (to get investor names)
  const { data: investors = [], isLoading: loadingInvestorsData } = useQuery({
    queryKey: ['investors-all'],
    queryFn: () => api.entities.Investor.list()
  });

  // Loan transactions (repayments & disbursements)
  const { data: loanTransactions = [], isLoading: loadingLoans } = useQuery({
    queryKey: ['loan-transactions-all'],
    queryFn: () => api.entities.Transaction.listAll('-date')
  });

  // Investor transactions (capital in/out)
  const { data: investorTransactions = [], isLoading: loadingInvestors } = useQuery({
    queryKey: ['investor-transactions-all'],
    queryFn: () => api.entities.InvestorTransaction.list('-date')
  });

  // Investor interest entries
  const { data: investorInterest = [], isLoading: loadingInterest } = useQuery({
    queryKey: ['investor-interest-all'],
    queryFn: () => api.entities.InvestorInterest.list('-date')
  });

  // Expenses - use listAll() to ensure we get all records
  const { data: expenses = [], isLoading: loadingExpenses } = useQuery({
    queryKey: ['expenses-all'],
    queryFn: () => api.entities.Expense.listAll('-date')
  });

  // Other income
  const { data: otherIncome = [], isLoading: loadingOtherIncome } = useQuery({
    queryKey: ['other-income-all'],
    queryFn: () => api.entities.OtherIncome.list('-date')
  });

  // Receipts (filed only)
  const { data: receipts = [], isLoading: loadingReceipts } = useQuery({
    queryKey: ['receipts-all'],
    queryFn: () => api.entities.ReceiptDraft.list('-receipt_date')
  });

  const isLoading = loadingLoansData || loadingInvestorsData || loadingLoans || loadingInvestors || loadingInterest || loadingExpenses || loadingOtherIncome || loadingReceipts;

  // Build sets of IDs that ARE reconciled
  const reconciledIds = useMemo(() => {
    const loanTxIds = new Set();
    const investorTxIds = new Set();
    const interestIds = new Set();
    const expenseIds = new Set();
    const otherIncomeIds = new Set();

    reconciliationEntries.forEach(re => {
      if (re.loan_transaction_id) loanTxIds.add(re.loan_transaction_id);
      if (re.investor_transaction_id) investorTxIds.add(re.investor_transaction_id);
      if (re.interest_id) interestIds.add(re.interest_id);
      if (re.expense_id) expenseIds.add(re.expense_id);
      if (re.other_income_id) otherIncomeIds.add(re.other_income_id);
    });

    return { loanTxIds, investorTxIds, interestIds, expenseIds, otherIncomeIds };
  }, [reconciliationEntries]);

  // Build map of accepted orphans for quick lookup
  const acceptedOrphanMap = useMemo(() => {
    const map = new Map();
    acceptedOrphans.forEach(ao => {
      map.set(`${ao.entity_type}-${ao.entity_id}`, ao);
    });
    return map;
  }, [acceptedOrphans]);

  // Build orphaned entries list
  const orphanedEntries = useMemo(() => {
    const entries = [];

    // Loan transactions not reconciled
    loanTransactions
      .filter(tx => !tx.is_deleted && !reconciledIds.loanTxIds.has(tx.id))
      .forEach(tx => {
        const key = `loan_transaction-${tx.id}`;
        const accepted = acceptedOrphanMap.get(key);
        const loan = loans.find(l => l.id === tx.loan_id);
        entries.push({
          id: tx.id,
          type: 'loan_transaction',
          subType: tx.type,
          date: tx.date,
          amount: tx.type === 'Disbursement' ? -Math.abs(tx.amount) : tx.amount,
          description: tx.reference || tx.notes,
          entityName: loan?.borrower_name || tx.borrower_name || '-',
          loanNumber: loan?.loan_number,
          entityLink: createPageUrl(`LoanDetails?id=${tx.loan_id}`),
          accepted,
          acceptedReason: accepted?.reason
        });
      });

    // Investor transactions not reconciled
    investorTransactions
      .filter(tx => !reconciledIds.investorTxIds.has(tx.id))
      .forEach(tx => {
        const key = `investor_transaction-${tx.id}`;
        const accepted = acceptedOrphanMap.get(key);
        const investor = investors.find(i => i.id === tx.investor_id);
        entries.push({
          id: tx.id,
          type: 'investor_transaction',
          subType: tx.type,
          date: tx.date,
          amount: tx.type === 'capital_out' ? -Math.abs(tx.amount) : tx.amount,
          description: tx.notes,
          entityName: investor?.business_name || investor?.name || tx.investor_name || '-',
          entityLink: createPageUrl(`InvestorDetails?id=${tx.investor_id}`),
          accepted,
          acceptedReason: accepted?.reason
        });
      });

    // Investor interest not reconciled
    investorInterest
      .filter(entry => !reconciledIds.interestIds.has(entry.id))
      .forEach(entry => {
        const key = `investor_interest-${entry.id}`;
        const accepted = acceptedOrphanMap.get(key);
        const investor = investors.find(i => i.id === entry.investor_id);
        entries.push({
          id: entry.id,
          type: 'investor_interest',
          subType: entry.type,
          date: entry.date,
          amount: entry.type === 'debit' ? -Math.abs(entry.amount) : entry.amount,
          description: entry.description,
          entityName: investor?.business_name || investor?.name || entry.investor_name || '-',
          entityLink: createPageUrl(`InvestorDetails?id=${entry.investor_id}`),
          accepted,
          acceptedReason: accepted?.reason
        });
      });

    // Expenses not reconciled
    expenses
      .filter(exp => !reconciledIds.expenseIds.has(exp.id))
      .forEach(exp => {
        const key = `expense-${exp.id}`;
        const accepted = acceptedOrphanMap.get(key);
        entries.push({
          id: exp.id,
          type: 'expense',
          subType: exp.type_name,
          date: exp.date,
          amount: -Math.abs(exp.amount),
          description: exp.description,
          entityName: exp.type_name,
          entityLink: createPageUrl('Expenses'),
          accepted,
          acceptedReason: accepted?.reason
        });
      });

    // Other income not reconciled
    otherIncome
      .filter(inc => !reconciledIds.otherIncomeIds.has(inc.id))
      .forEach(inc => {
        const key = `other_income-${inc.id}`;
        const accepted = acceptedOrphanMap.get(key);
        entries.push({
          id: inc.id,
          type: 'other_income',
          subType: 'Other Income',
          date: inc.date,
          amount: inc.amount,
          description: inc.description,
          entityName: 'Other Income',
          entityLink: createPageUrl('OtherIncome'),
          accepted,
          acceptedReason: accepted?.reason
        });
      });

    // Receipts not linked to bank statement (filed receipts only)
    receipts
      .filter(r => r.status === 'filed' && !r.bank_statement_id)
      .forEach(r => {
        const key = `receipt-${r.id}`;
        const accepted = acceptedOrphanMap.get(key);
        entries.push({
          id: r.id,
          type: 'receipt',
          subType: 'Receipt',
          date: r.receipt_date,
          amount: r.total_amount,
          description: r.reference || `Receipt #${r.receipt_number}`,
          entityName: r.borrower_name || 'Receipt',
          entityLink: createPageUrl('Receipts'),
          accepted,
          acceptedReason: accepted?.reason
        });
      });

    // Sort by date descending
    return entries.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [loans, investors, loanTransactions, investorTransactions, investorInterest, expenses, otherIncome, receipts, reconciledIds, acceptedOrphanMap]);

  // Detect two types of orphaned reconciliations:
  // 1. Bank statements marked as reconciled but with NO reconciliation entries (entries were deleted)
  // 2. Reconciliation entries where the linked entity is NULL (entity was deleted with SET NULL)
  const orphanedReconciliations = useMemo(() => {
    const orphans = [];

    // Build map of bank statement ID -> count of reconciliation entries
    const bankStatementEntryCounts = new Map();
    reconciliationEntries.forEach(re => {
      if (re.bank_statement_id) {
        bankStatementEntryCounts.set(
          re.bank_statement_id,
          (bankStatementEntryCounts.get(re.bank_statement_id) || 0) + 1
        );
      }
    });

    // Type 1: Bank statements marked as reconciled but with no entries (or 0 entries)
    bankStatements
      .filter(bs => bs.is_reconciled && (!bankStatementEntryCounts.has(bs.id) || bankStatementEntryCounts.get(bs.id) === 0))
      .forEach(bs => {
        orphans.push({
          id: `orphan-bs-${bs.id}`,
          type: 'missing_entries',
          bankStatement: bs,
          bank_statement_id: bs.id,
          reconciliation_type: 'unknown',
          expectedType: 'unknown'
        });
      });

    // Type 2: Reconciliation entries where linked entity is NULL or entity no longer exists
    const bankStatementMap = new Map(bankStatements.map(bs => [bs.id, bs]));

    // Build lookup sets for existing entities
    const existingExpenseIds = new Set(expenses.map(e => e.id));
    const existingLoanTxIds = new Set(loanTransactions.map(t => t.id));
    const existingInvestorTxIds = new Set(investorTransactions.map(t => t.id));
    const existingInterestIds = new Set(investorInterest.map(i => i.id));
    const existingOtherIncomeIds = new Set(otherIncome.map(o => o.id));

    reconciliationEntries.forEach(re => {
      let isOrphaned = false;
      let expectedType = null;

      // ALWAYS check each FK to see if it points to a non-existent entity
      // Don't rely on reconciliation_type as it may not be set for older entries

      // Check expense_id - if set, does the expense still exist?
      if (re.expense_id && !existingExpenseIds.has(re.expense_id)) {
        isOrphaned = true;
        expectedType = 'expense';
      }
      // Check loan_transaction_id
      else if (re.loan_transaction_id && !existingLoanTxIds.has(re.loan_transaction_id)) {
        isOrphaned = true;
        expectedType = re.reconciliation_type || 'loan_transaction';
      }
      // Check investor_transaction_id
      else if (re.investor_transaction_id && !existingInvestorTxIds.has(re.investor_transaction_id)) {
        isOrphaned = true;
        expectedType = re.reconciliation_type || 'investor_transaction';
      }
      // Check interest_id
      else if (re.interest_id && !existingInterestIds.has(re.interest_id)) {
        isOrphaned = true;
        expectedType = 'investor_interest';
      }
      // Check other_income_id
      else if (re.other_income_id && !existingOtherIncomeIds.has(re.other_income_id)) {
        isOrphaned = true;
        expectedType = 'other_income';
      }
      // Finally: Check if ALL entity FKs are NULL (completely orphaned record)
      else {
        const hasNoLinkedEntity = !re.expense_id && !re.loan_transaction_id &&
                                  !re.investor_transaction_id && !re.interest_id &&
                                  !re.other_income_id;
        if (hasNoLinkedEntity) {
          isOrphaned = true;
          expectedType = re.reconciliation_type || 'unknown';
        }
      }

      if (isOrphaned) {
        const bankStatement = bankStatementMap.get(re.bank_statement_id);
        orphans.push({
          ...re,
          type: 'null_reference',
          expectedType,
          bankStatement
        });
      }
    });

    // Sort by bank statement date descending
    return orphans.sort((a, b) => {
      const dateA = a.bankStatement?.date || '1970-01-01';
      const dateB = b.bankStatement?.date || '1970-01-01';
      return new Date(dateB) - new Date(dateA);
    });
  }, [reconciliationEntries, bankStatements, expenses, loanTransactions, investorTransactions, investorInterest, otherIncome]);

  // Filter entries by type, search, and accepted status
  const filteredEntries = useMemo(() => {
    let filtered = orphanedEntries;

    // Filter by accepted status
    if (!showAccepted) {
      filtered = filtered.filter(e => !e.accepted);
    }

    // Filter by type
    if (typeFilter !== 'all') {
      filtered = filtered.filter(e => e.type === typeFilter);
    }

    // Filter by search term
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(e =>
        e.entityName?.toLowerCase().includes(search) ||
        e.description?.toLowerCase().includes(search) ||
        e.subType?.toLowerCase().includes(search)
      );
    }

    return filtered;
  }, [orphanedEntries, typeFilter, searchTerm, showAccepted]);

  // Get financial year for a date (UK financial year: Apr 1 - Mar 31)
  // Returns the starting year of the financial year (e.g., 2025 for FY 2025/26)
  const getFinancialYear = (date) => {
    const d = new Date(date);
    const month = d.getMonth(); // 0-indexed (0 = Jan, 3 = Apr)
    const year = d.getFullYear();
    // If Jan-Mar, it's the previous calendar year's FY
    // If Apr-Dec, it's the current calendar year's FY
    return month < 3 ? year - 1 : year;
  };

  // Format financial year for display (e.g., "2025/26")
  const formatFinancialYear = (startYear) => {
    return `${startYear}/${(startYear + 1).toString().slice(-2)}`;
  };

  // Group entries by financial year
  const entriesByYear = useMemo(() => {
    const groups = new Map();

    filteredEntries.forEach(entry => {
      const fyYear = getFinancialYear(entry.date);
      if (!groups.has(fyYear)) {
        groups.set(fyYear, {
          year: fyYear,
          label: formatFinancialYear(fyYear),
          entries: [],
          totalIn: 0,
          totalOut: 0,
          acceptedCount: 0
        });
      }
      const group = groups.get(fyYear);
      group.entries.push(entry);
      if (entry.amount >= 0) {
        group.totalIn += entry.amount;
      } else {
        group.totalOut += Math.abs(entry.amount);
      }
      if (entry.accepted) {
        group.acceptedCount++;
      }
    });

    // Sort by financial year descending
    return Array.from(groups.values()).sort((a, b) => b.year - a.year);
  }, [filteredEntries]);

  // Track if we've done initial expansion (to avoid re-expanding after user collapses)
  const [hasInitialized, setHasInitialized] = useState(false);

  // Initialize expanded years to show current financial year expanded by default (only once)
  if (entriesByYear.length > 0 && !hasInitialized) {
    const currentFY = getFinancialYear(new Date());
    if (entriesByYear.find(g => g.year === currentFY)) {
      setExpandedYears(new Set([currentFY]));
    } else {
      setExpandedYears(new Set([entriesByYear[0].year]));
    }
    setHasInitialized(true);
  }

  // Stats by type (excluding accepted if not showing)
  const statsByType = useMemo(() => {
    const baseEntries = showAccepted ? orphanedEntries : orphanedEntries.filter(e => !e.accepted);
    return {
      loan_transaction: baseEntries.filter(e => e.type === 'loan_transaction').length,
      investor_transaction: baseEntries.filter(e => e.type === 'investor_transaction').length,
      investor_interest: baseEntries.filter(e => e.type === 'investor_interest').length,
      expense: baseEntries.filter(e => e.type === 'expense').length,
      other_income: baseEntries.filter(e => e.type === 'other_income').length,
      receipt: baseEntries.filter(e => e.type === 'receipt').length,
      accepted: orphanedEntries.filter(e => e.accepted).length
    };
  }, [orphanedEntries, showAccepted]);

  const toggleYear = (year) => {
    setExpandedYears(prev => {
      const next = new Set(prev);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  };

  const expandAllYears = () => {
    setExpandedYears(new Set(entriesByYear.map(g => g.year)));
  };

  const collapseAllYears = () => {
    setExpandedYears(new Set());
  };

  // Accept orphan mutation
  const acceptOrphanMutation = useMutation({
    mutationFn: async ({ entityType, entityId, reason }) => {
      return api.entities.AcceptedOrphan.create({
        entity_type: entityType,
        entity_id: entityId,
        reason
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accepted-orphans'] });
      toast.success('Entry marked as accepted orphan');
      setAcceptDialogOpen(false);
      setSelectedEntry(null);
      setAcceptReason('');
    },
    onError: (error) => {
      toast.error('Failed to accept orphan: ' + error.message);
    }
  });

  // Unaccept orphan mutation
  const unacceptOrphanMutation = useMutation({
    mutationFn: async (acceptedOrphanId) => {
      return api.entities.AcceptedOrphan.delete(acceptedOrphanId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accepted-orphans'] });
      toast.success('Entry unmarked as accepted orphan');
    },
    onError: (error) => {
      toast.error('Failed to unaccept orphan: ' + error.message);
    }
  });

  // Cleanup orphaned reconciliation entry
  const handleCleanupOrphanedReconciliation = async (entry) => {
    setCleaningUp(true);
    try {
      if (entry.type === 'missing_entries') {
        // Type 1: Bank statement is reconciled but has no entries - just un-reconcile it
        await api.entities.BankStatement.update(entry.bank_statement_id, {
          is_reconciled: false,
          reconciled_at: null
        });
      } else {
        // Type 2: Reconciliation entry exists but linked entity is NULL
        // Delete the orphaned reconciliation entry
        await api.entities.ReconciliationEntry.delete(entry.id);

        // Check if bank statement has any other reconciliation entries
        const remainingEntries = reconciliationEntries.filter(
          re => re.bank_statement_id === entry.bank_statement_id && re.id !== entry.id
        );

        // If no remaining entries, un-reconcile the bank statement
        if (remainingEntries.length === 0 && entry.bank_statement_id) {
          await api.entities.BankStatement.update(entry.bank_statement_id, {
            is_reconciled: false,
            reconciled_at: null
          });
        }
      }

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['reconciliation-entries-all'] });
      queryClient.invalidateQueries({ queryKey: ['bank-statements-all'] });

      toast.success('Orphaned reconciliation cleaned up. Bank statement can now be re-reconciled.');
      setCleanupDialogOpen(false);
      setSelectedOrphanedReconciliation(null);
    } catch (error) {
      toast.error('Failed to cleanup: ' + error.message);
    } finally {
      setCleaningUp(false);
    }
  };

  // Bulk cleanup all orphaned reconciliations
  const handleBulkCleanup = async () => {
    if (orphanedReconciliations.length === 0) return;

    setCleaningUp(true);
    try {
      // Track which bank statements we need to un-reconcile
      const affectedBankStatementIds = new Set();

      for (const entry of orphanedReconciliations) {
        if (entry.type === 'missing_entries') {
          // Type 1: Just mark bank statement ID for un-reconciliation
          affectedBankStatementIds.add(entry.bank_statement_id);
        } else {
          // Type 2: Delete the reconciliation entry
          await api.entities.ReconciliationEntry.delete(entry.id);
          if (entry.bank_statement_id) {
            affectedBankStatementIds.add(entry.bank_statement_id);
          }
        }
      }

      // Un-reconcile all affected bank statements that have no remaining entries
      const deletedEntryIds = new Set(
        orphanedReconciliations
          .filter(o => o.type !== 'missing_entries')
          .map(o => o.id)
      );
      const updatedReconciliationEntries = reconciliationEntries.filter(
        re => !deletedEntryIds.has(re.id)
      );

      for (const bsId of affectedBankStatementIds) {
        const hasRemainingEntries = updatedReconciliationEntries.some(
          re => re.bank_statement_id === bsId
        );
        if (!hasRemainingEntries) {
          await api.entities.BankStatement.update(bsId, {
            is_reconciled: false,
            reconciled_at: null
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ['reconciliation-entries-all'] });
      queryClient.invalidateQueries({ queryKey: ['bank-statements-all'] });

      toast.success(`Cleaned up ${orphanedReconciliations.length} orphaned reconciliation entries.`);
    } catch (error) {
      toast.error('Failed to cleanup: ' + error.message);
    } finally {
      setCleaningUp(false);
    }
  };

  const handleAcceptClick = (entry) => {
    setSelectedEntry(entry);
    setAcceptReason('');
    setAcceptDialogOpen(true);
  };

  const handleAcceptSubmit = () => {
    if (!selectedEntry || !acceptReason.trim()) return;
    acceptOrphanMutation.mutate({
      entityType: selectedEntry.type,
      entityId: selectedEntry.id,
      reason: acceptReason.trim()
    });
  };

  const handleUnaccept = (entry) => {
    if (entry.accepted?.id) {
      unacceptOrphanMutation.mutate(entry.accepted.id);
    }
  };

  const getTypeBadgeColor = (type) => {
    switch (type) {
      case 'loan_transaction': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'investor_transaction': return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'investor_interest': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'expense': return 'bg-red-50 text-red-700 border-red-200';
      case 'other_income': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'receipt': return 'bg-cyan-50 text-cyan-700 border-cyan-200';
      default: return 'bg-slate-50 text-slate-700';
    }
  };

  const formatEntryType = (type, subType) => {
    switch (type) {
      case 'loan_transaction': return subType;
      case 'investor_transaction': return subType === 'capital_in' ? 'Capital In' : 'Capital Out';
      case 'investor_interest': return subType === 'credit' ? 'Interest Credit' : 'Interest Debit';
      case 'expense': return subType || 'Expense';
      case 'other_income': return 'Other Income';
      case 'receipt': return 'Receipt';
      default: return type;
    }
  };

  const formatCategory = (type) => {
    switch (type) {
      case 'loan_transaction': return 'Loan';
      case 'investor_transaction': return 'Investor';
      case 'investor_interest': return 'Investor';
      case 'expense': return 'Expense';
      case 'other_income': return 'Income';
      case 'receipt': return 'Receipt';
      default: return type;
    }
  };

  const formatReconciliationType = (type) => {
    switch (type) {
      case 'expense': return 'Expense';
      case 'investor_interest': return 'Investor Interest';
      case 'other_income': return 'Other Income';
      case 'loan_repayment': return 'Loan Repayment';
      case 'loan_disbursement': return 'Loan Disbursement';
      case 'investor_credit': return 'Investor Credit';
      case 'investor_withdrawal': return 'Investor Withdrawal';
      case 'unknown': return 'Unknown';
      default: return type;
    }
  };

  const handleCleanupClick = (entry) => {
    setSelectedOrphanedReconciliation(entry);
    setCleanupDialogOpen(true);
  };

  const handleFindMatch = (entry) => {
    const searchValue = entry.entityName || formatCurrency(Math.abs(entry.amount));
    window.location.href = createPageUrl(`BankReconciliation?search=${encodeURIComponent(searchValue)}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Orphaned Entries</h1>
            <p className="text-slate-500 mt-1">
              System transactions not linked to bank statements
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="unreconciled" className="relative">
              Unreconciled Items
              {filteredEntries.length > 0 && (
                <Badge variant="secondary" className="ml-2">{filteredEntries.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="orphaned-reconciliations" className="relative">
              <AlertTriangle className="w-4 h-4 mr-1.5 text-amber-500" />
              Broken Reconciliations
              {orphanedReconciliations.length > 0 && (
                <Badge variant="destructive" className="ml-2">{orphanedReconciliations.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="unreconciled" className="space-y-4">
            {/* Show Accepted Button */}
            <div className="flex items-center justify-end gap-2">
              <Button
                variant={showAccepted ? "default" : "outline"}
                size="sm"
                onClick={() => setShowAccepted(!showAccepted)}
              >
                {showAccepted ? <Eye className="w-4 h-4 mr-2" /> : <EyeOff className="w-4 h-4 mr-2" />}
                {showAccepted ? 'Showing Accepted' : 'Show Accepted'} ({statsByType.accepted})
              </Button>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <Card className={`p-4 cursor-pointer transition-colors ${typeFilter === 'loan_transaction' ? 'ring-2 ring-blue-500' : 'hover:bg-blue-50'}`} onClick={() => setTypeFilter(typeFilter === 'loan_transaction' ? 'all' : 'loan_transaction')}>
                <p className="text-xs text-slate-500">Loan Transactions</p>
                <p className="text-xl font-bold text-blue-600">{statsByType.loan_transaction}</p>
              </Card>
              <Card className={`p-4 cursor-pointer transition-colors ${typeFilter === 'investor_transaction' ? 'ring-2 ring-purple-500' : 'hover:bg-purple-50'}`} onClick={() => setTypeFilter(typeFilter === 'investor_transaction' ? 'all' : 'investor_transaction')}>
                <p className="text-xs text-slate-500">Investor Transactions</p>
                <p className="text-xl font-bold text-purple-600">{statsByType.investor_transaction}</p>
              </Card>
              <Card className={`p-4 cursor-pointer transition-colors ${typeFilter === 'investor_interest' ? 'ring-2 ring-amber-500' : 'hover:bg-amber-50'}`} onClick={() => setTypeFilter(typeFilter === 'investor_interest' ? 'all' : 'investor_interest')}>
                <p className="text-xs text-slate-500">Investor Interest</p>
                <p className="text-xl font-bold text-amber-600">{statsByType.investor_interest}</p>
              </Card>
              <Card className={`p-4 cursor-pointer transition-colors ${typeFilter === 'expense' ? 'ring-2 ring-red-500' : 'hover:bg-red-50'}`} onClick={() => setTypeFilter(typeFilter === 'expense' ? 'all' : 'expense')}>
                <p className="text-xs text-slate-500">Expenses</p>
                <p className="text-xl font-bold text-red-600">{statsByType.expense}</p>
              </Card>
              <Card className={`p-4 cursor-pointer transition-colors ${typeFilter === 'other_income' ? 'ring-2 ring-emerald-500' : 'hover:bg-emerald-50'}`} onClick={() => setTypeFilter(typeFilter === 'other_income' ? 'all' : 'other_income')}>
                <p className="text-xs text-slate-500">Other Income</p>
                <p className="text-xl font-bold text-emerald-600">{statsByType.other_income}</p>
              </Card>
              <Card className={`p-4 cursor-pointer transition-colors ${typeFilter === 'receipt' ? 'ring-2 ring-cyan-500' : 'hover:bg-cyan-50'}`} onClick={() => setTypeFilter(typeFilter === 'receipt' ? 'all' : 'receipt')}>
                <p className="text-xs text-slate-500">Receipts</p>
                <p className="text-xl font-bold text-cyan-600">{statsByType.receipt}</p>
              </Card>
            </div>

            {/* Main Content */}
            <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                <div>
                  <CardTitle>Unreconciled Items</CardTitle>
                  <CardDescription>
                    {filteredEntries.length} entries not linked to bank statements
                    {filteredEntries.filter(e => e.accepted).length > 0 && showAccepted && (
                      <span className="text-emerald-600 ml-1">
                        ({filteredEntries.filter(e => e.accepted).length} accepted)
                      </span>
                    )}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Search..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 w-48"
                  />
                </div>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="loan_transaction">Loan Transactions</SelectItem>
                    <SelectItem value="investor_transaction">Investor Transactions</SelectItem>
                    <SelectItem value="investor_interest">Investor Interest</SelectItem>
                    <SelectItem value="expense">Expenses</SelectItem>
                    <SelectItem value="other_income">Other Income</SelectItem>
                    <SelectItem value="receipt">Receipts</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {entriesByYear.length > 1 && (
              <div className="flex items-center gap-2 mt-4">
                <Button variant="ghost" size="sm" onClick={expandAllYears}>Expand All</Button>
                <Button variant="ghost" size="sm" onClick={collapseAllYears}>Collapse All</Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : entriesByYear.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <AlertCircle className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                <p>No orphaned entries found</p>
                <p className="text-sm text-slate-400 mt-1">All transactions are linked to bank statements</p>
              </div>
            ) : (
              <div className="space-y-4">
                {entriesByYear.map((yearGroup) => (
                  <Collapsible
                    key={yearGroup.year}
                    open={expandedYears.has(yearGroup.year)}
                    onOpenChange={() => toggleYear(yearGroup.year)}
                  >
                    <CollapsibleTrigger asChild>
                      <button className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 rounded-lg border transition-colors">
                        <div className="flex items-center gap-3">
                          <ChevronDown className={`w-4 h-4 transition-transform ${expandedYears.has(yearGroup.year) ? '' : '-rotate-90'}`} />
                          <span className="font-semibold text-lg">FY {yearGroup.label}</span>
                          <Badge variant="outline">{yearGroup.entries.length} items</Badge>
                          {yearGroup.acceptedCount > 0 && (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                              {yearGroup.acceptedCount} accepted
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-emerald-600">+{formatCurrency(yearGroup.totalIn)}</span>
                          <span className="text-red-600">-{formatCurrency(yearGroup.totalOut)}</span>
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border rounded-b-lg border-t-0 overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-slate-50/50">
                              <TableHead className="w-[80px]">Date</TableHead>
                              <TableHead className="w-[80px]">Category</TableHead>
                              <TableHead className="w-[110px]">Type</TableHead>
                              <TableHead className="w-[140px]">Entity</TableHead>
                              <TableHead className="min-w-[250px]">Description</TableHead>
                              <TableHead className="text-right w-[100px]">Amount</TableHead>
                              <TableHead className="w-[70px]"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {yearGroup.entries.map((entry) => (
                              <TableRow
                                key={`${entry.type}-${entry.id}`}
                                className={entry.accepted ? 'bg-emerald-50/30' : ''}
                              >
                                <TableCell className="text-sm">
                                  {format(new Date(entry.date), 'dd MMM')}
                                </TableCell>
                                <TableCell>
                                  <span className={`text-xs font-medium ${
                                    entry.type === 'loan_transaction' ? 'text-blue-600' :
                                    entry.type === 'investor_transaction' || entry.type === 'investor_interest' ? 'text-purple-600' :
                                    entry.type === 'expense' ? 'text-red-600' :
                                    entry.type === 'other_income' ? 'text-emerald-600' :
                                    'text-cyan-600'
                                  }`}>
                                    {formatCategory(entry.type)}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className={getTypeBadgeColor(entry.type)}>
                                    {formatEntryType(entry.type, entry.subType)}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Link to={entry.entityLink} className="text-blue-600 hover:underline">
                                    <div className="truncate max-w-[130px]">{entry.entityName || '-'}</div>
                                    {entry.loanNumber && (
                                      <div className="text-xs text-slate-400 font-mono">#{entry.loanNumber}</div>
                                    )}
                                  </Link>
                                </TableCell>
                                <TableCell className="text-slate-600">
                                  <div className="truncate" title={entry.description}>
                                    {entry.description || '-'}
                                  </div>
                                  {entry.accepted && (
                                    <div className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                                      <Check className="w-3 h-3" />
                                      <span className="truncate" title={entry.acceptedReason}>
                                        {entry.acceptedReason}
                                      </span>
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell className={`text-right font-mono font-medium ${entry.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {entry.amount >= 0 ? '+' : ''}{formatCurrency(entry.amount)}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1">
                                    {entry.accepted ? (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                                        onClick={() => handleUnaccept(entry)}
                                        title="Remove accepted status"
                                      >
                                        <X className="w-4 h-4" />
                                      </Button>
                                    ) : (
                                      <>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50"
                                          onClick={() => handleAcceptClick(entry)}
                                          title="Accept as orphan"
                                        >
                                          <Check className="w-4 h-4" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7"
                                          onClick={() => handleFindMatch(entry)}
                                          title="Find matching bank entry"
                                        >
                                          <Search className="w-4 h-4" />
                                        </Button>
                                      </>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="orphaned-reconciliations" className="space-y-4">
            {/* Orphaned Reconciliations - bank statements marked as reconciled but linked entity deleted */}
            <Card>
              <CardHeader>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    <div>
                      <CardTitle>Broken Reconciliation Links</CardTitle>
                      <CardDescription>
                        Bank statements reconciled to deleted entities. These need cleanup so the bank entries can be re-reconciled.
                      </CardDescription>
                    </div>
                  </div>
                  {orphanedReconciliations.length > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleBulkCleanup}
                      disabled={cleaningUp}
                    >
                      {cleaningUp ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4 mr-2" />
                      )}
                      Clean Up All ({orphanedReconciliations.length})
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                  </div>
                ) : orphanedReconciliations.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <Check className="w-12 h-12 mx-auto mb-4 text-emerald-300" />
                    <p>No broken reconciliation links found</p>
                    <p className="text-sm text-slate-400 mt-1">All reconciled bank statements have valid linked entities</p>
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/50">
                          <TableHead className="w-[100px]">Bank Date</TableHead>
                          <TableHead className="min-w-[200px]">Bank Description</TableHead>
                          <TableHead className="text-right w-[100px]">Amount</TableHead>
                          <TableHead className="w-[140px]">Was Linked To</TableHead>
                          <TableHead className="w-[100px]">Status</TableHead>
                          <TableHead className="w-[80px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orphanedReconciliations.map((entry) => (
                          <TableRow key={entry.id} className="bg-red-50/30">
                            <TableCell className="text-sm">
                              {entry.bankStatement?.date
                                ? format(new Date(entry.bankStatement.date), 'dd MMM yyyy')
                                : '-'
                              }
                            </TableCell>
                            <TableCell className="text-slate-600">
                              <div className="truncate max-w-[280px]" title={entry.bankStatement?.description}>
                                {entry.bankStatement?.description || '-'}
                              </div>
                            </TableCell>
                            <TableCell className={`text-right font-mono font-medium ${
                              entry.bankStatement?.amount >= 0 ? 'text-emerald-600' : 'text-red-600'
                            }`}>
                              {entry.bankStatement?.amount !== undefined
                                ? formatCurrency(entry.bankStatement.amount)
                                : '-'
                              }
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                                <Unlink className="w-3 h-3 mr-1" />
                                {formatReconciliationType(entry.reconciliation_type)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                                Entity Deleted
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                                onClick={() => handleCleanupClick(entry)}
                                title="Clean up this orphaned reconciliation"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Cleanup Orphaned Reconciliation Dialog */}
      <Dialog open={cleanupDialogOpen} onOpenChange={setCleanupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clean Up Broken Reconciliation</DialogTitle>
            <DialogDescription>
              This will delete the reconciliation link and mark the bank statement as unreconciled so it can be matched again.
            </DialogDescription>
          </DialogHeader>
          {selectedOrphanedReconciliation && (
            <div className="space-y-4">
              <div className="p-3 bg-slate-50 rounded-lg border space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Bank Date:</span>
                  <span className="text-sm font-medium">
                    {selectedOrphanedReconciliation.bankStatement?.date
                      ? format(new Date(selectedOrphanedReconciliation.bankStatement.date), 'dd MMM yyyy')
                      : '-'
                    }
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Description:</span>
                  <span className="text-sm font-medium truncate max-w-[200px]">
                    {selectedOrphanedReconciliation.bankStatement?.description || '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Amount:</span>
                  <span className={`text-sm font-medium ${
                    selectedOrphanedReconciliation.bankStatement?.amount >= 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    {selectedOrphanedReconciliation.bankStatement?.amount !== undefined
                      ? formatCurrency(selectedOrphanedReconciliation.bankStatement.amount)
                      : '-'
                    }
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Was Linked To:</span>
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                    {formatReconciliationType(selectedOrphanedReconciliation.reconciliation_type)}
                  </Badge>
                </div>
              </div>
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                <p className="text-sm text-amber-800">
                  The linked {formatReconciliationType(selectedOrphanedReconciliation.reconciliation_type).toLowerCase()} has been deleted.
                  Cleaning up will allow you to re-reconcile this bank entry.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCleanupDialogOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => handleCleanupOrphanedReconciliation(selectedOrphanedReconciliation)}
              disabled={cleaningUp}
            >
              {cleaningUp && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Clean Up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Accept Orphan Dialog */}
      <Dialog open={acceptDialogOpen} onOpenChange={setAcceptDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept as Orphan</DialogTitle>
            <DialogDescription>
              Mark this entry as intentionally unreconciled. Provide a reason for audit purposes.
            </DialogDescription>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-4">
              <div className="p-3 bg-slate-50 rounded-lg border space-y-1">
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Type:</span>
                  <Badge variant="outline" className={getTypeBadgeColor(selectedEntry.type)}>
                    {formatEntryType(selectedEntry.type, selectedEntry.subType)}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Date:</span>
                  <span className="text-sm font-medium">{format(new Date(selectedEntry.date), 'dd MMM yyyy')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Amount:</span>
                  <span className={`text-sm font-medium ${selectedEntry.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatCurrency(Math.abs(selectedEntry.amount))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Entity:</span>
                  <span className="text-sm font-medium">{selectedEntry.entityName}</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Reason for accepting *</label>
                <Textarea
                  value={acceptReason}
                  onChange={(e) => setAcceptReason(e.target.value)}
                  placeholder="e.g., Internal transfer, Cash payment not banked, Historical entry before bank feed setup..."
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcceptDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAcceptSubmit}
              disabled={!acceptReason.trim() || acceptOrphanMutation.isPending}
            >
              {acceptOrphanMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Accept as Orphan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
