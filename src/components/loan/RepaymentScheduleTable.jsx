import React, { useState, useEffect } from 'react';
import { format, differenceInDays, addDays } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, ChevronDown, Layers, ArrowUp, ArrowDown, AlertTriangle, FileText, Shield, Receipt, Banknote, Coins, MessageSquare, FolderOpen, Landmark } from 'lucide-react';
import { formatCurrency, calculateLoanInterestBalance, buildCapitalEvents, calculateInterestFromLedger } from './LoanCalculator';
import { getOrgItem, setOrgItem } from '@/lib/orgStorage';
import RentScheduleView from './RentScheduleView';
import { getScheduler } from '@/lib/schedule';

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

export default function RepaymentScheduleTable({ schedule, isLoading, transactions = [], loan, product, tabs = [], activeTab = 'schedule', onTabChange, expenses = [], securityCount = 0, activityCount = 0, reconciliationMap = new Map(), reconciledTransactionIds = new Set() }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Load view mode from org-scoped localStorage, default to 'nested'
  const [viewMode, setViewMode] = useState(() => {
    const saved = getOrgItem('scheduleViewMode');
    return saved || 'nested';
  });

  // Get scheduler info if available
  const schedulerType = product?.scheduler_type;
  const SchedulerClass = schedulerType ? getScheduler(schedulerType) : null;
  const CustomViewComponent = SchedulerClass?.ViewComponent;

  // Wait for product data before rendering to avoid flash of wrong view
  const isProductLoading = !product;

  // Check if this is a Fixed Charge loan
  const isFixedCharge = schedulerType === 'fixed_charge' || loan?.product_type === 'Fixed Charge' || product?.product_type === 'Fixed Charge';
  // Check if this is an Irregular Income loan (no schedule should be shown)
  const isIrregularIncome = schedulerType === 'irregular_income' || loan?.product_type === 'Irregular Income' || product?.product_type === 'Irregular Income';
  // Check if this is a Rent loan (special quarterly view) - now handled via scheduler ViewComponent
  const isRent = schedulerType === 'rent' || loan?.product_type === 'Rent' || product?.product_type === 'Rent';
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

  // Track expanded disbursements (for showing linked repayments)
  const [expandedDisbursements, setExpandedDisbursements] = useState(new Set());

  // Toggle a disbursement's expansion
  const toggleDisbursementExpansion = (disbursementId) => {
    setExpandedDisbursements(prev => {
      const next = new Set(prev);
      if (next.has(disbursementId)) {
        next.delete(disbursementId);
      } else {
        next.add(disbursementId);
      }
      return next;
    });
  };

  // Check if a disbursement should show its children
  const isDisbursementExpanded = (disbursementId) => {
    return expandedDisbursements.has(disbursementId);
  };

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

  useEffect(() => {
    setOrgItem('scheduleViewMode', viewMode);
  }, [viewMode]);

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

  // Calculate totals - use GROSS principal (what borrower owes) for schedule display
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

  if (viewMode === '_removed_separate') {
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

      const headers = [
        'Date', 'Type', 'Principal', 'Interest Paid', 'Expected Interest',
        'Principal Outstanding', 'Interest Outstanding', 'Total Outstanding',
        'Principal Start', 'Days', 'Daily Rate', 'Calculation Description', 'Adjustments', 'Decision Trail'
      ];
      const csvRows = [headers.join(',')];

      const effectiveRate = loan?.interest_rate || product?.interest_rate || 0;
      const dailyRatePercent = effectiveRate / 365;
      const isAdvanceLoan = product?.interest_paid_in_advance;

      combinedRows.forEach(row => {
        const getRowType = () => {
          if (row.rowType === 'disbursement') return 'Disbursement';
          if (row.rowType === 'further_advance') return 'Further Advance';
          if (row.rowType === 'transaction') return 'Payment';
          return 'Schedule';
        };
        const getPrincipalAmount = () => {
          if (row.rowType === 'disbursement') return row.amount || row.transactions[0]?.amount || 0;
          if (row.rowType === 'further_advance') return row.amount || row.transactions[0]?.amount || 0;
          return row.transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0) || '';
        };

        // Build calculation description for schedule rows
        let principalStart = '';
        let days = '';
        let dailyRate = '';
        let calcDescription = '';
        let adjustments = '';
        let decisionTrail = '';

        if (row.rowType === 'schedule') {
          const scheduleEntry = row.scheduleEntry;
          principalStart = row.principalAtPeriodStart || scheduleEntry?.calculation_principal_start || row.principalBalance || '';
          days = row.periodDays || scheduleEntry?.calculation_days || '';

          if (principalStart && effectiveRate) {
            dailyRate = (principalStart * effectiveRate / 100 / 365).toFixed(2);
          }

          // Build description from ledger segments if available
          if (row.ledgerSegments && row.ledgerSegments.length > 0) {
            calcDescription = row.ledgerSegments.map(seg =>
              `${seg.days}d × £${seg.dailyInterest?.toFixed(2) || '0.00'}/day`
            ).join(' + ');
          } else if (days && dailyRate) {
            calcDescription = `${days}d × £${dailyRate}/day`;
          }

          // Add rate info prefix
          if (calcDescription) {
            calcDescription = `Interest due at ${effectiveRate}% pa, ${calcDescription}`;
          }

          // Handle adjustments for advance payment loans
          if (isAdvanceLoan) {
            if (row.periodAdjustment && Math.abs(row.periodAdjustment) > 0.01) {
              // This period generated an overpayment (capital changed mid-period)
              const overpaidDays = row.overpaidDays || '';
              const overpaidDailyRate = row.overpaidDailyRate ? row.overpaidDailyRate.toFixed(2) : '';
              adjustments = `Overpaid ${overpaidDays}d @ £${overpaidDailyRate}/day = £${Math.abs(row.periodAdjustment).toFixed(2)} → credited next`;
              decisionTrail = `Capital changed mid-period. Advance payment = overpaid for remaining days at old rate.`;
            } else if (row.adjustmentFromPrior && Math.abs(row.adjustmentFromPrior) > 0.01) {
              // This period receives credit from prior
              adjustments = `Credit from prior: -£${Math.abs(row.adjustmentFromPrior).toFixed(2)}`;
              decisionTrail = `No capital changes. Applied credit from prior period overpayment.`;
            } else {
              decisionTrail = 'Advance payment - interest due at start of period.';
            }
          } else {
            decisionTrail = 'Arrears payment - interest calculated for period just ended.';
          }
        } else if (row.rowType === 'disbursement') {
          decisionTrail = 'Initial disbursement';
        } else if (row.rowType === 'further_advance') {
          decisionTrail = 'Further advance - principal increased';
        } else if (row.rowType === 'transaction') {
          const principalApplied = row.transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
          const interestApplied = row.transactions.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
          if (principalApplied > 0 && interestApplied > 0) {
            decisionTrail = `Payment: £${principalApplied.toFixed(2)} to principal, £${interestApplied.toFixed(2)} to interest`;
          } else if (principalApplied > 0) {
            decisionTrail = `Capital repayment: £${principalApplied.toFixed(2)}`;
          } else if (interestApplied > 0) {
            decisionTrail = `Interest payment: £${interestApplied.toFixed(2)}`;
          } else {
            decisionTrail = 'Payment recorded';
          }
        }

        // Escape CSV values that might contain commas or quotes
        const escapeCSV = (val) => {
          if (val === null || val === undefined) return '';
          const str = String(val);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        };

        const csvRow = [
          format(row.date, 'yyyy-MM-dd'),
          getRowType(),
          getPrincipalAmount(),
          row.transactions.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0) || '',
          row.expectedInterest || '',
          row.principalOutstanding || '',
          row.interestOutstanding || '',
          (row.principalOutstanding || 0) + (row.interestOutstanding || 0) || '',
          principalStart,
          days,
          dailyRate,
          escapeCSV(calcDescription),
          escapeCSV(adjustments),
          escapeCSV(decisionTrail)
        ];
        csvRows.push(csvRow.join(','));
      });

      const csvContent = csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `loan-${loan?.loan_number || 'schedule'}-detailed.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
    };

    // Early return to prevent flash of wrong view while product data loads
    // This ensures CustomViewComponent is checked only after product is available
    if (isProductLoading) {
      return (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-center p-8 text-slate-400">
            Loading schedule...
          </div>
        </div>
      );
    }

    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 bg-slate-50 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 bg-slate-200 rounded p-0.5">
              <Button
                variant={(activeTab === 'schedule' && viewMode === 'nested') ? "default" : "ghost"}
                size="sm"
                onClick={() => { setViewMode('nested'); onTabChange?.('schedule'); }}
                className="gap-1 h-6 text-xs px-2"
              >
                <Layers className="w-3 h-3" />
                Schedule
              </Button>
              <Button
                variant={(activeTab === 'schedule' && viewMode === 'ledger') ? "default" : "ghost"}
                size="sm"
                onClick={() => { setViewMode('ledger'); onTabChange?.('schedule'); }}
                className="gap-1 h-6 text-xs px-2"
              >
                <FileText className="w-3 h-3" />
                Ledger
              </Button>
            </div>
            {/* Separator */}
            <div className="h-4 w-px bg-slate-300" />
            {/* Content tabs */}
            <div className="flex items-center gap-0.5 bg-slate-200 rounded p-0.5">
              {!isFixedCharge && (
                <Button
                  variant={activeTab === 'disbursements' ? "default" : "ghost"}
                  size="sm"
                  onClick={() => onTabChange?.('disbursements')}
                  className="gap-1 h-6 text-xs px-2"
                >
                  <Banknote className="w-3 h-3" />
                  Disbursements
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                    {transactions.filter(t => !t.is_deleted && t.type === 'Disbursement').length}
                  </Badge>
                </Button>
              )}
              <Button
                variant={activeTab === 'security' ? "default" : "ghost"}
                size="sm"
                onClick={() => onTabChange?.('security')}
                className="gap-1 h-6 text-xs px-2"
              >
                <Shield className="w-3 h-3" />
                Security
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {securityCount}
                </Badge>
              </Button>
              <Button
                variant={activeTab === 'expenses' ? "default" : "ghost"}
                size="sm"
                onClick={() => onTabChange?.('expenses')}
                className="gap-1 h-6 text-xs px-2"
              >
                <Coins className="w-3 h-3" />
                Expenses
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {expenses.length}
                </Badge>
              </Button>
              <Button
                variant={activeTab === 'activity' ? "default" : "ghost"}
                size="sm"
                onClick={() => onTabChange?.('activity')}
                className="gap-1 h-6 text-xs px-2"
              >
                <MessageSquare className="w-3 h-3" />
                Activity
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {activityCount}
                </Badge>
              </Button>
              <Button
                variant={activeTab === 'files' ? "default" : "ghost"}
                size="sm"
                onClick={() => onTabChange?.('files')}
                className="gap-1 h-6 text-xs px-2"
              >
                <FolderOpen className="w-3 h-3" />
                Files
              </Button>
            </div>
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
        {/* Ledger view - shows only actual transactions (reality) */}
        {viewMode === 'ledger' ? (
          (() => {
            // Calculate running balance for ledger view
            const sortedTx = transactions
              .filter(tx => !tx.is_deleted)
              .sort((a, b) => new Date(a.date) - new Date(b.date));

            // Build ledger entries: transactions + rate change events
            const ledgerEntries = [];

            // Add rate change event if loan has penalty rate
            if (loan?.has_penalty_rate && loan?.penalty_rate && loan?.penalty_rate_from) {
              ledgerEntries.push({
                id: 'rate-change-' + loan.penalty_rate_from,
                date: loan.penalty_rate_from,
                type: 'RateChange',
                isRateChange: true,
                oldRate: loan.interest_rate,
                newRate: loan.penalty_rate
              });
            }

            // Add all transactions
            sortedTx.forEach(tx => {
              ledgerEntries.push({ ...tx, isRateChange: false });
            });

            // Sort all entries by date
            ledgerEntries.sort((a, b) => new Date(a.date) - new Date(b.date));

            let runningPrincipal = 0;
            const txWithBalance = ledgerEntries.map(entry => {
              if (entry.isRateChange) {
                // Rate change doesn't affect balance
                return { ...entry, runningBalance: runningPrincipal };
              }
              if (entry.type === 'Disbursement') {
                runningPrincipal += entry.amount || 0;
              } else if (entry.type === 'Repayment') {
                runningPrincipal -= entry.principal_applied || 0;
              }
              return { ...entry, runningBalance: runningPrincipal };
            });

            // Calculate totals
            const totalDisbursed = sortedTx
              .filter(tx => tx.type === 'Disbursement')
              .reduce((sum, tx) => sum + (tx.amount || 0), 0);
            const totalRepaid = sortedTx
              .filter(tx => tx.type === 'Repayment')
              .reduce((sum, tx) => sum + (tx.amount || 0), 0);
            const totalPrincipalRepaid = sortedTx
              .filter(tx => tx.type === 'Repayment')
              .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
            const totalInterestPaid = sortedTx
              .filter(tx => tx.type === 'Repayment')
              .reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
            const totalFeesPaid = sortedTx
              .filter(tx => tx.type === 'Repayment')
              .reduce((sum, tx) => sum + (tx.fees_applied || 0), 0);

            return (
              <div className="absolute inset-0 overflow-auto">
                <Table>
                  <TableHeader className="[&_tr]:sticky [&_tr]:top-0 [&_tr]:z-20 [&_tr]:bg-slate-50">
                    <TableRow className="bg-slate-50">
                      <TableHead className="font-semibold text-xs w-20 py-1">Date</TableHead>
                      <TableHead className="font-semibold text-xs w-24 py-1">Type</TableHead>
                      <TableHead className="font-semibold text-xs text-right py-1">Disbursed</TableHead>
                      <TableHead className="font-semibold text-xs text-right py-1">Repaid</TableHead>
                      <TableHead className="font-semibold text-xs text-right py-1">Principal</TableHead>
                      <TableHead className="font-semibold text-xs text-right py-1">Interest</TableHead>
                      <TableHead className="font-semibold text-xs text-right py-1">Fees</TableHead>
                      <TableHead className="font-semibold text-xs text-right py-1">Balance</TableHead>
                      <TableHead className="font-semibold text-xs py-1">Reference</TableHead>
                      <TableHead className="font-semibold text-xs w-8 py-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Landmark className="w-3 h-3 text-slate-400" />
                          </TooltipTrigger>
                          <TooltipContent><p>Bank Reconciled</p></TooltipContent>
                        </Tooltip>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txWithBalance.map((tx) => (
                      tx.isRateChange ? (
                        // Rate change row
                        <TableRow key={tx.id} className="bg-amber-50/50 border-y border-amber-200">
                          <TableCell className="text-sm font-mono py-0.5 whitespace-nowrap">{format(new Date(tx.date), 'dd/MM/yy')}</TableCell>
                          <TableCell className="text-sm py-0.5">
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
                              Rate Change
                            </Badge>
                          </TableCell>
                          <TableCell colSpan={6} className="text-sm text-amber-700 py-0.5">
                            Interest rate changed from <span className="font-semibold">{tx.oldRate}%</span> to <span className="font-semibold">{tx.newRate}%</span> pa
                          </TableCell>
                          <TableCell className="text-sm text-slate-500 py-0.5">—</TableCell>
                          <TableCell className="py-0.5"></TableCell>
                        </TableRow>
                      ) : (
                        // Regular transaction row
                        <TableRow key={tx.id} className={tx.type === 'Disbursement' ? 'bg-red-50/30' : 'bg-emerald-50/30'}>
                          <TableCell className="text-sm font-mono py-0.5 whitespace-nowrap">{format(new Date(tx.date), 'dd/MM/yy')}</TableCell>
                          <TableCell className="text-sm py-0.5">
                            <Badge variant="outline" className={tx.type === 'Disbursement' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}>
                              {tx.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-right font-mono py-0.5">
                            {tx.type === 'Disbursement'
                              ? <span className="text-red-600">{formatCurrency(tx.amount)}</span>
                              : '—'}
                          </TableCell>
                          <TableCell className="text-sm text-right font-mono py-0.5">
                            {tx.type === 'Repayment'
                              ? <span className="text-emerald-600">{formatCurrency(tx.amount)}</span>
                              : '—'}
                          </TableCell>
                          <TableCell className="text-sm text-right font-mono py-0.5">
                            {tx.type === 'Repayment' && tx.principal_applied
                              ? <span className="text-emerald-600">{formatCurrency(tx.principal_applied)}</span>
                              : '—'}
                          </TableCell>
                          <TableCell className="text-sm text-right font-mono py-0.5">
                            {tx.interest_applied ? formatCurrency(tx.interest_applied) : '—'}
                          </TableCell>
                          <TableCell className="text-sm text-right font-mono py-0.5">
                            {tx.fees_applied ? formatCurrency(tx.fees_applied) : '—'}
                          </TableCell>
                          <TableCell className="text-sm text-right font-mono py-0.5">
                            {formatCurrency(tx.runningBalance)}
                          </TableCell>
                          <TableCell className="text-sm text-slate-500 py-0.5">{tx.reference || '—'}</TableCell>
                          <TableCell className="text-center py-0.5">
                            {reconciledTransactionIds.has(tx.id) ? (
                              (() => {
                                const matches = reconciliationMap.get(tx.id) || [];
                                return (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Landmark className="w-3.5 h-3.5 text-emerald-500 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs">
                                      <div className="space-y-2">
                                        <p className="font-medium text-emerald-400">
                                          Matched to {matches.length > 1 ? `${matches.length} bank entries` : 'Bank Statement'}
                                        </p>
                                        {matches.map((match, idx) => {
                                          const bs = match?.bankStatement;
                                          return (
                                            <div key={idx} className={matches.length > 1 ? 'border-t border-slate-600 pt-1' : ''}>
                                              {bs ? (
                                                <>
                                                  <p className="text-xs"><span className="text-slate-400">Date:</span> {format(new Date(bs.statement_date), 'dd/MM/yyyy')}</p>
                                                  <p className="text-xs"><span className="text-slate-400">Amount:</span> {formatCurrency(Math.abs(bs.amount))}</p>
                                                  <p className="text-xs"><span className="text-slate-400">Source:</span> {bs.bank_source}</p>
                                                  {bs.description && <p className="text-xs text-slate-300 truncate max-w-[200px]">{bs.description}</p>}
                                                </>
                                              ) : (
                                                <p className="text-xs text-slate-400">Bank statement details loading...</p>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              })()
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    ))}
                    {txWithBalance.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-slate-500 py-8">
                          No transactions recorded
                        </TableCell>
                      </TableRow>
                    )}
                    {/* Totals row */}
                    {txWithBalance.length > 0 && (
                      <TableRow className="bg-slate-100 border-t-2 border-slate-300">
                        <TableCell className="text-sm font-semibold py-0.5" colSpan={2}>Totals</TableCell>
                        <TableCell className="text-sm text-right font-mono text-red-600 py-0.5">
                          {formatCurrency(totalDisbursed)}
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono text-emerald-600 py-0.5">
                          {formatCurrency(totalRepaid)}
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono text-emerald-600 py-0.5">
                          {formatCurrency(totalPrincipalRepaid)}
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono text-emerald-600 py-0.5">
                          {formatCurrency(totalInterestPaid)}
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono py-0.5">
                          {totalFeesPaid > 0 ? formatCurrency(totalFeesPaid) : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono py-0.5">
                          {formatCurrency(totalDisbursed - totalPrincipalRepaid)}
                        </TableCell>
                        <TableCell className="py-0.5"></TableCell>
                        <TableCell className="py-0.5"></TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            );
          })()
        ) : viewMode === '_removed_smartview2' ? (
          <Table wrapperClassName="absolute inset-0 overflow-auto">
            <TableHeader className="[&_tr]:sticky [&_tr]:top-0 [&_tr]:z-20 [&_tr]:bg-slate-50">
              <TableRow className="bg-slate-50">
                <TableHead className="font-semibold bg-slate-50 w-12 py-1.5 whitespace-nowrap">#</TableHead>
                <TableHead className="font-semibold bg-slate-50 py-1.5">Due Date</TableHead>
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
                            <TableCell className="text-slate-600 text-xs whitespace-nowrap">
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
                          <TableCell className="text-slate-600 text-xs py-1.5 whitespace-nowrap">
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
                const totalPrincipalPaid = allRepayments.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
                const totalInterestPaid = allRepayments.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
                const totalFeesPaid = allRepayments.reduce((sum, tx) => sum + (tx.fees_applied || 0), 0);
                // Use GROSS principal (what borrower owes) for schedule totals
                const totalExpectedPrincipal = loan.principal_amount;
                const totalExpectedInterest = effectiveSchedule.reduce((sum, row) => sum + (row.interest_amount || 0), 0);
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
        ) : CustomViewComponent ? (
          // Scheduler provides a custom view component
          <div className="absolute inset-0 overflow-auto p-4">
            <CustomViewComponent
              schedule={schedule}
              transactions={transactions}
              loan={loan}
              product={product}
            />
          </div>
        ) : isRent ? (
          // Fallback for rent loans without scheduler_type set yet
          <div className="absolute inset-0 overflow-auto p-4">
            <RentScheduleView
              schedule={schedule}
              transactions={transactions}
              loan={loan}
              product={product}
            />
          </div>
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
                // Calculate summary totals using the accurate calculateLoanInterestBalance function
                // This matches the calculation used in Loans list and Dashboard
                const totalDisbursed = loan.principal_amount;
                const totalPrincipalReceived = transactions
                  .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
                  .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);

                // Use calculateLoanInterestBalance for accurate interest calculation
                const interestCalc = calculateLoanInterestBalance(loan, effectiveSchedule, transactions, new Date(), product);
                const totalInterestReceived = interestCalc.totalInterestPaid;
                const totalExpectedInterest = interestCalc.totalInterestDue;

                const principalBalance = totalDisbursed - totalPrincipalReceived;
                const interestBalance = interestCalc.interestBalance;

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
                      {formatCurrency(totalExpectedInterest)}
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
                    const isInitial = index === 0;

                    // Use gross_amount if available (new field), fallback to amount for legacy
                    let grossAmount = tx.gross_amount ?? tx.amount;
                    const deductedFee = tx.deducted_fee || 0;
                    const deductedInterest = tx.deducted_interest || 0;
                    const netAmount = tx.amount;
                    const hasDeductions = deductedFee > 0 || deductedInterest > 0;

                    // For legacy initial disbursements, use loan.principal_amount as gross
                    const hasLegacyDeductions = isInitial && !hasDeductions && loan.arrangement_fee && loan.net_disbursed;
                    if (hasLegacyDeductions) {
                      grossAmount = loan.principal_amount;
                    }

                    // For initial disbursement, show GROSS amount with net amount note
                    let netNote = '';
                    if (hasDeductions) {
                      const deductionParts = [];
                      if (deductedFee > 0) deductionParts.push(`${formatCurrency(deductedFee)} fee`);
                      if (deductedInterest > 0) deductionParts.push(`${formatCurrency(deductedInterest)} interest`);
                      netNote = ` (${formatCurrency(netAmount)} net, ${deductionParts.join(' + ')} deducted)`;
                    } else if (hasLegacyDeductions) {
                      // Fallback for legacy data where deductions are stored at loan level
                      netNote = ` (${formatCurrency(loan.net_disbursed)} net, ${formatCurrency(loan.arrangement_fee)} fee deducted)`;
                    }

                    rows.push({
                      type: isInitial ? 'disbursement' : 'further_advance',
                      date: new Date(tx.date),
                      description: isInitial ? `Loan Disbursement${netNote}` : `Further Advance${netNote}`,
                      principal: grossAmount,  // Use gross for principal tracking
                      transaction: tx,
                      sortOrder: isInitial ? 0 : 1
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

                  // Detect if this is an "interest paid in advance" loan (needed for transaction assignment)
                  // For advance loans, the first due date equals the loan start date
                  const loanStartForAdvanceCheck = new Date(loan.start_date);
                  loanStartForAdvanceCheck.setHours(0, 0, 0, 0);
                  const firstDueDateForAdvanceCheck = sortedSchedule.length > 0 ? new Date(sortedSchedule[0].due_date) : null;
                  if (firstDueDateForAdvanceCheck) firstDueDateForAdvanceCheck.setHours(0, 0, 0, 0);
                  const isAdvancePaymentLoan = firstDueDateForAdvanceCheck &&
                    firstDueDateForAdvanceCheck.getTime() === loanStartForAdvanceCheck.getTime();

                  // PASS 1: Assign each transaction to its schedule period
                  // - Principal payments: Assign by period boundaries (capital changes affect interest calculation)
                  // - Interest-only payments: Assign by closest due date (for paid/missed tracking)
                  const txAssignments = new Map();

                  repaymentTransactions.forEach(tx => {
                    const txDate = new Date(tx.date);
                    txDate.setHours(0, 0, 0, 0);
                    const hasPrincipal = (tx.principal_applied || 0) > 0.01;

                    // For principal payments on advance payment loans, assign by period boundaries
                    if (hasPrincipal && isAdvancePaymentLoan) {
                      // Find which period this transaction date falls within
                      for (let i = 0; i < sortedSchedule.length; i++) {
                        const periodStart = new Date(sortedSchedule[i].due_date);
                        periodStart.setHours(0, 0, 0, 0);

                        // Period end is the next period's start (or 31 days later for last period)
                        const periodEnd = i < sortedSchedule.length - 1
                          ? new Date(sortedSchedule[i + 1].due_date)
                          : new Date(periodStart.getTime() + 31 * 24 * 60 * 60 * 1000);
                        periodEnd.setHours(0, 0, 0, 0);

                        // Check if transaction falls within this period's boundaries
                        if (txDate >= periodStart && txDate < periodEnd) {
                          if (!txAssignments.has(sortedSchedule[i].id)) {
                            txAssignments.set(sortedSchedule[i].id, []);
                          }
                          txAssignments.get(sortedSchedule[i].id).push(tx);
                          return; // Found the period, exit the loop
                        }
                      }
                      // If no period found (transaction before first period), fall through to closest match
                    }

                    // For interest-only payments (or fallback), use closest due date
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

                  // PASS 2: Redistribute excess transactions from crowded periods to empty adjacent periods
                  const RANGE_DAYS = 60;
                  const rangeMsec = RANGE_DAYS * 24 * 60 * 60 * 1000;

                  // Find schedule index by ID for adjacency lookup
                  const scheduleIndexById = new Map();
                  sortedSchedule.forEach((s, idx) => scheduleIndexById.set(s.id, idx));

                  // Identify empty periods
                  const emptyPeriodIds = new Set(
                    sortedSchedule
                      .filter(s => !txAssignments.has(s.id) || txAssignments.get(s.id).length === 0)
                      .map(s => s.id)
                  );

                  // Process crowded periods (more than 1 transaction)
                  for (const [periodId, transactions] of txAssignments.entries()) {
                    while (transactions.length > 1 && emptyPeriodIds.size > 0) {
                      const periodIdx = scheduleIndexById.get(periodId);
                      const periodDueDate = new Date(sortedSchedule[periodIdx].due_date);

                      // Find the transaction furthest from this period's due date
                      let furthestTx = null;
                      let furthestDiff = -1;
                      transactions.forEach(tx => {
                        const diff = Math.abs(new Date(tx.date) - periodDueDate);
                        if (diff > furthestDiff) {
                          furthestDiff = diff;
                          furthestTx = tx;
                        }
                      });

                      // Find nearest empty period within range
                      let bestEmptyId = null;
                      let bestDistance = Infinity;

                      for (const emptyId of emptyPeriodIds) {
                        const emptyIdx = scheduleIndexById.get(emptyId);
                        const emptyDueDate = new Date(sortedSchedule[emptyIdx].due_date);
                        const txDate = new Date(furthestTx.date);

                        // Check if empty period is within 60-day range of the transaction
                        const txToEmptyDiff = Math.abs(txDate - emptyDueDate);
                        if (txToEmptyDiff <= rangeMsec) {
                          // Prefer closer empty periods (by index distance from crowded period)
                          const indexDistance = Math.abs(emptyIdx - periodIdx);
                          if (indexDistance < bestDistance) {
                            bestDistance = indexDistance;
                            bestEmptyId = emptyId;
                          }
                        }
                      }

                      if (bestEmptyId) {
                        // Move transaction to empty period
                        const txIndex = transactions.indexOf(furthestTx);
                        transactions.splice(txIndex, 1);

                        if (!txAssignments.has(bestEmptyId)) {
                          txAssignments.set(bestEmptyId, []);
                        }
                        txAssignments.get(bestEmptyId).push(furthestTx);
                        emptyPeriodIds.delete(bestEmptyId);
                      } else {
                        // No eligible empty period found, stop redistributing for this period
                        break;
                      }
                    }
                  }

                  // Build rows WITHOUT running balances first, then sort, then calculate balances
                  const rows = [];

                  // Detect if this is an "interest paid in advance" loan EARLY
                  // For advance loans, the first due date equals the loan start date
                  // For arrears loans, the first due date is after the loan start date
                  const loanStartDateForAdvanceCheckEarly = new Date(loan.start_date);
                  loanStartDateForAdvanceCheckEarly.setHours(0, 0, 0, 0);
                  const firstDueDateForAdvanceCheckEarly = sortedSchedule.length > 0 ? new Date(sortedSchedule[0].due_date) : null;
                  if (firstDueDateForAdvanceCheckEarly) firstDueDateForAdvanceCheckEarly.setHours(0, 0, 0, 0);
                  const isInterestPaidInAdvanceEarly = firstDueDateForAdvanceCheckEarly &&
                    firstDueDateForAdvanceCheckEarly.getTime() === loanStartDateForAdvanceCheckEarly.getTime();

                  // Find the first schedule period that matches the first disbursement date (for stacking under disbursement)
                  const firstDisbDateEarly = disbursementTransactions.length > 0 ? new Date(disbursementTransactions[0].date) : null;
                  if (firstDisbDateEarly) firstDisbDateEarly.setHours(0, 0, 0, 0);
                  const firstScheduleOnDisbursementDateEarly = isInterestPaidInAdvanceEarly && sortedSchedule.length > 0
                    ? sortedSchedule.find(s => {
                        const dueDate = new Date(s.due_date);
                        dueDate.setHours(0, 0, 0, 0);
                        return firstDisbDateEarly && dueDate.getTime() === firstDisbDateEarly.getTime();
                      })
                    : null;

                  // First disbursement transaction is the initial "Loan Disbursement"
                  // Subsequent disbursement transactions are "Further Advances"
                  // Also find any linked repayments (for deducted interest)
                  const linkedRepaymentsByDisbursement = new Map();
                  repaymentTransactions.forEach(tx => {
                    if (tx.linked_disbursement_id) {
                      linkedRepaymentsByDisbursement.set(tx.linked_disbursement_id, tx);
                    }
                  });

                  disbursementTransactions.forEach((tx, index) => {
                    const isInitial = index === 0;

                    // Use gross_amount if available (new field), fallback to amount for legacy
                    let grossAmount = tx.gross_amount ?? tx.amount;
                    const deductedFee = tx.deducted_fee || 0;
                    const deductedInterest = tx.deducted_interest || 0;
                    const netAmount = tx.amount;
                    const hasDeductions = deductedFee > 0 || deductedInterest > 0;

                    // For legacy initial disbursements, use loan.principal_amount as gross
                    const hasLegacyDeductions = isInitial && !hasDeductions && loan.arrangement_fee && loan.net_disbursed;
                    if (hasLegacyDeductions) {
                      grossAmount = loan.principal_amount;
                    }

                    // Find linked repayment for this disbursement (if any)
                    const linkedRepayment = linkedRepaymentsByDisbursement.get(tx.id);
                    const linkedInterestPaid = linkedRepayment ? (linkedRepayment.interest_applied || linkedRepayment.amount || 0) : 0;

                    let netNote = '';
                    if (hasDeductions) {
                      const deductionParts = [];
                      if (deductedFee > 0) deductionParts.push(`${formatCurrency(deductedFee)} fee`);
                      if (deductedInterest > 0) deductionParts.push(`${formatCurrency(deductedInterest)} interest`);
                      netNote = ` (${formatCurrency(netAmount)} net, ${deductionParts.join(' + ')} deducted)`;
                    } else if (hasLegacyDeductions) {
                      // Fallback for legacy data where deductions are stored at loan level
                      netNote = ` (${formatCurrency(loan.net_disbursed)} net, ${formatCurrency(loan.arrangement_fee)} fee deducted)`;
                    }

                    // For initial disbursement on advance loans, attach the first schedule period
                    // so it can be shown as a child row (stacked behind the disbursement)
                    const linkedSchedulePeriod = isInitial && firstScheduleOnDisbursementDateEarly ? {
                      scheduleRow: firstScheduleOnDisbursementDateEarly,
                      expectedInterest: isFixedCharge ? monthlyCharge : (firstScheduleOnDisbursementDateEarly.interest_amount || 0),
                      periodTransactions: txAssignments.get(firstScheduleOnDisbursementDateEarly.id) || []
                    } : null;

                    rows.push({
                      type: isInitial ? 'disbursement' : 'further_advance',
                      date: new Date(tx.date),
                      description: isInitial ? `Loan Disbursement${netNote}` : `Further Advance${netNote}`,
                      principal: grossAmount, // Use gross amount for principal tracking
                      interest: 0,
                      balance: 0, // Will be calculated after sorting
                      transaction: tx,
                      sortOrder: isInitial ? 0 : 1,
                      grossAmount,
                      deductedFee,
                      deductedInterest,
                      netAmount,
                      hasDeductions,
                      linkedRepayment,
                      linkedInterestPaid,
                      linkedSchedulePeriod
                    });
                  });

                  // Use the early-detected values for isInterestPaidInAdvance
                  const isInterestPaidInAdvance = isInterestPaidInAdvanceEarly;

                  // Process each schedule period
                  sortedSchedule.forEach((scheduleRow, idx) => {
                    // Skip first period if it will be shown as disbursement child (for advance loans)
                    if (firstScheduleOnDisbursementDateEarly && scheduleRow.id === firstScheduleOnDisbursementDateEarly.id) {
                      return; // Will be handled as disbursement child row instead
                    }

                    const dueDate = new Date(scheduleRow.due_date);
                    dueDate.setHours(0, 0, 0, 0);
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

                    // Calculate period boundaries based on payment timing
                    let periodStartDate, periodEndDate;

                    if (isInterestPaidInAdvance) {
                      // For ADVANCE loans: due date is at START of period
                      // Period covers: current due date → next due date
                      periodStartDate = dueDate;

                      if (idx < sortedSchedule.length - 1) {
                        periodEndDate = new Date(sortedSchedule[idx + 1].due_date);
                        periodEndDate.setHours(0, 0, 0, 0);
                      } else {
                        // Last period: use schedule's calculation_days to estimate end
                        const calcDays = scheduleRow.calculation_days || 30;
                        periodEndDate = addDays(dueDate, calcDays);
                      }
                    } else {
                      // For ARREARS loans: due date is at END of period
                      // Period covers: previous due date → current due date
                      periodStartDate = idx > 0
                        ? new Date(sortedSchedule[idx - 1].due_date)
                        : new Date(loan.start_date);
                      periodStartDate.setHours(0, 0, 0, 0);
                      periodEndDate = dueDate;
                    }

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
                      periodTransactions, // Store for adding child rows after sorting
                      periodStartDate, // Store for interest split calculation
                      periodEndDate, // Store period end for advance payment loans
                      isAdvancePayment: isInterestPaidInAdvance
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
                  let previousPeriodAdjustment = 0; // Track adjustment from prior period for advance loans

                  // Build capital events ledger once for interest calculations
                  const capitalEvents = buildCapitalEvents(loan, transactions);

                  // Get loan start date for period boundary calculations
                  const loanStartDate = new Date(loan.start_date);
                  loanStartDate.setHours(0, 0, 0, 0);

                  // Track principal balance at each period boundary for interest calculations
                  // Key: period start date as ISO string, Value: principal balance at that date
                  const principalAtDate = new Map();
                  // Initialize with principal amount at loan start (disbursement happens at/before first period)
                  principalAtDate.set(new Date(loan.start_date).toISOString().split('T')[0], loan.principal_amount);

                  rows.forEach(row => {
                    if (row.type === 'disbursement') {
                      prevPrincipalBalance = runningPrincipalBalance;
                      runningPrincipalBalance = row.principal;
                      row.balance = runningInterestAccrued - runningInterestPaid;
                      row.principalBalance = runningPrincipalBalance;
                      row.principalChanged = true;
                      // Record balance after this date
                      principalAtDate.set(row.date.toISOString().split('T')[0], runningPrincipalBalance);
                      expandedRows.push(row);

                      // Add linked repayment as child row if exists
                      if (row.linkedRepayment) {
                        runningInterestPaid += row.linkedInterestPaid;
                        expandedRows.push({
                          type: 'disbursement_child',
                          parentDisbursementId: row.transaction.id,
                          date: new Date(row.linkedRepayment.date),
                          description: 'Advance interest deducted from disbursement',
                          principal: 0,
                          interest: row.linkedInterestPaid,
                          balance: runningInterestAccrued - runningInterestPaid,
                          principalBalance: runningPrincipalBalance,
                          transaction: row.linkedRepayment
                        });
                      }

                      // For advance loans, add first schedule period interest to the disbursement row (not as child)
                      if (row.linkedSchedulePeriod) {
                        const sp = row.linkedSchedulePeriod;
                        runningInterestAccrued += sp.expectedInterest;

                        // Calculate period payments for this schedule period
                        const periodInterestPaid = sp.periodTransactions.reduce((sum, tx) =>
                          sum + (isFixedCharge ? (tx.fees_applied || tx.amount || 0) : (tx.interest_applied || 0)), 0);
                        runningInterestPaid += periodInterestPaid;

                        // Store interest amounts on the disbursement row for display
                        row.linkedScheduleInterestDue = sp.expectedInterest;
                        row.linkedScheduleInterestPaid = periodInterestPaid;

                        // Calculate period days and daily rate for description
                        const scheduleRow = sp.scheduleRow;
                        row.linkedSchedulePeriodDays = scheduleRow?.calculation_days || 30;
                        const dailyRate = loan.interest_rate / 100 / 365;
                        row.linkedScheduleDailyInterest = runningPrincipalBalance * dailyRate;
                        row.linkedScheduleInterestRate = loan.interest_rate;

                        // Update the interest balance on the disbursement row
                        row.balance = runningInterestAccrued - runningInterestPaid;
                      }
                    } else if (row.type === 'further_advance') {
                      prevPrincipalBalance = runningPrincipalBalance;
                      runningPrincipalBalance += row.principal;
                      row.balance = runningInterestAccrued - runningInterestPaid;
                      row.principalBalance = runningPrincipalBalance;
                      row.principalChanged = true;
                      // Record balance after this date
                      principalAtDate.set(row.date.toISOString().split('T')[0], runningPrincipalBalance);
                      expandedRows.push(row);

                      // Add linked repayment as child row if exists
                      if (row.linkedRepayment) {
                        runningInterestPaid += row.linkedInterestPaid;
                        expandedRows.push({
                          type: 'disbursement_child',
                          parentDisbursementId: row.transaction.id,
                          date: new Date(row.linkedRepayment.date),
                          description: 'Advance interest deducted from disbursement',
                          principal: 0,
                          interest: row.linkedInterestPaid,
                          balance: runningInterestAccrued - runningInterestPaid,
                          principalBalance: runningPrincipalBalance,
                          transaction: row.linkedRepayment
                        });
                      }
                    } else if (row.type === 'schedule_header') {
                      row.principalBalance = runningPrincipalBalance;
                      row.principalChanged = false;

                      // Calculate principalAtPeriodStart by finding the most recent balance before/at periodStartDate
                      if (row.periodStartDate) {
                        const periodStartKey = row.periodStartDate.toISOString().split('T')[0];
                        // Find the latest recorded balance at or before periodStartDate
                        let bestDate = null;
                        let bestBalance = loan.principal_amount;
                        for (const [dateKey, balance] of principalAtDate.entries()) {
                          if (dateKey <= periodStartKey && (!bestDate || dateKey > bestDate)) {
                            bestDate = dateKey;
                            bestBalance = balance;
                          }
                        }
                        row.principalAtPeriodStart = bestBalance;
                      } else {
                        row.principalAtPeriodStart = loan.principal_amount;
                      }

                      // Recalculate expectedInterest using capital events ledger (for non-Fixed Charge loans)
                      if (!isFixedCharge) {
                        // Determine period boundaries based on payment timing
                        const scheduleIdx = sortedSchedule.findIndex(s => s.id === row.scheduleRow.id);

                        // Detect if this is an "interest paid in advance" loan
                        // (first due date equals loan start date)
                        const firstDueDate = sortedSchedule.length > 0 ? new Date(sortedSchedule[0].due_date) : null;
                        if (firstDueDate) firstDueDate.setHours(0, 0, 0, 0);
                        const isAdvancePayment = firstDueDate && firstDueDate.getTime() === loanStartDate.getTime();

                        let periodStart, periodEnd;

                        if (isAdvancePayment) {
                          // For ADVANCE payment: due date is at START of period
                          // Period covers: current due date → next due date
                          periodStart = row.date;
                          if (scheduleIdx < sortedSchedule.length - 1) {
                            periodEnd = new Date(sortedSchedule[scheduleIdx + 1].due_date);
                            periodEnd.setHours(0, 0, 0, 0);
                          } else {
                            // Last period - use calculation_days or default 30 days
                            const calcDays = row.scheduleRow?.calculation_days || 30;
                            periodEnd = addDays(row.date, calcDays);
                          }
                        } else {
                          // For ARREARS payment: due date is at END of period
                          // Period covers: previous due date (or loan start) → current due date
                          periodStart = scheduleIdx === 0
                            ? loanStartDate
                            : new Date(sortedSchedule[scheduleIdx - 1].due_date);
                          periodStart.setHours(0, 0, 0, 0);
                          periodEnd = row.date;
                        }

                        // Calculate interest using the capital events ledger
                        const ledgerResult = calculateInterestFromLedger(loan, capitalEvents, periodStart, periodEnd);

                        // Store results
                        row.expectedInterestRaw = ledgerResult.totalInterest;
                        row.expectedInterest = ledgerResult.totalInterest;
                        row.interest = ledgerResult.totalInterest;
                        row.ledgerSegments = ledgerResult.segments;
                        row.periodDays = ledgerResult.days;

                        // Recalculate status based on new expectedInterest
                        const periodInterestPaid = row.periodInterestPaid || 0;
                        if (row.isPastDue) {
                          if (periodInterestPaid >= row.expectedInterest - 0.01) {
                            if (periodInterestPaid > row.expectedInterest + 0.01) {
                              row.status = 'overpaid';
                              row.statusVariance = periodInterestPaid - row.expectedInterest;
                            } else {
                              row.status = 'paid';
                            }
                          } else if (periodInterestPaid > 0.01) {
                            row.status = 'underpaid';
                            row.statusVariance = periodInterestPaid - row.expectedInterest;
                          } else {
                            row.status = 'overdue';
                          }
                        }

                        // For advance loans, track adjustments from mid-period capital changes
                        // Only generate adjustment when there are capital changes (multiple ledger segments)
                        if (isAdvancePayment && periodStart && periodEnd) {
                          row.isAdvancePayment = true;

                          // Check if this period had capital changes (multiple segments = capital changed mid-period)
                          const hasCapitalChanges = row.ledgerSegments && row.ledgerSegments.length > 1;

                          // Store any adjustment from PRIOR period (to be applied to this period)
                          row.adjustmentFromPrior = previousPeriodAdjustment;

                          // Only calculate NEW adjustment if this period had capital changes
                          if (hasCapitalChanges) {
                            const days = differenceInDays(periodEnd, periodStart);
                            let effectiveRate = loan.interest_rate || 0;
                            // Check for penalty rate
                            if (loan.penalty_rate && loan.penalty_rate_from) {
                              const penaltyDate = new Date(loan.penalty_rate_from);
                              penaltyDate.setHours(0, 0, 0, 0);
                              if (periodStart >= penaltyDate) {
                                effectiveRate = loan.penalty_rate;
                              }
                            }
                            const dailyRate = effectiveRate / 100 / 365;
                            // Advance interest = full period on START capital (no mid-period changes)
                            const advanceInterestDue = row.principalAtPeriodStart * dailyRate * days;

                            // Adjustment = what was charged - what should have been charged
                            // Positive = overpaid (credit to next), Negative = underpaid (debit to next)
                            const periodAdjustment = advanceInterestDue - row.expectedInterest;

                            // Store for display
                            row.advanceInterestDue = advanceInterestDue;
                            row.actualInterest = row.expectedInterest;
                            row.periodAdjustment = periodAdjustment;

                            // This period's adjustment carries to NEXT period
                            previousPeriodAdjustment = periodAdjustment;
                          } else {
                            // No capital changes in this period - no new adjustment generated
                            row.periodAdjustment = 0;

                            // After applying prior adjustment to this period, reset to 0 (consumed)
                            previousPeriodAdjustment = 0;
                          }
                        }
                      }

                      // Accrue interest for this period (after recalculation)
                      // For advance loans, apply the prior period's adjustment (credit/debit)
                      // But only if this period doesn't ALSO generate an adjustment (has capital changes)
                      let effectiveInterestToAccrue = row.expectedInterestRaw ?? row.expectedInterest;
                      const receivesCredit = row.isAdvancePayment && row.adjustmentFromPrior && Math.abs(row.adjustmentFromPrior) > 0.01;
                      const generatesAdjustment = row.periodAdjustment && Math.abs(row.periodAdjustment) > 0.01;

                      if (receivesCredit && !generatesAdjustment) {
                        // This period RECEIVES credit from prior (and doesn't generate its own)
                        effectiveInterestToAccrue = effectiveInterestToAccrue - row.adjustmentFromPrior;
                        // Store adjusted interest for display (original - credit)
                        row.adjustedInterestDue = row.interest - row.adjustmentFromPrior;
                      }
                      runningInterestAccrued += effectiveInterestToAccrue;
                      row.balance = Math.round((runningInterestAccrued - runningInterestPaid) * 100) / 100;

                      // Record balance at this period end date
                      principalAtDate.set(row.date.toISOString().split('T')[0], runningPrincipalBalance);
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

                        // Record principal balance at transaction date for future period lookups
                        // This ensures subsequent periods see the reduced principal after capital repayments
                        if (principalChanged) {
                          principalAtDate.set(dateKey, runningPrincipalBalance);
                        }

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
                      row.interestBalanceAfterPeriod = Math.round((runningInterestAccrued - runningInterestPaid) * 100) / 100;

                      // Update principalAtDate AFTER processing transactions so next period sees reduced principal
                      // This fixes Bug 2: wrong daily rate in description for periods after capital repayments
                      principalAtDate.set(row.date.toISOString().split('T')[0], runningPrincipalBalance);
                    }
                  });

                  // Apply sorting based on user preference
                  const sortedRows = nestedSortOrder === 'desc' ? [...expandedRows].reverse() : expandedRows;

                  return sortedRows.map((row, idx) => {
                    // Skip transaction children when their parent period is collapsed
                    if (row.type === 'transaction_child' && !isPeriodExpanded(row.parentScheduleId)) {
                      return null;
                    }

                    // Skip disbursement children when their parent disbursement is collapsed
                    if (row.type === 'disbursement_child' && !isDisbursementExpanded(row.parentDisbursementId)) {
                      return null;
                    }


                    if (row.type === 'disbursement') {
                      const hasLinkedRepayment = !!row.linkedRepayment;
                      const isExpanded = isDisbursementExpanded(row.transaction.id);

                      // Calculate Interest Rcvd - show linkedInterestPaid (deducted from disbursement) or linkedScheduleInterestPaid (from schedule period)
                      const interestReceived = row.linkedInterestPaid > 0
                        ? row.linkedInterestPaid
                        : (row.linkedScheduleInterestPaid || 0);

                      // Build description with interest calculation for advance loans
                      let fullDescription = row.description;
                      if (row.linkedSchedulePeriod && row.linkedScheduleInterestDue > 0) {
                        const interestCalcDetail = isFixedCharge
                          ? `Fixed charge due @ ${formatCurrency(monthlyCharge)}`
                          : `Interest due at ${row.linkedScheduleInterestRate}% pa, ${row.linkedSchedulePeriodDays}d × ${formatCurrency(row.linkedScheduleDailyInterest)}/day`;
                        fullDescription = (
                          <span>
                            <span className="font-semibold text-red-700">{row.description}</span>
                            <span className="text-slate-500 font-normal ml-2">{interestCalcDetail}</span>
                          </span>
                        );
                      }

                      return (
                        <TableRow
                          key={`disbursement-${idx}`}
                          className={`bg-red-50/50 border-l-4 border-red-500 ${hasLinkedRepayment ? 'cursor-pointer hover:bg-red-100/50' : ''}`}
                          onClick={hasLinkedRepayment ? () => toggleDisbursementExpansion(row.transaction.id) : undefined}
                        >
                          <TableCell className="py-0.5 font-medium text-sm">
                            <div className="flex items-center gap-1">
                              {format(row.date, 'dd/MM/yy')}
                              {hasLinkedRepayment && (
                                isExpanded
                                  ? <ChevronDown className="w-3 h-3 text-red-400" />
                                  : <ChevronRight className="w-3 h-3 text-red-400" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-0.5 text-sm">
                            {fullDescription}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-red-600 font-semibold text-sm">
                            {formatCurrency(row.principal)}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-red-600 font-semibold text-sm">
                            {formatCurrency(row.principalBalance)}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">
                            {interestReceived > 0 ? (
                              <span className="text-emerald-600">{formatCurrency(interestReceived)}</span>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">
                            {row.linkedScheduleInterestDue > 0
                              ? formatCurrency(row.linkedScheduleInterestDue)
                              : '—'}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5">—</TableCell>
                        </TableRow>
                      );
                    }

                    if (row.type === 'disbursement_child') {
                      return (
                        <TableRow key={`disbursement-child-${idx}`} className="bg-red-50/30 border-l-4 border-red-300">
                          <TableCell className="py-0.5 pl-6 text-slate-500 text-sm">
                            ↳ {format(row.date, 'dd/MM/yy')}
                          </TableCell>
                          <TableCell className="py-0.5 text-slate-600 text-sm italic">
                            Receipt: {row.description}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-emerald-600 text-sm">
                            {formatCurrency(row.interest)}
                          </TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5 text-right font-mono text-sm">—</TableCell>
                          <TableCell className="py-0.5">—</TableCell>
                        </TableRow>
                      );
                    }

                    if (row.type === 'further_advance') {
                      const hasLinkedRepayment = !!row.linkedRepayment;
                      const isExpanded = isDisbursementExpanded(row.transaction.id);
                      return (
                        <TableRow
                          key={`further-advance-${idx}`}
                          className={`bg-orange-50/50 border-l-4 border-orange-500 ${hasLinkedRepayment ? 'cursor-pointer hover:bg-orange-100/50' : ''}`}
                          onClick={hasLinkedRepayment ? () => toggleDisbursementExpansion(row.transaction.id) : undefined}
                        >
                          <TableCell className="py-0.5 font-medium text-sm">
                            <div className="flex items-center gap-1">
                              {format(row.date, 'dd/MM/yy')}
                              {hasLinkedRepayment && (
                                isExpanded
                                  ? <ChevronDown className="w-3 h-3 text-orange-400" />
                                  : <ChevronRight className="w-3 h-3 text-orange-400" />
                              )}
                            </div>
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
                          <TableCell className="py-0.5 text-right font-mono text-sm">
                            {row.linkedInterestPaid > 0 ? (
                              <span className="text-emerald-600">{formatCurrency(row.linkedInterestPaid)}</span>
                            ) : '—'}
                          </TableCell>
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
                              // Use principalAtPeriodStart for accurate segment calculations (accounts for previous advances)
                              const principalStart = row.principalAtPeriodStart || scheduleRow?.calculation_principal_start || row.principalBalance || loan.principal_amount;
                              // Use actual calculated days from period boundaries (not stale database value)
                              const days = (row.periodStartDate && row.periodEndDate)
                                ? differenceInDays(row.periodEndDate, row.periodStartDate)
                                : (scheduleRow?.calculation_days || (loan.period === 'Monthly' ? 30 : 7));
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

                              // Use ledgerSegments from calculation if available, otherwise build from periodTransactions
                              // This ensures display matches the calculation logic for capital changes
                              let segments = [];

                              if (row.ledgerSegments && row.ledgerSegments.length >= 1) {
                                // Use pre-calculated segments from the interest calculation
                                // Note: calculateInterestFromLedger returns dailyRate (per £1), so calculate dailyAmount
                                segments = row.ledgerSegments.map(seg => ({
                                  days: seg.days,
                                  dailyAmount: seg.principal * seg.dailyRate,  // Calculate £/day from principal × rate
                                  total: seg.interest,
                                  principal: seg.principal
                                }));
                              } else {
                                // Fallback: Check for capital payments within this period to show split interest
                                const capitalPayments = (row.periodTransactions || [])
                                  .filter(tx => tx.principal_applied > 0)
                                  .map(tx => ({ type: 'repayment', date: new Date(tx.date), amount: tx.principal_applied }));

                                // Also find further advances (disbursements) within this period
                                const periodStart = row.periodStartDate ? new Date(row.periodStartDate) : null;
                                const periodEnd = row.periodEndDate || row.date;
                                const furtherAdvancesInPeriod = periodStart ? sortedRows
                                  .filter(r => r.type === 'further_advance' && r.date > periodStart && r.date <= periodEnd)
                                  .map(r => ({ type: 'advance', date: r.date, amount: r.principal })) : [];

                                const capitalChanges = [...capitalPayments, ...furtherAdvancesInPeriod]
                                  .sort((a, b) => a.date - b.date);

                                if (capitalChanges.length > 0 && periodStart) {
                                  let runningPrincipal = principalStart;
                                  let segmentStart = periodStart;

                                  capitalChanges.forEach((change) => {
                                    const changeDate = change.date;
                                    const daysInSegment = differenceInDays(changeDate, segmentStart);

                                    if (daysInSegment > 0) {
                                      const segmentDailyInterest = runningPrincipal * dailyRate;
                                      segments.push({
                                        days: daysInSegment,
                                        dailyAmount: segmentDailyInterest,
                                        total: segmentDailyInterest * daysInSegment,
                                        principal: runningPrincipal
                                      });
                                    }

                                    if (change.type === 'advance') {
                                      runningPrincipal += change.amount;
                                    } else {
                                      runningPrincipal = Math.max(0, runningPrincipal - change.amount);
                                    }
                                    segmentStart = changeDate;
                                  });

                                  const finalDays = differenceInDays(periodEnd, segmentStart);
                                  if (finalDays > 0 && runningPrincipal > 0) {
                                    const finalDailyInterest = runningPrincipal * dailyRate;
                                    segments.push({
                                      days: finalDays,
                                      dailyAmount: finalDailyInterest,
                                      total: finalDailyInterest * finalDays,
                                      principal: runningPrincipal
                                    });
                                  }
                                }
                              }

                              // Show segment-based rendering if we have any segments (consistent styling)
                              if (segments.length >= 1) {
                                // For ADVANCE payment loans: show what was CHARGED (full period at starting rate)
                                // The segmented calculation is only used internally to determine overpayment
                                if (row.isAdvancePayment) {
                                  const totalDays = segments.reduce((sum, s) => sum + s.days, 0);
                                  const startingDailyRate = segments[0].dailyAmount; // First segment is at starting principal

                                  // Calculate overpaid/underpaid info from segment data
                                  // For capital repayment: principalChange > 0 (decreased), overpaid
                                  // For further advance: principalChange < 0 (increased), underpaid
                                  const firstSegment = segments[0];
                                  const lastSegment = segments[segments.length - 1];
                                  // Use first segment principal as the starting point (what we charged at)
                                  const startPrincipal = firstSegment?.principal || row.principalAtPeriodStart || principalStart;
                                  const endPrincipal = lastSegment?.principal || startPrincipal;
                                  const principalChange = startPrincipal - endPrincipal; // + for repayment, - for advance
                                  const adjustmentDailyRate = principalChange * (effectiveRate / 100 / 365);
                                  const adjustmentDays = Math.abs(adjustmentDailyRate) > 0.01
                                    ? Math.round(Math.abs(row.periodAdjustment || 0) / Math.abs(adjustmentDailyRate))
                                    : lastSegment?.days || 0;

                                  return (
                                    <span>
                                      Interest due at {effectiveRate}% pa, <span className="text-slate-500">{totalDays}d × {formatCurrency(startingDailyRate)}/day</span>
                                      {/* Show overpayment annotation */}
                                      {row.periodAdjustment && row.periodAdjustment > 0.01 && (
                                        <span className="ml-2 text-emerald-600 text-xs">
                                          (Overpaid {adjustmentDays}d @ {formatCurrency(Math.abs(adjustmentDailyRate))}/day → credited next)
                                        </span>
                                      )}
                                      {row.periodAdjustment && row.periodAdjustment < -0.01 && (
                                        <span className="ml-2 text-amber-600 text-xs">
                                          (Underpaid {adjustmentDays}d @ {formatCurrency(Math.abs(adjustmentDailyRate))}/day → debited next)
                                        </span>
                                      )}
                                    </span>
                                  );
                                }

                                // For ARREARS loans: show segmented calculation (what actually accrued)
                                return (
                                    <span>
                                      Interest due at {effectiveRate}% pa, {segments.map((seg, segIdx) => (
                                        <span key={segIdx}>
                                          {segIdx > 0 && ' + '}
                                          <span className="text-slate-500">{seg.days}d × {formatCurrency(seg.dailyAmount)}/day</span>
                                        </span>
                                      ))}
                                    </span>
                                  );
                                }

                              return (
                                <span>
                                  Interest due at {effectiveRate}% pa, <span className="text-slate-500">{days}d × {formatCurrency(dailyInterestAmount)}/day</span>
                                  {/* Show credit/debit for advance loans receiving prior period adjustment */}
                                  {/* Credit: from capital repayment (overpaid) - reduces interest due */}
                                  {/* Debit: from further advance (underpaid) - increases interest due */}
                                  {row.isAdvancePayment && row.adjustmentFromPrior && Math.abs(row.adjustmentFromPrior) > 0.01 &&
                                   (!row.periodAdjustment || Math.abs(row.periodAdjustment) < 0.01) && (
                                    row.adjustmentFromPrior > 0 ? (
                                      <span className="ml-1 text-blue-600">
                                        - {formatCurrency(row.adjustmentFromPrior)} credit
                                      </span>
                                    ) : (
                                      <span className="ml-1 text-amber-600">
                                        + {formatCurrency(Math.abs(row.adjustmentFromPrior))} shortfall
                                      </span>
                                    )
                                  )}
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
                            {row.isAdvancePayment && row.periodAdjustment && Math.abs(row.periodAdjustment) > 0.01 ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className={row.periodAdjustment > 0.01 ? 'cursor-help border-b border-dashed border-emerald-400' : 'cursor-help border-b border-dashed border-amber-400'}>
                                      {formatCurrency(row.interest)}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <div className="text-xs space-y-1">
                                      <p>Charged in advance: {formatCurrency(row.advanceInterestDue)}</p>
                                      <p>Correct (after changes): {formatCurrency(row.actualInterest)}</p>
                                      {row.periodAdjustment > 0 ? (
                                        <p className="text-emerald-400 font-medium">Overpaid: {formatCurrency(row.periodAdjustment)}</p>
                                      ) : (
                                        <p className="text-amber-400 font-medium">Underpaid: {formatCurrency(Math.abs(row.periodAdjustment))}</p>
                                      )}
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : row.adjustedInterestDue !== undefined ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className={`cursor-help border-b border-dashed ${row.adjustmentFromPrior > 0 ? 'border-blue-400' : 'border-amber-400'}`}>
                                      {formatCurrency(row.adjustedInterestDue)}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <div className="text-xs space-y-1">
                                      <p>Interest due: {formatCurrency(row.interest)}</p>
                                      {row.adjustmentFromPrior > 0 ? (
                                        <p className="text-blue-400">Less credit: -{formatCurrency(row.adjustmentFromPrior)}</p>
                                      ) : (
                                        <p className="text-amber-400">Plus shortfall: +{formatCurrency(Math.abs(row.adjustmentFromPrior))}</p>
                                      )}
                                      <p className="font-medium">Net due: {formatCurrency(row.adjustedInterestDue)}</p>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              formatCurrency(row.interest)
                            )}
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
                                    {row.transactions.length === 1 && row.transactions[0].notes && (
                                      <span className="text-slate-500">: {row.transactions[0].notes}</span>
                                    )}
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
                                    {row.transactions.length === 1 && row.transactions[0].notes && (
                                      <p>Notes: {row.transactions[0].notes}</p>
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
                const totalPrincipalPaid = allRepayments.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
                const totalInterestPaid = allRepayments.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
                const totalFeesPaid = allRepayments.reduce((sum, tx) => sum + (tx.fees_applied || 0), 0);
                // Use GROSS principal (what borrower owes) for schedule totals
                const totalExpectedPrincipal = loan.principal_amount;
                const totalExpectedInterest = effectiveSchedule.reduce((sum, row) => sum + (row.interest_amount || 0), 0);
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
                <TableCell className="py-1.5">
                  <p className="font-medium text-sm">{format(row.date, 'dd/MM/yy')}</p>
                </TableCell>

                {/* Actual Transactions */}
                <TableCell className="text-right font-mono text-sm py-1.5">
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
                <TableCell className="text-right font-mono text-sm py-1.5">
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
                <TableCell className="text-right font-mono text-sm border-l-2 border-slate-200 py-1.5">
                  {(viewMode === 'separate' && row.rowType === 'schedule' && row.expectedInterest !== undefined) ? (
                    isFixedCharge ? (
                      // Fixed Charge loan - show simple monthly charge (use monthlyCharge directly for reliability)
                      <div className="text-sm">
                        <span className="text-purple-600 font-semibold">{formatCurrency(monthlyCharge)}</span>
                        <span className="text-xs text-slate-500 ml-1">(monthly charge)</span>
                      </div>
                    ) : (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="cursor-help text-sm">
                            {formatCurrency(row.expectedInterest)}
                            <span className="text-xs text-slate-500 ml-1">
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

                                // Find capital transactions (repayments) and disbursements within this period
                                const capitalTxInPeriod = combinedRows.filter(r =>
                                  r.date > periodStart &&
                                  r.date <= periodEnd &&
                                  (
                                    (r.rowType === 'transaction' && r.transactions.some(tx => tx.principal_applied > 0)) ||
                                    r.rowType === 'further_advance'
                                  )
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
                                  const disbursementsBeforePeriodStart = transactions
                                    .filter(tx => !tx.is_deleted && tx.type === 'Disbursement' && new Date(tx.date) <= periodStart && new Date(tx.date) > new Date(loan.start_date))
                                    .reduce((sum, tx) => sum + (tx.amount || 0), 0);
                                  let runningPrincipal = loan.principal_amount - principalPaidBeforePeriodStart + disbursementsBeforePeriodStart;

                                  for (const txRow of capitalTxInPeriod) {
                                    const daysInSegment = differenceInDays(txRow.date, segmentStart);
                                    if (daysInSegment > 0) {
                                      const dailyInterestAmount = runningPrincipal * dailyRate;
                                      segments.push(`${daysInSegment}d × ${formatCurrency(dailyInterestAmount)}/day`);
                                    }

                                    // Handle both repayments (subtract) and disbursements (add)
                                    if (txRow.rowType === 'further_advance') {
                                      runningPrincipal += txRow.amount || 0;
                                    } else {
                                      const principalPaid = txRow.transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
                                      runningPrincipal = Math.max(0, runningPrincipal - principalPaid);
                                    }
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

                              // Find capital transactions (repayments) and disbursements within this period
                              const capitalTxInPeriod = combinedRows.filter(r =>
                                r.date > periodStart &&
                                r.date <= periodEnd &&
                                (
                                  (r.rowType === 'transaction' && r.transactions.some(tx => tx.principal_applied > 0)) ||
                                  r.rowType === 'further_advance'
                                )
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
                                const disbursementsBeforePeriodStart = transactions
                                  .filter(tx => !tx.is_deleted && tx.type === 'Disbursement' && new Date(tx.date) <= periodStart && new Date(tx.date) > new Date(loan.start_date))
                                  .reduce((sum, tx) => sum + (tx.amount || 0), 0);
                                let runningPrincipal = loan.principal_amount - principalPaidBeforePeriodStart + disbursementsBeforePeriodStart;
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

                                  // Handle both repayments (subtract) and disbursements (add)
                                  if (txRow.rowType === 'further_advance') {
                                    runningPrincipal += txRow.amount || 0;
                                  } else {
                                    const principalPaid = txRow.transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
                                    runningPrincipal = Math.max(0, runningPrincipal - principalPaid);
                                  }
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
                <TableCell className="text-right font-mono text-sm font-semibold py-1.5">
                  {(viewMode === 'merged' && effectiveSchedule.length > 0) ? formatCurrency(row.principalOutstanding + row.interestOutstanding) :
                   (viewMode === 'separate' && row.rowType === 'schedule') ? formatCurrency(row.principalOutstanding + row.interestOutstanding) : ''}
                </TableCell>
              </TableRow>
            ))}
            {/* Totals Row for Journal View */}
            {!isLoading && effectiveSchedule.length > 0 && (() => {
              const allRepayments = transactions.filter(tx => !tx.is_deleted && tx.type === 'Repayment');
              const totalPrincipalPaid = allRepayments.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
              const totalInterestPaid = allRepayments.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
              const totalFeesPaid = allRepayments.reduce((sum, tx) => sum + (tx.fees_applied || 0), 0);
              // Use GROSS principal (what borrower owes) for schedule totals
              const totalExpectedPrincipal = loan.principal_amount;
              const totalExpectedInterest = effectiveSchedule.reduce((sum, row) => sum + (row.interest_amount || 0), 0);
              const principalOutstanding = totalExpectedPrincipal - totalPrincipalPaid;
              const interestOutstanding = totalExpectedInterest - totalInterestPaid;
              const totalOutstanding = principalOutstanding + interestOutstanding;

              return (
                <TableRow className="bg-slate-100 border-t-2 border-slate-300">
                  <TableCell className="text-right font-semibold text-sm py-2">
                    Totals
                  </TableCell>
                  <TableCell className="text-right py-2">
                    <div className="text-sm space-y-0.5">
                      <div className="font-mono text-slate-600">{formatCurrency(totalExpectedPrincipal)} owed</div>
                      <div className="font-mono text-emerald-600">-{formatCurrency(totalPrincipalPaid)} paid</div>
                      <div className={`font-mono font-bold border-t pt-0.5 ${principalOutstanding < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {principalOutstanding < 0 ? '-' : ''}{formatCurrency(Math.abs(principalOutstanding))}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right py-2">
                    <div className="text-sm space-y-0.5">
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
                    <div className="text-sm">
                      <div className="text-slate-700 font-semibold">{totalOutstanding < 0 ? 'Total Overpaid:' : 'Total Outstanding:'}</div>
                      <div className={`font-mono font-bold text-lg ${totalOutstanding < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
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