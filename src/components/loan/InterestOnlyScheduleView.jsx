/**
 * InterestOnlyScheduleView
 *
 * Custom view for interest-only loans showing:
 * - Left columns (Reality): What actually happened from the ledger
 * - Right columns (Expectations): What's expected based on schedule
 * - Each transaction and schedule entry gets its own row (no merging)
 * - Running balance indicators (RED = behind, GREEN = ahead)
 */

import React, { useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { format, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatCurrency } from './LoanCalculator';
import { CalendarClock, ArrowUpCircle, ArrowDownCircle, CircleDot, ChevronRight, ChevronDown, Clock } from 'lucide-react';

/**
 * Build a unified timeline from transactions and schedule entries
 * Each transaction and schedule entry gets its own row (no merging by date)
 */
function buildTimeline({ loan, product, schedule, transactions }) {
  const rows = [];

  const getDateKey = (date) => {
    // Handle both Date objects and strings consistently
    if (typeof date === 'string') {
      const match = date.match(/^(\d{4}-\d{2}-\d{2})/);
      if (match) return match[1];
    }
    const d = new Date(date);
    return format(d, 'yyyy-MM-dd');
  };

  // 1. Add disbursement rows
  (transactions || [])
    .filter(tx => tx.type === 'Disbursement' && !tx.is_deleted)
    .forEach(tx => {
      const dateKey = getDateKey(tx.date);
      const grossAmount = tx.gross_amount ?? tx.amount;
      rows.push({
        id: `tx-${tx.id}`,
        date: dateKey,
        primaryType: 'disbursement',
        // Ledger data
        principalChange: grossAmount,
        interestPaid: 0,
        transaction: tx,
        // No schedule data for transaction rows
        expectedInterest: 0,
        isDueDate: false,
        scheduleEntry: null,
        calculationBreakdown: null
      });
    });

  // 2. Add repayment rows
  (transactions || [])
    .filter(tx => tx.type === 'Repayment' && !tx.is_deleted)
    .forEach(tx => {
      const dateKey = getDateKey(tx.date);
      rows.push({
        id: `tx-${tx.id}`,
        date: dateKey,
        primaryType: 'repayment',
        // Ledger data
        principalChange: -(tx.principal_applied || 0),
        interestPaid: tx.interest_applied || 0,
        transaction: tx,
        // No schedule data for transaction rows
        expectedInterest: 0,
        isDueDate: false,
        scheduleEntry: null,
        calculationBreakdown: null
      });
    });

  // 3. Add schedule due date rows
  (schedule || []).forEach(scheduleEntry => {
    const dateKey = getDateKey(scheduleEntry.due_date);
    const isAdjustment = scheduleEntry.installment_number === 0;
    rows.push({
      id: `schedule-${scheduleEntry.installment_number}-${dateKey}`,
      date: dateKey,
      primaryType: isAdjustment ? 'adjustment' : 'due_date',
      // No ledger data for schedule rows
      principalChange: 0,
      interestPaid: 0,
      transaction: null,
      // Schedule data
      expectedInterest: scheduleEntry.interest_amount || 0,
      isDueDate: true,
      scheduleEntry: scheduleEntry,
      calculationBreakdown: null // Will be calculated below
    });
  });

  // 4. Sort all rows by date, then by type order (disbursements first, then repayments, then schedule)
  const typeOrder = { disbursement: 0, repayment: 1, adjustment: 2, due_date: 3 };
  rows.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return (typeOrder[a.primaryType] || 99) - (typeOrder[b.primaryType] || 99);
  });

  // 5. Calculate running balances
  const rate = loan?.interest_rate || product?.interest_rate || 0;
  let runningPrincipal = 0;
  let totalExpectedToDate = 0;
  let totalPaidToDate = 0;

  rows.forEach(row => {
    // Update running principal
    runningPrincipal += row.principalChange;
    row.principalBalance = runningPrincipal;

    // Calculate expected interest for schedule entries
    if (row.isDueDate && row.scheduleEntry) {
      const scheduleEntry = row.scheduleEntry;
      const days = scheduleEntry.calculation_days || 0;
      const principalForCalc = runningPrincipal;
      const dailyRate = principalForCalc * (rate / 100 / 365);
      const isAdjustment = scheduleEntry.installment_number === 0;

      if (isAdjustment) {
        const isCredit = scheduleEntry.interest_amount < 0;
        const adjAmount = Math.abs(scheduleEntry.interest_amount);
        // Calculate the daily rate difference that was used for the adjustment
        const adjDailyRate = days > 0 ? adjAmount / days : 0;
        row.calculationBreakdown = {
          days,
          dailyRate: adjDailyRate,
          principal: principalForCalc,
          isAdjustment: true,
          breakdown: isCredit
            ? `${days}d × ${formatCurrency(adjDailyRate)} = -${formatCurrency(adjAmount)}`
            : `${days}d × ${formatCurrency(adjDailyRate)} = +${formatCurrency(adjAmount)}`
        };
        // Use stored adjustment amount
        row.expectedInterest = scheduleEntry.interest_amount;
      } else {
        row.calculationBreakdown = {
          days,
          dailyRate,
          principal: principalForCalc,
          breakdown: `${days}d × ${formatCurrency(dailyRate)}/day`
        };
        // Recalculate based on actual principal
        row.expectedInterest = dailyRate * days;
      }
      totalExpectedToDate += row.expectedInterest;
    }

    // Track interest paid
    totalPaidToDate += row.interestPaid;

    // Calculate interest balance
    row.interestBalance = totalExpectedToDate - totalPaidToDate;
    row.totalExpectedToDate = totalExpectedToDate;
    row.totalPaidToDate = totalPaidToDate;
  });

  // 6. Insert "Today" marker row if needed
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = format(today, 'yyyy-MM-dd');

  const firstDate = rows.length > 0 ? rows[0].date : null;
  const lastDate = rows.length > 0 ? rows[rows.length - 1].date : null;
  const todayIsInRange = firstDate && todayKey > firstDate && todayKey <= lastDate;
  const todayAlreadyHasRow = rows.some(r => r.date === todayKey);

  if (todayIsInRange && !todayAlreadyHasRow) {
    // Find where to insert today
    let insertIndex = rows.length;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].date > todayKey) {
        insertIndex = i;
        break;
      }
    }

    const previousRow = rows[insertIndex - 1];

    // Find last due date for accrued interest calculation
    let lastDueDateRow = null;
    for (let i = insertIndex - 1; i >= 0; i--) {
      if (rows[i].isDueDate) {
        lastDueDateRow = rows[i];
        break;
      }
    }

    const daysSinceLastDue = lastDueDateRow
      ? differenceInDays(today, new Date(lastDueDateRow.date))
      : 0;

    const dailyRate = previousRow.principalBalance * (rate / 100 / 365);
    const accruedSinceLastDue = dailyRate * daysSinceLastDue;
    const todayInterestBalance = previousRow.interestBalance + accruedSinceLastDue;

    const todayRow = {
      id: 'row-today',
      date: todayKey,
      primaryType: 'today',
      isToday: true,
      principalChange: 0,
      interestPaid: 0,
      transaction: null,
      expectedInterest: 0,
      isDueDate: false,
      scheduleEntry: null,
      calculationBreakdown: daysSinceLastDue > 0 ? {
        days: daysSinceLastDue,
        dailyRate,
        principal: previousRow.principalBalance,
        breakdown: `${daysSinceLastDue}d × ${formatCurrency(dailyRate)}/day accrued`
      } : null,
      principalBalance: previousRow.principalBalance,
      interestBalance: todayInterestBalance,
      totalExpectedToDate: previousRow.totalExpectedToDate + accruedSinceLastDue,
      totalPaidToDate: previousRow.totalPaidToDate,
      accruedInterest: accruedSinceLastDue,
      daysSinceLastDue
    };

    rows.splice(insertIndex, 0, todayRow);
  }

  return rows;
}

