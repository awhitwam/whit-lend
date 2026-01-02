import React, { useState, useEffect } from 'react';
import { format, differenceInDays } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, ChevronDown, Split, List, Download, Layers, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react';
import { formatCurrency } from './LoanCalculator';
import { getOrgItem, setOrgItem } from '@/lib/orgStorage';

// Helper to check if penalty rate applies for a given date
const isPenaltyRateActive = (loan, date) => {
  if (!loan?.has_penalty_rate || !loan?.penalty_rate || !loan?.penalty_rate_from) {
    return false;
  }
  const penaltyDate = new Date(loan.penalty_rate_from);
  penaltyDate.setHours(0, 0, 0, 0);
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  return checkDate >= penaltyDate;
};

// Helper to get effective rate for display
const getDisplayRate = (loan, date) => {
  if (isPenaltyRateActive(loan, date)) {
    return loan.penalty_rate;
  }
  return loan?.interest_rate || 0;
};

export default function RepaymentScheduleTable({ schedule, isLoading, transactions = [], loan, product }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [viewMode, setViewMode] = useState('nested'); // 'nested', 'smartview2', 'separate', 'detailed'

  // Check if this is a Fixed Charge loan
  const isFixedCharge = loan?.product_type === 'Fixed Charge' || product?.product_type === 'Fixed Charge';
  // Check if this is an Irregular Income loan (no schedule should be shown)
  const isIrregularIncome = loan?.product_type === 'Irregular Income' || product?.product_type === 'Irregular Income';
  // Use nullish coalescing to handle 0 correctly (0 is a valid monthly_charge value, but || would skip it)
  const monthlyCharge = loan?.monthly_charge ?? product?.monthly_charge ?? 0;

  // For Irregular Income loans, treat schedule as empty (only show transactions)
  const effectiveSchedule = isIrregularIncome ? [] : schedule;

  // Load nested sort order from org-scoped localStorage, default to 'asc' (oldest first)
  const [nestedSortOrder, setNestedSortOrder] = useState(() => {
    const saved = getOrgItem('nestedScheduleSortOrder');
    return saved || 'asc';
  });

  // Load smart view sort order from org-scoped localStorage, default to 'asc' (oldest first)
  const [smartViewSortOrder, setSmartViewSortOrder] = useState(() => {
    const saved = getOrgItem('smartViewSortOrder');
    return saved || 'asc';
  });

  // Load collapsed state from org-scoped localStorage, default to true (collapsed)
  const [periodsCollapsed, setPeriodsCollapsed] = useState(() => {
    const saved = getOrgItem('nestedScheduleCollapsed');
    return saved === null ? true : saved === 'true';
  });

  // Track individually expanded periods (when globally collapsed, these are expanded)
  const [expandedPeriods, setExpandedPeriods] = useState(new Set());

  // Toggle a single period's expansion
  const togglePeriodExpansion = (periodId) => {
    setExpandedPeriods(prev => {
      const next = new Set(prev);
      if (next.has(periodId)) {
        next.delete(periodId);
      } else {
        next.add(periodId);
      }
      return next;
    });
  };

  // Check if a period should show its children
  const isPeriodExpanded = (periodId) => {
    // If globally expanded, individual toggles collapse them
    // If globally collapsed, individual toggles expand them
    const isIndividuallyToggled = expandedPeriods.has(periodId);
    return periodsCollapsed ? isIndividuallyToggled : !isIndividuallyToggled;
  };

  // When global collapse state changes, reset individual expansions
  const handleGlobalCollapseToggle = () => {
    setPeriodsCollapsed(prev => !prev);
    setExpandedPeriods(new Set());
  };

  // Save sort order to org-scoped localStorage whenever it changes
  useEffect(() => {
    setOrgItem('nestedScheduleSortOrder', nestedSortOrder);
  }, [nestedSortOrder]);

  useEffect(() => {
    setOrgItem('smartViewSortOrder', smartViewSortOrder);
  }, [smartViewSortOrder]);

  useEffect(() => {
    setOrgItem('nestedScheduleCollapsed', periodsCollapsed.toString());
  }, [periodsCollapsed]);

  const toggleNestedSortOrder = () => {
    setNestedSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  const toggleSmartViewSortOrder = () => {
    setSmartViewSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
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

  // For Fixed Charge loans, sum fees_applied; for regular loans, sum interest_applied
  let cumulativeInterestPaid = transactions
    .filter(tx => !tx.is_deleted)
    .reduce((sum, tx) => sum + (isFixedCharge ? (tx.fees_applied || 0) : (tx.interest_applied || 0)), 0);

  // Calculate total expected interest/charge from schedule
  const totalExpectedInterest = isFixedCharge
    ? monthlyCharge * effectiveSchedule.length
    : effectiveSchedule.reduce((sum, row) => sum + (row.interest_amount || 0), 0);

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

      // Get active repayment transactions
      const repaymentTransactions = transactions.filter(tx => !tx.is_deleted && tx.type === 'Repayment');

      // Get disbursement transactions sorted by date (first one is initial disbursement)
      const disbursementTransactions = transactions
        .filter(tx => !tx.is_deleted && tx.type === 'Disbursement')
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      // Add the first disbursement as the initial "Loan Disbursement" row
      if (disbursementTransactions.length > 0) {
        const firstDisbursement = disbursementTransactions[0];
        allRows.push({
          date: new Date(firstDisbursement.date),
          dateStr: format(new Date(firstDisbursement.date), 'yyyy-MM-dd'),
          isDisbursement: true,
          transactions: [firstDisbursement],
          scheduleEntry: null,
          daysDifference: null,
          rowType: 'disbursement',
          amount: firstDisbursement.amount
        });
      }

      // Add ALL schedule entries as separate rows with dynamically calculated expected interest/charge
      effectiveSchedule.forEach(row => {
        // Calculate principal outstanding at the start of this period
        const dueDate = new Date(row.due_date);

        // Get all principal payments made BEFORE this period starts (before due date)
        const principalPaidBeforeThisPeriod = repaymentTransactions
          .filter(tx => new Date(tx.date) < dueDate)
          .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);

        const principalOutstandingAtStart = loan.principal_amount - principalPaidBeforeThisPeriod;

        // For Fixed Charge loans, use monthly charge; otherwise use schedule's interest amount
        let expectedInterestForPeriod = isFixedCharge ? monthlyCharge : row.interest_amount;

        allRows.push({
          date: dueDate,
          dateStr: format(dueDate, 'yyyy-MM-dd'),
          isDisbursement: false,
          transactions: [],
          scheduleEntry: row,
          daysDifference: null,
          rowType: 'schedule',
          expectedInterest: expectedInterestForPeriod,
          isFixedCharge: isFixedCharge
        });
      });

      // Add ALL repayment transactions as separate rows
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

      // Add further advance (disbursement) transactions as separate rows (skip first one, already added above)
      disbursementTransactions.slice(1).forEach(tx => {
        allRows.push({
          date: new Date(tx.date),
          dateStr: format(new Date(tx.date), 'yyyy-MM-dd'),
          isDisbursement: true,
          isFurtherAdvance: true,
          transactions: [tx],
          scheduleEntry: null,
          daysDifference: null,
          rowType: 'further_advance',
          amount: tx.amount
        });
      });



      // Sort by date, then by type (schedule before transaction on same date)
      combinedRows = allRows.sort((a, b) => {
        const dateCompare = a.date - b.date;
        if (dateCompare !== 0) return dateCompare;

        // On same date: disbursement first, then further_advance, then schedule, then transaction
        const typeOrder = { disbursement: 0, further_advance: 1, schedule: 2, transaction: 3 };
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

      // Accrue interest/charges based on loan type
      if (isFixedCharge) {
        // For Fixed Charge loans, accrue the monthly charge at each schedule period
        if (row.rowType === 'schedule') {
          totalInterestAccrued += monthlyCharge;
        }
      } else {
        // For regular loans, accrue interest on current principal balance for days elapsed
        if (daysSinceLastCalculation > 0 && principalOutstanding > 0) {
          const dailyRate = loan.interest_rate / 100 / 365;
          const interestForPeriod = principalOutstanding * dailyRate * daysSinceLastCalculation;
          totalInterestAccrued += interestForPeriod;
        }
      }

      if (row.rowType === 'disbursement') {
        // Disbursement row - initial state
        row.principalOutstanding = principalOutstanding;
        row.interestOutstanding = 0;
        row.expectedInterest = 0;
      } else if (row.rowType === 'further_advance') {
        // Further advance - increases principal
        const advanceAmount = row.amount || row.transactions[0]?.amount || 0;
        principalOutstanding += advanceAmount;

        row.principalOutstanding = principalOutstanding;
        row.interestOutstanding = totalInterestAccrued - totalInterestPaid;
        row.expectedInterest = 0;

        lastCalculationDate = currentDate;
      } else if (row.rowType === 'transaction') {
        // Apply transaction FIRST, then show resulting balances
        row.transactions.forEach(tx => {
          if (tx.principal_applied) {
            principalOutstanding -= tx.principal_applied;
          }
          // For Fixed Charge, use fees_applied; for regular loans, use interest_applied
          if (isFixedCharge) {
            if (tx.fees_applied) {
              totalInterestPaid += tx.fees_applied;
            }
          } else {
            if (tx.interest_applied) {
              totalInterestPaid += tx.interest_applied;
            }
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
        // For Fixed Charge, expectedInterest is already set from monthlyCharge; use it instead of schedule's interest_amount
        row.expectedInterest = isFixedCharge ? monthlyCharge : row.scheduleEntry.interest_amount;
        
        lastCalculationDate = currentDate;
      }
    });

    cumulativeInterestPaid = totalInterestPaid;
    }

    // Pagination logic
    const itemCount = viewMode === 'detailed' ? effectiveSchedule.length : combinedRows.length;
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
        const getRowType = () => {
          if (row.rowType === 'disbursement') return 'Disbursement';
          if (row.rowType === 'further_advance') return 'Further Advance';
          if (row.rowType === 'transaction') return 'Payment';
          return 'Schedule';
        };
        const getPrincipalAmount = () => {
          if (row.rowType === 'disbursement') return loan.principal_amount;
          if (row.rowType === 'further_advance') return row.amount || row.transactions[0]?.amount || 0;
          return row.transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0) || '';
        };
        const csvRow = [
          format(row.date, 'yyyy-MM-dd'),
          getRowType(),
          getPrincipalAmount(),
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
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 bg-slate-50 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 bg-slate-200 rounded p-0.5">
              <Button
                variant={viewMode === 'nested' ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode('nested')}
                className="gap-1 h-6 text-xs px-2"
              >
                <Layers className="w-3 h-3" />
                Nested
              </Button>
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
            {viewMode === 'nested' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGlobalCollapseToggle}
                className="gap-1 h-6 text-xs px-2"
              >
                {periodsCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {periodsCollapsed ? 'Expand All' : 'Collapse All'}
              </Button>
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
        <div className="flex-1 min-h-0 relative">
        {(viewMode === 'detailed' || viewMode === 'smartview2') ? (
          <Table wrapperClassName="absolute inset-0 overflow-auto">
            <TableHeader className="[&_tr]:sticky [&_tr]:top-0 [&_tr]:z-20 [&_tr]:bg-slate-50">
              <TableRow className="bg-slate-50">
                <TableHead className="font-semibold bg-slate-50 w-12 py-1.5 whitespace-nowrap">#</TableHead>
                <TableHead className="font-semibold bg-slate-50 py-1.5">
                  {viewMode === 'smartview2' ? (
                    <div className="flex items-center gap-1">
                      Due Date
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={toggleSmartViewSortOrder}
                              className="h-5 w-5 p-0 hover:bg-slate-200"
                            >
                              {smartViewSortOrder === 'asc' ? (
                                <ArrowUp className="w-3 h-3" />
                              ) : (
                                <ArrowDown className="w-3 h-3" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{smartViewSortOrder === 'asc' ? 'Oldest first (click for newest first)' : 'Newest first (click for oldest first)'}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  ) : (
                    'Due Date'
                  )}
                </TableHead>
                <TableHead className="font-semibold bg-slate-50 text-right py-1.5">Expected</TableHead>
                <TableHead className="font-semibold bg-slate-50 py-1.5">Status</TableHead>
                {viewMode === 'detailed' && (
                  <>
                    <TableHead className="font-semibold bg-slate-50 py-1.5">Date Paid</TableHead>
                    <TableHead className="font-semibold bg-slate-50 text-right py-1.5">Amt Paid</TableHead>
                  </>
                )}
                {viewMode === 'smartview2' && (
                  <>
                    <TableHead className="font-semibold bg-slate-50 py-1.5">Paid Date</TableHead>
                    <TableHead className="font-semibold bg-slate-50 text-right py-1.5">Amount</TableHead>
                  </>
                )}
                <TableHead className="font-semibold bg-slate-50 text-right py-1.5">+/-</TableHead>
                <TableHead className="font-semibold bg-slate-50 py-1.5">Notes</TableHead>
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
              ) : effectiveSchedule.length === 0 ? (
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
                    const sortedSchedule = [...effectiveSchedule].sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
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
                      const row = effectiveSchedule[i];
                      const payments = initialPayments.get(row.id) || [];
                      const directPayment = payments.reduce((sum, tx) => sum + tx.amount, 0);
                      cumulativeVariance += (directPayment - row.total_due);
                    }

                    const displayRows = effectiveSchedule.slice(startIndex, endIndex);

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

                      // Check if penalty rate applies to this period
                      const hasPenaltyRate = isPenaltyRateActive(loan, dueDate);

                      return (
                        <React.Fragment key={row.id}>
                          <TableRow className={`${statusColor} ${row.is_extension_period ? 'bg-purple-50' : ''}`}>
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
                            <TableCell className="text-slate-600 text-xs">
                              <div className="flex items-center gap-1.5">
                                {hasPenaltyRate ? (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                                          <AlertTriangle className="w-3 h-3" />
                                          <span className="line-through text-slate-400">{loan.interest_rate}%</span>
                                          <span>→</span>
                                          <span>{loan.penalty_rate}%</span>
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>Penalty rate of {loan.penalty_rate}% applies from {format(new Date(loan.penalty_rate_from), 'dd MMM yyyy')}</p>
                                        <p className="text-slate-400 text-xs">Original rate: {loan.interest_rate}%</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                ) : (
                                  <span className="text-slate-500">{loan.interest_rate}%</span>
                                )}
                                <span>{notes}</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        </React.Fragment>
                      );
                      });
                  })()
                  ) : (
                    (() => {
                    // SMART VIEW - Fuzzy payment matching by nearest due date
                    // Each payment matches to the schedule period with closest due date
                    const sortedSchedule = [...effectiveSchedule].sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
                    const sortedTransactions = transactions
                      .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
                      .sort((a, b) => new Date(a.date) - new Date(b.date));

                    const today = new Date();

                    // Match each payment to nearest schedule period by date proximity
                    const paymentAssignments = new Map();
                    sortedSchedule.forEach(row => {
                      paymentAssignments.set(row.id, []);
                    });

                    // For each payment, find the schedule period with minimum absolute days difference
                    sortedTransactions.forEach(tx => {
                      const txDate = new Date(tx.date);
                      let closestSchedule = null;
                      let minDaysDiff = Infinity;

                      sortedSchedule.forEach(scheduleRow => {
                        const dueDate = new Date(scheduleRow.due_date);
                        const daysDiff = Math.abs(differenceInDays(txDate, dueDate));
                        if (daysDiff < minDaysDiff) {
                          minDaysDiff = daysDiff;
                          closestSchedule = scheduleRow;
                        }
                      });

                      if (closestSchedule) {
                        paymentAssignments.get(closestSchedule.id).push({
                          ...tx,
                          daysDiff: minDaysDiff,
                          daysFromDue: differenceInDays(txDate, new Date(closestSchedule.due_date))
                        });
                      }
                    });

                    // Build period data with matched payments
                    const periodData = sortedSchedule.map((row) => {
                      const dueDate = new Date(row.due_date);
                      // For Fixed Charge loans, use monthly charge; otherwise use interest amount
                      const expectedAmount = isFixedCharge ? monthlyCharge : (row.interest_amount || row.total_due || 0);
                      const matchedPayments = paymentAssignments.get(row.id) || [];

                      // Sum all payments matched to this period
                      // For Fixed Charge, use fees_applied; for regular loans, use interest_applied
                      const totalPaidForPeriod = matchedPayments.reduce((sum, tx) =>
                        sum + (isFixedCharge ? (tx.fees_applied || tx.amount || 0) : (tx.interest_applied || 0)), 0);
                      const variance = totalPaidForPeriod - expectedAmount;

                      // Get payment date info (use first payment date if multiple)
                      const firstPayment = matchedPayments.length > 0 ? matchedPayments[0] : null;
                      const paidDate = firstPayment ? new Date(firstPayment.date) : null;
                      const daysFromDue = firstPayment ? firstPayment.daysFromDue : null;

                      // Determine status
                      const isPastDue = today > dueDate;
                      let status = 'upcoming';

                      if (totalPaidForPeriod >= expectedAmount - 0.01) {
                        // Fully paid
                        if (paidDate && daysFromDue !== null) {
                          if (daysFromDue < 0) {
                            status = 'paid_early';
                          } else if (daysFromDue === 0) {
                            status = 'paid';
                          } else {
                            status = 'paid_late';
                          }
                        } else {
                          status = 'paid';
                        }
                      } else if (totalPaidForPeriod > 0.01) {
                        // Partially paid
                        status = 'partial';
                      } else if (isPastDue) {
                        // Missed
                        status = 'missed';
                      }
                      // else: upcoming (default)

                      return {
                        row,
                        dueDate,
                        expectedAmount,
                        matchedPayments,
                        totalPaidForPeriod,
                        variance,
                        paidDate,
                        daysFromDue,
                        status
                      };
                    });

                    // Apply sort order to periodData
                    const sortedPeriodData = smartViewSortOrder === 'desc'
                      ? [...periodData].reverse()
                      : periodData;

                    const displayData = sortedPeriodData.slice(startIndex, endIndex);

                    return displayData.map((data) => {
                      if (!data) return null;
                      const row = data.row;

                      const { dueDate, expectedAmount, totalPaidForPeriod, variance, paidDate, daysFromDue, status, matchedPayments } = data;

                      let statusBadge;
                      let statusColor = '';
                      let notes = '';

                      switch (status) {
                        case 'paid_early':
                          statusBadge = <Badge className="bg-emerald-500 text-white">✓ Paid</Badge>;
                          statusColor = 'bg-emerald-50/30';
                          notes = `${Math.abs(daysFromDue)} days early`;
                          break;
                        case 'paid':
                          statusBadge = <Badge className="bg-emerald-500 text-white">✓ Paid</Badge>;
                          statusColor = 'bg-emerald-50/30';
                          notes = 'On time';
                          break;
                        case 'paid_late':
                          statusBadge = <Badge className="bg-amber-500 text-white">Paid Late</Badge>;
                          statusColor = 'bg-amber-50/30';
                          notes = `${daysFromDue} days late`;
                          break;
                        case 'partial':
                          const pctPaid = Math.round((totalPaidForPeriod / expectedAmount) * 100);
                          statusBadge = <Badge className="bg-amber-500 text-white">Partial ({pctPaid}%)</Badge>;
                          statusColor = 'bg-amber-50/30';
                          notes = `${formatCurrency(Math.abs(variance))} short`;
                          break;
                        case 'missed':
                          const daysOverdue = differenceInDays(today, dueDate);
                          statusBadge = <Badge className="bg-red-500 text-white">Missed</Badge>;
                          statusColor = 'bg-red-50/30';
                          notes = `${daysOverdue} days overdue`;
                          break;
                        case 'upcoming':
                        default:
                          const daysUntil = differenceInDays(dueDate, today);
                          statusBadge = <Badge className="bg-blue-500 text-white">Upcoming</Badge>;
                          statusColor = 'bg-blue-50/30';
                          notes = daysUntil === 0 ? 'Due today' : `Due in ${daysUntil} days`;
                          break;
                      }

                      // Add overpayment note if applicable
                      if (variance > 0.01 && (status === 'paid' || status === 'paid_early' || status === 'paid_late')) {
                        notes += ` (+${formatCurrency(variance)} over)`;
                      }

                      // Show multiple payments note
                      if (matchedPayments.length > 1) {
                        notes += ` (${matchedPayments.length} payments)`;
                      }

                      // Check if penalty rate applies to this period
                      const hasPenaltyRate = isPenaltyRateActive(loan, dueDate);

                      // Variance color
                      const varianceColor = variance >= 0
                        ? 'text-emerald-600'
                        : (Math.abs(variance) <= expectedAmount ? 'text-amber-600' : 'text-red-600');

                      return (
                        <TableRow key={row.id} className={`${statusColor} ${row.is_extension_period ? 'bg-purple-50' : ''}`}>
                          <TableCell className="font-medium py-1.5 whitespace-nowrap">
                            {formatInstallmentLabel(row)}
                          </TableCell>
                          <TableCell className="py-1.5">{format(dueDate, 'MMM dd, yyyy')}</TableCell>
                          <TableCell className="text-right font-mono py-1.5">{formatCurrency(expectedAmount)}</TableCell>
                          <TableCell className="py-1.5">{statusBadge}</TableCell>
                          <TableCell className="py-1.5">
                            {paidDate ? format(paidDate, 'MMM dd, yyyy') : '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono py-1.5">
                            {totalPaidForPeriod > 0 ? formatCurrency(totalPaidForPeriod) : '—'}
                          </TableCell>
                          <TableCell className={`text-right font-mono font-semibold py-1.5 ${varianceColor}`}>
                            {variance >= 0 ? '+' : ''}{formatCurrency(variance)}
                          </TableCell>
                          <TableCell className="text-slate-600 text-xs py-1.5">
                            <div className="flex items-center gap-1.5">
                              {hasPenaltyRate ? (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                                        <AlertTriangle className="w-3 h-3" />
                                        <span className="line-through text-slate-400">{loan.interest_rate}%</span>
                                        <span>→</span>
                                        <span>{loan.penalty_rate}%</span>
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>Penalty rate of {loan.penalty_rate}% applies from {format(new Date(loan.penalty_rate_from), 'dd MMM yyyy')}</p>
                                      <p className="text-slate-400 text-xs">Original rate: {loan.interest_rate}%</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                <span className="text-slate-500">{loan.interest_rate}%</span>
                              )}
                              <span>{notes}</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    });
                    })()
                  )}
                </>
              )}
              {/* Totals Row for Smart/Detailed Views */}
              {!isLoading && effectiveSchedule.length > 0 && (() => {
                const allRepayments = transactions.filter(tx => !tx.is_deleted && tx.type === 'Repayment');
                const allDisbursements = transactions.filter(tx => !tx.is_deleted && tx.type === 'Disbursement');
                const totalPrincipalPaid = allRepayments.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
                const totalInterestPaid = allRepayments.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
                const totalFeesPaid = allRepayments.reduce((sum, tx) => sum + (tx.fees_applied || 0), 0);
                const totalDisbursements = allDisbursements.reduce((sum, tx) => sum + (tx.amount || 0), 0);
                const totalExpectedInterest = effectiveSchedule.reduce((sum, row) => sum + (row.interest_amount || 0), 0);
                // Use loan.principal_amount as the base - disbursement transactions should equal this
                // (further advances beyond initial principal are handled separately if needed)
                const totalExpectedPrincipal = loan.principal_amount;
                const principalOutstanding = totalExpectedPrincipal - totalPrincipalPaid;
                const interestOutstanding = totalExpectedInterest - totalInterestPaid;
                const totalOutstanding = principalOutstanding + interestOutstanding;

                return (
                  <TableRow className="bg-slate-100 border-t-2 border-slate-300">
                    <TableCell colSpan={viewMode === 'smartview2' ? 6 : 6} className="text-right font-semibold text-sm py-2">
                      Totals
                    </TableCell>
                    <TableCell colSpan={2} className="py-2">
                      <div className="text-xs space-y-1">
                        <div className="flex justify-between">
                          <span className="text-slate-600">Principal:</span>
                          <span className="font-mono">
                            {formatCurrency(totalExpectedPrincipal)} owed - {formatCurrency(totalPrincipalPaid)} paid =
                            <span className={`font-bold ${principalOutstanding < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {principalOutstanding < 0 ? '-' : ''}{formatCurrency(Math.abs(principalOutstanding))}
                            </span>
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Interest:</span>
                          <span className="font-mono">
                            {formatCurrency(totalExpectedInterest)} owed - {formatCurrency(totalInterestPaid)} paid =
                            <span className={`font-bold ${interestOutstanding < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {interestOutstanding < 0 ? '-' : ''}{formatCurrency(Math.abs(interestOutstanding))}
                            </span>
                          </span>
                        </div>
                        {totalFeesPaid > 0 && (
                          <div className="flex justify-between">
                            <span className="text-purple-600">Fees collected:</span>
                            <span className="font-mono text-purple-600">{formatCurrency(totalFeesPaid)}</span>
                          </div>
                        )}
                        <div className="flex justify-between border-t pt-1">
                          <span className="text-slate-700 font-semibold">{totalOutstanding < 0 ? 'Total Overpaid:' : 'Total Outstanding:'}</span>
                          <span className={`font-mono font-bold text-base ${totalOutstanding < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {totalOutstanding < 0 ? '-' : ''}{formatCurrency(Math.abs(totalOutstanding))}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })()}
            </TableBody>
          </Table>
        ) : viewMode === 'nested' ? (
          <Table wrapperClassName="absolute inset-0 overflow-auto">
            <TableHeader className="[&_tr]:sticky [&_tr]:z-20 [&_tr]:bg-slate-50 [&_tr:first-child]:top-0 [&_tr:last-child]:top-[33px]">
              <TableRow className="bg-slate-50">
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
                <TableHead className="font-semibold bg-slate-50 text-right">Principal Bal</TableHead>
                <TableHead className="font-semibold bg-slate-50 text-right">Interest Rcvd</TableHead>
                <TableHead className="font-semibold bg-slate-50 text-right">Interest Due</TableHead>
                <TableHead className="font-semibold bg-slate-50 text-right">Interest Bal</TableHead>
                <TableHead className="font-semibold bg-slate-50 w-28">Status</TableHead>
              </TableRow>
              {/* Summary totals row - fixed below header */}
              {!isLoading && (() => {
                // Calculate summary totals for nested view
                const totalDisbursed = loan.principal_amount +
                  transactions.filter(tx => !tx.is_deleted && tx.type === 'Disbursement')
                    .reduce((sum, tx) => sum + (tx.amount || 0), 0);
                const totalPrincipalReceived = transactions
                  .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
                  .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
                const totalInterestReceived = transactions
                  .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
                  .reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
                const totalExpectedInterest = effectiveSchedule.reduce((sum, row) => sum + (row.interest_amount || 0), 0);

                const principalBalance = totalDisbursed - totalPrincipalReceived;
                const interestBalance = totalExpectedInterest - totalInterestReceived;

                return (
                  <TableRow className="bg-slate-100 border-b-2 border-slate-300">
                    <TableCell className="py-1.5 text-xs font-semibold text-slate-600 bg-slate-100" colSpan={3}>
                      Current Totals
                    </TableCell>
                    <TableCell className="py-1.5 text-right font-mono text-sm font-bold text-slate-800 bg-slate-100">
                      {formatCurrency(principalBalance)}
                    </TableCell>
                    <TableCell className="py-1.5 text-right font-mono text-sm font-bold text-emerald-600 bg-slate-100">
                      {formatCurrency(totalInterestReceived)}
                    </TableCell>
                    <TableCell className="py-1.5 text-right font-mono text-sm text-slate-500 bg-slate-100">
                      ({formatCurrency(totalExpectedInterest)})
                    </TableCell>
                    <TableCell className={`py-1.5 text-right font-mono text-sm font-bold bg-slate-100 ${interestBalance < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {interestBalance < 0 ? '-' : ''}{formatCurrency(Math.abs(interestBalance))}
                    </TableCell>
                    <TableCell className="py-1.5 bg-slate-100"></TableCell>
                  </TableRow>
                );
              })()}
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(6).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8} className="h-14">
                      <div className="h-4 bg-slate-100 rounded animate-pulse w-full"></div>
                    </TableCell>
                  </TableRow>
                ))
              ) : effectiveSchedule.length === 0 ? (
                // NO SCHEDULE VIEW: Show only disbursements and receipts (for Irregular Income loans)
                (() => {
                  const repaymentTransactions = transactions
                    .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
                    .sort((a, b) => new Date(a.date) - new Date(b.date));
                  const disbursementTransactions = transactions
                    .filter(tx => !tx.is_deleted && tx.type === 'Disbursement')
                    .sort((a, b) => new Date(a.date) - new Date(b.date));

                  // Build all rows
                  const rows = [];

                  // First disbursement transaction is the initial "Loan Disbursement"
                  // Subsequent disbursement transactions are "Further Advances"
                  disbursementTransactions.forEach((tx, index) => {
                    rows.push({
                      type: index === 0 ? 'disbursement' : 'further_advance',
                      date: new Date(tx.date),
                      description: index === 0 ? 'Loan Disbursement' : 'Further Advance',
                      principal: tx.amount,
                      transaction: tx,
                      sortOrder: index === 0 ? 0 : 1
                    });
                  });

                  // Add receipts - include both principal and interest portions
                  repaymentTransactions.forEach(tx => {
                    rows.push({
                      type: 'receipt',
                      date: new Date(tx.date),
                      description: 'Receipt',
                      principal: tx.principal_applied || 0,
                      interest: tx.interest_applied || 0,
                      transaction: tx,
                      sortOrder: 2
                    });
                  });

                  // Sort by date
                  rows.sort((a, b) => {
                    const dateDiff = a.date - b.date;
                    if (dateDiff !== 0) return dateDiff;
                    return a.sortOrder - b.sortOrder;
                  });

                  // Calculate running balances
                  let runningPrincipalBalance = 0;
                  rows.forEach(row => {
                    if (row.type === 'disbursement' || row.type === 'further_advance') {
                      runningPrincipalBalance += row.principal;
                    } else if (row.type === 'receipt') {
                      runningPrincipalBalance -= row.principal;
                      runningPrincipalBalance = Math.max(0, runningPrincipalBalance);
                    }
                    row.principalBalance = runningPrincipalBalance;
                  });

                  // Apply sort order
                  const sortedRows = nestedSortOrder === 'desc' ? [...rows].reverse() : rows;

                  if (sortedRows.length === 0) {
                    return (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-12 text-slate-500">
                          No transactions yet
                        </TableCell>
                      </TableRow>
                    );
                  }

                  return sortedRows.map((row, idx) => {
                    if (row.type === 'disbursement') {
                      return (
                        <TableRow key={`disbursement-${idx}`} className="bg-red-50/50 border-l-4 border-red-500">
                          <TableCell className="py-0.5 font-medium text-sm">
                            {format(row.date, 'dd/MM/yy')}
                          </TableCell>
                          <TableCell className="py-0.5 font-semibold text-red-700 text-sm">
                            {row.description}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-red-600 font-semibold text-sm">
                            {formatCurrency(row.principal)}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-red-600 font-semibold text-sm">
                            {formatCurrency(row.principalBalance)}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5">—</TableCell>
                        </TableRow>
                      );
                    }

                    if (row.type === 'further_advance') {
                      return (
                        <TableRow key={`further-advance-${idx}`} className="bg-orange-50/50 border-l-4 border-orange-500">
                          <TableCell className="py-0.5 font-medium text-sm">
                            {format(row.date, 'dd/MM/yy')}
                          </TableCell>
                          <TableCell className="py-0.5 font-semibold text-orange-700 text-sm">
                            {row.description}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-orange-600 font-semibold text-sm">
                            {formatCurrency(row.principal)}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-orange-600 font-semibold text-sm">
                            {formatCurrency(row.principalBalance)}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5">—</TableCell>
                        </TableRow>
                      );
                    }

                    if (row.type === 'receipt') {
                      return (
                        <TableRow key={`receipt-${row.transaction.id}`} className="bg-emerald-50/50 border-l-4 border-emerald-500">
                          <TableCell className="py-0.5 font-medium text-sm">
                            {format(row.date, 'dd/MM/yy')}
                          </TableCell>
                          <TableCell className="py-0.5 text-emerald-700 text-sm">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help">{row.description}</span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-md">
                                  <div className="space-y-1 text-xs">
                                    <p className="font-semibold">Payment Details:</p>
                                    <p>Date: {format(row.date, 'dd MMM yyyy')}</p>
                                    <p>Total Amount: {formatCurrency(row.transaction.amount)}</p>
                                    <p>Principal: {formatCurrency(row.principal)}</p>
                                    <p>Interest: {formatCurrency(row.interest)}</p>
                                    {row.transaction.reference && <p>Reference: {row.transaction.reference}</p>}
                                    {row.transaction.notes && <p>Notes: {row.transaction.notes}</p>}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-emerald-600 text-sm">
                            {row.principal > 0 ? formatCurrency(row.principal) : '—'}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-emerald-600 text-sm">
                            {formatCurrency(row.principalBalance)}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-emerald-600 text-sm">
                            {row.interest > 0 ? formatCurrency(row.interest) : '—'}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5">—</TableCell>
                        </TableRow>
                      );
                    }

                    return null;
                  });
                })()
              ) : (
                (() => {
                  // NESTED VIEW: Group transactions under schedule periods
                  const sortedSchedule = [...effectiveSchedule].sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
                  const repaymentTransactions = transactions
                    .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
                    .sort((a, b) => new Date(a.date) - new Date(b.date));
                  const disbursementTransactions = transactions
                    .filter(tx => !tx.is_deleted && tx.type === 'Disbursement')
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

                  // Build rows WITHOUT running balances first, then sort, then calculate balances
                  const rows = [];

                  // First disbursement transaction is the initial "Loan Disbursement"
                  // Subsequent disbursement transactions are "Further Advances"
                  disbursementTransactions.forEach((tx, index) => {
                    rows.push({
                      type: index === 0 ? 'disbursement' : 'further_advance',
                      date: new Date(tx.date),
                      description: index === 0 ? 'Loan Disbursement' : 'Further Advance',
                      principal: tx.amount,
                      interest: 0,
                      balance: 0, // Will be calculated after sorting
                      transaction: tx,
                      sortOrder: index === 0 ? 0 : 1
                    });
                  });

                  // Process each schedule period
                  sortedSchedule.forEach((scheduleRow, idx) => {
                    const dueDate = new Date(scheduleRow.due_date);
                    // For Fixed Charge loans, use monthly charge; otherwise use interest amount
                    const expectedInterest = isFixedCharge ? monthlyCharge : (scheduleRow.interest_amount || 0);
                    const periodTransactions = txAssignments.get(scheduleRow.id) || [];

                    // Calculate period payments
                    // For Fixed Charge, use fees_applied; for regular loans, use interest_applied
                    const periodInterestPaid = periodTransactions.reduce((sum, tx) =>
                      sum + (isFixedCharge ? (tx.fees_applied || tx.amount || 0) : (tx.interest_applied || 0)), 0);
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
                      balance: 0, // Will be calculated after sorting
                      status,
                      statusVariance,
                      periodInterestPaid,
                      periodPrincipalPaid,
                      expectedInterest,
                      isPastDue,
                      sortOrder: 2, // Schedule headers after disbursements/advances on same date
                      periodTransactions // Store for adding child rows after sorting
                    });
                  });

                  // Sort all rows by date first
                  rows.sort((a, b) => {
                    const dateDiff = a.date - b.date;
                    if (dateDiff !== 0) return dateDiff;
                    // On same date, use sortOrder: disbursement (0), further_advance (1), schedule_header (2)
                    return (a.sortOrder || 0) - (b.sortOrder || 0);
                  });

                  // Now expand schedule headers to include their transaction children, and calculate running balances
                  const expandedRows = [];
                  let runningPrincipalBalance = 0;
                  let prevPrincipalBalance = 0;
                  let runningInterestAccrued = 0;
                  let runningInterestPaid = 0;

                  rows.forEach(row => {
                    if (row.type === 'disbursement') {
                      prevPrincipalBalance = runningPrincipalBalance;
                      runningPrincipalBalance = row.principal;
                      row.balance = runningInterestAccrued - runningInterestPaid;
                      row.principalBalance = runningPrincipalBalance;
                      row.principalChanged = true;
                      expandedRows.push(row);
                    } else if (row.type === 'further_advance') {
                      prevPrincipalBalance = runningPrincipalBalance;
                      runningPrincipalBalance += row.principal;
                      row.balance = runningInterestAccrued - runningInterestPaid;
                      row.principalBalance = runningPrincipalBalance;
                      row.principalChanged = true;
                      expandedRows.push(row);
                    } else if (row.type === 'schedule_header') {
                      // Accrue interest for this period
                      runningInterestAccrued += row.expectedInterest;
                      row.balance = runningInterestAccrued - runningInterestPaid;
                      row.principalBalance = runningPrincipalBalance;
                      row.principalChanged = false;
                      expandedRows.push(row);

                      // Group transactions by date for same-day receipts
                      const periodTransactions = row.periodTransactions || [];
                      const txByDate = new Map();
                      periodTransactions.forEach(tx => {
                        const dateKey = tx.date.split('T')[0]; // Get just the date part
                        if (!txByDate.has(dateKey)) {
                          txByDate.set(dateKey, []);
                        }
                        txByDate.get(dateKey).push(tx);
                      });

                      // Process grouped transactions
                      const txDates = Array.from(txByDate.keys()).sort();
                      const totalTxGroups = txDates.length;

                      txDates.forEach((dateKey, groupIdx) => {
                        const txGroup = txByDate.get(dateKey);
                        const txDate = new Date(dateKey);

                        // Sum up all principal and interest from transactions on this date
                        // For Fixed Charge loans, use fees_applied instead of interest_applied
                        const totalPrincipal = txGroup.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
                        const totalInterest = txGroup.reduce((sum, tx) =>
                          sum + (isFixedCharge ? (tx.fees_applied || 0) : (tx.interest_applied || 0)), 0);

                        // Update running balances
                        prevPrincipalBalance = runningPrincipalBalance;
                        runningPrincipalBalance -= totalPrincipal;
                        runningPrincipalBalance = Math.max(0, runningPrincipalBalance);
                        runningInterestPaid += totalInterest;

                        const principalChanged = totalPrincipal > 0.01;

                        // Calculate status text for the last transaction group in this period
                        let txStatusText = null;
                        if (groupIdx === totalTxGroups - 1) {
                          if (row.status === 'overpaid') {
                            txStatusText = `Overpaid +${formatCurrency(row.statusVariance)}`;
                          } else if (row.status === 'paid') {
                            const daysDiff = differenceInDays(txDate, row.date);
                            if (daysDiff < 0) txStatusText = `${Math.abs(daysDiff)}d early`;
                            else if (daysDiff === 0) txStatusText = 'On time';
                            else txStatusText = `${daysDiff}d late`;
                          } else if (row.status === 'underpaid') {
                            txStatusText = `Short ${formatCurrency(Math.abs(row.statusVariance))}`;
                          } else if (row.status === 'paid_early') {
                            const daysDiff = differenceInDays(txDate, row.date);
                            txStatusText = `${Math.abs(daysDiff)}d early`;
                          }
                        }

                        // Determine description - "Receipt" for payments
                        let description;
                        if (totalPrincipal > 0.01 && totalInterest > 0.01) {
                          description = 'Receipt';
                        } else if (totalPrincipal > 0.01) {
                          description = 'Principal Payment';
                        } else {
                          description = 'Receipt';
                        }

                        expandedRows.push({
                          type: 'transaction_child',
                          transactions: txGroup,
                          date: txDate,
                          description,
                          principal: totalPrincipal,
                          interest: totalInterest,
                          balance: runningInterestAccrued - runningInterestPaid,
                          principalBalance: runningPrincipalBalance,
                          principalChanged,
                          parentScheduleId: row.scheduleRow.id,
                          txStatusText,
                          status: groupIdx === totalTxGroups - 1 ? row.status : null,
                          expectedInterest: row.expectedInterest,
                          dueDate: row.date
                        });
                      });

                      // Store the balances after all period transactions for collapsed view
                      row.principalBalanceAfterPeriod = runningPrincipalBalance;
                      row.interestBalanceAfterPeriod = runningInterestAccrued - runningInterestPaid;
                    }
                  });

                  // Apply sorting based on user preference
                  const sortedRows = nestedSortOrder === 'desc' ? [...expandedRows].reverse() : expandedRows;

                  return sortedRows.map((row, idx) => {
                    // Skip transaction children when their parent period is collapsed
                    if (row.type === 'transaction_child' && !isPeriodExpanded(row.parentScheduleId)) {
                      return null;
                    }

                    if (row.type === 'disbursement') {
                      return (
                        <TableRow key={`disbursement-${idx}`} className="bg-red-50/50 border-l-4 border-red-500">
                          <TableCell className="py-0.5 font-medium text-sm">
                            {format(row.date, 'dd/MM/yy')}
                          </TableCell>
                          <TableCell className="py-0.5 font-semibold text-red-700 text-sm">
                            {row.description}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-red-600 font-semibold text-sm">
                            {formatCurrency(row.principal)}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-red-600 font-semibold text-sm">
                            {formatCurrency(row.principalBalance)}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5">—</TableCell>
                        </TableRow>
                      );
                    }

                    if (row.type === 'further_advance') {
                      return (
                        <TableRow key={`further-advance-${idx}`} className="bg-orange-50/50 border-l-4 border-orange-500">
                          <TableCell className="py-0.5 font-medium text-sm">
                            {format(row.date, 'dd/MM/yy')}
                          </TableCell>
                          <TableCell className="py-0.5 font-semibold text-orange-700 text-sm">
                            {row.description}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-orange-600 font-semibold text-sm">
                            {formatCurrency(row.principal)}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-orange-600 font-semibold text-sm">
                            {formatCurrency(row.principalBalance)}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
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

                      // Check if penalty rate applies to this period
                      const hasPenaltyRate = isPenaltyRateActive(loan, row.date);
                      const effectiveRate = hasPenaltyRate ? loan.penalty_rate : loan.interest_rate;
                      const effectiveDailyRate = effectiveRate / 100 / 365;
                      const hasTransactions = row.periodTransactions && row.periodTransactions.length > 0;
                      const isExpanded = isPeriodExpanded(row.scheduleRow.id);

                      return (
                        <TableRow
                          key={`header-${row.scheduleRow.id}`}
                          className={`${row.scheduleRow.is_extension_period ? 'bg-purple-100/80' : 'bg-slate-100/80'} border-t border-slate-300 ${hasTransactions ? 'cursor-pointer hover:bg-slate-200/80' : ''}`}
                          onClick={hasTransactions ? () => togglePeriodExpansion(row.scheduleRow.id) : undefined}
                        >
                          <TableCell className="py-0.5 font-semibold text-slate-700 text-sm">
                            <div className="flex items-center gap-1">
                              {format(row.date, 'dd/MM/yy')}
                              {hasTransactions && (
                                isExpanded
                                  ? <ChevronDown className="w-3 h-3 text-slate-400" />
                                  : <ChevronRight className="w-3 h-3 text-slate-400" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-0.5 text-sm text-slate-700">
                            {(() => {
                              // Fixed Charge loans show simple monthly charge
                              if (isFixedCharge) {
                                return (
                                  <span>
                                    Fixed charge due @ <span className="font-medium text-purple-600">{formatCurrency(monthlyCharge)}</span>
                                  </span>
                                );
                              }

                              const scheduleRow = row.scheduleRow;
                              const dailyRate = effectiveRate / 100 / 365;
                              const principalStart = scheduleRow?.calculation_principal_start || row.principalBalance || loan.principal_amount;
                              const days = scheduleRow?.calculation_days || (loan.period === 'Monthly' ? 30 : 7);
                              const dailyInterestAmount = principalStart * dailyRate;

                              // Special case for Rolled-Up loans: first installment is rolled-up interest for entire loan duration
                              if (loan.interest_type === 'Rolled-Up' && scheduleRow?.installment_number === 1) {
                                const totalDays = differenceInDays(new Date(scheduleRow.due_date), new Date(loan.start_date));
                                const rollUpPrincipal = loan.principal_amount;
                                const rollUpDailyRate = loan.interest_rate / 100 / 365;
                                const rollUpDailyInterest = rollUpPrincipal * rollUpDailyRate;
                                return (
                                  <span>
                                    Rolled-up interest due, <span className="text-slate-500">{totalDays}d × {formatCurrency(rollUpDailyInterest)}/day</span>
                                  </span>
                                );
                              }

                              if (hasPenaltyRate) {
                                return (
                                  <span className="inline-flex items-center gap-1 flex-wrap">
                                    <span>Interest due at</span>
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                                            <AlertTriangle className="w-3 h-3" />
                                            <span className="line-through text-slate-400">{loan.interest_rate}%</span>
                                            <span>→</span>
                                            <span>{loan.penalty_rate}% pa</span>
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>Penalty rate from {format(new Date(loan.penalty_rate_from), 'dd MMM yyyy')}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                    <span className="text-slate-500">{days}d × {formatCurrency(dailyInterestAmount)}/day</span>
                                  </span>
                                );
                              }
                              return (
                                <span>
                                  Interest due at {effectiveRate}% pa, <span className="text-slate-500">{days}d × {formatCurrency(dailyInterestAmount)}/day</span>
                                </span>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">
                            {!isExpanded && row.periodPrincipalPaid > 0.01
                              ? <span className="text-emerald-600">{formatCurrency(row.periodPrincipalPaid)}</span>
                              : row.principal > 0
                                ? <span className="text-slate-500">{formatCurrency(row.principal)}</span>
                                : <span className="text-slate-500">—</span>}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">
                            {!isExpanded && row.periodPrincipalPaid > 0.01
                              ? <span className="text-emerald-600">{formatCurrency(row.principalBalanceAfterPeriod)}</span>
                              : <span className="text-slate-500">—</span>}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">
                            {!isExpanded && row.periodInterestPaid > 0.01
                              ? <span className="text-emerald-600">{formatCurrency(row.periodInterestPaid)}</span>
                              : <span className="text-slate-500">—</span>}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono font-semibold text-slate-700 text-sm">
                            ({formatCurrency(row.interest)})
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">
                            {(() => {
                              const bal = !isExpanded && row.periodInterestPaid > 0.01
                                ? row.interestBalanceAfterPeriod
                                : row.balance;
                              const colorClass = bal <= 0 ? 'text-emerald-600' : 'text-red-600';
                              return <span className={colorClass}>{formatCurrency(Math.abs(bal))}</span>;
                            })()}
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

                      // Generate unique key from transactions
                      const txIds = row.transactions.map(tx => tx.id).join('-');

                      return (
                        <TableRow
                          key={`tx-${txIds}`}
                          className="bg-white hover:bg-emerald-50/30"
                        >
                          <TableCell className="py-0.5 pl-6 text-slate-600 text-sm">
                            <div className="flex items-center gap-1">
                              <span className="text-emerald-600 text-xs">↳</span>
                              {format(row.date, 'dd/MM/yy')}
                            </div>
                          </TableCell>
                          <TableCell className="py-0.5 text-slate-600 pl-6 text-sm">
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
                                    {row.transactions.length === 1 && row.transactions[0].reference && (
                                      <p>Reference: {row.transactions[0].reference}</p>
                                    )}
                                    {row.transactions.length > 1 && (
                                      <p className="text-slate-400">{row.transactions.length} transactions combined</p>
                                    )}
                                    {row.expectedInterest && (
                                      <p className="pt-1 border-t">Period Expected: {formatCurrency(row.expectedInterest)}</p>
                                    )}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-emerald-600 text-sm">
                            {row.principal > 0.01 ? formatCurrency(row.principal) : '—'}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-emerald-600 text-sm">
                            {row.principalChanged ? formatCurrency(row.principalBalance) : '—'}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-emerald-600 text-sm">
                            {row.interest > 0.01 ? formatCurrency(row.interest) : '—'}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-slate-500 text-sm">
                            —
                          </TableCell>
                          <TableCell className={`py-0.5 text-right font-mono text-sm ${row.balance <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {formatCurrency(Math.abs(row.balance))}
                          </TableCell>
                          <TableCell className="py-0.5 text-xs">
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
              {/* Totals Row for Nested View */}
              {!isLoading && effectiveSchedule.length > 0 && (() => {
                const allRepayments = transactions.filter(tx => !tx.is_deleted && tx.type === 'Repayment');
                const allDisbursements = transactions.filter(tx => !tx.is_deleted && tx.type === 'Disbursement');
                const totalPrincipalPaid = allRepayments.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
                const totalInterestPaid = allRepayments.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
                const totalFeesPaid = allRepayments.reduce((sum, tx) => sum + (tx.fees_applied || 0), 0);
                // Further advances are disbursements beyond the first one (which is the initial principal)
                const sortedDisbursements = [...allDisbursements].sort((a, b) => new Date(a.date) - new Date(b.date));
                const furtherAdvances = sortedDisbursements.slice(1);
                const totalFurtherAdvances = furtherAdvances.reduce((sum, tx) => sum + (tx.amount || 0), 0);
                const totalExpectedInterest = effectiveSchedule.reduce((sum, row) => sum + (row.interest_amount || 0), 0);
                // Total expected principal = original principal + any further advances
                const totalExpectedPrincipal = loan.principal_amount + totalFurtherAdvances;
                const principalOutstanding = totalExpectedPrincipal - totalPrincipalPaid;
                const interestOutstanding = totalExpectedInterest - totalInterestPaid;
                const totalOutstanding = principalOutstanding + interestOutstanding;

                return (
                  <TableRow className="bg-slate-100 border-t-2 border-slate-300">
                    <TableCell colSpan={2} className="text-right font-semibold text-sm py-2">
                      Totals
                    </TableCell>
                    <TableCell className="text-right py-2">
                      <div className="text-xs space-y-0.5">
                        <div className="font-mono text-slate-600">{formatCurrency(totalExpectedPrincipal)} owed</div>
                        <div className="font-mono text-emerald-600">-{formatCurrency(totalPrincipalPaid)} paid</div>
                        <div className={`font-mono font-bold border-t pt-0.5 ${principalOutstanding < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {principalOutstanding < 0 ? '-' : ''}{formatCurrency(Math.abs(principalOutstanding))}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right py-2 text-xs font-mono text-slate-500">—</TableCell>
                    <TableCell className="text-right py-2">
                      <div className="text-xs space-y-0.5">
                        <div className="font-mono text-emerald-600">{formatCurrency(totalInterestPaid)} rcvd</div>
                        {totalFeesPaid > 0 && (
                          <div className="font-mono text-purple-600 pt-0.5">Fees: {formatCurrency(totalFeesPaid)}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right py-2">
                      <div className="text-xs space-y-0.5">
                        <div className="font-mono text-slate-600">{formatCurrency(totalExpectedInterest)} due</div>
                      </div>
                    </TableCell>
                    <TableCell colSpan={2} className="text-right py-2">
                      <div className="text-xs">
                        <div className="text-slate-700 font-semibold">{totalOutstanding < 0 ? 'Total Overpaid:' : 'Total Outstanding:'}</div>
                        <div className={`font-mono font-bold text-base ${totalOutstanding < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {totalOutstanding < 0 ? '-' : ''}{formatCurrency(Math.abs(totalOutstanding))}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })()}
            </TableBody>
          </Table>
        ) : (
        <Table wrapperClassName="absolute inset-0 overflow-auto">
              <TableHeader className="[&_tr]:sticky [&_tr]:z-20 [&_tr]:bg-slate-50 [&_tr:first-child]:top-0 [&_tr:last-child]:top-[33px]">
                <TableRow className="bg-slate-50 shadow-sm">
                  <TableHead className="font-semibold bg-slate-50">Date</TableHead>
                  <TableHead className="font-semibold bg-slate-50" colSpan={2}>Actual Transactions</TableHead>
                  <TableHead className="font-semibold bg-slate-50" colSpan={2}>Expected Schedule</TableHead>
                </TableRow>
                <TableRow className="bg-slate-50 border-t shadow-sm">
                  <TableHead className="bg-slate-50"></TableHead>
                  <TableHead className="font-semibold text-right bg-slate-50">
                    <div>{isFixedCharge ? '—' : 'Principal'}</div>
                    {!isFixedCharge && <div className="text-xs text-red-600 font-bold mt-1">{formatCurrency(totalPrincipalDisbursed)}</div>}
                  </TableHead>
                  <TableHead className="font-semibold text-right bg-slate-50">
                    <div>{isFixedCharge ? 'Charges Paid' : 'Interest'}</div>
                    <div className={`text-xs font-bold mt-1 ${isFixedCharge ? 'text-purple-600' : 'text-emerald-600'}`}>{formatCurrency(cumulativeInterestPaid)}</div>
                  </TableHead>
                  <TableHead className="font-semibold text-right border-l-2 border-slate-300 bg-slate-50">
                    {effectiveSchedule.length > 0 && (
                      <>
                        <div>{isFixedCharge ? 'Expected Charge' : 'Expected Interest'}</div>
                        <div className={`text-xs font-bold mt-1 ${isFixedCharge ? 'text-purple-600' : 'text-blue-600'}`}>{formatCurrency(isFixedCharge ? monthlyCharge * effectiveSchedule.length : totalExpectedInterest)}</div>
                      </>
                    )}
                  </TableHead>
                  <TableHead className="font-semibold text-right bg-slate-50">
                    {effectiveSchedule.length > 0 && 'Total Outstanding'}
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
                  row.rowType === 'disbursement'
                    ? 'bg-red-50/50 border-l-4 border-red-500'
                    : row.rowType === 'further_advance'
                    ? 'bg-orange-50/50 border-l-4 border-orange-500'
                    : row.transactions.length > 0
                    ? 'bg-emerald-50/50 border-l-4 border-emerald-500'
                    : row.scheduleEntry?.is_extension_period
                    ? 'bg-purple-50'
                    : ''
                }
              >
                <TableCell className="py-1">
                  <p className="font-medium text-xs">{format(row.date, 'dd/MM/yy')}</p>
                </TableCell>

                {/* Actual Transactions */}
                <TableCell className="text-right font-mono text-xs py-1">
                  {row.rowType === 'disbursement' ? (
                    <span className="text-red-600 font-semibold">{formatCurrency(loan.principal_amount)}</span>
                  ) : row.rowType === 'further_advance' ? (
                    <span className="text-orange-600 font-semibold">{`+${formatCurrency(row.amount || row.transactions[0]?.amount || 0)}`}</span>
                  ) : (viewMode === 'separate' && row.rowType === 'transaction') ? (
                    formatCurrency(row.transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0))
                  ) : (viewMode === 'merged' && row.transactions.length > 0) ? (
                    formatCurrency(row.transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0))
                  ) : '-'}
                </TableCell>
                <TableCell className="text-right font-mono text-xs py-1">
                  {(viewMode === 'separate' && row.rowType === 'transaction') ? (() => {
                    const interestPaid = row.transactions.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
                    const feesPaid = row.transactions.reduce((sum, tx) => sum + (tx.fees_applied || 0), 0);
                    if (feesPaid > 0 && interestPaid === 0) {
                      return <span className="text-purple-600">{formatCurrency(feesPaid)} <span className="text-[10px]">(fee)</span></span>;
                    } else if (feesPaid > 0) {
                      return <span className="text-emerald-600">{formatCurrency(interestPaid)} <span className="text-purple-600">+{formatCurrency(feesPaid)} fee</span></span>;
                    }
                    return <span className="text-emerald-600">{formatCurrency(interestPaid)}</span>;
                  })() : (viewMode === 'merged' && row.transactions.length > 0) ? (() => {
                    const interestPaid = row.transactions.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
                    const feesPaid = row.transactions.reduce((sum, tx) => sum + (tx.fees_applied || 0), 0);
                    if (feesPaid > 0 && interestPaid === 0) {
                      return <span className="text-purple-600">{formatCurrency(feesPaid)} <span className="text-[10px]">(fee)</span></span>;
                    } else if (feesPaid > 0) {
                      return <span className="text-emerald-600">{formatCurrency(interestPaid)} <span className="text-purple-600">+{formatCurrency(feesPaid)} fee</span></span>;
                    }
                    return <span className="text-emerald-600">{formatCurrency(interestPaid)}</span>;
                  })() : '-'}
                </TableCell>

                {/* Expected Schedule */}
                <TableCell className="text-right font-mono text-xs border-l-2 border-slate-200 py-1">
                  {(viewMode === 'separate' && row.rowType === 'schedule' && row.expectedInterest !== undefined) ? (
                    isFixedCharge ? (
                      // Fixed Charge loan - show simple monthly charge (use monthlyCharge directly for reliability)
                      <div className="text-xs">
                        <span className="text-purple-600 font-semibold">{formatCurrency(monthlyCharge)}</span>
                        <span className="text-[10px] text-slate-500 ml-1">(monthly charge)</span>
                      </div>
                    ) : (
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

                                  // Calculate principal at start of THIS period (before any transactions in this period)
                                  const principalPaidBeforePeriodStart = transactions
                                    .filter(tx => !tx.is_deleted && tx.type === 'Repayment' && new Date(tx.date) <= periodStart)
                                    .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
                                  let runningPrincipal = loan.principal_amount - principalPaidBeforePeriodStart;

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

                                // Calculate principal at start of THIS period (before any transactions in this period)
                                const principalPaidBeforePeriodStart = transactions
                                  .filter(tx => !tx.is_deleted && tx.type === 'Repayment' && new Date(tx.date) <= periodStart)
                                  .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
                                let runningPrincipal = loan.principal_amount - principalPaidBeforePeriodStart;
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
                    )
                  ) : (viewMode === 'merged' && effectiveSchedule.length > 0 && row.expectedInterest > 0) ? (
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
                  {(viewMode === 'merged' && effectiveSchedule.length > 0) ? formatCurrency(row.principalOutstanding + row.interestOutstanding) : 
                   (viewMode === 'separate' && row.rowType === 'schedule') ? formatCurrency(row.principalOutstanding + row.interestOutstanding) : ''}
                </TableCell>
              </TableRow>
            ))}
            {/* Totals Row for Journal View */}
            {!isLoading && effectiveSchedule.length > 0 && (() => {
              const allRepayments = transactions.filter(tx => !tx.is_deleted && tx.type === 'Repayment');
              const allDisbursements = transactions.filter(tx => !tx.is_deleted && tx.type === 'Disbursement');
              const totalPrincipalPaid = allRepayments.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
              const totalInterestPaid = allRepayments.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
              const totalFeesPaid = allRepayments.reduce((sum, tx) => sum + (tx.fees_applied || 0), 0);
              // Further advances are disbursements beyond the first one (which is the initial principal)
              const sortedDisbursements = [...allDisbursements].sort((a, b) => new Date(a.date) - new Date(b.date));
              const furtherAdvances = sortedDisbursements.slice(1);
              const totalFurtherAdvances = furtherAdvances.reduce((sum, tx) => sum + (tx.amount || 0), 0);
              const totalExpectedInterest = effectiveSchedule.reduce((sum, row) => sum + (row.interest_amount || 0), 0);
              // Total expected principal = original principal + any further advances
              const totalExpectedPrincipal = loan.principal_amount + totalFurtherAdvances;
              const principalOutstanding = totalExpectedPrincipal - totalPrincipalPaid;
              const interestOutstanding = totalExpectedInterest - totalInterestPaid;
              const totalOutstanding = principalOutstanding + interestOutstanding;

              return (
                <TableRow className="bg-slate-100 border-t-2 border-slate-300">
                  <TableCell className="text-right font-semibold text-sm py-2">
                    Totals
                  </TableCell>
                  <TableCell className="text-right py-2">
                    <div className="text-xs space-y-0.5">
                      <div className="font-mono text-slate-600">{formatCurrency(totalExpectedPrincipal)} owed</div>
                      <div className="font-mono text-emerald-600">-{formatCurrency(totalPrincipalPaid)} paid</div>
                      <div className={`font-mono font-bold border-t pt-0.5 ${principalOutstanding < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {principalOutstanding < 0 ? '-' : ''}{formatCurrency(Math.abs(principalOutstanding))}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right py-2">
                    <div className="text-xs space-y-0.5">
                      <div className="font-mono text-slate-600">{formatCurrency(totalExpectedInterest)} owed</div>
                      <div className="font-mono text-emerald-600">-{formatCurrency(totalInterestPaid)} paid</div>
                      <div className={`font-mono font-bold border-t pt-0.5 ${interestOutstanding < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {interestOutstanding < 0 ? '-' : ''}{formatCurrency(Math.abs(interestOutstanding))}
                      </div>
                      {totalFeesPaid > 0 && (
                        <div className="font-mono text-purple-600 pt-0.5">Fees: {formatCurrency(totalFeesPaid)}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell colSpan={2} className="text-right py-2">
                    <div className="text-xs">
                      <div className="text-slate-700 font-semibold">{totalOutstanding < 0 ? 'Total Overpaid:' : 'Total Outstanding:'}</div>
                      <div className={`font-mono font-bold text-base ${totalOutstanding < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {totalOutstanding < 0 ? '-' : ''}{formatCurrency(Math.abs(totalOutstanding))}
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })()}
            </>
          )}
        </TableBody>
        </Table>
        )}
        </div>
        </div>
        );
        }