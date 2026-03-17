import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/lib/OrganizationContext';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Calendar, TrendingUp, TrendingDown, ArrowRightLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { format, subMonths, startOfMonth } from 'date-fns';

export default function IncomeExpenditureReport() {
  const { currentOrganization } = useOrganization();
  const navigate = useNavigate();

  // Default to last 12 months
  const [fromDate, setFromDate] = useState(() => format(startOfMonth(subMonths(new Date(), 12)), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  // Track which detail sections are expanded
  const [expandedRows, setExpandedRows] = useState(new Set());

  const toggleRow = (key) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Fetch all required data
  const { data: transactions = [], isLoading: loadingTx } = useQuery({
    queryKey: ['ie-transactions', currentOrganization?.id],
    queryFn: () => api.entities.Transaction.listAll('-date'),
    enabled: !!currentOrganization
  });

  const { data: loans = [], isLoading: loadingLoans } = useQuery({
    queryKey: ['ie-loans', currentOrganization?.id],
    queryFn: () => api.entities.Loan.list('-created_at'),
    enabled: !!currentOrganization
  });

  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ['ie-products', currentOrganization?.id],
    queryFn: () => api.entities.LoanProduct.list('name'),
    enabled: !!currentOrganization
  });

  const { data: expenses = [], isLoading: loadingExpenses } = useQuery({
    queryKey: ['ie-expenses', currentOrganization?.id],
    queryFn: () => api.entities.Expense.listAll('-date'),
    enabled: !!currentOrganization
  });

  const { data: otherIncome = [], isLoading: loadingOther } = useQuery({
    queryKey: ['ie-other-income', currentOrganization?.id],
    queryFn: () => api.entities.OtherIncome.list('-date'),
    enabled: !!currentOrganization
  });

  const { data: investorInterest = [], isLoading: loadingInvestor } = useQuery({
    queryKey: ['ie-investor-interest', currentOrganization?.id],
    queryFn: () => api.entities.InvestorInterest.list('-date'),
    enabled: !!currentOrganization
  });

  const { data: investors = [] } = useQuery({
    queryKey: ['ie-investors', currentOrganization?.id],
    queryFn: () => api.entities.Investor.list(),
    enabled: !!currentOrganization
  });

  const isLoading = loadingTx || loadingLoans || loadingProducts || loadingExpenses || loadingOther || loadingInvestor;

  // Build lookup maps
  const { rentLoanIds, loanMap, investorMap } = useMemo(() => {
    const productMap = {};
    for (const p of products) productMap[p.id] = p;

    const lMap = {};
    const rentIds = new Set();
    for (const loan of loans) {
      lMap[loan.id] = loan;
      if (loan.product_id && productMap[loan.product_id]?.scheduler_type === 'rent') {
        rentIds.add(loan.id);
      }
    }

    const iMap = {};
    for (const inv of investors) iMap[inv.id] = inv;

    return { rentLoanIds: rentIds, loanMap: lMap, investorMap: iMap };
  }, [loans, products, investors]);

  // Calculate report data with detail rows
  const reportData = useMemo(() => {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);

    // Filter repayment transactions in date range
    const repayments = transactions.filter(tx =>
      tx.type === 'Repayment' &&
      !tx.is_deleted &&
      new Date(tx.date) >= from &&
      new Date(tx.date) <= to
    );

    // --- INCOME ---

    // Interest income detail (non-rent loans)
    const interestDetail = [];
    let interestIncome = 0;
    for (const tx of repayments) {
      const amt = parseFloat(tx.interest_applied) || 0;
      if (amt > 0 && !rentLoanIds.has(tx.loan_id)) {
        interestIncome += amt;
        interestDetail.push({
          date: tx.date,
          amount: amt,
          loanId: tx.loan_id,
          loanNumber: loanMap[tx.loan_id]?.loan_number,
          borrower: loanMap[tx.loan_id]?.borrower_name || tx.borrower_name,
          reference: tx.reference
        });
      }
    }
    interestDetail.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Rent income detail (rent loans)
    const rentDetail = [];
    let rentIncome = 0;
    for (const tx of repayments) {
      const amt = parseFloat(tx.interest_applied) || 0;
      if (amt > 0 && rentLoanIds.has(tx.loan_id)) {
        rentIncome += amt;
        rentDetail.push({
          date: tx.date,
          amount: amt,
          loanId: tx.loan_id,
          loanNumber: loanMap[tx.loan_id]?.loan_number,
          borrower: loanMap[tx.loan_id]?.borrower_name || tx.borrower_name,
          reference: tx.reference
        });
      }
    }
    rentDetail.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Fee income detail
    const feeDetail = [];
    let feeIncome = 0;
    for (const tx of repayments) {
      const amt = parseFloat(tx.fees_applied) || 0;
      if (amt > 0) {
        feeIncome += amt;
        feeDetail.push({
          date: tx.date,
          amount: amt,
          loanId: tx.loan_id,
          loanNumber: loanMap[tx.loan_id]?.loan_number,
          borrower: loanMap[tx.loan_id]?.borrower_name || tx.borrower_name,
          reference: tx.reference
        });
      }
    }
    feeDetail.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Other income detail
    const otherDetail = [];
    let otherIncomeTotal = 0;
    for (const o of otherIncome) {
      if (new Date(o.date) >= from && new Date(o.date) <= to) {
        const amt = parseFloat(o.amount) || 0;
        otherIncomeTotal += amt;
        otherDetail.push({
          date: o.date,
          amount: amt,
          description: o.description || o.source || 'Other income'
        });
      }
    }
    otherDetail.sort((a, b) => new Date(b.date) - new Date(a.date));

    const totalIncome = interestIncome + rentIncome + feeIncome + otherIncomeTotal;

    // --- EXPENDITURE ---
    const filteredExpenses = expenses.filter(e =>
      new Date(e.date) >= from && new Date(e.date) <= to
    );

    // Group expenses by category with detail
    const expensesByCategory = {};
    const expenseDetail = {};
    for (const e of filteredExpenses) {
      const category = e.type_name || 'Uncategorised';
      expensesByCategory[category] = (expensesByCategory[category] || 0) + (parseFloat(e.amount) || 0);
      if (!expenseDetail[category]) expenseDetail[category] = [];
      expenseDetail[category].push({
        date: e.date,
        amount: parseFloat(e.amount) || 0,
        description: e.description || '',
        loanId: e.loan_id,
        loanNumber: e.loan_id ? loanMap[e.loan_id]?.loan_number : null,
        borrower: e.borrower_name
      });
    }
    // Sort each category's detail by date desc
    for (const cat of Object.keys(expenseDetail)) {
      expenseDetail[cat].sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    const sortedCategories = Object.keys(expensesByCategory).sort();
    const totalExpenditure = Object.values(expensesByCategory).reduce((sum, v) => sum + v, 0);

    // --- INVESTOR COSTS ---
    // Only 'debit' type entries are actual payments made to investors
    const investorDebits = investorInterest.filter(i =>
      i.type === 'debit' &&
      new Date(i.date) >= from &&
      new Date(i.date) <= to
    );
    const investorDetail = investorDebits.map(i => ({
      date: i.date,
      amount: parseFloat(i.amount) || 0,
      investorId: i.investor_id,
      investorName: investorMap[i.investor_id]?.name || 'Unknown Investor',
      description: i.description || ''
    }));
    investorDetail.sort((a, b) => new Date(b.date) - new Date(a.date));
    const investorInterestTotal = investorDebits.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);

    const netIncome = totalIncome - totalExpenditure - investorInterestTotal;

    return {
      income: {
        interestIncome, interestDetail,
        rentIncome, rentDetail,
        feeIncome, feeDetail,
        otherIncomeTotal, otherDetail,
        totalIncome
      },
      expenditure: { expensesByCategory, expenseDetail, sortedCategories, totalExpenditure },
      investorCosts: { investorInterestTotal, investorDetail },
      netIncome
    };
  }, [transactions, expenses, otherIncome, investorInterest, rentLoanIds, loanMap, investorMap, fromDate, toDate]);

  const formatDate = (d) => {
    try { return format(new Date(d), 'dd/MM/yy'); } catch { return d; }
  };

  // Reusable detail table for loan-based income rows
  const renderLoanDetail = (detail, key) => {
    if (!expandedRows.has(key) || detail.length === 0) return null;
    return (
      <TableRow>
        <TableCell colSpan={2} className="p-0">
          <div className="bg-slate-50 border-t border-b px-4 py-2 max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="text-left py-1 font-medium">Date</th>
                  <th className="text-left py-1 font-medium">Loan</th>
                  <th className="text-left py-1 font-medium">Borrower</th>
                  <th className="text-left py-1 font-medium">Reference</th>
                  <th className="text-right py-1 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {detail.map((item, idx) => (
                  <tr
                    key={idx}
                    className={item.loanId ? 'hover:bg-slate-100 cursor-pointer' : ''}
                    onClick={() => item.loanId && navigate(createPageUrl(`LoanDetails?id=${item.loanId}`))}
                  >
                    <td className="py-1 text-slate-600">{formatDate(item.date)}</td>
                    <td className="py-1 font-mono text-slate-600">{item.loanNumber ? `#${item.loanNumber}` : '-'}</td>
                    <td className="py-1 text-slate-700">{item.borrower || '-'}</td>
                    <td className="py-1 text-slate-400 truncate max-w-[200px]">{item.reference || '-'}</td>
                    <td className="py-1 text-right font-medium text-slate-700">{formatCurrency(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TableCell>
      </TableRow>
    );
  };

  // Detail table for other income
  const renderOtherIncomeDetail = () => {
    if (!expandedRows.has('otherIncome') || reportData.income.otherDetail.length === 0) return null;
    return (
      <TableRow>
        <TableCell colSpan={2} className="p-0">
          <div className="bg-slate-50 border-t border-b px-4 py-2 max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="text-left py-1 font-medium">Date</th>
                  <th className="text-left py-1 font-medium">Description</th>
                  <th className="text-right py-1 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {reportData.income.otherDetail.map((item, idx) => (
                  <tr key={idx}>
                    <td className="py-1 text-slate-600">{formatDate(item.date)}</td>
                    <td className="py-1 text-slate-700">{item.description}</td>
                    <td className="py-1 text-right font-medium text-slate-700">{formatCurrency(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TableCell>
      </TableRow>
    );
  };

  // Detail table for expense categories
  const renderExpenseDetail = (category) => {
    const key = `expense-${category}`;
    const detail = reportData.expenditure.expenseDetail[category] || [];
    if (!expandedRows.has(key) || detail.length === 0) return null;
    return (
      <TableRow>
        <TableCell colSpan={2} className="p-0">
          <div className="bg-slate-50 border-t border-b px-4 py-2 max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="text-left py-1 font-medium">Date</th>
                  <th className="text-left py-1 font-medium">Description</th>
                  <th className="text-left py-1 font-medium">Loan</th>
                  <th className="text-right py-1 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {detail.map((item, idx) => (
                  <tr
                    key={idx}
                    className={item.loanId ? 'hover:bg-slate-100 cursor-pointer' : ''}
                    onClick={() => item.loanId && navigate(createPageUrl(`LoanDetails?id=${item.loanId}`))}
                  >
                    <td className="py-1 text-slate-600">{formatDate(item.date)}</td>
                    <td className="py-1 text-slate-700">{item.description || '-'}</td>
                    <td className="py-1 font-mono text-slate-600">
                      {item.loanNumber ? `#${item.loanNumber}` : '-'}
                      {item.borrower && <span className="text-slate-400 ml-1 font-sans">({item.borrower})</span>}
                    </td>
                    <td className="py-1 text-right font-medium text-slate-700">{formatCurrency(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TableCell>
      </TableRow>
    );
  };

  // Detail table for investor costs
  const renderInvestorDetail = () => {
    if (!expandedRows.has('investorCosts') || reportData.investorCosts.investorDetail.length === 0) return null;
    return (
      <TableRow>
        <TableCell colSpan={2} className="p-0">
          <div className="bg-slate-50 border-t border-b px-4 py-2 max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="text-left py-1 font-medium">Date</th>
                  <th className="text-left py-1 font-medium">Investor</th>
                  <th className="text-left py-1 font-medium">Description</th>
                  <th className="text-right py-1 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {reportData.investorCosts.investorDetail.map((item, idx) => (
                  <tr
                    key={idx}
                    className="hover:bg-slate-100 cursor-pointer"
                    onClick={() => navigate(createPageUrl(`InvestorDetails?id=${item.investorId}`))}
                  >
                    <td className="py-1 text-slate-600">{formatDate(item.date)}</td>
                    <td className="py-1 text-slate-700 font-medium">{item.investorName}</td>
                    <td className="py-1 text-slate-400">{item.description || '-'}</td>
                    <td className="py-1 text-right font-medium text-slate-700">{formatCurrency(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TableCell>
      </TableRow>
    );
  };

  // Clickable row component
  const ClickableRow = ({ rowKey, label, amount, detail }) => {
    const isExpanded = expandedRows.has(rowKey);
    const hasDetail = detail && detail.length > 0;
    return (
      <TableRow
        className={hasDetail ? 'cursor-pointer hover:bg-slate-50 transition-colors' : ''}
        onClick={() => hasDetail && toggleRow(rowKey)}
      >
        <TableCell>
          <div className="flex items-center gap-1.5">
            {hasDetail ? (
              isExpanded
                ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <span className="w-3.5" />
            )}
            {label}
            {hasDetail && (
              <span className="text-xs text-slate-400 ml-1">({detail.length})</span>
            )}
          </div>
        </TableCell>
        <TableCell className="text-right font-medium">{formatCurrency(amount)}</TableCell>
      </TableRow>
    );
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Income & Expenditure Report</h1>
        <p className="text-sm text-slate-500 mt-1">
          Breakdown of income and expenditure for the selected period. Click any row to see detail.
        </p>
      </div>

      {/* Date Range Picker */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2 text-slate-500">
              <Calendar className="w-4 h-4" />
              <span className="text-sm font-medium">Report Period</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="from-date" className="text-sm text-slate-500">From</Label>
                <Input
                  id="from-date"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-40 h-8 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="to-date" className="text-sm text-slate-500">To</Label>
                <Input
                  id="to-date"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-40 h-8 text-sm"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          <span className="ml-2 text-slate-500">Loading report data...</span>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                  <TrendingUp className="w-4 h-4 text-green-500" />
                  Total Income
                </div>
                <div className="text-2xl font-bold text-green-600">
                  {formatCurrency(reportData.income.totalIncome)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                  <TrendingDown className="w-4 h-4 text-red-500" />
                  Total Expenditure
                </div>
                <div className="text-2xl font-bold text-red-600">
                  {formatCurrency(reportData.expenditure.totalExpenditure + reportData.investorCosts.investorInterestTotal)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                  <ArrowRightLeft className="w-4 h-4 text-slate-500" />
                  Net Income
                </div>
                <div className={`text-2xl font-bold ${reportData.netIncome >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(reportData.netIncome)}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Income Section */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-slate-700">Income</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right w-40">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ClickableRow
                    rowKey="interest"
                    label="Interest Income"
                    amount={reportData.income.interestIncome}
                    detail={reportData.income.interestDetail}
                  />
                  {renderLoanDetail(reportData.income.interestDetail, 'interest')}

                  {reportData.income.rentIncome > 0 && (
                    <>
                      <ClickableRow
                        rowKey="rent"
                        label="Rent Income"
                        amount={reportData.income.rentIncome}
                        detail={reportData.income.rentDetail}
                      />
                      {renderLoanDetail(reportData.income.rentDetail, 'rent')}
                    </>
                  )}

                  <ClickableRow
                    rowKey="fees"
                    label="Fee Income"
                    amount={reportData.income.feeIncome}
                    detail={reportData.income.feeDetail}
                  />
                  {renderLoanDetail(reportData.income.feeDetail, 'fees')}

                  {reportData.income.otherIncomeTotal > 0 && (
                    <>
                      <ClickableRow
                        rowKey="otherIncome"
                        label="Other Income"
                        amount={reportData.income.otherIncomeTotal}
                        detail={reportData.income.otherDetail}
                      />
                      {renderOtherIncomeDetail()}
                    </>
                  )}

                  <TableRow className="bg-slate-50">
                    <TableCell className="font-bold">
                      <div className="flex items-center gap-1.5">
                        <span className="w-3.5" />
                        Total Income
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-bold text-green-600">{formatCurrency(reportData.income.totalIncome)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Operating Expenditure Section */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-slate-700">Operating Expenditure</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right w-40">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.expenditure.sortedCategories.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center text-slate-400 py-6">
                        No expenses recorded in this period
                      </TableCell>
                    </TableRow>
                  ) : (
                    reportData.expenditure.sortedCategories.map(category => (
                      <React.Fragment key={category}>
                        <ClickableRow
                          rowKey={`expense-${category}`}
                          label={category}
                          amount={reportData.expenditure.expensesByCategory[category]}
                          detail={reportData.expenditure.expenseDetail[category]}
                        />
                        {renderExpenseDetail(category)}
                      </React.Fragment>
                    ))
                  )}
                  <TableRow className="bg-slate-50">
                    <TableCell className="font-bold">
                      <div className="flex items-center gap-1.5">
                        <span className="w-3.5" />
                        Total Operating Expenditure
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-bold text-red-600">{formatCurrency(reportData.expenditure.totalExpenditure)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Investor Costs Section */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-slate-700">Investor Costs</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right w-40">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ClickableRow
                    rowKey="investorCosts"
                    label="Investor Interest Paid"
                    amount={reportData.investorCosts.investorInterestTotal}
                    detail={reportData.investorCosts.investorDetail}
                  />
                  {renderInvestorDetail()}
                  <TableRow className="bg-slate-50">
                    <TableCell className="font-bold">
                      <div className="flex items-center gap-1.5">
                        <span className="w-3.5" />
                        Total Investor Costs
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-bold text-red-600">{formatCurrency(reportData.investorCosts.investorInterestTotal)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Net Income Summary */}
          <Card className={reportData.netIncome >= 0 ? 'border-green-200 bg-green-50/50' : 'border-red-200 bg-red-50/50'}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-500">Net Income</div>
                  <div className="text-xs text-slate-400 mt-0.5">Total Income - Operating Expenditure - Investor Costs</div>
                </div>
                <div className={`text-3xl font-bold ${reportData.netIncome >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(reportData.netIncome)}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