/**
 * Group timeline rows by month for collapsible display
 * Returns array of items: either month groups or standalone "today" row
 * Today appears as its own entry between month groups at the correct chronological position
 */
function groupRowsByMonth(rows) {
  if (!rows || rows.length === 0) return [];

  const groups = new Map();
  let todayRow = null;

  rows.forEach(row => {
    // TODAY is NOT grouped - it will be inserted as a standalone item
    if (row.isToday) {
      todayRow = row;
      return;
    }

    const date = new Date(row.date);
    const monthKey = format(date, 'yyyy-MM'); // e.g., "2025-01"
    const monthLabel = format(date, 'MMMM yyyy'); // e.g., "January 2025"

    if (!groups.has(monthKey)) {
      groups.set(monthKey, {
        monthKey,
        monthLabel,
        rows: [],
        isMonthGroup: true,
        // Totals (calculated after all rows added)
        totalInterestPaid: 0,
        totalPrincipalChange: 0,
        totalExpectedInterest: 0,
        endingInterestBalance: 0,
        endingPrincipalBalance: 0,
        // Type counts for icons (excluding standard due dates)
        typeCounts: {
          disbursements: 0,
          repayments: 0,
          adjustments: 0
        }
      });
    }
    const group = groups.get(monthKey);
    group.rows.push(row);

    // Count entry types (for collapsed view icons) - based on primaryType
    if (row.primaryType === 'disbursement') {
      group.typeCounts.disbursements++;
    } else if (row.primaryType === 'repayment') {
      group.typeCounts.repayments++;
    } else if (row.primaryType === 'adjustment') {
      group.typeCounts.adjustments++;
    }
  });

  // Calculate totals for each group
  for (const group of groups.values()) {
    group.totalInterestPaid = group.rows.reduce((sum, r) => sum + r.interestPaid, 0);
    group.totalPrincipalChange = group.rows.reduce((sum, r) => sum + r.principalChange, 0);
    group.totalExpectedInterest = group.rows.reduce((sum, r) => sum + (r.isDueDate ? r.expectedInterest : 0), 0);
    const lastRow = group.rows[group.rows.length - 1];
    group.endingInterestBalance = lastRow.interestBalance;
    group.endingPrincipalBalance = lastRow.principalBalance;
  }

  // Sort groups chronologically by monthKey
  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    return a.monthKey.localeCompare(b.monthKey);
  });

  // If there's a TODAY row, insert it at the correct position
  if (todayRow) {
    const todayDate = todayRow.date; // yyyy-MM-dd format
    const todayMonthKey = todayDate.substring(0, 7); // yyyy-MM

    // Find where to insert TODAY
    // It goes AFTER groups with monthKey < todayMonthKey
    // AND AFTER groups with monthKey === todayMonthKey (if any rows in that group are before today)
    let insertIndex = sortedGroups.length; // Default: end

    for (let i = 0; i < sortedGroups.length; i++) {
      const group = sortedGroups[i];

      if (group.monthKey > todayMonthKey) {
        // This month is entirely after today - insert before it
        insertIndex = i;
        break;
      } else if (group.monthKey === todayMonthKey) {
        // Same month - check if all rows in this group are before today
        const allRowsBeforeToday = group.rows.every(r => r.date < todayDate);
        if (allRowsBeforeToday) {
          // All rows in this month are before today - insert after this group
          insertIndex = i + 1;
        } else {
          // Some rows are after today - insert before this group
          insertIndex = i;
        }
        break;
      }
      // This month is before today - keep looking
      insertIndex = i + 1;
    }

    // Create a standalone TODAY item (not a group)
    const todayItem = {
      isToday: true,
      isTodayStandalone: true,
      row: todayRow,
      monthKey: `today-${todayDate}` // Unique key for React
    };

    sortedGroups.splice(insertIndex, 0, todayItem);
  }

  return sortedGroups;
}

