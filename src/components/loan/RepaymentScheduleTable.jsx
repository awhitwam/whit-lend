import { useState } from 'react';
import { format, differenceInDays } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCurrency } from './LoanCalculator';

export default function RepaymentScheduleTable({ schedule, isLoading, transactions = [], loan }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  // Calculate totals
  const totalPrincipalDisbursed = loan ? loan.principal_amount : 0;
  
  let cumulativeInterestPaid = transactions
    .filter(tx => !tx.is_deleted)
    .reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
  
  // Create combined entries - merge transactions with schedule entries in same month
  const allDates = new Set();
  const monthMap = new Map(); // Track schedule entries by month
  
  // Add disbursement date
  if (loan) {
    allDates.add(format(new Date(loan.start_date), 'yyyy-MM-dd'));
  }
  
  // Map schedule entries by month
  schedule.forEach(row => {
    const scheduleDate = new Date(row.due_date);
    const monthKey = format(scheduleDate, 'yyyy-MM');
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, []);
    }
    monthMap.get(monthKey).push(row);
  });
  
  // Add all transaction dates
  transactions.filter(tx => !tx.is_deleted).forEach(tx => {
    allDates.add(format(new Date(tx.date), 'yyyy-MM-dd'));
  });
  
  // Track which schedules have been merged with transactions
  const processedScheduleIds = new Set();
  
  // Add schedule dates that don't have a transaction in the same month
  schedule.forEach(row => {
    const scheduleDate = new Date(row.due_date);
    const monthKey = format(scheduleDate, 'yyyy-MM');
    
    // Check if there's a transaction in this month
    const txInMonth = transactions.filter(tx => !tx.is_deleted).some(tx => 
      format(new Date(tx.date), 'yyyy-MM') === monthKey
    );
    
    // If no transaction in this month, add the schedule date
    if (!txInMonth) {
      allDates.add(format(scheduleDate, 'yyyy-MM-dd'));
    }
  });
  
  // Create combined rows
  const combinedRows = Array.from(allDates)
    .sort()
    .map(dateStr => {
      const date = new Date(dateStr);
      const monthKey = format(date, 'yyyy-MM');
      
      // Find matching transaction(s)
      const txs = transactions.filter(tx => 
        !tx.is_deleted && format(new Date(tx.date), 'yyyy-MM-dd') === dateStr
      );
      
      // Find matching schedule entry
      let scheduleEntry = schedule.find(s => 
        format(new Date(s.due_date), 'yyyy-MM-dd') === dateStr
      );
      
      // If this is a transaction date, look for schedule entry in same month to merge
      if (txs.length > 0 && !scheduleEntry) {
        const scheduleInMonth = monthMap.get(monthKey);
        if (scheduleInMonth && scheduleInMonth.length > 0) {
          // Find the closest schedule entry that hasn't been matched yet
          const availableSchedules = scheduleInMonth.filter(s => !processedScheduleIds.has(s.id));
          
          if (availableSchedules.length > 0) {
            const closestSchedule = availableSchedules
              .sort((a, b) => Math.abs(differenceInDays(new Date(a.due_date), date)) - Math.abs(differenceInDays(new Date(b.due_date), date)))[0];
            
            scheduleEntry = closestSchedule;
            processedScheduleIds.add(closestSchedule.id);
          }
        }
      }
      
      // Check if this is the disbursement date
      const isDisbursement = loan && format(new Date(loan.start_date), 'yyyy-MM-dd') === dateStr;
      
      // Calculate days difference if we have both transaction and schedule
      let daysDifference = null;
      if (txs.length > 0 && scheduleEntry) {
        daysDifference = differenceInDays(date, new Date(scheduleEntry.due_date));
      }
      
      return {
        date,
        dateStr,
        isDisbursement,
        transactions: txs,
        scheduleEntry,
        daysDifference
      };
    });
  
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
    const totalPages = Math.ceil(combinedRows.length / itemsPerPage);
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
            {!isLoading && combinedRows.length > 0 && (
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
            Showing {startIndex + 1} to {Math.min(endIndex, combinedRows.length)} of {combinedRows.length}
          </div>
        </div>
        <div className="max-h-[600px] overflow-y-auto relative">
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
                  ) : row.transactions.length > 0 ? (
                    formatCurrency(row.transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0))
                  ) : '-'}
                </TableCell>
                <TableCell className="text-right font-mono text-sm py-2">
                  {row.transactions.length > 0 ? (
                    <span className="text-emerald-600">{formatCurrency(row.transactions.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0))}</span>
                    ) : '-'}
                </TableCell>

                {/* Expected Schedule */}
                <TableCell className="text-right font-mono text-sm border-l-2 border-slate-200 py-2">
                  {schedule.length > 0 && row.expectedInterest > 0 ? (
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
                  {schedule.length > 0 ? formatCurrency(row.principalOutstanding + row.interestOutstanding) : ''}
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
        </div>
        </div>
        );
        }