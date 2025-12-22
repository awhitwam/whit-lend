import React, { useState } from 'react';
import { format, differenceInDays, addMonths, addWeeks } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, Split, List, Download } from 'lucide-react';
import { formatCurrency } from './LoanCalculator';

export default function RepaymentScheduleTable({ schedule, isLoading, transactions = [], loan }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [viewMode, setViewMode] = useState('detailed'); // 'separate', 'detailed', 'smartview2'
  const [showCumulativeColumns, setShowCumulativeColumns] = useState(false);
  // Calculate totals
  const totalPrincipalDisbursed = loan ? loan.principal_amount : 0;
  
  let cumulativeInterestPaid = transactions
    .filter(tx => !tx.is_deleted)
    .reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
  
  // Create combined or separate rows based on view mode
  let combinedRows;

  if (viewMode === 'separate') {
    // SEPARATE VIEW: Show all schedule entries and all transactions separately
    // Every transaction gets its own row, every schedule entry gets its own row
    const allRows = [];
    const periodsPerYear = loan.period === 'Monthly' ? 12 : 52;
    const periodRate = (loan.interest_rate / 100) / periodsPerYear;

    // Add disbursement row
    if (loan) {
      allRows.push({
        date: new Date(loan.start_date),
        dateStr: format(new Date(loan.start_date), 'yyyy-MM-dd'),
        isDisbursement: true,
        transactions: [],
        scheduleEntry: null,
        daysDifference: null,
        rowType: 'disbursement'
      });
    }

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
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              <Button
                variant={viewMode === 'detailed' ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode('detailed')}
                className="gap-1 h-8"
              >
                <List className="w-4 h-4" />
                SmartView
              </Button>
              <Button
                variant={viewMode === 'smartview2' ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode('smartview2')}
                className="gap-1 h-8"
              >
                <List className="w-4 h-4" />
                SmartView2
              </Button>
              <Button
                variant={viewMode === 'separate' ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode('separate')}
                className="gap-1 h-8"
              >
                <Split className="w-4 h-4" />
                Schedule
              </Button>
            </div>
            {viewMode === 'separate' && (
              <>
                <div className="h-4 w-px bg-slate-300" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportToCSV}
                  className="gap-1 h-8"
                >
                  <Download className="w-4 h-4" />
                  Export CSV
                </Button>
              </>
            )}
            {viewMode === 'smartview2' && (
              <>
                <div className="h-4 w-px bg-slate-300" />
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showCumulativeColumns}
                    onChange={(e) => setShowCumulativeColumns(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                  Show Cumulative
                </label>
              </>
            )}
            <div className="h-4 w-px bg-slate-300" />
            <span className="text-sm text-slate-600">Show</span>
            <Select value={itemsPerPage.toString()} onValueChange={handleItemsPerPageChange}>
              <SelectTrigger className="w-20">
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
            <span className="text-sm text-slate-600">entries</span>
            {!isLoading && itemCount > 0 && (
              <>
                <div className="h-4 w-px bg-slate-300 mx-1" />
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Previous
                  </Button>
                  <span className="text-sm text-slate-600">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                  >
                    Next
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </>
            )}
          </div>
          <div className="text-sm text-slate-600">
            Showing {startIndex + 1} to {Math.min(endIndex, itemCount)} of {itemCount}
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
                                {row.installment_number}
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
                            <TableCell className="text-slate-600 text-sm">{notes}</TableCell>
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
                                {row.installment_number}
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
                            <TableCell className="text-slate-600 text-sm">
                              {notes && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="cursor-help underline decoration-dotted">{notes}</span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-sm">
                                      {isPastDue ? (
                                        cumulativeBalance < -0.01 ? (
                                          recoveryTransactionDate ? (
                                            <p>Interest was paid {daysLate} day{daysLate !== 1 ? 's' : ''} after the due date. The cumulative interest balance became positive on {format(recoveryTransactionDate, 'MMM dd, yyyy')}.</p>
                                          ) : (
                                            <p>Interest payment is overdue. As of the due date ({format(dueDate, 'MMM dd, yyyy')}), there was a shortfall of {formatCurrency(arrearsAtDueDate)}. This has not yet been recovered.</p>
                                          )
                                        ) : (
                                          cumulativeBalance > 0.01 ? (
                                            <p>Interest obligations were met by the due date. The account has a surplus of {formatCurrency(cumulativeBalance)} in interest payments.</p>
                                          ) : (
                                            <p>Interest obligations were met exactly by the due date ({format(dueDate, 'MMM dd, yyyy')}).</p>
                                          )
                                        )
                                      ) : (
                                        cumulativeBalance > 0.01 ? (
                                          <p>This payment is upcoming in {daysUntilDue} day{daysUntilDue !== 1 ? 's' : ''}. The account currently has a surplus of {formatCurrency(cumulativeBalance)}, meaning interest payments are ahead of schedule.</p>
                                        ) : (
                                          <p>This payment is due in {daysUntilDue} day{daysUntilDue !== 1 ? 's' : ''} ({format(dueDate, 'MMM dd, yyyy')}).</p>
                                        )
                                      )}
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
                    {schedule.length > 0 && 'Expected Interest'}
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
                <TableCell className="py-2">
                  <p className="font-medium">{format(row.date, 'MMM dd, yyyy')}</p>
                </TableCell>
                
                {/* Actual Transactions */}
                <TableCell className="text-right font-mono text-sm py-2">
                  {row.isDisbursement ? (
                    <span className="text-red-600 font-semibold">{formatCurrency(loan.principal_amount)}</span>
                  ) : (viewMode === 'separate' && row.rowType === 'transaction') ? (
                    formatCurrency(row.transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0))
                  ) : (viewMode === 'merged' && row.transactions.length > 0) ? (
                    formatCurrency(row.transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0))
                  ) : '-'}
                </TableCell>
                <TableCell className="text-right font-mono text-sm py-2">
                  {(viewMode === 'separate' && row.rowType === 'transaction') ? (
                    <span className="text-emerald-600">{formatCurrency(row.transactions.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0))}</span>
                  ) : (viewMode === 'merged' && row.transactions.length > 0) ? (
                    <span className="text-emerald-600">{formatCurrency(row.transactions.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0))}</span>
                  ) : '-'}
                </TableCell>

                {/* Expected Schedule */}
                <TableCell className="text-right font-mono text-sm border-l-2 border-slate-200 py-2">
                  {(viewMode === 'separate' && row.rowType === 'schedule' && row.expectedInterest !== undefined) ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="cursor-help">
                            {formatCurrency(row.expectedInterest)}
                            <span className="text-xs text-slate-500 ml-2">
                              {(() => {
                                const scheduleEntry = row.scheduleEntry;
                                const dailyRate = loan.interest_rate / 100 / 365;
                                
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
                                const dailyRate = loan.interest_rate / 100 / 365;
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
                <TableCell className="text-right font-mono text-sm font-semibold py-2">
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