/**
 * Visual bar gauge for interest balance
 * Shows 1-5 bars based on balance magnitude - bars get bigger as balance increases
 */
function BalanceGauge({ balance, maxBalance }) {
  if (Math.abs(balance) < 0.01) return null;

  // Calculate number of bars (1-5) based on proportion of max balance
  const proportion = Math.abs(balance) / Math.max(maxBalance, 1);
  const numBars = Math.min(5, Math.max(1, Math.ceil(proportion * 5)));

  // Red for behind (positive), green for ahead (negative)
  const colorClass = balance > 0 ? 'bg-red-500' : 'bg-emerald-500';

  return (
    <div className="inline-flex items-center gap-[2px] ml-1.5">
      {Array.from({ length: numBars }).map((_, i) => (
        <div
          key={i}
          className={cn(colorClass, 'w-[3px] rounded-sm')}
          style={{ height: `${8 + i * 2}px` }}
        />
      ))}
    </div>
  );
}

/**
 * Type icon with tooltip
 * Icons match GroupTypeIcons for consistency:
 * - Disbursements: blue ArrowUpCircle (capital out)
 * - Repayments: emerald ArrowDownCircle (money received)
 * - Adjustments: amber CircleDot
 * - Due dates: blue CalendarClock
 */
function TypeIcon({ row }) {
  const { primaryType } = row;
  let icon, tooltip, colorClass;

  switch (primaryType) {
    case 'today':
      icon = <Clock className="w-4 h-4" />;
      tooltip = 'Today - current position';
      colorClass = 'text-amber-600';
      break;
    case 'adjustment':
      icon = <CircleDot className="w-4 h-4" />;
      tooltip = 'Schedule adjustment';
      colorClass = 'text-amber-600';
      break;
    case 'due_date':
      icon = <CalendarClock className="w-4 h-4" />;
      tooltip = 'Interest due date';
      colorClass = 'text-blue-600';
      break;
    case 'disbursement':
      icon = <ArrowUpCircle className="w-4 h-4" />;
      tooltip = 'Disbursement (capital advanced)';
      colorClass = 'text-blue-600';
      break;
    case 'repayment':
      icon = <ArrowDownCircle className="w-4 h-4" />;
      tooltip = 'Repayment received';
      colorClass = 'text-emerald-600';
      break;
    default:
      icon = <CircleDot className="w-4 h-4" />;
      tooltip = 'Event';
      colorClass = 'text-slate-400';
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('cursor-help', colorClass)}>
          {icon}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Icons representing entry types in a month group
 * Repeats icons for multiple entries of same type
 * Does NOT show icons for standard due dates (every month has one)
 */
function GroupTypeIcons({ typeCounts }) {
  const icons = [];

  // Disbursements (blue up arrows - capital out)
  for (let i = 0; i < typeCounts.disbursements; i++) {
    icons.push(
      <ArrowUpCircle key={`disb-${i}`} className="w-3.5 h-3.5 text-blue-600" />
    );
  }

  // Repayments (emerald down arrows - money received)
  for (let i = 0; i < typeCounts.repayments; i++) {
    icons.push(
      <ArrowDownCircle key={`rep-${i}`} className="w-3.5 h-3.5 text-emerald-600" />
    );
  }

  // Adjustments (amber dots)
  for (let i = 0; i < typeCounts.adjustments; i++) {
    icons.push(
      <CircleDot key={`adj-${i}`} className="w-3.5 h-3.5 text-amber-600" />
    );
  }

  if (icons.length === 0) return null;

  return (
    <div className="flex items-center gap-0.5 ml-1">
      {icons}
    </div>
  );
}

/**
 * Collapsible month group header row
 * Shows month name and summary totals
 */
function MonthGroupRow({ group, isExpanded, onToggle, maxInterestBalance }) {
  // Determine interest balance color
  let balanceColorClass = '';
  if (group.endingInterestBalance > 0.01) {
    balanceColorClass = 'text-red-600'; // Behind
  } else if (group.endingInterestBalance < -0.01) {
    balanceColorClass = 'text-emerald-600'; // Ahead
  }

  return (
    <TableRow
      className="transition-colors cursor-pointer bg-slate-100 hover:bg-slate-200"
      onClick={onToggle}
    >
      {/* Month name with expand/collapse chevron and type icons */}
      <TableCell className="font-medium text-sm py-1" colSpan={2}>
        <div className="flex items-center gap-1">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500" />
          )}
          <span>{group.monthLabel}</span>
          {group.typeCounts && <GroupTypeIcons typeCounts={group.typeCounts} />}
        </div>
      </TableCell>

      {/* Interest Received total */}
      <TableCell className="text-right font-mono text-sm text-emerald-600 py-1">
        {group.totalInterestPaid > 0 && `-${formatCurrency(group.totalInterestPaid)}`}
      </TableCell>

      {/* Interest Balance (ending) */}
      <TableCell className={cn('text-right font-mono text-sm py-1', balanceColorClass)}>
        <div className="flex items-center justify-end">
          <span>
            {Math.abs(group.endingInterestBalance) < 0.01 ? (
              formatCurrency(0)
            ) : group.endingInterestBalance > 0 ? (
              formatCurrency(group.endingInterestBalance)
            ) : (
              `-${formatCurrency(Math.abs(group.endingInterestBalance))}`
            )}
          </span>
          <BalanceGauge balance={group.endingInterestBalance} maxBalance={maxInterestBalance} />
        </div>
      </TableCell>

      {/* Principal Change total */}
      <TableCell className="text-right font-mono text-sm py-1 border-r">
        {group.totalPrincipalChange !== 0 && (
          <span className={group.totalPrincipalChange > 0 ? 'text-emerald-600' : ''}>
            {group.totalPrincipalChange > 0 ? '+' : ''}{formatCurrency(group.totalPrincipalChange)}
          </span>
        )}
      </TableCell>

      {/* Expected Interest total */}
      <TableCell className="text-right font-mono text-sm py-1">
        {group.totalExpectedInterest > 0 && formatCurrency(group.totalExpectedInterest)}
      </TableCell>

      {/* Calculation - empty for month summary */}
      <TableCell className="text-sm py-1"></TableCell>

      {/* Principal Balance (ending) */}
      <TableCell className="text-right font-mono text-sm font-medium py-1">
        {formatCurrency(group.endingPrincipalBalance)}
      </TableCell>
    </TableRow>
  );
}

