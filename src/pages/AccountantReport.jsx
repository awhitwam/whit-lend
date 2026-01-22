import { useState, useMemo } from 'react';
import { api } from '@/api/dataClient';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/lib/OrganizationContext';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileDown, FileSpreadsheet, Calendar, AlertCircle, CheckCircle2 } from 'lucide-react';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { format, subMonths, startOfMonth } from 'date-fns';
import { generateAccountantReportPDF, generateAccountantReportCSV } from '@/lib/accountantReportGenerator';

export default function AccountantReport() {
  const { currentOrganization } = useOrganization();

  // Default to last 12 months
  const [fromDate, setFromDate] = useState(() => format(startOfMonth(subMonths(new Date(), 12)), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [isExporting, setIsExporting] = useState(false);

  // Fetch all required data
  const { data: bankStatements = [], isLoading: loadingBank } = useQuery({
    queryKey: ['bank-statements-all', currentOrganization?.id],
    queryFn: () => api.entities.BankStatement.listAll('-statement_date'),
    enabled: !!currentOrganization
  });

  const { data: reconciliationEntries = [], isLoading: loadingRecon } = useQuery({
    queryKey: ['reconciliation-entries-all', currentOrganization?.id],
    queryFn: () => api.entities.ReconciliationEntry.listAll('-created_at'),
    enabled: !!currentOrganization
  });

  const { data: loanTransactions = [], isLoading: loadingLoanTx } = useQuery({
    queryKey: ['loan-transactions-all', currentOrganization?.id],
    queryFn: () => api.entities.Transaction.listAll('-date'),
    enabled: !!currentOrganization
  });

  const { data: loans = [], isLoading: loadingLoans } = useQuery({
    queryKey: ['loans', currentOrganization?.id],
    queryFn: () => api.entities.Loan.list('-created_date'),
    enabled: !!currentOrganization
  });

  const { data: borrowers = [], isLoading: loadingBorrowers } = useQuery({
    queryKey: ['borrowers', currentOrganization?.id],
    queryFn: () => api.entities.Borrower.list('full_name'),
    enabled: !!currentOrganization
  });

  const { data: investorTransactions = [], isLoading: loadingInvTx } = useQuery({
    queryKey: ['investor-transactions-all', currentOrganization?.id],
    queryFn: () => api.entities.InvestorTransaction.listAll('-date'),
    enabled: !!currentOrganization
  });

  const { data: investors = [], isLoading: loadingInvestors } = useQuery({
    queryKey: ['investors', currentOrganization?.id],
    queryFn: () => api.entities.Investor.list(),
    enabled: !!currentOrganization
  });

  const { data: expenses = [], isLoading: loadingExpenses } = useQuery({
    queryKey: ['expenses-all', currentOrganization?.id],
    queryFn: () => api.entities.Expense.listAll('-date'),
    enabled: !!currentOrganization
  });

  const { data: expenseTypes = [] } = useQuery({
    queryKey: ['expense-types', currentOrganization?.id],
    queryFn: () => api.entities.ExpenseType.list('name'),
    enabled: !!currentOrganization
  });

  const { data: investorInterest = [] } = useQuery({
    queryKey: ['investor-interest-all', currentOrganization?.id],
    queryFn: () => api.entities.InvestorInterest.list('-date'),
    enabled: !!currentOrganization
  });

  const { data: otherIncome = [] } = useQuery({
    queryKey: ['other-income-all', currentOrganization?.id],
    queryFn: () => api.entities.OtherIncome.list('-date'),
    enabled: !!currentOrganization
  });

  const isLoading = loadingBank || loadingRecon || loadingLoanTx || loadingLoans ||
                    loadingBorrowers || loadingInvTx || loadingInvestors || loadingExpenses;

  // Build lookup maps
  const loanMap = useMemo(() => {
    const map = {};
    loans.forEach(l => { map[l.id] = l; });
    return map;
  }, [loans]);

  const borrowerMap = useMemo(() => {
    const map = {};
    borrowers.forEach(b => { map[b.id] = b; });
    return map;
  }, [borrowers]);

  const investorMap = useMemo(() => {
    const map = {};
    investors.forEach(i => { map[i.id] = i; });
    return map;
  }, [investors]);

  const loanTxMap = useMemo(() => {
    const map = {};
    loanTransactions.forEach(tx => { map[tx.id] = tx; });
    return map;
  }, [loanTransactions]);

  const investorTxMap = useMemo(() => {
    const map = {};
    investorTransactions.forEach(tx => { map[tx.id] = tx; });
    return map;
  }, [investorTransactions]);

  const expenseMap = useMemo(() => {
    const map = {};
    expenses.forEach(e => { map[e.id] = e; });
    return map;
  }, [expenses]);

  const expenseTypeMap = useMemo(() => {
    const map = {};
    expenseTypes.forEach(t => { map[t.id] = t.name; });
    return map;
  }, [expenseTypes]);

  const interestMap = useMemo(() => {
    const map = {};
    investorInterest.forEach(i => { map[i.id] = i; });
    return map;
  }, [investorInterest]);

  const otherIncomeMap = useMemo(() => {
    const map = {};
    otherIncome.forEach(o => { map[o.id] = o; });
    return map;
  }, [otherIncome]);

  // Build reconciliation lookup by bank statement ID
  const reconByBankId = useMemo(() => {
    const map = {};
    reconciliationEntries.forEach(re => {
      if (!map[re.bank_statement_id]) {
        map[re.bank_statement_id] = [];
      }
      map[re.bank_statement_id].push(re);
    });
    return map;
  }, [reconciliationEntries]);

  // Process report data
  const reportData = useMemo(() => {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);

    return bankStatements
      .filter(bs => {
        const date = new Date(bs.statement_date);
        return date >= from && date <= to;
      })
      .sort((a, b) => new Date(a.statement_date) - new Date(b.statement_date))
      .map(bs => {
        const recons = reconByBankId[bs.id] || [];
        const isReconciled = bs.is_reconciled;

        let reconciledTo = null;
        let entityDetails = null;
        let borrowerId = null;
        // Notes show unreconcilable reason (for entries that couldn't be reconciled)
        const notes = bs.unreconcilable_reason || null;
        // Loan repayment breakdown
        let principalAmount = null;
        let interestAmount = null;
        let feesAmount = null;

        if (recons.length > 0) {
          const re = recons[0]; // Primary reconciliation

          if (re.loan_transaction_id) {
            const loanTx = loanTxMap[re.loan_transaction_id];
            if (loanTx) {
              const loan = loanMap[loanTx.loan_id];
              const borrower = loan?.borrower_id ? borrowerMap[loan.borrower_id] : null;
              reconciledTo = loanTx.type === 'Repayment' ? 'Loan Repayment' : 'Loan Disbursement';
              entityDetails = `${loan?.loan_number || '-'} - ${loan?.borrower_name || '-'}`;
              borrowerId = borrower?.unique_number || null;
              // Add breakdown for repayments
              if (loanTx.type === 'Repayment') {
                principalAmount = loanTx.principal_applied || 0;
                interestAmount = loanTx.interest_applied || 0;
                feesAmount = (loanTx.deducted_fee || 0) + (loanTx.deducted_interest || 0);
              }
            }
          } else if (re.investor_transaction_id) {
            const invTx = investorTxMap[re.investor_transaction_id];
            if (invTx) {
              const investor = investorMap[invTx.investor_id];
              reconciledTo = invTx.type === 'capital_in' ? 'Investor Credit' : 'Investor Withdrawal';
              entityDetails = investor?.business_name || investor?.name || '-';
            }
          } else if (re.expense_id) {
            const expense = expenseMap[re.expense_id];
            if (expense) {
              reconciledTo = 'Expense';
              entityDetails = expense.type_name || expenseTypeMap[expense.type_id] || 'Expense';
            }
          } else if (re.interest_id) {
            const interest = interestMap[re.interest_id];
            if (interest) {
              const investor = investorMap[interest.investor_id];
              reconciledTo = 'Investor Interest';
              entityDetails = investor?.business_name || investor?.name || '-';
            }
          } else if (re.other_income_id) {
            const income = otherIncomeMap[re.other_income_id];
            if (income) {
              reconciledTo = 'Other Income';
              entityDetails = income.description || '-';
            }
          } else if (re.reconciliation_type === 'offset') {
            reconciledTo = 'Offset (Funds Returned)';
            entityDetails = '-';
          }
        }

        return {
          id: bs.id,
          date: bs.statement_date,
          description: bs.description,
          amount: bs.amount,
          type: bs.amount >= 0 ? 'Credit' : 'Debit',
          isReconciled,
          reconciledTo,
          entityDetails,
          borrowerId,
          notes,
          principalAmount,
          interestAmount,
          feesAmount
        };
      });
  }, [bankStatements, fromDate, toDate, reconByBankId, loanTxMap, loanMap, borrowerMap, investorTxMap, investorMap, expenseMap, expenseTypeMap, interestMap, otherIncomeMap]);

  // Summary stats
  const summary = useMemo(() => {
    const totalCredits = reportData.filter(r => r.amount > 0).reduce((sum, r) => sum + r.amount, 0);
    const totalDebits = reportData.filter(r => r.amount < 0).reduce((sum, r) => sum + Math.abs(r.amount), 0);
    const reconciledCount = reportData.filter(r => r.isReconciled).length;
    return {
      total: reportData.length,
      totalCredits,
      totalDebits,
      netMovement: totalCredits - totalDebits,
      reconciledCount,
      reconciledPercent: reportData.length > 0 ? Math.round((reconciledCount / reportData.length) * 100) : 0
    };
  }, [reportData]);

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      generateAccountantReportPDF(reportData, {
        fromDate,
        toDate,
        organization: currentOrganization
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      generateAccountantReportCSV(reportData, { fromDate, toDate });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Accountant Report</h1>
          <p className="text-sm text-slate-500">Bank transactions with reconciliation details for your accountant</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleExportCSV}
            disabled={isLoading || isExporting || reportData.length === 0}
          >
            {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-2" />}
            Export CSV
          </Button>
          <Button
            onClick={handleExportPDF}
            disabled={isLoading || isExporting || reportData.length === 0}
          >
            {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileDown className="w-4 h-4 mr-2" />}
            Export PDF
          </Button>
        </div>
      </div>

      {/* Date Range Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Report Period
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="from-date">From Date</Label>
              <Input
                id="from-date"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-44"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to-date">To Date</Label>
              <Input
                id="to-date"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-44"
              />
            </div>
            <div className="text-sm text-slate-500">
              {reportData.length} transactions in selected period
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Total Transactions</p>
            <p className="text-2xl font-bold">{summary.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Total Credits</p>
            <p className="text-2xl font-bold text-emerald-600">{formatCurrency(summary.totalCredits)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Total Debits</p>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(summary.totalDebits)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Net Movement</p>
            <p className={`text-2xl font-bold ${summary.netMovement >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatCurrency(summary.netMovement)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Reconciled</p>
            <p className="text-2xl font-bold">{summary.reconciledPercent}%</p>
            <p className="text-xs text-slate-400">{summary.reconciledCount} of {summary.total}</p>
          </CardContent>
        </Card>
      </div>

      {/* Transactions Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              <span className="ml-2 text-slate-500">Loading transactions...</span>
            </div>
          ) : reportData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <AlertCircle className="w-8 h-8 mb-2" />
              <p>No transactions found in the selected date range</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="w-24">Date</TableHead>
                    <TableHead className="min-w-[200px]">Description</TableHead>
                    <TableHead className="w-28 text-right">Amount</TableHead>
                    <TableHead className="w-20">Type</TableHead>
                    <TableHead className="w-36">Reconciled To</TableHead>
                    <TableHead className="min-w-[180px]">Entity Details</TableHead>
                    <TableHead className="w-24">Borrower ID</TableHead>
                    <TableHead className="w-24 text-right">Principal</TableHead>
                    <TableHead className="w-24 text-right">Interest</TableHead>
                    <TableHead className="w-24 text-right">Fees</TableHead>
                    <TableHead className="min-w-[150px]">Unreconcilable Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.map((row) => (
                    <TableRow key={row.id} className={!row.isReconciled ? 'bg-amber-50/50' : ''}>
                      <TableCell className="font-mono text-sm">
                        {format(new Date(row.date), 'dd/MM/yyyy')}
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate text-sm" title={row.description}>
                        {row.description}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-sm ${row.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {formatCurrency(row.amount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.type === 'Credit' ? 'default' : 'secondary'} className="text-xs">
                          {row.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {row.isReconciled ? (
                          <div className="flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            <span className="text-xs text-slate-600">{row.reconciledTo || 'Reconciled'}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                            <span className="text-xs text-amber-600">Not reconciled</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600 max-w-[200px] truncate" title={row.entityDetails}>
                        {row.entityDetails || '-'}
                      </TableCell>
                      <TableCell className="text-sm font-mono text-slate-500">
                        {row.borrowerId || '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-slate-600">
                        {row.principalAmount !== null ? formatCurrency(row.principalAmount) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-slate-600">
                        {row.interestAmount !== null ? formatCurrency(row.interestAmount) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-slate-600">
                        {row.feesAmount !== null && row.feesAmount > 0 ? formatCurrency(row.feesAmount) : '-'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 max-w-[200px] truncate" title={row.notes}>
                        {row.notes || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
