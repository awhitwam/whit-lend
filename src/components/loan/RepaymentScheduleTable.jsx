import React, { useState, useEffect } from 'react';
import { format, differenceInDays, addMonths, addWeeks } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, Split, List, Download, Layers, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { formatCurrency } from './LoanCalculator';

export default function RepaymentScheduleTable({ schedule, isLoading, transactions = [], loan, product }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [viewMode, setViewMode] = useState('separate'); // 'separate', 'detailed', 'smartview2', 'nested'
  const [showCumulativeColumns, setShowCumulativeColumns] = useState(false);

  // Load nested sort order from localStorage, default to 'asc' (oldest first)
  const [nestedSortOrder, setNestedSortOrder] = useState(() => {
    const saved = localStorage.getItem('nestedScheduleSortOrder');
    return saved || 'asc';
  });

  // Save sort order to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('nestedScheduleSortOrder', nestedSortOrder);
  }, [nestedSortOrder]);

  const toggleNestedSortOrder = () => {
    setNestedSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  // Helper to format installment label for Rolled-Up loans
  const formatInstallmentLabel = (row) => {
    if (loan?.interest_type === 'Rolled-Up') {
      if (row.installment_number === 1) {
        return 'Roll-up Interest';
      } else if (row.is_extension_period) {
        return `Interest ${row.installment_number - 1}`;
      }
    }
    return row.installment_number;
  };

  // Calculate totals
  const totalPrincipalDisbursed = loan ? loan.principal_amount : 0;
  
  let cumulativeInterestPaid = transactions
    .filter(tx => !tx.is_deleted)
    .reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
  
  // Calculate total expected interest from schedule
  const totalExpectedInterest = schedule.reduce((sum, row) => sum + (row.interest_amount || 0), 0);

  // Create combined or separate rows based on view mode
  let combinedRows;

  if (viewMode === 'separate') {
    // SEPARATE VIEW: Show all schedule entries and all transactions separately
    // Every transaction gets its own row, every schedule entry gets its own row
    const allRows = [];

    // Early return if loan is not available
    if (!loan) {
      combinedRows = [];
    } else {
      const periodsPerYear = loan.period === 'Monthly' ? 12 : 52;
      const periodRate = (loan.interest_rate / 100) / periodsPerYear;

      // Add disbursement row
      allRows.push({
        date: new Date(loan.start_date),
        dateStr: format(new Date(loan.start_date), 'yyyy-MM-dd'),
        isDisbursement: true,
        transactions: [],
        scheduleEntry: null,
        daysDifference: null,
        rowType: 'disbursement'
      });

      // Get active repayment transactions
      const repaymentTransactions = transactions.filter(tx => !tx.is_deleted && tx.type === 'Repayment');

      // Add ALL schedule entries as separate rows with dynamically calculated expected interest
      schedule.forEach(row => {
        // Calculate principal outstanding at the start of this period
        const dueDate = new Date(row.due_date);

        // Get all principal payments made BEFORE this period starts (before due date)
        const principalPaidBeforeThisPeriod = repaymentTransactions
          .filter(tx => new Date(tx.date) < dueDate)
          .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);

        const principalOutstandingAtStart = loan.principal_amount - principalPaidBeforeThisPeriod;

        // Use schedule entry's interest amount directly (it's already been generated correctly)
        let expectedInterestForPeriod = row.interest_amount;

        allRows.push({
          date: dueDate,
          dateStr: format(dueDate, 'yyyy-MM-dd'),
          isDisbursement: false,
          transactions: [],
          scheduleEntry: row,
          daysDifference: null,
          rowType: 'schedule',
          expectedInterest: expectedInterestForPeriod
        });
      });

      // Add ALL transactions as separate rows
      repaymentTransactions.forEach(tx => {
        allRows.push({
          date: new Date(tx.date),
          dateStr: format(new Date(tx.date), 'yyyy-MM-dd'),
          isDisbursement: false,
          transactions: [tx],
          scheduleEntry: null,
          daysDifference: null,
          rowType: 'transaction'
        });
      });



      // Sort by date, then by type (schedule before transaction on same date)
      combinedRows = allRows.sort((a, b) => {
        const dateCompare = a.date - b.date;
        if (dateCompare !== 0) return dateCompare;

        // On same date: disbursement first, then schedule, then transaction
        const typeOrder = { disbursement: 0, schedule: 1, transaction: 2 };
        return typeOrder[a.rowType] - typeOrder[b.rowType];
      });
    }
  } else {
    // DETAILED VIEW: Show schedule with nested transaction splits
    combinedRows = [];
  }
  
  if (loan) {
    // Calculate running balances properly accounting for timing of transactions
    let principalOutstanding = loan.principal_amount;
    let totalInterestAccrued = 0;
    let totalInterestPaid = 0;
    let lastCalculationDate = new Date(loan.start_date);

    combinedRows.forEach(row => {
      const currentDate = row.date;
      const daysSinceLastCalculation = Math.max(0, differenceInDays(currentDate, lastCalculationDate));

      // Accrue interest on current principal balance for days elapsed
      if (daysSinceLastCalculation > 0 && principalOutstanding > 0) {
        const dailyRate = loan.interest_rate / 100 / 365;
        const interestForPeriod = principalOutstanding * dailyRate * daysSinceLastCalculation;
        totalInterestAccrued += interestForPeriod;
      }

      if (row.rowType === 'disbursement') {
        // Disbursement row - initial state
        row.principalOutstanding = principalOutstanding;
        row.interestOutstanding = 0;
        row.expectedInterest = 0;
      } else if (row.rowType === 'transaction') {
        // Apply transaction FIRST, then show resulting balances
        row.transactions.forEach(tx => {
          if (tx.principal_applied) {
            principalOutstanding -= tx.principal_applied;
          }
          if (tx.interest_applied) {
            totalInterestPaid += tx.interest_applied;
          }
        });

        principalOutstanding = Math.max(0, principalOutstanding);

        // Show state AFTER transaction
        row.principalOutstanding = principalOutstanding;
        row.interestOutstanding = totalInterestAccrued - totalInterestPaid;
        row.expectedInterest = 0;
        
        lastCalculationDate = currentDate;
      } else if (row.rowType === 'schedule') {
        // Schedule row - show balances at this point in time (after accrual, before any payments)
        row.principalOutstanding = principalOutstanding;
        row.interestOutstanding = totalInterestAccrued - totalInterestPaid;
        row.expectedInterest = row.scheduleEntry.interest_amount;
        
        lastCalculationDate = currentDate;
      }
    });

    cumulativeInterestPaid = totalInterestPaid;
    }

    // Pagination logic
    const itemCount = viewMode === 'detailed' ? schedule.length : combinedRows.length;
    const totalPages = Math.ceil(itemCount / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedRows = combinedRows.slice(startIndex, endIndex);

    const handlePageChange = (newPage) => {
    setCurrentPage(Math.max(1, Math.min(newPage, totalPages)));
    };

    const handleItemsPerPageChange = (value) => {
      setItemsPerPage(Number(value));
      setCurrentPage(1);
    };

    const exportToCSV = () => {
      if (viewMode !== 'separate' || combinedRows.length === 0) return;

      const headers = ['Date', 'Type', 'Principal', 'Interest', 'Expected Interest', 'Principal Outstanding', 'Interest Outstanding', 'Total Outstanding'];
      const csvRows = [headers.join(',')];

      combinedRows.forEach(row => {
        const csvRow = [
          format(row.date, 'yyyy-MM-dd'),
          row.isDisbursement ? 'Disbursement' : (row.rowType === 'transaction' ? 'Payment' : 'Schedule'),
          row.isDisbursement ? loan.principal_amount : (row.transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0) || ''),
          row.transactions.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0) || '',
          row.expectedInterest || '',
          row.principalOutstanding || '',
          row.interestOutstanding || '',
          (row.principalOutstanding || 0) + (row.interestOutstanding || 0) || ''
        ];
        csvRows.push(csvRow.join(','));
      });

      const csvContent = csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `loan-${loan?.loan_number || 'schedule'}-separate-view.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
    };

    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 bg-slate-200 rounded p-0.5">
              <Button
                variant={viewMode === 'smartview2' ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode('smartview2')}
                className="gap-1 h-6 text-xs px-2"
              >
                <List className="w-3 h-3" />
                Smart
              </Button>
              <Button
                variant={viewMode === 'separate' ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode('separate')}
                className="gap-1 h-6 text-xs px-2"
              >
                <Split className="w-3 h-3" />
                Journal
              </Button>
              <Button
                variant={viewMode === 'nested' ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode('nested')}
                className="gap-1 h-6 text-xs px-2"
              >
                <Layers className="w-3 h-3" />
                Nested
              </Button>
            </div>
            {viewMode === 'separate' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={exportToCSV}
                className="gap-1 h-6 text-xs px-2"
              >
                <Download className="w-3 h-3" />
                CSV
              </Button>
            )}
            {viewMode === 'smartview2' && (
              <label className="flex items-center gap-1.5 text-xs cursor-pointer text-slate-600">
                <input
                  type="checkbox"
                  checked={showCumulativeColumns}
                  onChange={(e) => setShowCumulativeColumns(e.target.checked)}
                  className="w-3 h-3 rounded border-slate-300"
                />
                Cumulative
              </label>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Select value={itemsPerPage.toString()} onValueChange={handleItemsPerPageChange}>
              <SelectTrigger className="w-16 h-6 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value={combinedRows.length.toString()}>All</SelectItem>
              </SelectContent>
            </Select>
            {!isLoading && itemCount > 0 && totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="h-6 w-6 p-0"
                >
                  <ChevronLeft className="w-3 h-3" />
                </Button>
                <span className="text-xs text-slate-500">
                  {currentPage}/{totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="h-6 w-6 p-0"
                >
                  <ChevronRight className="w-3 h-3" />
                </Button>
              </div>
            )}
            <span className="text-xs text-slate-500">
              ({itemCount})
            </span>
          </div>
        </div>
        <div className="overflow-hidden">
        {(viewMode === 'detailed' || viewMode === 'smartview2') ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 sticky top-0 z-20">
                <TableHead className="font-semibold bg-slate-50 w-16">Inst.</TableHead>
                <TableHead className="font-semibold bg-slate-50">Due Date</TableHead>
                <TableHead className="font-semibold bg-slate-50 text-right">Expected Amt</TableHead>
                <TableHead className="font-semibold bg-slate-50">Status</TableHead>
                {viewMode === 'detailed' && (
                  <>
                    <TableHead className="font-semibold bg-slate-50">Date Paid</TableHead>
                    <TableHead className="font-semibold bg-slate-50 text-right">Amt Paid</TableHead>
                  </>
                )}
                {viewMode === 'smartview2' && (
                  <>
                    <TableHead className="font-semibold bg-slate-50 text-right">Principal Paid</TableHead>
                    {showCumulativeColumns && (
                      <>
                        <TableHead className="font-semibold bg-slate-50 text-right">Principal Outstanding</TableHead>
                        <TableHead className="font-semibold bg-slate-50 text-right">Cumulative Interest Expected</TableHead>
                        <TableHead className="font-semibold bg-slate-50 text-right">Cumulative Interest Paid</TableHead>
                      </>
                    )}
                  </>
                )}
                <TableHead className="font-semibold bg-slate-50 text-right">Interest Variance</TableHead>
                <TableHead className="font-semibold bg-slate-50">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(6).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7} className="h-14">
                      <div className="h-4 bg-slate-100 rounded animate-pulse w-full"></div>
                    </TableCell>
                  </TableRow>
                ))
              ) : schedule.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-slate-500">
                    No schedule available
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {viewMode === 'detailed' ? (
                    (() => {
                    // ORIGINAL SMARTVIEW - Match transactions by date proximity
                    const sortedSchedule = [...schedule].sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
                    const sortedTransactions = transactions
                      .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
                      .sort((a, b) => new Date(a.date) - new Date(b.date));

                    const initialPayments = new Map();
                    sortedSchedule.forEach(row => {
                      initialPayments.set(row.id, []);
                    });

                    for (const tx of sortedTransactions) {
                      const txDate = new Date(tx.date);
                      let closestRow = null;
                      let closestDiff = Infinity;

                      for (const row of sortedSchedule) {
                        const rowDate = new Date(row.due_date);
                        const diff = Math.abs(txDate - rowDate);
                        if (diff < closestDiff) {
                          closestDiff = diff;
                          closestRow = row;
                        }
                      }

                      if (closestRow) {
                        initialPayments.get(closestRow.id).push(tx);
                      }
                    }

                    const allocatedAmounts = new Map();
                    const latePaymentSources = new Map();
                    sortedSchedule.forEach(row => {
                      allocatedAmounts.set(row.id, 0);
                    });

                    let cumulativeVariance = 0;

                    for (let i = 0; i < startIndex; i++) {
                      const row = schedule[i];
                      const payments = initialPayments.get(row.id) || [];
                      const directPayment = payments.reduce((sum, tx) => sum + tx.amount, 0);
                      cumulativeVariance += (directPayment - row.total_due);
                    }

                    const displayRows = schedule.slice(startIndex, endIndex);

                    return displayRows.map((row, idx) => {
                      const payments = initialPayments.get(row.id) || [];
                      const directPayment = payments.reduce((sum, tx) => sum + tx.amount, 0);
                      const allocated = allocatedAmounts.get(row.id) || 0;
                      const totalPaid = directPayment + allocated;
                      const expectedTotal = row.total_due;
                      const paymentPercent = expectedTotal > 0 ? (totalPaid / expectedTotal) * 100 : 0;

                      const variance = directPayment - expectedTotal;
                      cumulativeVariance += variance;

                      const isPaid = totalPaid >= expectedTotal - 0.01;
                      const isPartial = totalPaid > 0.01 && totalPaid < expectedTotal - 0.01;
                      const latePaymentTx = latePaymentSources.get(row.id);

                      let statusBadge;
                      let statusColor = '';
                      let notes = '';
                      let datePaid = '';

                      const today = new Date();
                      const dueDate = new Date(row.due_date);
                      const daysOverdue = differenceInDays(today, dueDate);

                      if (isPaid) {
                        statusBadge = <Badge className="bg-emerald-500 text-white">✓ Paid</Badge>;
                        statusColor = 'bg-emerald-50/30';

                        if (payments.length > 0) {
                          const firstTx = payments[0];
                          datePaid = format(new Date(firstTx.date), 'MMM dd, yyyy');
                          const daysDiff = differenceInDays(new Date(firstTx.date), dueDate);
                          if (daysDiff < 0) notes = 'Paid early';
                          else if (daysDiff === 0) notes = 'On time';
                          else if (daysDiff > 0) notes = `${daysDiff} days late`;
                        } else if (latePaymentTx && allocated > 0.01) {
                          datePaid = format(new Date(latePaymentTx.date), 'MMM dd, yyyy');
                          const daysDiff = differenceInDays(new Date(latePaymentTx.date), dueDate);
                          notes = `${daysDiff} days late`;
                        }
                      } else if (isPartial) {
                        statusBadge = <Badge className="bg-amber-500 text-white">Partial ({Math.round(paymentPercent)}%)</Badge>;
                        statusColor = 'bg-amber-50/30';
                        if (payments.length > 0) {
                          datePaid = format(new Date(payments[0].date), 'MMM dd, yyyy');
                        }
                      } else if (daysOverdue > 0 && cumulativeVariance < 0) {
                        statusBadge = <Badge className="bg-red-500 text-white">Late</Badge>;
                        statusColor = 'bg-red-50/30';
                        notes = `${daysOverdue} days overdue`;
                        datePaid = '—';
                      } else if (daysOverdue > 0 && cumulativeVariance >= 0) {
                        statusBadge = <Badge className="bg-blue-500 text-white">Ahead</Badge>;
                        statusColor = 'bg-blue-50/30';
                        datePaid = '—';
                      } else {
                        statusBadge = <Badge className="bg-blue-500 text-white">⏰ Upcoming</Badge>;
                        statusColor = 'bg-blue-50/30';
                        datePaid = '—';
                      }

                      return (
                        <React.Fragment key={row.id}>
                          <TableRow className={statusColor}>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <span className="text-slate-400">📄</span>
                                {formatInstallmentLabel(row)}
                              </div>
                            </TableCell>
                            <TableCell>{format(new Date(row.due_date), 'MMM dd, yyyy')}</TableCell>
                            <TableCell className="text-right font-mono">{formatCurrency(expectedTotal)}</TableCell>
                            <TableCell>{statusBadge}</TableCell>
                            <TableCell>{datePaid}</TableCell>
                            <TableCell className="text-right font-mono">
                              {totalPaid > 0 ? formatCurrency(totalPaid) : '$0.00'}
                            </TableCell>
                            <TableCell className={`text-right font-mono font-semibold ${cumulativeVariance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {cumulativeVariance >= 0 ? '+' : ''}{formatCurrency(cumulativeVariance)}
                            </TableCell>
                            <TableCell className="text-slate-600 text-xs">{notes}</TableCell>
                          </TableRow>
                        </React.Fragment>
                      );
                      });
                  })()
                  ) : (
                    (() => {
                    // SMARTVIEW2 - Interest-focused cumulative tracking with principal reduction
                    const sortedSchedule = [...schedule].sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
                    const sortedTransactions = transactions
                      .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
                      .sort((a, b) => new Date(a.date) - new Date(b.date));

                    const today = new Date();
                    const periodsPerYear = loan.period === 'Monthly' ? 12 : 52;
                    const periodRate = (loan.interest_rate / 100) / periodsPerYear;

                    // Calculate cumulative values up to before display window
                    let cumulativeInterestExpected = 0;
                    let cumulativeInterestPaid = 0;
                    let runningPrincipalOutstanding = loan.principal_amount;

                    for (let i = 0; i < startIndex; i++) {
                      const row = schedule[i];
                      const dueDate = new Date(row.due_date);
                      const isPastDue = today > dueDate;

                      // Calculate principal paid up to this due date
                      const txUpToDueDate = sortedTransactions.filter(tx => new Date(tx.date) <= dueDate);
                      const principalPaidUpToDueDate = txUpToDueDate.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
                      runningPrincipalOutstanding = loan.principal_amount - principalPaidUpToDueDate;

                      // Calculate expected interest based on actual outstanding principal
                      let expectedInterestForPeriod = 0;
                      if (loan.interest_type === 'Flat') {
                        expectedInterestForPeriod = loan.principal_amount * periodRate;
                      } else if (loan.interest_type === 'Reducing') {
                        expectedInterestForPeriod = runningPrincipalOutstanding * periodRate;
                      } else if (loan.interest_type === 'Interest-Only') {
                        expectedInterestForPeriod = loan.principal_amount * periodRate;
                      }

                      if (isPastDue) {
                        cumulativeInterestExpected += expectedInterestForPeriod;
                      }

                      const evaluationDate = isPastDue ? dueDate : today;
                      const txUpToEval = sortedTransactions.filter(tx => new Date(tx.date) <= evaluationDate);
                      cumulativeInterestPaid = txUpToEval.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
                    }

                    const displayRows = schedule.slice(startIndex, endIndex);

                    return displayRows.map((row, idx) => {
                      const actualIndex = startIndex + idx;
                      const dueDate = new Date(row.due_date);
                      const isPastDue = today > dueDate;

                      // For past dates: calculate cumulative up to due date
                      // For future dates: calculate cumulative up to TODAY only
                      const evaluationDate = isPastDue ? dueDate : today;

                      // Get the previous period's due date to determine principal outstanding at start of this period
                      const previousDueDate = actualIndex > 0 ? new Date(sortedSchedule[actualIndex - 1].due_date) : new Date(loan.start_date);

                      // Calculate principal paid up to END of previous period
                      const txUpToPreviousPeriod = sortedTransactions.filter(tx => new Date(tx.date) <= previousDueDate);
                      const principalPaidUpToPreviousPeriod = txUpToPreviousPeriod.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
                      const principalOutstandingAtStartOfPeriod = loan.principal_amount - principalPaidUpToPreviousPeriod;

                      // Recalculate expected interest based on principal outstanding at START of period
                      let expectedInterestForPeriod = 0;
                      if (loan.interest_type === 'Flat') {
                        expectedInterestForPeriod = loan.principal_amount * periodRate;
                      } else if (loan.interest_type === 'Reducing') {
                        expectedInterestForPeriod = principalOutstandingAtStartOfPeriod * periodRate;
                      } else if (loan.interest_type === 'Interest-Only') {
                        expectedInterestForPeriod = loan.principal_amount * periodRate;
                      } else if (loan.interest_type === 'Rolled-Up') {
                        expectedInterestForPeriod = principalOutstandingAtStartOfPeriod * periodRate;
                      }

                      // Add to cumulative expected if due date has passed
                      if (isPastDue) {
                        cumulativeInterestExpected += expectedInterestForPeriod;
                      }

                      // Calculate payments up to evaluation date
                      const txUpToDate = sortedTransactions.filter(tx => new Date(tx.date) <= evaluationDate);
                      const interestPaidUpToDate = txUpToDate.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
                      const principalPaidUpToDate = txUpToDate.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);

                      // Calculate outstanding principal as of evaluation date
                      const principalOutstanding = loan.principal_amount - principalPaidUpToDate;

                      // Cumulative interest variance (frozen for past dates, current for future dates)
                      const cumulativeBalance = interestPaidUpToDate - cumulativeInterestExpected;

                      let statusBadge;
                      let statusColor = '';
                      let notes = '';

                      if (isPastDue) {
                        // Check if interest was paid by due date
                        if (cumulativeBalance < -0.01) {
                          // Interest in arrears at due date - check if it recovered later
                          const arrearsAtDueDate = Math.abs(cumulativeBalance);

                          // Find the transaction that brought the interest balance back to positive
                          let recoveryTransactionDate = null;
                          let runningInterestBalance = cumulativeBalance;

                          // Check transactions after due date
                          const laterTransactions = sortedTransactions.filter(tx => 
                            new Date(tx.date) > dueDate
                          ).sort((a, b) => new Date(a.date) - new Date(b.date));

                          for (const tx of laterTransactions) {
                            runningInterestBalance += (tx.interest_applied || 0);
                            if (runningInterestBalance >= -0.01) {
                              recoveryTransactionDate = new Date(tx.date);
                              break;
                            }
                          }

                          if (recoveryTransactionDate) {
                            // Interest paid late
                            const daysLate = differenceInDays(recoveryTransactionDate, dueDate);
                            statusBadge = <Badge className="bg-emerald-500 text-white">✓ Paid</Badge>;
                            statusColor = 'bg-emerald-50/30';
                            notes = `Paid ${daysLate} day${daysLate !== 1 ? 's' : ''} late`;
                          } else {
                            // Interest still in arrears
                            const daysOverdue = differenceInDays(today, dueDate);
                            statusBadge = <Badge className="bg-red-500 text-white">Overdue</Badge>;
                            statusColor = 'bg-red-50/30';
                            notes = `${daysOverdue} days overdue • ${formatCurrency(arrearsAtDueDate)} interest in arrears`;
                          }
                        } else {
                          // Interest was paid by due date
                          statusBadge = <Badge className="bg-emerald-500 text-white">✓ Paid</Badge>;
                          statusColor = 'bg-emerald-50/30';

                          if (cumulativeBalance > 0.01) {
                            notes = `Interest overpaid by ${formatCurrency(cumulativeBalance)}`;
                          } else {
                            notes = 'Interest obligations met at due date';
                          }
                        }
                      } else {
                        // Future obligation - upcoming payment
                        if (cumulativeBalance > 0.01) {
                          statusBadge = <Badge className="bg-emerald-500 text-white">Ahead</Badge>;
                          statusColor = 'bg-emerald-50/30';
                          notes = `Account in surplus: ${formatCurrency(cumulativeBalance)}`;
                        } else {
                          statusBadge = <Badge className="bg-blue-500 text-white">⏰ Upcoming</Badge>;
                          statusColor = 'bg-blue-50/30';
                          const daysUntilDue = differenceInDays(dueDate, today);
                          notes = `Due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}`;
                        }
                      }

                      const recoveryTransactionDate = (() => {
                        if (isPastDue && cumulativeBalance < -0.01) {
                          const arrearsAtDueDate = Math.abs(cumulativeBalance);
                          let runningInterestBalance = cumulativeBalance;
                          const laterTransactions = sortedTransactions.filter(tx => 
                            new Date(tx.date) > dueDate
                          ).sort((a, b) => new Date(a.date) - new Date(b.date));

                          for (const tx of laterTransactions) {
                            runningInterestBalance += (tx.interest_applied || 0);
                            if (runningInterestBalance >= -0.01) {
                              return new Date(tx.date);
                            }
                          }
                        }
                        return null;
                      })();

                      const arrearsAtDueDate = isPastDue && cumulativeBalance < -0.01 ? Math.abs(cumulativeBalance) : 0;
                      const daysLate = recoveryTransactionDate ? differenceInDays(recoveryTransactionDate, dueDate) : 0;
                      const daysUntilDue = !isPastDue ? differenceInDays(dueDate, today) : 0;

                      return (
                        <React.Fragment key={row.id}>
                          <TableRow className={statusColor}>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <span className="text-slate-400">📄</span>
                                {formatInstallmentLabel(row)}
                              </div>
                            </TableCell>
                            <TableCell>{format(dueDate, 'MMM dd, yyyy')}</TableCell>
                            <TableCell className="text-right font-mono">{formatCurrency(expectedInterestForPeriod)}</TableCell>
                            <TableCell>{statusBadge}</TableCell>
                            <TableCell className="text-right font-mono text-slate-600">
                              {formatCurrency(principalPaidUpToDate)}
                            </TableCell>
                            {showCumulativeColumns && (
                              <>
                                <TableCell className="text-right font-mono text-slate-600">
                                  {formatCurrency(principalOutstanding)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-slate-600">
                                  {formatCurrency(cumulativeInterestExpected)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-slate-600">
                                  {formatCurrency(interestPaidUpToDate)}
                                </TableCell>
                              </>
                            )}
                            <TableCell className={`text-right font-mono font-semibold ${cumulativeBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {cumulativeBalance >= 0 ? '+' : ''}{formatCurrency(cumulativeBalance)}
                            </TableCell>
                            <TableCell className="text-slate-600 text-xs">
                              {notes && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="cursor-help underline decoration-dotted">{notes}</span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-md">
                                      <div className="space-y-2 text-xs">
                                        <div className="font-semibold text-xs border-b pb-1">Period Analysis</div>

                                        <div>
                                          <p className="font-medium">Due Date: {format(dueDate, 'MMM dd, yyyy')}</p>
                                          <p className="text-slate-600">Expected Interest: {formatCurrency(expectedInterestForPeriod)}</p>
                                        </div>

                                        <div>
                                          <p className="font-medium">Cumulative Position (as of {isPastDue ? format(dueDate, 'MMM dd, yyyy') : format(today, 'MMM dd, yyyy')}):</p>
                                          <p className="text-slate-600">• Interest Expected: {formatCurrency(cumulativeInterestExpected)}</p>
                                          <p className="text-slate-600">• Interest Paid: {formatCurrency(interestPaidUpToDate)}</p>
                                          <p className={`font-semibold ${cumulativeBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                            • Balance: {cumulativeBalance >= 0 ? '+' : ''}{formatCurrency(cumulativeBalance)}
                                          </p>
                                        </div>

                                        {(() => {
                                          const txUpToEvalDate = sortedTransactions.filter(tx => 
                                            new Date(tx.date) <= (isPastDue ? dueDate : today)
                                          );

                                          if (txUpToEvalDate.length > 0) {
                                            return (
                                              <div>
                                                <p className="font-medium">Payments Considered ({txUpToEvalDate.length}):</p>
                                                <div className="space-y-1 mt-1 max-h-32 overflow-y-auto">
                                                  {txUpToEvalDate.map((tx, i) => (
                                                    <div key={i} className="text-slate-600 pl-2 border-l-2 border-slate-200">
                                                      <p>• {format(new Date(tx.date), 'MMM dd, yyyy')}: {formatCurrency(tx.amount)}</p>
                                                      <p className="pl-2 text-slate-500">
                                                        Principal: {formatCurrency(tx.principal_applied || 0)} | 
                                                        Interest: {formatCurrency(tx.interest_applied || 0)}
                                                      </p>
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>
                                            );
                                          }
                                        })()}

                                        <div className="border-t pt-2">
                                          <p className="font-medium">Status Logic:</p>
                                          {isPastDue ? (
                                            cumulativeBalance < -0.01 ? (
                                              recoveryTransactionDate ? (
                                                <p className="text-slate-600">
                                                  Interest shortfall of {formatCurrency(arrearsAtDueDate)} at due date was cleared {daysLate} day{daysLate !== 1 ? 's' : ''} late on {format(recoveryTransactionDate, 'MMM dd, yyyy')}.
                                                </p>
                                              ) : (
                                                <p className="text-red-600">
                                                  Interest shortfall of {formatCurrency(arrearsAtDueDate)} at due date remains unpaid.
                                                </p>
                                              )
                                            ) : (
                                              cumulativeBalance > 0.01 ? (
                                                <p className="text-emerald-600">
                                                  Interest obligations met by due date with surplus of {formatCurrency(cumulativeBalance)}.
                                                </p>
                                              ) : (
                                                <p className="text-slate-600">
                                                  Interest obligations met exactly by due date.
                                                </p>
                                              )
                                            )
                                          ) : (
                                            cumulativeBalance > 0.01 ? (
                                              <p className="text-emerald-600">
                                                Upcoming in {daysUntilDue} day{daysUntilDue !== 1 ? 's' : ''}. Account has {formatCurrency(cumulativeBalance)} surplus - payments ahead of schedule.
                                              </p>
                                            ) : (
                                              <p className="text-slate-600">
                                                Upcoming in {daysUntilDue} day{daysUntilDue !== 1 ? 's' : ''}. No payments made yet.
                                              </p>
                                            )
                                          )}
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </TableCell>
                          </TableRow>
                        </React.Fragment>
                      );
                    });
                    })()
                  )}
                </>
              )}
            </TableBody>
          </Table>
        ) : viewMode === 'nested' ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 sticky top-0 z-20">
                <TableHead className="font-semibold bg-slate-50 w-24">
                  <div className="flex items-center gap-1">
                    Date
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={toggleNestedSortOrder}
                            className="h-5 w-5 p-0 hover:bg-slate-200"
                          >
                            {nestedSortOrder === 'asc' ? (
                              <ArrowUp className="w-3 h-3" />
                            ) : (
                              <ArrowDown className="w-3 h-3" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{nestedSortOrder === 'asc' ? 'Oldest first (click for newest first)' : 'Newest first (click for oldest first)'}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </TableHead>
                <TableHead className="font-semibold bg-slate-50">Description</TableHead>
                <TableHead className="font-semibold bg-slate-50 text-right">Principal</TableHead>
                <TableHead className="font-semibold bg-slate-50 text-right">Interest</TableHead>
                <TableHead className="font-semibold bg-slate-50 text-right">Interest Balance</TableHead>
                <TableHead className="font-semibold bg-slate-50 w-28">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(6).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6} className="h-14">
                      <div className="h-4 bg-slate-100 rounded animate-pulse w-full"></div>
                    </TableCell>
                  </TableRow>
                ))
              ) : schedule.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-slate-500">
                    No schedule available
                  </TableCell>
                </TableRow>
              ) : (
                (() => {
                  // NESTED VIEW: Group transactions under schedule periods
                  const sortedSchedule = [...schedule].sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
                  const repaymentTransactions = transactions
                    .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
                    .sort((a, b) => new Date(a.date) - new Date(b.date));

                  const today = new Date();
                  const dailyRate = loan.interest_rate / 100 / 365;

                  // Assign each transaction to exactly ONE schedule period (closest due date)
                  const txAssignments = new Map();
                  repaymentTransactions.forEach(tx => {
                    const txDate = new Date(tx.date);
                    let closestSchedule = null;
                    let closestDiff = Infinity;

                    sortedSchedule.forEach(scheduleRow => {
                      const dueDate = new Date(scheduleRow.due_date);
                      const diff = Math.abs(txDate - dueDate);
                      if (diff < closestDiff) {
                        closestDiff = diff;
                        closestSchedule = scheduleRow;
                      }
                    });

                    if (closestSchedule) {
                      if (!txAssignments.has(closestSchedule.id)) {
                        txAssignments.set(closestSchedule.id, []);
                      }
                      txAssignments.get(closestSchedule.id).push(tx);
                    }
                  });

                  // Build rows with running balances
                  const rows = [];
                  let runningPrincipalBalance = loan.principal_amount;
                  let runningInterestAccrued = 0;
                  let runningInterestPaid = 0;

                  // Add disbursement row
                  rows.push({
                    type: 'disbursement',
                    date: new Date(loan.start_date),
                    description: 'Loan Disbursement',
                    principal: loan.principal_amount,
                    interest: 0,
                    balance: 0
                  });

                  // Process each schedule period (will be sorted later based on user preference)
                  sortedSchedule.forEach((scheduleRow, idx) => {
                    const dueDate = new Date(scheduleRow.due_date);
                    const expectedInterest = scheduleRow.interest_amount || 0;
                    const periodTransactions = txAssignments.get(scheduleRow.id) || [];

                    // Accrue interest for this period
                    runningInterestAccrued += expectedInterest;

                    // Calculate period payments
                    const periodInterestPaid = periodTransactions.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
                    const periodPrincipalPaid = periodTransactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);

                    // Determine status
                    const isPastDue = today > dueDate;
                    let status = 'upcoming';
                    let statusVariance = 0;

                    if (isPastDue) {
                      if (periodInterestPaid >= expectedInterest - 0.01) {
                        if (periodInterestPaid > expectedInterest + 0.01) {
                          status = 'overpaid';
                          statusVariance = periodInterestPaid - expectedInterest;
                        } else {
                          status = 'paid';
                          // Check if paid early
                          if (periodTransactions.length > 0) {
                            const lastPaymentDate = new Date(periodTransactions[periodTransactions.length - 1].date);
                            if (lastPaymentDate < dueDate) {
                              status = 'paid_early';
                            }
                          }
                        }
                      } else if (periodInterestPaid > 0.01) {
                        status = 'underpaid';
                        statusVariance = periodInterestPaid - expectedInterest;
                      } else {
                        status = 'overdue';
                      }
                    }

                    // Add HEADER ROW for the schedule period
                    const installmentLabel = loan?.interest_type === 'Rolled-Up'
                      ? (scheduleRow.installment_number === 1 ? 'Roll-up Interest' : `Interest ${scheduleRow.installment_number - 1}`)
                      : `Instalment ${scheduleRow.installment_number}`;
                    rows.push({
                      type: 'schedule_header',
                      scheduleRow,
                      date: dueDate,
                      description: installmentLabel,
                      principal: scheduleRow.principal_amount || 0,
                      interest: expectedInterest,
                      balance: runningInterestAccrued - runningInterestPaid,
                      status,
                      statusVariance,
                      periodInterestPaid,
                      periodPrincipalPaid,
                      expectedInterest,
                      isPastDue
                    });

                    // Add CHILD ROWS for each transaction in this period
                    const txCount = periodTransactions.length;
                    periodTransactions.forEach((tx, txIdx) => {
                      const txDate = new Date(tx.date);
                      runningPrincipalBalance -= (tx.principal_applied || 0);
                      runningPrincipalBalance = Math.max(0, runningPrincipalBalance);
                      runningInterestPaid += (tx.interest_applied || 0);

                      // Calculate status text for the last transaction in this period
                      let txStatusText = null;
                      if (txIdx === txCount - 1) {
                        if (status === 'overpaid') {
                          txStatusText = `Overpaid +${formatCurrency(statusVariance)}`;
                        } else if (status === 'paid') {
                          const daysDiff = differenceInDays(txDate, dueDate);
                          if (daysDiff < 0) txStatusText = `${Math.abs(daysDiff)}d early`;
                          else if (daysDiff === 0) txStatusText = 'On time';
                          else txStatusText = `${daysDiff}d late`;
                        } else if (status === 'underpaid') {
                          txStatusText = `Short ${formatCurrency(Math.abs(statusVariance))}`;
                        } else if (status === 'paid_early') {
                          const daysDiff = differenceInDays(txDate, dueDate);
                          txStatusText = `${Math.abs(daysDiff)}d early`;
                        }
                      }

                      rows.push({
                        type: 'transaction_child',
                        transaction: tx,
                        date: txDate,
                        description: `${tx.reference || 'Payment'}`,
                        principal: tx.principal_applied || 0,
                        interest: tx.interest_applied || 0,
                        balance: runningInterestAccrued - runningInterestPaid,
                        parentScheduleId: scheduleRow.id,
                        txStatusText,
                        status: txIdx === txCount - 1 ? status : null,
                        expectedInterest,
                        dueDate
                      });
                    });
                  });

                  // Apply sorting based on user preference
                  const sortedRows = [...rows];

                  if (nestedSortOrder === 'desc') {
                    // Newest first (reverse chronological)
                    sortedRows.reverse();
                  }
                  // else: keep 'asc' (oldest first, default chronological order)

                  return sortedRows.map((row, idx) => {
                    if (row.type === 'disbursement') {
                      return (
                        <TableRow key={`disbursement-${idx}`} className="bg-red-50/50 border-l-4 border-red-500">
                          <TableCell className="py-0.5 font-medium text-xs">
                            {format(row.date, 'dd/MM/yy')}
                          </TableCell>
                          <TableCell className="py-0.5 font-semibold text-red-700 text-xs">
                            {row.description}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-red-600 font-semibold text-xs">
                            {formatCurrency(row.principal)}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-xs">—</TableCell>
                          <TableCell className="py-0.5 text-right font-mono font-semibold text-xs">
                            {formatCurrency(row.balance)}
                          </TableCell>
                          <TableCell className="py-0.5">—</TableCell>
                        </TableRow>
                      );
                    }

                    if (row.type === 'schedule_header') {
                      const statusColors = {
                        paid: 'bg-emerald-500',
                        overpaid: 'bg-blue-500',
                        underpaid: 'bg-amber-500',
                        overdue: 'bg-red-500',
                        upcoming: 'bg-slate-400',
                        paid_early: 'bg-emerald-500'
                      };
                      const statusLabels = {
                        paid: 'Paid',
                        overpaid: 'Overpaid',
                        underpaid: 'Partial',
                        overdue: 'Overdue',
                        upcoming: 'Upcoming',
                        paid_early: 'Paid Early'
                      };

                      return (
                        <TableRow
                          key={`header-${row.scheduleRow.id}`}
                          className="bg-slate-100/80 border-t border-slate-300"
                        >
                          <TableCell className="py-0.5 font-semibold text-slate-700 text-xs">
                            {format(row.date, 'dd/MM/yy')}
                          </TableCell>
                          <TableCell className="py-0.5 font-semibold text-slate-800 text-xs">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help">
                                    {row.description}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-md">
                                  <div className="space-y-1 text-xs">
                                    <p className="font-semibold">Interest Calculation:</p>
                                    <p>Annual Rate: {loan.interest_rate}%</p>
                                    <p>Daily Rate: {(dailyRate * 100).toFixed(4)}%/day</p>
                                    <p>Expected Interest: {formatCurrency(row.expectedInterest)}</p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-slate-500 text-xs">
                            {row.principal > 0 ? formatCurrency(row.principal) : '—'}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono font-semibold text-slate-700 text-xs">
                            ({formatCurrency(row.interest)})
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-slate-600 text-xs">
                            {formatCurrency(row.balance)}
                          </TableCell>
                          <TableCell className="py-0.5">
                            <Badge className={`${statusColors[row.status]} text-white text-xs`}>
                              {statusLabels[row.status]}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    }

                    if (row.type === 'transaction_child') {
                      const statusTextColors = {
                        paid: 'text-emerald-600',
                        overpaid: 'text-blue-600',
                        underpaid: 'text-amber-600',
                        overdue: 'text-red-600',
                        upcoming: 'text-slate-500',
                        paid_early: 'text-emerald-600'
                      };

                      return (
                        <TableRow
                          key={`tx-${row.transaction.id}`}
                          className="bg-white hover:bg-emerald-50/30"
                        >
                          <TableCell className="py-0.5 pl-6 text-slate-600 text-xs">
                            <div className="flex items-center gap-1">
                              <span className="text-emerald-600 text-[10px]">↳</span>
                              {format(row.date, 'dd/MM/yy')}
                            </div>
                          </TableCell>
                          <TableCell className="py-0.5 text-slate-600 pl-6 text-xs">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help">
                                    {row.description}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-md">
                                  <div className="space-y-1 text-xs">
                                    <p className="font-semibold">Payment Details:</p>
                                    <p>Date: {format(row.date, 'dd MMM yyyy')}</p>
                                    <p>Principal Applied: {formatCurrency(row.principal)}</p>
                                    <p>Interest Applied: {formatCurrency(row.interest)}</p>
                                    {row.transaction.reference && (
                                      <p>Reference: {row.transaction.reference}</p>
                                    )}
                                    {row.expectedInterest && (
                                      <p className="pt-1 border-t">Period Expected: {formatCurrency(row.expectedInterest)}</p>
                                    )}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-emerald-600 text-xs">
                            {row.principal > 0 ? formatCurrency(row.principal) : '—'}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-emerald-600 text-xs">
                            {formatCurrency(row.interest)}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-slate-600 text-xs">
                            {formatCurrency(row.balance)}
                          </TableCell>
                          <TableCell className="py-0.5 text-[10px]">
                            {row.txStatusText && (
                              <span className={`font-medium ${statusTextColors[row.status] || 'text-slate-600'}`}>
                                {row.txStatusText}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    }

                    return null;
                  });
                })()
              )}
            </TableBody>
          </Table>
        ) : (
        <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 sticky top-0 z-20 shadow-sm">
                  <TableHead className="font-semibold bg-slate-50">Date</TableHead>
                  <TableHead className="font-semibold bg-slate-50" colSpan={2}>Actual Transactions</TableHead>
                  <TableHead className="font-semibold bg-slate-50" colSpan={2}>Expected Schedule</TableHead>
                </TableRow>
                <TableRow className="bg-slate-50 border-t sticky top-[41px] z-20 shadow-sm">
                  <TableHead className="bg-slate-50"></TableHead>
                  <TableHead className="font-semibold text-right bg-slate-50">
                    <div>Principal</div>
                    <div className="text-xs text-red-600 font-bold mt-1">{formatCurrency(totalPrincipalDisbursed)}</div>
                  </TableHead>
                  <TableHead className="font-semibold text-right bg-slate-50">
                    <div>Interest</div>
                    <div className="text-xs text-emerald-600 font-bold mt-1">{formatCurrency(cumulativeInterestPaid)}</div>
                  </TableHead>
                  <TableHead className="font-semibold text-right border-l-2 border-slate-300 bg-slate-50">
                    {schedule.length > 0 && (
                      <>
                        <div>Expected Interest</div>
                        <div className="text-xs text-blue-600 font-bold mt-1">{formatCurrency(totalExpectedInterest)}</div>
                      </>
                    )}
                  </TableHead>
                  <TableHead className="font-semibold text-right bg-slate-50">
                    {schedule.length > 0 && 'Total Outstanding'}
                  </TableHead>
                </TableRow>
              </TableHeader>
        <TableBody>
          {isLoading ? (
            Array(6).fill(0).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={5} className="h-14">
                  <div className="h-4 bg-slate-100 rounded animate-pulse w-full"></div>
                </TableCell>
              </TableRow>
            ))
          ) : combinedRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-12 text-slate-500">
                No data available
              </TableCell>
            </TableRow>
          ) : (
            <>
            {paginatedRows.map((row, index) => (
              <TableRow 
                key={index}
                className={
                  row.isDisbursement 
                    ? 'bg-red-50/50 border-l-4 border-red-500' 
                    : row.transactions.length > 0
                    ? 'bg-emerald-50/50 border-l-4 border-emerald-500'
                    : ''
                }
              >
                <TableCell className="py-1">
                  <p className="font-medium text-xs">{format(row.date, 'dd/MM/yy')}</p>
                </TableCell>

                {/* Actual Transactions */}
                <TableCell className="text-right font-mono text-xs py-1">
                  {row.isDisbursement ? (
                    <span className="text-red-600 font-semibold">{formatCurrency(loan.principal_amount)}</span>
                  ) : (viewMode === 'separate' && row.rowType === 'transaction') ? (
                    formatCurrency(row.transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0))
                  ) : (viewMode === 'merged' && row.transactions.length > 0) ? (
                    formatCurrency(row.transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0))
                  ) : '-'}
                </TableCell>
                <TableCell className="text-right font-mono text-xs py-1">
                  {(viewMode === 'separate' && row.rowType === 'transaction') ? (
                    <span className="text-emerald-600">{formatCurrency(row.transactions.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0))}</span>
                  ) : (viewMode === 'merged' && row.transactions.length > 0) ? (
                    <span className="text-emerald-600">{formatCurrency(row.transactions.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0))}</span>
                  ) : '-'}
                </TableCell>

                {/* Expected Schedule */}
                <TableCell className="text-right font-mono text-xs border-l-2 border-slate-200 py-1">
                  {(viewMode === 'separate' && row.rowType === 'schedule' && row.expectedInterest !== undefined) ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="cursor-help text-xs">
                            {formatCurrency(row.expectedInterest)}
                            <span className="text-[10px] text-slate-500 ml-1">
                              {(() => {
                                const scheduleEntry = row.scheduleEntry;
                                const dailyRate = loan.interest_rate / 100 / 365;

                                // Special case for Rolled-Up loans: first installment is rolled-up interest for entire loan duration
                                if (loan.interest_type === 'Rolled-Up' && scheduleEntry.installment_number === 1) {
                                  const totalDays = differenceInDays(new Date(scheduleEntry.due_date), new Date(loan.start_date));
                                  const principalStart = loan.principal_amount;
                                  const dailyInterestAmount = principalStart * dailyRate;
                                  return `${totalDays}d × ${formatCurrency(dailyInterestAmount)}/day (rolled-up)`;
                                }

                                // Find the period start date
                                const currentIndex = combinedRows.findIndex(r => r.scheduleEntry?.id === scheduleEntry.id);
                                const previousScheduleRows = combinedRows.slice(0, currentIndex).filter(r => r.rowType === 'schedule');
                                const periodStart = previousScheduleRows.length > 0
                                  ? new Date(previousScheduleRows[previousScheduleRows.length - 1].scheduleEntry.due_date)
                                  : new Date(loan.start_date);
                                const periodEnd = new Date(scheduleEntry.due_date);

                                // Find capital transactions within this period
                                const capitalTxInPeriod = combinedRows.filter(r =>
                                  r.rowType === 'transaction' &&
                                  r.date > periodStart &&
                                  r.date <= periodEnd &&
                                  r.transactions.some(tx => tx.principal_applied > 0)
                                ).sort((a, b) => a.date - b.date);

                                if (capitalTxInPeriod.length === 0) {
                                  // No mid-period changes
                                  const principalStart = scheduleEntry?.calculation_principal_start || row.principalOutstanding;
                                  const actualDays = scheduleEntry?.calculation_days || (loan.period === 'Monthly' ? 30 : 7);
                                  const dailyInterestAmount = principalStart * dailyRate;
                                  return `${actualDays}d × ${formatCurrency(dailyInterestAmount)}/day`;
                                } else {
                                  // Mid-period changes - show segments
                                  const segments = [];
                                  let segmentStart = periodStart;
                                  let runningPrincipal = scheduleEntry?.calculation_principal_start || row.principalOutstanding;

                                  for (const txRow of capitalTxInPeriod) {
                                    const daysInSegment = differenceInDays(txRow.date, segmentStart);
                                    if (daysInSegment > 0) {
                                      const dailyInterestAmount = runningPrincipal * dailyRate;
                                      segments.push(`${daysInSegment}d × ${formatCurrency(dailyInterestAmount)}/day`);
                                    }

                                    const principalPaid = txRow.transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
                                    runningPrincipal = Math.max(0, runningPrincipal - principalPaid);
                                    segmentStart = txRow.date;
                                  }

                                  // Final segment
                                  const finalDays = differenceInDays(periodEnd, segmentStart);
                                  if (finalDays > 0) {
                                    const dailyInterestAmount = runningPrincipal * dailyRate;
                                    segments.push(`${finalDays}d × ${formatCurrency(dailyInterestAmount)}/day`);
                                  }

                                  return segments.join(' + ');
                                }
                              })()}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-md">
                          <div className="space-y-1 text-xs">
                            <p className="font-semibold">Interest Calculation:</p>
                            <p>Annual Rate: {loan.interest_rate}%</p>
                            <p>Daily Rate: {(loan.interest_rate / 100 / 365 * 100).toFixed(4)}% per day</p>
                            {(() => {
                              const scheduleEntry = row.scheduleEntry;
                              const dailyRate = loan.interest_rate / 100 / 365;

                              // Special case for Rolled-Up loans: first installment is rolled-up interest
                              if (loan.interest_type === 'Rolled-Up' && scheduleEntry.installment_number === 1) {
                                const totalDays = differenceInDays(new Date(scheduleEntry.due_date), new Date(loan.start_date));
                                const principalStart = loan.principal_amount;
                                const calculatedInterest = principalStart * dailyRate * totalDays;
                                return (
                                  <>
                                    <p className="font-semibold text-blue-600">Rolled-Up Interest</p>
                                    <p>Loan Duration: {loan.duration} months</p>
                                    <p>Days from Start to Due: {totalDays} days</p>
                                    <p>Principal: {formatCurrency(principalStart)}</p>
                                    <p className="pt-1 border-t">Formula: Principal × Daily Rate × Days</p>
                                    <p className="pl-2">{formatCurrency(principalStart)} × {(dailyRate * 100).toFixed(4)}% × {totalDays}d</p>
                                    <p className="pt-1 border-t font-semibold">= {formatCurrency(calculatedInterest)}</p>
                                  </>
                                );
                              }

                              const currentIndex = combinedRows.findIndex(r => r.scheduleEntry?.id === scheduleEntry.id);
                              const previousScheduleRows = combinedRows.slice(0, currentIndex).filter(r => r.rowType === 'schedule');
                              const periodStart = previousScheduleRows.length > 0
                                ? new Date(previousScheduleRows[previousScheduleRows.length - 1].scheduleEntry.due_date)
                                : new Date(loan.start_date);
                              const periodEnd = new Date(scheduleEntry.due_date);

                              const capitalTxInPeriod = combinedRows.filter(r =>
                                r.rowType === 'transaction' &&
                                r.date > periodStart &&
                                r.date <= periodEnd &&
                                r.transactions.some(tx => tx.principal_applied > 0)
                              ).sort((a, b) => a.date - b.date);

                              if (capitalTxInPeriod.length === 0) {
                                return (
                                  <>
                                    <p>Days in Period: {row.scheduleEntry?.calculation_days || (loan.period === 'Monthly' ? 30 : 7)}</p>
                                    <p>Principal at Start: {formatCurrency(row.scheduleEntry?.calculation_principal_start || row.principalOutstanding)}</p>
                                    <p className="pt-1 border-t">Formula: Principal × Daily Rate × Days</p>
                                  </>
                                );
                              } else {
                                let segmentStart = periodStart;
                                let runningPrincipal = scheduleEntry?.calculation_principal_start || row.principalOutstanding;
                                const segments = [];

                                for (const txRow of capitalTxInPeriod) {
                                  const daysInSegment = differenceInDays(txRow.date, segmentStart);
                                  if (daysInSegment > 0) {
                                    const interestForSegment = runningPrincipal * dailyRate * daysInSegment;
                                    segments.push({
                                      days: daysInSegment,
                                      principal: runningPrincipal,
                                      interest: interestForSegment,
                                      endDate: format(txRow.date, 'MMM dd')
                                    });
                                  }

                                  const principalPaid = txRow.transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
                                  runningPrincipal = Math.max(0, runningPrincipal - principalPaid);
                                  segmentStart = txRow.date;
                                }

                                const finalDays = differenceInDays(periodEnd, segmentStart);
                                if (finalDays > 0) {
                                  const interestForSegment = runningPrincipal * dailyRate * finalDays;
                                  segments.push({
                                    days: finalDays,
                                    principal: runningPrincipal,
                                    interest: interestForSegment,
                                    endDate: format(periodEnd, 'MMM dd')
                                  });
                                }

                                return (
                                  <>
                                    <p className="font-semibold text-amber-600">Mid-Period Principal Change</p>
                                    <p className="pt-1 border-t">Interest Segments:</p>
                                    {segments.map((seg, i) => (
                                      <p key={i} className="pl-2">
                                        • {seg.days}d × {formatCurrency(seg.principal)} × {(dailyRate * 100).toFixed(4)}% = {formatCurrency(seg.interest)}
                                      </p>
                                    ))}
                                    <p className="pt-1 border-t font-semibold">
                                      Total: {formatCurrency(segments.reduce((sum, s) => sum + s.interest, 0))}
                                    </p>
                                  </>
                                );
                              }
                            })()}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (viewMode === 'merged' && schedule.length > 0 && row.expectedInterest > 0) ? (
                    <div>
                      {formatCurrency(row.expectedInterest)}
                      {row.scheduleEntry && row.transactions.length > 0 && row.daysDifference !== null && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={`ml-1 text-xs cursor-help ${row.daysDifference > 0 ? 'text-red-600' : row.daysDifference < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                                ({row.daysDifference === 0 ? 'on time' : `${Math.abs(row.daysDifference)}d ${row.daysDifference > 0 ? 'late' : 'early'}`})
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Expected: {format(new Date(row.scheduleEntry.due_date), 'MMM dd, yyyy')}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  ) : ''}
                </TableCell>
                <TableCell className="text-right font-mono text-xs font-semibold py-1">
                  {(viewMode === 'merged' && schedule.length > 0) ? formatCurrency(row.principalOutstanding + row.interestOutstanding) : 
                   (viewMode === 'separate' && row.rowType === 'schedule') ? formatCurrency(row.principalOutstanding + row.interestOutstanding) : ''}
                </TableCell>
              </TableRow>
            ))}
            {/* Total Row */}
            <TableRow className="bg-slate-100 font-bold border-t-2 border-slate-300">
              <TableCell colSpan={4} className="text-right">
                {schedule.length > 0 && 'Total Outstanding:'}
              </TableCell>
              <TableCell className="text-right font-mono text-lg text-red-600">
                {schedule.length > 0 && formatCurrency(combinedRows.length > 0 ? (combinedRows[combinedRows.length - 1].principalOutstanding + combinedRows[combinedRows.length - 1].interestOutstanding) : 0)}
              </TableCell>
            </TableRow>
            </>
          )}
        </TableBody>
        </Table>
        )}
        </div>
        </div>
        );
        }