/**
 * Standalone TODAY row - appears between month groups at the correct chronological position
 */
function TodayStandaloneRow({ row, maxInterestBalance }) {
  // Determine interest balance color
  let balanceColorClass = '';
  if (row.interestBalance > 0.01) {
    balanceColorClass = 'text-red-600 font-medium'; // Behind
  } else if (row.interestBalance < -0.01) {
    balanceColorClass = 'text-emerald-600 font-medium'; // Ahead
  }

  return (
    <TableRow className="bg-amber-100 border-y-2 border-amber-400">
      {/* Date with TODAY label */}
      <TableCell className="font-mono text-sm font-bold text-amber-700 py-2" colSpan={2}>
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-600" />
          <span>TODAY</span>
          <span className="font-normal text-amber-600">{format(new Date(row.date), 'dd/MM/yyyy')}</span>
        </div>
      </TableCell>

      {/* Interest Received - none for today */}
      <TableCell className="text-right font-mono text-sm py-2">
        <span className="text-slate-300">—</span>
      </TableCell>

      {/* Interest Balance */}
      <TableCell className={cn('text-right font-mono text-sm py-2', balanceColorClass)}>
        <div className="flex items-center justify-end">
          <span>
            {Math.abs(row.interestBalance) < 0.01 ? (
              formatCurrency(0)
            ) : row.interestBalance > 0 ? (
              formatCurrency(row.interestBalance)
            ) : (
              `-${formatCurrency(Math.abs(row.interestBalance))}`
            )}
          </span>
          <BalanceGauge balance={row.interestBalance} maxBalance={maxInterestBalance} />
        </div>
      </TableCell>

      {/* Principal Change - none for today */}
      <TableCell className="text-right font-mono text-sm py-2 border-r">
        <span className="text-slate-300">—</span>
      </TableCell>

      {/* Expected Interest - show accrued */}
      <TableCell className="text-right font-mono text-sm py-2 text-amber-600">
        {row.accruedInterest > 0.01 && `+${formatCurrency(row.accruedInterest)}`}
      </TableCell>

      {/* Calculation - accrued breakdown */}
      <TableCell className="text-sm py-2 text-amber-600">
        {row.accruedInterest > 0.01 && row.calculationBreakdown && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help">
                {row.daysSinceLastDue}d accrued
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{row.daysSinceLastDue} days since last due date</p>
              <p>{formatCurrency(row.calculationBreakdown.dailyRate)}/day × {row.daysSinceLastDue}d</p>
              <p>= {formatCurrency(row.accruedInterest)} accrued</p>
            </TooltipContent>
          </Tooltip>
        )}
      </TableCell>

      {/* Principal Balance */}
      <TableCell className="text-right font-mono text-sm font-medium py-2">
        {formatCurrency(row.principalBalance)}
      </TableCell>
    </TableRow>
  );
}

