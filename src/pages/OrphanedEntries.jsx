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
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, Search, Loader2, ChevronLeft, ChevronRight, ChevronDown, Check, X, Eye, EyeOff } from 'lucide-react';
import { format, getYear } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from 'sonner';

export default function OrphanedEntries() {
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAccepted, setShowAccepted] = useState(false);
  const [expandedYears, setExpandedYears] = useState(new Set());

  // Accept orphan dialog state
  const [acceptDialogOpen, setAcceptDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [acceptReason, setAcceptReason] = useState('');

  const queryClient = useQueryClient();

  // Query all reconciliation entries to know what's already reconciled
  const { data: reconciliationEntries = [] } = useQuery({
    queryKey: ['reconciliation-entries-all'],
    queryFn: () => api.entities.ReconciliationEntry.list()
  });

  // Query accepted orphans
  const { data: acceptedOrphans = [] } = useQuery({
    queryKey: ['accepted-orphans'],
    queryFn: () => api.entities.AcceptedOrphan.list()
  });

  // Loan transactions (repayments & disbursements)
  const { data: loanTransactions = [], isLoading: loadingLoans } = useQuery({
    queryKey: ['loan-transactions-all'],
    queryFn: () => api.entities.Transaction.list('-date')
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

  // Expenses
  const { data: expenses = [], isLoading: loadingExpenses } = useQuery({
    queryKey: ['expenses-all'],
    queryFn: () => api.entities.Expense.list('-date')
  });

  // Other income
  const { data: otherIncome = [], isLoading: loadingOtherIncome } = useQuery({
    queryKey: ['other-income-all'],
    queryFn: () => api.entities.OtherIncome.list('-date')
  });

  // Receipts (filed only)
  const { data: receipts = [], isLoading: loadingReceipts } = useQuery({
    queryKey: ['receipts-all'],
    queryFn: () => api.entities.ReceiptDraft.list('-date')
  });

  const isLoading = loadingLoans || loadingInvestors || loadingInterest || loadingExpenses || loadingOtherIncome || loadingReceipts;

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
        entries.push({
          id: tx.id,
          type: 'loan_transaction',
          subType: tx.type,
          date: tx.date,
          amount: tx.type === 'Disbursement' ? -Math.abs(tx.amount) : tx.amount,
          description: tx.reference || tx.notes,
          entityName: tx.borrower_name,
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
        entries.push({
          id: tx.id,
          type: 'investor_transaction',
          subType: tx.type,
          date: tx.date,
          amount: tx.type === 'capital_out' ? -Math.abs(tx.amount) : tx.amount,
          description: tx.notes,
          entityName: tx.investor_name,
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
        entries.push({
          id: entry.id,
          type: 'investor_interest',
          subType: entry.type,
          date: entry.date,
          amount: entry.type === 'debit' ? -Math.abs(entry.amount) : entry.amount,
          description: entry.description,
          entityName: entry.investor_name,
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
  }, [loanTransactions, investorTransactions, investorInterest, expenses, otherIncome, receipts, reconciledIds, acceptedOrphanMap]);

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

  // Group entries by year
  const entriesByYear = useMemo(() => {
    const groups = new Map();

    filteredEntries.forEach(entry => {
      const year = getYear(new Date(entry.date));
      if (!groups.has(year)) {
        groups.set(year, {
          year,
          entries: [],
          totalIn: 0,
          totalOut: 0,
          acceptedCount: 0
        });
      }
      const group = groups.get(year);
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

    // Sort by year descending
    return Array.from(groups.values()).sort((a, b) => b.year - a.year);
  }, [filteredEntries]);

  // Initialize expanded years to show current year expanded by default
  useMemo(() => {
    if (entriesByYear.length > 0 && expandedYears.size === 0) {
      const currentYear = new Date().getFullYear();
      if (entriesByYear.find(g => g.year === currentYear)) {
        setExpandedYears(new Set([currentYear]));
      } else if (entriesByYear.length > 0) {
        setExpandedYears(new Set([entriesByYear[0].year]));
      }
    }
  }, [entriesByYear]);

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
          <div className="flex items-center gap-2">
            <Button
              variant={showAccepted ? "default" : "outline"}
              size="sm"
              onClick={() => setShowAccepted(!showAccepted)}
            >
              {showAccepted ? <Eye className="w-4 h-4 mr-2" /> : <EyeOff className="w-4 h-4 mr-2" />}
              {showAccepted ? 'Showing Accepted' : 'Show Accepted'} ({statsByType.accepted})
            </Button>
          </div>
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
                          <span className="font-semibold text-lg">{yearGroup.year}</span>
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
                              <TableHead className="w-[110px]">Type</TableHead>
                              <TableHead className="w-[140px]">Entity</TableHead>
                              <TableHead className="min-w-[300px]">Description</TableHead>
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
                                  <Badge variant="outline" className={getTypeBadgeColor(entry.type)}>
                                    {formatEntryType(entry.type, entry.subType)}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Link to={entry.entityLink} className="text-blue-600 hover:underline truncate block max-w-[130px]">
                                    {entry.entityName || '-'}
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
      </div>

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
