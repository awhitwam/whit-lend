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
                    // Reconcile transactions to schedule entries using waterfall logic
                    const sortedSchedule = [...schedule].sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
                    const sortedTransactions = transactions
                      .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
                      .sort((a, b) => new Date(a.date) - new Date(b.date));

                    // Check if there's an initial interest payment on loan start date
                    let initialInterestEntry = null;
                    if (loan && sortedSchedule.length > 0) {
                      const loanStartDate = format(new Date(loan.start_date), 'yyyy-MM-dd');
                      const firstInstallmentDate = sortedSchedule[0].due_date;

                      // If first installment is after loan start date, there might be initial interest
                      if (loanStartDate < firstInstallmentDate) {
                        const txOnStartDate = sortedTransactions.filter(tx => 
                          format(new Date(tx.date), 'yyyy-MM-dd') === loanStartDate
                        );

                        // If there are payments on start date and it's interest-based loan
                        if (txOnStartDate.length > 0 && sortedSchedule[0].interest_amount > 0) {
                          initialInterestEntry = {
                            id: 'initial',
                            installment_number: 0,
                            due_date: loanStartDate,
                            interest_amount: sortedSchedule[0].interest_amount,
                            principal_amount: 0,
                            total_due: sortedSchedule[0].interest_amount,
                            transactions: txOnStartDate,
                            interestPaid: txOnStartDate.reduce((sum, tx) => sum + tx.amount, 0),
                            principalPaid: 0,
                            interestRemaining: 0,
                            principalRemaining: 0
                          };
                        }
                      }
                    }

                    // Create map of schedule row to transactions that paid it
                    const scheduleToTransactions = new Map();
                    sortedSchedule.forEach(row => {
                      scheduleToTransactions.set(row.id, {
                        transactions: [],
                        interestPaid: 0,
                        principalPaid: 0,
                        interestRemaining: row.interest_amount,
                        principalRemaining: row.principal_amount
                      });
                    });

                    // Apply each transaction using waterfall logic (skip initial interest payments)
                    const transactionsToApply = initialInterestEntry 
                      ? sortedTransactions.filter(tx => !initialInterestEntry.transactions.includes(tx))
                      : sortedTransactions;

                    for (const tx of transactionsToApply) {
                      let remainingAmount = tx.amount;

                      for (const row of sortedSchedule) {
                        if (remainingAmount <= 0.01) break;

                        const bucket = scheduleToTransactions.get(row.id);

                        // Pay interest first
                        if (bucket.interestRemaining > 0.01) {
                          const interestPayment = Math.min(remainingAmount, bucket.interestRemaining);
                          bucket.interestRemaining -= interestPayment;
                          bucket.interestPaid += interestPayment;
                          remainingAmount -= interestPayment;

                          if (!bucket.transactions.find(t => t.id === tx.id)) {
                            bucket.transactions.push(tx);
                          }
                        }

                        // Then pay principal
                        if (remainingAmount > 0.01 && bucket.principalRemaining > 0.01) {
                          const principalPayment = Math.min(remainingAmount, bucket.principalRemaining);
                          bucket.principalRemaining -= principalPayment;
                          bucket.principalPaid += principalPayment;
                          remainingAmount -= principalPayment;

                          if (!bucket.transactions.find(t => t.id === tx.id)) {
                            bucket.transactions.push(tx);
                          }
                        }
                      }
                    }

                    // Add initial interest entry if it exists
                    const displayRows = [];
                    if (initialInterestEntry && startIndex === 0) {
                      displayRows.push(initialInterestEntry);
                    }
                    displayRows.push(...schedule.slice(startIndex, endIndex));

                    return displayRows.map((row) => {
                      // Handle initial interest entry specially
                      if (row.id === 'initial') {
                        const totalPaid = row.interestPaid;
                        const expectedTotal = row.total_due;
                        const isPaid = totalPaid >= expectedTotal - 0.01;

                        return (
                          <React.Fragment key="initial">
                            <TableRow className="bg-blue-50/30">
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-2">
                                  <span className="text-slate-400">📄</span>
                                  Initial
                                </div>
                              </TableCell>
                              <TableCell>{format(new Date(row.due_date), 'MMM dd, yyyy')}</TableCell>
                              <TableCell className="text-right font-mono">{formatCurrency(expectedTotal)}</TableCell>
                              <TableCell>
                                <Badge className="bg-emerald-500 text-white">✓ Paid</Badge>
                              </TableCell>
                              <TableCell>{format(new Date(row.due_date), 'MMM dd, yyyy')}</TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(totalPaid)}
                              </TableCell>
                              <TableCell className="text-slate-600 text-sm">Initial interest</TableCell>
                            </TableRow>
                          </React.Fragment>
                        );
                      }

                      // Regular schedule entry handling
                      const bucket = scheduleToTransactions.get(row.id);
                      const rowTransactions = bucket ? bucket.transactions : [];
                      const totalPaid = bucket ? (bucket.interestPaid + bucket.principalPaid) : 0;
                      const expectedTotal = row.total_due;
                      const paymentPercent = expectedTotal > 0 ? (totalPaid / expectedTotal) * 100 : 0;

                      // Determine status based on reconciled amounts
                      const isPaid = totalPaid >= expectedTotal - 0.01;
                      const isPartial = totalPaid > 0.01 && totalPaid < expectedTotal - 0.01;

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

                        if (rowTransactions.length > 0) {
                          const firstTx = rowTransactions[0];
                          datePaid = format(new Date(firstTx.date), 'MMM dd, yyyy');
                          const daysDiff = differenceInDays(new Date(firstTx.date), dueDate);
                          if (daysDiff < 0) notes = 'Paid early';
                          else if (daysDiff === 0) notes = 'On time';
                          else if (daysDiff > 0) notes = `${daysDiff} days late`;
                        }
                      } else if (isPartial) {
                        statusBadge = <Badge className="bg-amber-500 text-white">Partial ({Math.round(paymentPercent)}%)</Badge>;
                        statusColor = 'bg-amber-50/30';
                        if (rowTransactions.length > 0) {
                          datePaid = format(new Date(rowTransactions[0].date), 'MMM dd, yyyy');
                        }
                      } else if (daysOverdue > 0) {
                        statusBadge = <Badge className="bg-red-500 text-white">Late</Badge>;
                        statusColor = 'bg-red-50/30';
                        notes = `${daysOverdue} days overdue`;
                        datePaid = '—';
                      } else {
                        statusBadge = <Badge className="bg-blue-500 text-white">⏰ Upcoming</Badge>;
                        statusColor = 'bg-blue-50/30';
                        datePaid = '—';
                      }

                      // Only show splits if there are multiple transactions AND status is partial
                      const showSplits = isPartial && rowTransactions.length > 1;

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
                            <TableCell className="text-slate-600 text-sm">{notes}</TableCell>
                          </TableRow>

                          {showSplits && rowTransactions.map((tx, idx) => (
                            <TableRow key={`${row.id}-split-${idx}`} className="bg-slate-50/50 border-l-2 border-slate-300 ml-4">
                              <TableCell className="py-2">
                                <div className="pl-6 text-slate-400 text-xs">↳</div>
                              </TableCell>
                              <TableCell className="text-sm font-medium text-slate-700 py-2">
                                Split {idx + 1}
                              </TableCell>
                              <TableCell className="text-right text-sm py-2">
                                {format(new Date(tx.date), 'MMM dd, yyyy')}
                              </TableCell>
                              <TableCell className="text-sm text-slate-500 py-2">
                                Received {format(new Date(tx.date), 'MMM dd')}
                              </TableCell>
                              <TableCell className="py-2"></TableCell>
                              <TableCell className="text-right font-mono text-sm py-2">
                                {formatCurrency(tx.amount)}
                              </TableCell>
                              <TableCell className="text-sm text-slate-500 py-2">—</TableCell>
                            </TableRow>
                          ))}
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