/**
 * Single timeline row component
 */
function TimelineRow({ row, product, isFirst, isLast, maxInterestBalance, isNested = false }) {
  const isFuture = new Date(row.date) > new Date();
  const isDueDate = row.isDueDate;
  const isToday = row.isToday;

  // Determine interest balance color
  let balanceColorClass = '';
  if (row.interestBalance > 0.01) {
    balanceColorClass = 'text-red-600 font-medium'; // Behind
  } else if (row.interestBalance < -0.01) {
    balanceColorClass = 'text-emerald-600 font-medium'; // Ahead
  }

  // Determine if payment was made
  const hasPrincipalChange = Math.abs(row.principalChange) > 0.01;
  const hasInterestPaid = row.interestPaid > 0.01;

  // Only show principal balance on first row, last row, or when there's a change
  const showPrincipalBalance = isFirst || isLast || hasPrincipalChange || isToday;

  return (
    <TableRow className={cn(
      isDueDate && 'bg-slate-50/50',
      isFuture && 'opacity-60',
      isToday && 'bg-amber-50 border-y-2 border-amber-300'
    )}>
      {/* Date */}
      <TableCell className={cn(
        "font-mono text-xs whitespace-nowrap py-1",
        isNested && "pl-6",
        isToday && "font-bold text-amber-700"
      )}>
        {isToday ? (
          <span>TODAY {format(new Date(row.date), 'dd/MM/yy')}</span>
        ) : (
          format(new Date(row.date), 'dd/MM/yy')
        )}
      </TableCell>

      {/* Type */}
      <TableCell className="py-1">
        <TypeIcon row={row} />
      </TableCell>

      {/* Interest Paid (Reality) */}
      <TableCell className="text-right font-mono text-xs py-1">
        {hasInterestPaid ? (
          <span className="text-emerald-600">
            -{formatCurrency(row.interestPaid)}
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </TableCell>

      {/* Interest Balance (Reality) */}
      <TableCell className={cn('text-right font-mono text-xs py-1', balanceColorClass)}>
        <div className="flex items-center justify-end">
          <span>
            {Math.abs(row.interestBalance) < 0.01 ? (
              formatCurrency(0)
            ) : row.interestBalance > 0 ? (
              formatCurrency(row.interestBalance)
            ) : (
              `-${formatCurrency(Math.abs(row.interestBalance))}`
            )}
          </span>
          <BalanceGauge balance={row.interestBalance} maxBalance={maxInterestBalance} />
        </div>
      </TableCell>

      {/* Principal Change (Reality) - rightmost in ledger section */}
      <TableCell className="text-right font-mono text-xs py-1 border-r">
        {hasPrincipalChange ? (
          (() => {
            // Check if this disbursement has deductions (gross != net)
            const tx = row.transaction;
            const hasDeductions = tx?.type === 'Disbursement' &&
              tx.gross_amount &&
              tx.gross_amount !== tx.amount;

            if (hasDeductions) {
              const grossAmount = tx.gross_amount;
              const netAmount = tx.amount;
              const deductedFee = tx.deducted_fee || 0;
              const deductedInterest = tx.deducted_interest || 0;

              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-emerald-600 cursor-help underline decoration-dotted">
                      +{formatCurrency(row.principalChange)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">
                    <div className="space-y-1">
                      <p className="font-medium">Gross: {formatCurrency(grossAmount)}</p>
                      {deductedFee > 0 && <p>Less fee: -{formatCurrency(deductedFee)}</p>}
                      {deductedInterest > 0 && <p>Less interest: -{formatCurrency(deductedInterest)}</p>}
                      <p className="border-t pt-1">Net transferred: {formatCurrency(netAmount)}</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            }

            return (
              <span className={row.principalChange > 0 ? 'text-emerald-600' : 'text-slate-700'}>
                {row.principalChange > 0 ? '+' : ''}{formatCurrency(row.principalChange)}
              </span>
            );
          })()
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </TableCell>

      {/* Expected Interest (Expectations) */}
      <TableCell className="text-right font-mono text-xs py-1">
        {row.isDueDate && row.expectedInterest > 0.01 ? (
          <span className={isFuture ? 'text-slate-400' : ''}>
            {formatCurrency(row.expectedInterest)}
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </TableCell>

      {/* Calculation (Expectations) */}
      <TableCell className={cn("text-xs py-1", isToday ? "text-amber-600" : "text-slate-500")}>
        {isToday && row.accruedInterest > 0.01 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help">
                +{formatCurrency(row.accruedInterest)} accrued
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{row.daysSinceLastDue}d since last due date</p>
              <p>{formatCurrency(row.calculationBreakdown?.dailyRate || 0)}/day</p>
            </TooltipContent>
          </Tooltip>
        ) : row.calculationBreakdown?.isAdjustment ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn(
                "cursor-help",
                row.expectedInterest < 0 ? "text-emerald-600" : "text-amber-600"
              )}>
                {row.calculationBreakdown.breakdown}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">Mid-period capital adjustment</p>
              <p>{row.calculationBreakdown.days} days remaining in period</p>
              <p>Interest {row.expectedInterest < 0 ? 'credit' : 'due'}: {formatCurrency(Math.abs(row.expectedInterest))}</p>
            </TooltipContent>
          </Tooltip>
        ) : row.calculationBreakdown ? (
          row.calculationBreakdown.breakdown
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </TableCell>

      {/* Principal Balance (Expectations) - only show at start, end, or on changes */}
      <TableCell className="text-right font-mono text-xs font-medium py-1">
        {showPrincipalBalance ? (
          formatCurrency(row.principalBalance)
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * Summary/Totals row
 */
function TotalsRow({ rows }) {
  if (!rows || rows.length === 0) return null;

  const lastRow = rows[rows.length - 1];

  // Calculate totals
  const totalPrincipalChange = rows.reduce((sum, r) => sum + r.principalChange, 0);
  const totalInterestPaid = rows.reduce((sum, r) => sum + r.interestPaid, 0);
  const totalExpected = lastRow.totalExpectedToDate;
  const interestBalance = lastRow.interestBalance;
  const principalBalance = lastRow.principalBalance;

  // Aggregate disbursements with deductions for tooltip
  const disbursementsWithDeductions = [];
  let totalGross = 0;
  let totalDeductedFee = 0;
  let totalDeductedInterest = 0;
  let totalNet = 0;

  rows.forEach(row => {
    const tx = row.transaction;
    if (tx?.type === 'Disbursement' && tx.gross_amount && tx.gross_amount !== tx.amount) {
      disbursementsWithDeductions.push(tx);
      totalGross += tx.gross_amount || 0;
      totalDeductedFee += tx.deducted_fee || 0;
      totalDeductedInterest += tx.deducted_interest || 0;
      totalNet += tx.amount || 0;
    }
  });

  const hasDeductions = disbursementsWithDeductions.length > 0;

  // Determine status
  let statusLabel = 'On Track';
  let statusColor = '';
  if (interestBalance > 0.01) {
    statusLabel = 'BEHIND';
    statusColor = 'text-red-600';
  } else if (interestBalance < -0.01) {
    statusLabel = 'AHEAD';
    statusColor = 'text-emerald-600';
  }

  return (
    <TableRow className="bg-slate-100 font-semibold border-t-2">
      <TableCell className="text-xs py-1.5">TOTALS</TableCell>
      <TableCell className="py-1.5"></TableCell>
      <TableCell className="text-right font-mono text-xs text-emerald-600 py-1.5">
        -{formatCurrency(totalInterestPaid)}
      </TableCell>
      <TableCell className={cn('text-right font-mono text-xs py-1.5', statusColor)}>
        <div>{Math.abs(interestBalance) < 0.01 ? formatCurrency(0) : formatCurrency(Math.abs(interestBalance))}</div>
        <div className="text-[10px]">{statusLabel}</div>
      </TableCell>
      <TableCell className="text-right font-mono text-xs py-1.5 border-r">
        {totalPrincipalChange !== 0 && (
          hasDeductions ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn(
                  'cursor-help underline decoration-dotted',
                  totalPrincipalChange > 0 ? 'text-emerald-600' : ''
                )}>
                  {totalPrincipalChange > 0 ? '+' : ''}{formatCurrency(totalPrincipalChange)}
                </span>
              </TooltipTrigger>
              <TooltipContent className="text-xs">
                <div className="space-y-1">
                  <p className="font-medium">Total Gross: {formatCurrency(totalGross)}</p>
                  {totalDeductedFee > 0 && <p>Less fees: -{formatCurrency(totalDeductedFee)}</p>}
                  {totalDeductedInterest > 0 && <p>Less interest: -{formatCurrency(totalDeductedInterest)}</p>}
                  <p className="border-t pt-1">Total Net transferred: {formatCurrency(totalNet)}</p>
                  <p className="text-slate-400 text-[10px]">({disbursementsWithDeductions.length} disbursement{disbursementsWithDeductions.length > 1 ? 's' : ''} with deductions)</p>
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className={totalPrincipalChange > 0 ? 'text-emerald-600' : ''}>
              {totalPrincipalChange > 0 ? '+' : ''}{formatCurrency(totalPrincipalChange)}
            </span>
          )
        )}
      </TableCell>
      <TableCell className="text-right font-mono text-xs py-1.5">
        {formatCurrency(totalExpected)}
      </TableCell>
      <TableCell className="py-1.5"></TableCell>
      <TableCell className="text-right font-mono text-xs py-1.5">
        {formatCurrency(principalBalance)}
      </TableCell>
    </TableRow>
  );
}

/**
 * Main InterestOnlyScheduleView component
 */
export default function InterestOnlyScheduleView({
  loan,
  product,
  schedule,
  transactions
}) {
  // Expand/collapse state for month groups
  const [expandedMonths, setExpandedMonths] = useState(new Set());
  // Flat view mode - shows all rows without month grouping
  const [flatView, setFlatView] = useState(false);

  const toggleMonth = (monthKey) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(monthKey)) {
        next.delete(monthKey);
      } else {
        next.add(monthKey);
      }
      return next;
    });
  };

  // Build the unified timeline
  const timelineRows = useMemo(() => {
    return buildTimeline({ loan, product, schedule, transactions });
  }, [loan, product, schedule, transactions]);

  // Group rows by month
  const monthGroups = useMemo(() => {
    return groupRowsByMonth(timelineRows);
  }, [timelineRows]);

  // Get only the actual month groups (not standalone TODAY)
  const actualMonthGroups = useMemo(() => {
    return monthGroups.filter(item => item.isMonthGroup);
  }, [monthGroups]);

  // Expand/collapse all helpers
  const expandAll = () => {
    setExpandedMonths(new Set(actualMonthGroups.map(g => g.monthKey)));
  };

  const collapseAll = () => {
    setExpandedMonths(new Set());
  };

  const allExpanded = actualMonthGroups.length > 0 && expandedMonths.size === actualMonthGroups.length;

  // Calculate max interest balance for gauge scaling
  const maxInterestBalance = useMemo(() => {
    if (!timelineRows || timelineRows.length === 0) return 0;
    return Math.max(...timelineRows.map(r => Math.abs(r.interestBalance)), 0);
  }, [timelineRows]);

  if (!timelineRows || timelineRows.length === 0) {
    return (
      <div className="text-center text-slate-500 py-8">
        <p>No schedule data available.</p>
        <p className="text-sm mt-1">Record transactions to see the schedule timeline.</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
    <div className="space-y-4">
      {/* View controls */}
      <div className="flex justify-end gap-2">
        <Button
          variant={flatView ? "default" : "outline"}
          size="sm"
          onClick={() => setFlatView(!flatView)}
          className="gap-1 h-6 text-xs px-2"
        >
          {flatView ? 'Grouped View' : 'Flat View'}
        </Button>
        {!flatView && (
          <Button
            variant="outline"
            size="sm"
            onClick={allExpanded ? collapseAll : expandAll}
            className="gap-1 h-6 text-xs px-2"
          >
            {allExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {allExpanded ? 'Collapse All' : 'Expand All'}
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs w-20 py-1">Date</TableHead>
            <TableHead className="text-xs w-8 py-1"></TableHead>
            <TableHead className="text-xs text-right w-24 py-1">Int Received</TableHead>
            <TableHead className="text-xs text-right w-28 py-1">Int Bal</TableHead>
            <TableHead className="text-xs text-right w-24 border-r py-1">Principal</TableHead>
            <TableHead className="text-xs text-right w-24 py-1">Expected</TableHead>
            <TableHead className="text-xs w-32 py-1">Calculation</TableHead>
            <TableHead className="text-xs text-right w-24 py-1">Prin Bal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {flatView ? (
            /* Flat view - show all rows without month grouping */
            timelineRows.map((row, idx) => (
              <TimelineRow
                key={row.id}
                row={row}
                product={product}
                isFirst={idx === 0}
                isLast={idx === timelineRows.length - 1}
                maxInterestBalance={maxInterestBalance}
                isNested={false}
              />
            ))
          ) : (
            /* Grouped view - collapsible month groups with standalone TODAY */
            monthGroups.map((item, itemIndex) => {
              // Standalone TODAY row
              if (item.isTodayStandalone) {
                return (
                  <TodayStandaloneRow
                    key={item.monthKey}
                    row={item.row}
                    maxInterestBalance={maxInterestBalance}
                  />
                );
              }

              // Month group
              const group = item;
              return (
                <React.Fragment key={group.monthKey}>
                  <MonthGroupRow
                    group={group}
                    isExpanded={expandedMonths.has(group.monthKey)}
                    onToggle={() => toggleMonth(group.monthKey)}
                    maxInterestBalance={maxInterestBalance}
                  />
                  {expandedMonths.has(group.monthKey) && group.rows.map((row, idx) => (
                    <TimelineRow
                      key={row.id}
                      row={row}
                      product={product}
                      isFirst={itemIndex === 0 && idx === 0}
                      isLast={itemIndex === monthGroups.length - 1 && idx === group.rows.length - 1}
                      maxInterestBalance={maxInterestBalance}
                      isNested={true}
                    />
                  ))}
                </React.Fragment>
              );
            })
          )}
          <TotalsRow rows={timelineRows} />
        </TableBody>
      </Table>
    </div>
    </TooltipProvider>
  );
}
