import { useState } from 'react';
import { api } from '@/api/dataClient';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/lib/OrganizationContext';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, TrendingUp, TrendingDown, DollarSign, ArrowUpDown, ChevronLeft, ChevronRight, FileCheck, ExternalLink } from 'lucide-react';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

export default function Ledger() {
  const navigate = useNavigate();
  const { currentOrganization } = useOrganization();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const { data: transactions = [], isLoading: transactionsLoading } = useQuery({
    queryKey: ['transactions', currentOrganization?.id],
    queryFn: () => api.entities.Transaction.listAll('-date'),
    enabled: !!currentOrganization
  });

  const { data: loans = [], isLoading: loansLoading } = useQuery({
    queryKey: ['loans', currentOrganization?.id],
    queryFn: () => api.entities.Loan.list('-created_date'),
    enabled: !!currentOrganization
  });

  const { data: expenses = [], isLoading: expensesLoading } = useQuery({
    queryKey: ['expenses', currentOrganization?.id],
    queryFn: () => api.entities.Expense.list('-date'),
    enabled: !!currentOrganization
  });

  const { data: investorTransactions = [], isLoading: investorTxLoading } = useQuery({
    queryKey: ['investor-transactions', currentOrganization?.id],
    queryFn: () => api.entities.InvestorTransaction.list('-date'),
    enabled: !!currentOrganization
  });

  const { data: investors = [], isLoading: investorsLoading } = useQuery({
    queryKey: ['investors', currentOrganization?.id],
    queryFn: () => api.entities.Investor.list(),
    enabled: !!currentOrganization
  });

  const { data: reconciliationEntries = [], isLoading: reconcilingLoading } = useQuery({
    queryKey: ['reconciliation-entries', currentOrganization?.id],
    queryFn: () => api.entities.ReconciliationEntry.listAll('-created_at'),
    enabled: !!currentOrganization
  });

  const { data: bankStatements = [], isLoading: bankStatementsLoading } = useQuery({
    queryKey: ['bank-statements', currentOrganization?.id],
    queryFn: () => api.entities.BankStatement.list('-statement_date'),
    enabled: !!currentOrganization
  });

  const isLoading = transactionsLoading || loansLoading || expensesLoading || investorTxLoading || investorsLoading || reconcilingLoading || bankStatementsLoading;

  // Create investor lookup map
  const investorMap = {};
  investors.forEach(inv => {
    investorMap[inv.id] = inv.name;
  });

  // Create lookup maps for reconciliation
  // Map from transaction ID to bank statement info
  const txToReconciliation = {};
  const invTxToReconciliation = {};
  const expToReconciliation = {};

  reconciliationEntries.forEach(re => {
    const bankStatement = bankStatements.find(bs => bs.id === re.bank_statement_id);
    const reconInfo = {
      bankStatementId: re.bank_statement_id,
      bankDate: bankStatement?.statement_date,
      bankDescription: bankStatement?.description,
      bankAmount: bankStatement?.amount,
      reconciliationType: re.reconciliation_type
    };

    if (re.loan_transaction_id) {
      txToReconciliation[re.loan_transaction_id] = reconInfo;
    }
    if (re.investor_transaction_id) {
      invTxToReconciliation[re.investor_transaction_id] = reconInfo;
    }
    if (re.expense_id) {
      expToReconciliation[re.expense_id] = reconInfo;
    }
  });

  // Create loan lookup map
  const loanMap = {};
  loans.forEach((loan, index) => {
    loanMap[loan.id] = {
      ...loan,
      displayId: `#${1000 + index}`
    };
  });

  // Combine all entries into a single ledger
  const ledgerEntries = [
    // Repayments (money in)
    ...transactions
      .filter(t => !t.is_deleted && t.type === 'Repayment')
      .map(t => {
        const loan = loanMap[t.loan_id];
        const recon = txToReconciliation[t.id];
        return {
          id: `tx-${t.id}`,
          date: t.date,
          type: 'repayment',
          description: `Repayment - ${t.notes || 'Loan payment'}`,
          borrower: loan?.borrower_name || null,
          loanId: loan?.displayId || null,
          reference: t.reference,
          amount_in: t.amount,
          amount_out: 0,
          balance: 0,
          reconciliation: recon || null
        };
      }),

    // Disbursements (money out) - check for disbursement transactions
    ...transactions
      .filter(t => !t.is_deleted && t.type === 'Disbursement')
      .map(t => {
        const loan = loanMap[t.loan_id];
        const recon = txToReconciliation[t.id];
        return {
          id: `tx-disb-${t.id}`,
          date: t.date,
          type: 'disbursement',
          description: `Loan Disbursement - ${loan?.borrower_name || 'Unknown'}`,
          borrower: loan?.borrower_name || null,
          loanId: loan?.displayId || null,
          reference: t.reference,
          amount_in: 0,
          amount_out: t.amount,
          balance: 0,
          reconciliation: recon || null
        };
      }),

    // Loan start disbursements (fallback for loans without disbursement transactions)
    ...loans
      .filter(l => !l.is_deleted && l.status !== 'Pending' && !transactions.some(t => t.loan_id === l.id && t.type === 'Disbursement'))
      .map(l => {
        const loan = loanMap[l.id];
        return {
          id: `loan-${l.id}`,
          date: l.start_date,
          type: 'disbursement',
          description: `Loan Disbursement - ${l.borrower_name}`,
          borrower: l.borrower_name,
          loanId: loan?.displayId || null,
          reference: l.product_name,
          amount_in: 0,
          amount_out: l.net_disbursed || l.principal_amount,
          balance: 0,
          reconciliation: null
        };
      }),

    // Expenses (money out)
    ...expenses.map(e => {
      const recon = expToReconciliation[e.id];
      return {
        id: `exp-${e.id}`,
        date: e.date,
        type: 'expense',
        description: `${e.type_name} - ${e.description || 'Business expense'}`,
        borrower: e.borrower_name || null,
        loanId: null,
        reference: null,
        amount_in: 0,
        amount_out: e.amount,
        balance: 0,
        reconciliation: recon || null
      };
    }),

    // Investor capital in (money in from investors)
    ...investorTransactions
      .filter(t => t.type === 'capital_in')
      .map(t => {
        const recon = invTxToReconciliation[t.id];
        return {
          id: `inv-in-${t.id}`,
          date: t.date,
          type: 'investor_capital_in',
          description: `Capital from Investor - ${investorMap[t.investor_id] || 'Unknown'}`,
          borrower: null,
          loanId: null,
          reference: t.reference,
          amount_in: t.amount,
          amount_out: 0,
          balance: 0,
          reconciliation: recon || null
        };
      }),

    // Investor capital out (money out to investors)
    ...investorTransactions
      .filter(t => t.type === 'capital_out')
      .map(t => {
        const recon = invTxToReconciliation[t.id];
        return {
          id: `inv-out-${t.id}`,
          date: t.date,
          type: 'investor_capital_out',
          description: `Capital Withdrawal - ${investorMap[t.investor_id] || 'Unknown'}`,
          borrower: null,
          loanId: null,
          reference: t.reference,
          amount_in: 0,
          amount_out: t.amount,
          balance: 0,
          reconciliation: recon || null
        };
      }),

    // Investor interest payments (money out to investors)
    ...investorTransactions
      .filter(t => t.type === 'interest_payment')
      .map(t => {
        const recon = invTxToReconciliation[t.id];
        return {
          id: `inv-int-${t.id}`,
          date: t.date,
          type: 'investor_interest',
          description: `Interest Payment - ${investorMap[t.investor_id] || 'Unknown'}`,
          borrower: null,
          loanId: null,
          reference: t.reference,
          amount_in: 0,
          amount_out: t.amount,
          balance: 0,
          reconciliation: recon || null
        };
      })
  ];

  // Sort entries
  const sortedEntries = [...ledgerEntries].sort((a, b) => {
    let aVal, bVal;
    
    switch(sortField) {
      case 'date':
        aVal = new Date(a.date);
        bVal = new Date(b.date);
        break;
      case 'description':
        aVal = a.description.toLowerCase();
        bVal = b.description.toLowerCase();
        break;
      case 'amount':
        aVal = a.amount_in || a.amount_out;
        bVal = b.amount_in || b.amount_out;
        break;
      default:
        aVal = new Date(a.date);
        bVal = new Date(b.date);
    }
    
    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Calculate running balance
  let runningBalance = 0;
  const entriesWithBalance = sortedEntries.map(entry => {
    runningBalance += entry.amount_in - entry.amount_out;
    return { ...entry, balance: runningBalance };
  });

  // Filter entries
  const filteredEntries = entriesWithBalance.filter(entry => {
    const search = searchTerm.toLowerCase();
    return entry.description.toLowerCase().includes(search) ||
           entry.borrower?.toLowerCase().includes(search) ||
           entry.loanId?.toLowerCase().includes(search) ||
           entry.reference?.toLowerCase().includes(search);
  });

  // Pagination
  const totalPages = Math.ceil(filteredEntries.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedEntries = filteredEntries.slice(startIndex, endIndex);

  // Reset to page 1 when search or items per page changes
  const handleSearchChange = (value) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleItemsPerPageChange = (value) => {
    setItemsPerPage(parseInt(value));
    setCurrentPage(1);
  };

  // Calculate totals
  const totalIn = ledgerEntries.reduce((sum, e) => sum + e.amount_in, 0);
  const totalOut = ledgerEntries.reduce((sum, e) => sum + e.amount_out, 0);
  const netPosition = totalIn - totalOut;

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getTypeColor = (type) => {
    const colors = {
      repayment: 'bg-emerald-100 text-emerald-700',
      disbursement: 'bg-blue-100 text-blue-700',
      expense: 'bg-red-100 text-red-700',
      investor_capital_in: 'bg-purple-100 text-purple-700',
      investor_capital_out: 'bg-orange-100 text-orange-700',
      investor_interest: 'bg-amber-100 text-amber-700'
    };
    return colors[type];
  };

  const getTypeLabel = (type) => {
    const labels = {
      repayment: 'Repayment',
      disbursement: 'Disbursement',
      expense: 'Expense',
      investor_capital_in: 'Investor Capital In',
      investor_capital_out: 'Investor Capital Out',
      investor_interest: 'Investor Interest'
    };
    return labels[type];
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Ledger</h1>
          <p className="text-slate-500 mt-1">Complete view of all financial transactions</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 border-emerald-200">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-emerald-600 font-medium">Total In</p>
                  <p className="text-2xl font-bold text-emerald-900">{formatCurrency(totalIn)}</p>
                </div>
                <div className="p-3 rounded-xl bg-emerald-200">
                  <TrendingUp className="w-5 h-5 text-emerald-700" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-red-50 to-red-100/50 border-red-200">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-red-600 font-medium">Total Out</p>
                  <p className="text-2xl font-bold text-red-900">{formatCurrency(totalOut)}</p>
                </div>
                <div className="p-3 rounded-xl bg-red-200">
                  <TrendingDown className="w-5 h-5 text-red-700" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={`bg-gradient-to-br ${netPosition >= 0 ? 'from-blue-50 to-blue-100/50 border-blue-200' : 'from-amber-50 to-amber-100/50 border-amber-200'}`}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm font-medium ${netPosition >= 0 ? 'text-blue-600' : 'text-amber-600'}`}>Net Position</p>
                  <p className={`text-2xl font-bold ${netPosition >= 0 ? 'text-blue-900' : 'text-amber-900'}`}>
                    {formatCurrency(Math.abs(netPosition))}
                  </p>
                </div>
                <div className={`p-3 rounded-xl ${netPosition >= 0 ? 'bg-blue-200' : 'bg-amber-200'}`}>
                  <DollarSign className={`w-5 h-5 ${netPosition >= 0 ? 'text-blue-700' : 'text-amber-700'}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Per Page */}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search ledger..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">Show:</span>
            <Select value={itemsPerPage.toString()} onValueChange={handleItemsPerPageChange}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-slate-600">per page</span>
          </div>
        </div>

        {/* Ledger Table */}
        <Card>
          <CardHeader>
            <CardTitle>Transaction Ledger</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {Array(8).fill(0).map((_, i) => (
                  <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <TooltipProvider>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>
                        <button 
                          onClick={() => handleSort('date')}
                          className="flex items-center gap-1 hover:text-slate-900 font-semibold"
                        >
                          Date
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>
                        <button 
                          onClick={() => handleSort('description')}
                          className="flex items-center gap-1 hover:text-slate-900 font-semibold"
                        >
                          Description
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </TableHead>
                      <TableHead>Loan ID</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Money In</TableHead>
                      <TableHead className="text-right">Money Out</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-center w-12">
                        <Tooltip>
                          <TooltipTrigger>
                            <FileCheck className="w-4 h-4 text-slate-400" />
                          </TooltipTrigger>
                          <TooltipContent>Reconciled with bank</TooltipContent>
                        </Tooltip>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-12 text-slate-500">
                          No transactions found
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedEntries.map((entry) => (
                        <TableRow key={entry.id} className="hover:bg-slate-50">
                          <TableCell className="font-medium text-slate-700">
                            {format(new Date(entry.date), 'dd MMM yyyy')}
                          </TableCell>
                          <TableCell>
                            <Badge className={getTypeColor(entry.type)}>
                              {getTypeLabel(entry.type)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium text-slate-900">{entry.description}</p>
                              {entry.borrower && (
                                <p className="text-xs text-slate-500">{entry.borrower}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm text-slate-700">
                            {entry.loanId || '-'}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">
                            {entry.reference || '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold text-emerald-600">
                            {entry.amount_in > 0 ? formatCurrency(entry.amount_in) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold text-red-600">
                            {entry.amount_out > 0 ? formatCurrency(entry.amount_out) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono font-bold text-slate-900">
                            {formatCurrency(entry.balance)}
                          </TableCell>
                          <TableCell className="text-center">
                            {entry.reconciliation ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => navigate(`/BankReconciliation?view=${entry.reconciliation.bankStatementId}`)}
                                    className="inline-flex items-center justify-center p-1.5 rounded-full bg-emerald-100 hover:bg-emerald-200 transition-colors"
                                  >
                                    <FileCheck className="w-4 h-4 text-emerald-600" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-xs">
                                  <div className="space-y-1">
                                    <p className="font-medium text-emerald-600">Reconciled</p>
                                    {entry.reconciliation.bankDate && (
                                      <p className="text-xs">
                                        Bank date: {format(new Date(entry.reconciliation.bankDate), 'dd MMM yyyy')}
                                      </p>
                                    )}
                                    {entry.reconciliation.bankAmount && (
                                      <p className="text-xs">
                                        Bank amount: {formatCurrency(Math.abs(entry.reconciliation.bankAmount))}
                                      </p>
                                    )}
                                    {entry.reconciliation.bankDescription && (
                                      <p className="text-xs truncate">
                                        {entry.reconciliation.bankDescription.substring(0, 50)}
                                        {entry.reconciliation.bankDescription.length > 50 ? '...' : ''}
                                      </p>
                                    )}
                                    <p className="text-xs text-slate-400 pt-1">Click to view in Bank Reconciliation</p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              </TooltipProvider>
            )}

            {/* Pagination */}
            {!isLoading && filteredEntries.length > 0 && (
              <div className="flex items-center justify-between px-4 py-4 border-t">
                <div className="text-sm text-slate-600">
                  Showing {startIndex + 1} to {Math.min(endIndex, filteredEntries.length)} of {filteredEntries.length} entries
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <div className="text-sm text-slate-600">
                    Page {currentPage} of {totalPages}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}