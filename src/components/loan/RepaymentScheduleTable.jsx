import React, { useState } from 'react';
import { format, differenceInDays, addMonths, addWeeks } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, Split, List } from 'lucide-react';
import { formatCurrency } from './LoanCalculator';

export default function RepaymentScheduleTable({ schedule, isLoading, transactions = [], loan }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [viewMode, setViewMode] = useState('detailed'); // 'separate', 'detailed'
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

    // Add ALL schedule entries as separate rows
    schedule.forEach(row => {
      allRows.push({
        date: new Date(row.due_date),
        dateStr: format(new Date(row.due_date), 'yyyy-MM-dd'),
        isDisbursement: false,
        transactions: [],
        scheduleEntry: row,
        daysDifference: null,
        rowType: 'schedule'
      });
    });

    // Get active repayment transactions
    const repaymentTransactions = transactions.filter(tx => !tx.is_deleted && tx.type === 'Repayment');
    
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
    // Calculate running balances and cumulative interest with daily accrual
    let principalOutstanding = loan.principal_amount;
    let cumulativeInterestAccrued = 0;
    let currentCumulativeInterestPaid = 0;
    let lastInterestCalculationDate = new Date(loan.start_date);

    combinedRows.forEach(row => {
      const currentDate = row.date;

      // Calculate interest that accrued since last calculation date
      const daysSinceLastCalculation = Math.max(0, differenceInDays(currentDate, lastInterestCalculationDate));

      if (daysSinceLastCalculation > 0 && principalOutstanding > 0) {
        let interestAccruedDaily = 0;
        const dailyRate = loan.interest_rate / 100 / 365;

        if (loan.interest_type === 'Flat' || loan.interest_type === 'Interest-Only') {
          interestAccruedDaily = loan.principal_amount * dailyRate;
        } else if (loan.interest_type === 'Reducing' || loan.interest_type === 'Rolled-Up') {
          interestAccruedDaily = principalOutstanding * dailyRate;
        }
        
        cumulativeInterestAccrued += interestAccruedDaily * daysSinceLastCalculation;
      }

      // Apply actual transactions for the current date
      row.transactions.forEach(tx => {
        if (tx.principal_applied) {
          principalOutstanding -= tx.principal_applied;
        }
        if (tx.interest_applied) {
          currentCumulativeInterestPaid += tx.interest_applied;
        }
      });

      principalOutstanding = Math.max(0, principalOutstanding);

      // Set values for the current row
      row.principalOutstanding = principalOutstanding;
      row.interestOutstanding = cumulativeInterestAccrued - currentCumulativeInterestPaid;

      // Calculate expected periodic interest for this row
      if (row.scheduleEntry) {
        row.expectedInterest = row.scheduleEntry.interest_amount;
      } else if (principalOutstanding > 0 && row.date >= new Date(loan.start_date)) {
        // Dynamically calculate expected periodic interest
        let dynamicallyCalculatedExpectedInterest = 0;
        const annualRate = loan.interest_rate / 100;

        if (loan.period === 'Monthly') {
          const monthlyRate = annualRate / 12;
          if (loan.interest_type === 'Flat' || loan.interest_type === 'Interest-Only') {
            dynamicallyCalculatedExpectedInterest = loan.principal_amount * monthlyRate;
          } else if (loan.interest_type === 'Reducing' || loan.interest_type === 'Rolled-Up') {
            dynamicallyCalculatedExpectedInterest = principalOutstanding * monthlyRate;
          }
        } else if (loan.period === 'Weekly') {
          const weeklyRate = annualRate / 52;
          if (loan.interest_type === 'Flat' || loan.interest_type === 'Interest-Only') {
            dynamicallyCalculatedExpectedInterest = loan.principal_amount * weeklyRate;
          } else if (loan.interest_type === 'Reducing' || loan.interest_type === 'Rolled-Up') {
            dynamicallyCalculatedExpectedInterest = principalOutstanding * weeklyRate;
          }
        }
        row.expectedInterest = dynamicallyCalculatedExpectedInterest;
      } else {
        row.expectedInterest = 0;
      }

      lastInterestCalculationDate = currentDate;
    });

    cumulativeInterestPaid = currentCumulativeInterestPaid;
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
                variant={viewMode === 'separate' ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode('separate')}
                className="gap-1 h-8"
              >
                <Split className="w-4 h-4" />
                Separate
              </Button>
            </div>
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
        {viewMode === 'detailed' ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 sticky top-0 z-20">
                <TableHead className="font-semibold bg-slate-50 w-16">Inst.</TableHead>
                <TableHead className="font-semibold bg-slate-50">Due Date</TableHead>
                <TableHead className="font-semibold bg-slate-50 text-right">Expected Amt</TableHead>
                <TableHead className="font-semibold bg-slate-50">Status</TableHead>
                <TableHead className="font-semibold bg-slate-50">Date Paid</TableHead>
                <TableHead className="font-semibold bg-slate-50 text-right">Amt Paid</TableHead>
                <TableHead className="font-semibold bg-slate-50 text-right">Cumulative Variance</TableHead>
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
                  {(() => {
                    // Smart allocation: match transactions by date, then allocate overpayments to previous underpayments
                    const sortedSchedule = [...schedule].sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
                    const sortedTransactions = transactions
                      .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
                      .sort((a, b) => new Date(a.date) - new Date(b.date));

                    // Initially match each transaction to its nearest schedule entry
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

                    // Now allocate overpayments to previous underpayments
                    const allocatedAmounts = new Map(); // row.id -> allocated amount
                    const latePaymentSources = new Map(); // row.id -> transaction that covered it

                    sortedSchedule.forEach(row => {
                      allocatedAmounts.set(row.id, 0);
                    });

                    let excessPool = 0; // Running pool of overpayments

                    for (let i = 0; i < sortedSchedule.length; i++) {
                      const row = sortedSchedule[i];
                      const payments = initialPayments.get(row.id) || [];
                      const directPayment = payments.reduce((sum, tx) => sum + tx.amount, 0);

                      // Check if there's a shortfall
                      const shortfall = row.total_due - directPayment;

                      if (shortfall > 0.01 && excessPool > 0.01) {
                        // Allocate from excess pool to cover shortfall
                        const allocation = Math.min(shortfall, excessPool);
                        allocatedAmounts.set(row.id, allocation);
                        excessPool -= allocation;

                        // Find the transaction that created this excess (look forward)
                        for (let j = i + 1; j < sortedSchedule.length; j++) {
                          const futureRow = sortedSchedule[j];
                          const futurePayments = initialPayments.get(futureRow.id) || [];
                          const futureDirectPayment = futurePayments.reduce((sum, tx) => sum + tx.amount, 0);
                          const futureExcess = futureDirectPayment - futureRow.total_due;

                          if (futureExcess > 0.01 && futurePayments.length > 0) {
                            latePaymentSources.set(row.id, futurePayments[0]);
                            break;
                          }
                        }
                      } else if (directPayment > row.total_due + 0.01) {
                        // This period has excess
                        excessPool += (directPayment - row.total_due);
                      }
                    }

                    // Calculate cumulative variance from all previous rows (using ONLY direct payments, not allocations)
                    let cumulativeVariance = 0;

                    for (let i = 0; i < startIndex; i++) {
                      const row = schedule[i];
                      const payments = initialPayments.get(row.id) || [];
                      const directPayment = payments.reduce((sum, tx) => sum + tx.amount, 0);
                      cumulativeVariance += (directPayment - row.total_due);
                    }

                    const displayRows = schedule.slice(startIndex, endIndex);

                    return displayRows.map((row, idx) => {
                      // Get payments matched to this schedule entry
                      const payments = initialPayments.get(row.id) || [];
                      const directPayment = payments.reduce((sum, tx) => sum + tx.amount, 0);
                      const allocated = allocatedAmounts.get(row.id) || 0;
                      const totalPaid = directPayment + allocated;
                      const expectedTotal = row.total_due;
                      const paymentPercent = expectedTotal > 0 ? (totalPaid / expectedTotal) * 100 : 0;

                      // Calculate variance for this row (using ONLY direct payment for cumulative variance)
                      const variance = directPayment - expectedTotal;
                      cumulativeVariance += variance;

                      // Determine status
                      const isPaid = totalPaid >= expectedTotal - 0.01;
                      const isPartial = totalPaid > 0.01 && totalPaid < expectedTotal - 0.01;

                      // Check if this was paid late (via allocation from future payment)
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
                          // Paid late via allocation from future payment
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
                        // Only mark as late if they're actually behind (negative cumulative variance)
                        statusBadge = <Badge className="bg-red-500 text-white">Late</Badge>;
                        statusColor = 'bg-red-50/30';
                        notes = `${daysOverdue} days overdue`;
                        datePaid = '—';
                      } else if (daysOverdue > 0 && cumulativeVariance >= 0) {
                        // If overdue but cumulative variance is positive, they're ahead overall
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
                  })()}
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
                  {(viewMode === 'separate' && row.rowType === 'schedule' && row.scheduleEntry) ? (
                    formatCurrency(row.scheduleEntry.interest_amount)
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