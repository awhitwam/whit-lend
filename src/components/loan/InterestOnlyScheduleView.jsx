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
import { CalendarClock, ArrowRightCircle, ArrowLeftCircle, CircleDot, ChevronRight, ChevronDown, Clock, List, Layers, ChevronsUpDown, ArrowUp, ArrowDown, TrendingUp } from 'lucide-react';

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

  // 3.5 Add rate change row if loan has a penalty rate
  if (loan?.has_penalty_rate && loan?.penalty_rate && loan?.penalty_rate_from) {
    const penaltyDateKey = getDateKey(loan.penalty_rate_from);
    rows.push({
      id: `rate-change-${penaltyDateKey}`,
      date: penaltyDateKey,
      primaryType: 'rate_change',
      // No ledger data
      principalChange: 0,
      interestPaid: 0,
      transaction: null,
      // Rate change data
      expectedInterest: 0,
      isDueDate: false,
      scheduleEntry: null,
      calculationBreakdown: null,
      // Rate change specific
      previousRate: loan.interest_rate,
      newRate: loan.penalty_rate,
      isRateChange: true
    });
  }

  // 4. Sort all rows by date, then by type order:
  // Capital first (disbursements), then capital repayments, then adjustments/due dates, rate changes last
  // This ensures interest adjustments appear AFTER any transactions on the same date
  const typeOrder = { disbursement: 0, repayment: 1, adjustment: 2, due_date: 3, rate_change: 4 };

  rows.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    // Use nullish coalescing (??) instead of || because 0 is a valid value
    const aOrder = typeOrder[a.primaryType] ?? 99;
    const bOrder = typeOrder[b.primaryType] ?? 99;
    return aOrder - bOrder;
  });

  // 5. Calculate running balances
  const baseRate = loan?.interest_rate || product?.interest_rate || 0;
  const hasPenaltyRate = loan?.has_penalty_rate && loan?.penalty_rate && loan?.penalty_rate_from;
  const penaltyRate = loan?.penalty_rate || baseRate;
  const penaltyRateFrom = hasPenaltyRate ? new Date(loan.penalty_rate_from) : null;

  // Helper to get the effective rate for a given date
  const getEffectiveRateForDate = (dateStr) => {
    if (!hasPenaltyRate) return baseRate;
    const entryDate = new Date(dateStr);
    return entryDate >= penaltyRateFrom ? penaltyRate : baseRate;
  };

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
      // Use the effective rate for this schedule entry's date
      const effectiveRate = getEffectiveRateForDate(scheduleEntry.due_date);
      const dailyRate = principalForCalc * (effectiveRate / 100 / 365);
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
          effectiveRate,
          isAdjustment: true,
          breakdown: isCredit
            ? `${days}d × ${formatCurrency(adjDailyRate)} = -${formatCurrency(adjAmount)}`
            : `${days}d × ${formatCurrency(adjDailyRate)} = +${formatCurrency(adjAmount)}`
        };
        // Use stored adjustment amount
        row.expectedInterest = scheduleEntry.interest_amount;
      } else {
        // Use schedule entry's stored interest amount if available
        const storedInterest = scheduleEntry.interest_amount || 0;
        // For display, use the stored calculation values if available
        const displayPrincipal = scheduleEntry.calculation_principal_start || principalForCalc;
        const displayDailyRate = displayPrincipal * (effectiveRate / 100 / 365);

        row.calculationBreakdown = {
          days,
          dailyRate: displayDailyRate,
          principal: displayPrincipal,
          effectiveRate,
          breakdown: days > 0 && displayDailyRate > 0
            ? `${days}d × ${formatCurrency(displayDailyRate)}/day (${effectiveRate}% pa)`
            : storedInterest === 0 ? 'Prepaid' : `${days}d`
        };
        // Use stored interest amount from schedule
        row.expectedInterest = storedInterest;
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

    // For interest-in-advance loans, don't accrue additional interest
    // because the full period's interest was already charged at the due date
    const isInterestInAdvance = product?.interest_paid_in_advance;

    const daysSinceLastDue = lastDueDateRow
      ? differenceInDays(today, new Date(lastDueDateRow.date))
      : 0;

    // Use the effective rate for today's date
    const todayEffectiveRate = getEffectiveRateForDate(todayKey);
    const dailyRate = previousRow.principalBalance * (todayEffectiveRate / 100 / 365);
    const accruedSinceLastDue = isInterestInAdvance ? 0 : dailyRate * daysSinceLastDue;
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
      calculationBreakdown: accruedSinceLastDue > 0 ? {
        days: daysSinceLastDue,
        dailyRate,
        principal: previousRow.principalBalance,
        effectiveRate: todayEffectiveRate,
        breakdown: `${daysSinceLastDue}d × ${formatCurrency(dailyRate)}/day (${todayEffectiveRate}% pa) accrued`
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
          interestRepayments: 0,
          capitalRepayments: 0,
          adjustments: 0,
          rateChanges: 0
        }
      });
    }
    const group = groups.get(monthKey);
    group.rows.push(row);

    // Count entry types (for collapsed view icons) - based on primaryType
    if (row.primaryType === 'disbursement') {
      group.typeCounts.disbursements++;
    } else if (row.primaryType === 'repayment') {
      // Distinguish capital vs interest repayments
      if (row.transaction?.principal_applied > 0) {
        group.typeCounts.capitalRepayments++;
      } else {
        group.typeCounts.interestRepayments++;
      }
    } else if (row.primaryType === 'adjustment') {
      group.typeCounts.adjustments++;
    } else if (row.primaryType === 'rate_change') {
      group.typeCounts.rateChanges++;
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
 * Shows 1-5 bars based on multiples of monthly interest due
 * Red bars when owing (positive balance), green bars when ahead (negative balance)
 */
function BalanceGauge({ balance, monthlyInterest }) {
  if (Math.abs(balance) < 0.01 || !monthlyInterest || monthlyInterest < 0.01) return null;

  // Calculate number of bars (1-5) based on multiples of monthly interest
  // 1 bar = balance > 1× monthly, 2 bars = > 2× monthly, etc.
  const multiples = Math.abs(balance) / monthlyInterest;
  const numBars = Math.min(5, Math.max(0, Math.floor(multiples)));

  if (numBars === 0) return null;

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
    case 'rate_change':
      icon = <TrendingUp className="w-4 h-4" />;
      tooltip = `Interest rate changed: ${row.previousRate}% → ${row.newRate}% p.a.`;
      colorClass = 'text-orange-600';
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
      icon = <ArrowRightCircle className="w-4 h-4" />;
      tooltip = 'Disbursement (capital advanced)';
      colorClass = 'text-red-600';
      break;
    case 'repayment':
      icon = <ArrowLeftCircle className="w-4 h-4" />;
      // Blue for capital receipts (principal applied), green for interest receipts
      const hasPrincipal = row.transaction?.principal_applied > 0;
      tooltip = hasPrincipal ? 'Capital repayment received' : 'Interest payment received';
      colorClass = hasPrincipal ? 'text-blue-600' : 'text-emerald-600';
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

  // Disbursements (red right arrows - capital out)
  for (let i = 0; i < typeCounts.disbursements; i++) {
    icons.push(
      <ArrowRightCircle key={`disb-${i}`} className="w-4 h-4 text-red-600" />
    );
  }

  // Capital repayments (blue left arrows - principal returned)
  for (let i = 0; i < typeCounts.capitalRepayments; i++) {
    icons.push(
      <ArrowLeftCircle key={`cap-${i}`} className="w-4 h-4 text-blue-600" />
    );
  }

  // Interest repayments (green left arrows - interest received)
  for (let i = 0; i < typeCounts.interestRepayments; i++) {
    icons.push(
      <ArrowLeftCircle key={`int-${i}`} className="w-4 h-4 text-emerald-600" />
    );
  }

  // Adjustments (amber dots)
  for (let i = 0; i < typeCounts.adjustments; i++) {
    icons.push(
      <CircleDot key={`adj-${i}`} className="w-4 h-4 text-amber-600" />
    );
  }

  // Rate changes (orange trending up)
  for (let i = 0; i < (typeCounts.rateChanges || 0); i++) {
    icons.push(
      <TrendingUp key={`rate-${i}`} className="w-4 h-4 text-orange-600" />
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
function MonthGroupRow({ group, isExpanded, onToggle, monthlyInterest }) {
  // Interest balance is always black (no color coding)
  const balanceColorClass = '';

  return (
    <TableRow
      className="transition-colors cursor-pointer bg-slate-100 hover:bg-slate-200"
      onClick={onToggle}
    >
      {/* Month name with expand/collapse chevron and type icons */}
      <TableCell className="font-medium text-base py-0.5" colSpan={2}>
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
      <TableCell className="text-right font-mono text-base text-emerald-600 py-0.5">
        {group.totalInterestPaid > 0 && `-${formatCurrency(group.totalInterestPaid)}`}
      </TableCell>

      {/* Expected Interest total */}
      <TableCell className="text-right font-mono text-base text-blue-600 py-0.5">
        {group.totalExpectedInterest > 0 && formatCurrency(group.totalExpectedInterest)}
      </TableCell>

      {/* Interest Balance (ending) */}
      <TableCell className={cn('text-right font-mono text-base py-0.5', balanceColorClass)}>
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
          <BalanceGauge balance={group.endingInterestBalance} monthlyInterest={monthlyInterest} />
        </div>
      </TableCell>

      {/* Principal Change total */}
      <TableCell className="text-right font-mono text-base py-0.5 border-r">
        {group.totalPrincipalChange !== 0 && (
          <span className={group.totalPrincipalChange > 0 ? 'text-red-600' : ''}>
            {group.totalPrincipalChange > 0 ? '+' : ''}{formatCurrency(group.totalPrincipalChange)}
          </span>
        )}
      </TableCell>

      {/* Calculation - empty for month summary */}
      <TableCell className="text-base py-0.5"></TableCell>

      {/* Principal Balance (ending) */}
      <TableCell className="text-right font-mono text-base font-medium py-0.5">
        {formatCurrency(group.endingPrincipalBalance)}
      </TableCell>
    </TableRow>
  );
}

/**
 * Standalone TODAY row - appears between month groups at the correct chronological position
 */
function TodayStandaloneRow({ row, monthlyInterest }) {
  // Interest balance is always black (no color coding)
  const balanceColorClass = '';

  return (
    <TableRow className="bg-amber-100 border-y-2 border-amber-400">
      {/* Date with TODAY label */}
      <TableCell className="font-mono text-base font-bold text-amber-700 py-0.5" colSpan={2}>
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-600" />
          <span>TODAY</span>
          <span className="font-normal text-amber-600">{format(new Date(row.date), 'dd/MM/yyyy')}</span>
        </div>
      </TableCell>

      {/* Interest Received - none for today */}
      <TableCell className="text-right font-mono text-base py-0.5">
        <span className="text-slate-300">—</span>
      </TableCell>

      {/* Expected Interest - show accrued */}
      <TableCell className="text-right font-mono text-base py-0.5 text-amber-600">
        {row.accruedInterest > 0.01 && `+${formatCurrency(row.accruedInterest)}`}
      </TableCell>

      {/* Interest Balance */}
      <TableCell className={cn('text-right font-mono text-base py-0.5', balanceColorClass)}>
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
          <BalanceGauge balance={row.interestBalance} monthlyInterest={monthlyInterest} />
        </div>
      </TableCell>

      {/* Principal Change - none for today */}
      <TableCell className="text-right font-mono text-base py-0.5 border-r">
        <span className="text-slate-300">—</span>
      </TableCell>

      {/* Calculation - accrued breakdown */}
      <TableCell className="text-base py-0.5 text-amber-600">
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
      <TableCell className="text-right font-mono text-base font-medium py-0.5">
        {formatCurrency(row.principalBalance)}
      </TableCell>
    </TableRow>
  );
}

/**
 * Single timeline row component
 */
function TimelineRow({ row, product, isFirst, isLast, monthlyInterest, isNested = false }) {
  const isFuture = new Date(row.date) > new Date();
  const isDueDate = row.isDueDate;
  const isToday = row.isToday;
  const isRateChange = row.primaryType === 'rate_change';

  // Interest balance is always black (no color coding)
  const balanceColorClass = '';

  // Determine if payment was made
  const hasPrincipalChange = Math.abs(row.principalChange) > 0.01;
  const hasInterestPaid = row.interestPaid > 0.01;

  // Only show principal balance on first row, last row, or when there's a change
  const showPrincipalBalance = isFirst || isLast || hasPrincipalChange || isToday || isRateChange;

  // Special display for rate change rows
  if (isRateChange) {
    return (
      <TableRow className="bg-orange-50 border-y border-orange-300">
        {/* Date */}
        <TableCell className={cn(
          "font-mono text-base whitespace-nowrap py-0.5",
          isNested && "pl-6"
        )} colSpan={2}>
          {format(new Date(row.date), 'dd/MM/yy')}
        </TableCell>

        {/* Rate change message spanning remaining columns */}
        <TableCell colSpan={6} className="py-0.5">
          <div className="flex items-center gap-2 text-orange-700 font-medium text-base">
            <span>Interest rate changed:</span>
            <span className="font-mono">{row.previousRate}% p.a.</span>
            <span>→</span>
            <span className="font-mono font-bold">{row.newRate}% p.a.</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-orange-600 cursor-help">
                  <TrendingUp className="w-3.5 h-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Penalty rate effective from this date</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow className={cn(
      isDueDate && 'bg-slate-50/50',
      isFuture && 'opacity-60',
      isToday && 'bg-amber-50 border-y-2 border-amber-300'
    )}>
      {/* Date */}
      <TableCell className={cn(
        "font-mono text-base whitespace-nowrap py-0.5",
        isNested && "pl-6",
        isToday && "font-bold text-amber-700"
      )} colSpan={2}>
        {isToday ? (
          <span>TODAY {format(new Date(row.date), 'dd/MM/yy')}</span>
        ) : (
          format(new Date(row.date), 'dd/MM/yy')
        )}
      </TableCell>

      {/* Interest Paid (Reality) - with repayment icon */}
      <TableCell className="text-right font-mono text-base py-0.5">
        {hasInterestPaid ? (
          <div className="flex items-center justify-end gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-emerald-600 cursor-help">
                  <ArrowLeftCircle className="w-3.5 h-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Interest payment received</p>
              </TooltipContent>
            </Tooltip>
            <span className="text-emerald-600">
              -{formatCurrency(row.interestPaid)}
            </span>
          </div>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </TableCell>

      {/* Expected Interest (Expectations) - with schedule icon */}
      <TableCell className="text-right font-mono text-base py-0.5">
        {row.isDueDate && row.expectedInterest > 0.01 ? (
          <div className="flex items-center justify-end gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn('cursor-help', row.primaryType === 'adjustment' ? 'text-amber-600' : (isFuture ? 'text-slate-400' : 'text-blue-600'))}>
                  {row.primaryType === 'adjustment' ? <CircleDot className="w-3.5 h-3.5" /> : <CalendarClock className="w-3.5 h-3.5" />}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{row.primaryType === 'adjustment' ? 'Schedule adjustment' : 'Interest due date'}</p>
              </TooltipContent>
            </Tooltip>
            <span className={isFuture ? 'text-slate-400' : (row.primaryType === 'adjustment' ? 'text-amber-600' : 'text-blue-600')}>
              {formatCurrency(row.expectedInterest)}
            </span>
          </div>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </TableCell>

      {/* Interest Balance (Reality) - always show */}
      <TableCell className={cn('text-right font-mono text-base py-0.5', balanceColorClass)}>
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
          <BalanceGauge balance={row.interestBalance} monthlyInterest={monthlyInterest} />
        </div>
      </TableCell>

      {/* Principal Change (Reality) - rightmost in ledger section, with disbursement/capital icon */}
      <TableCell className="text-right font-mono text-base py-0.5 border-r">
        {hasPrincipalChange ? (
          (() => {
            // Check if this disbursement has deductions (gross != net)
            const tx = row.transaction;
            const hasDeductions = tx?.type === 'Disbursement' &&
              tx.gross_amount &&
              tx.gross_amount !== tx.amount;
            const isDisbursement = row.principalChange > 0;
            const iconColor = isDisbursement ? 'text-red-600' : 'text-blue-600';
            const iconTooltip = isDisbursement ? 'Disbursement (capital advanced)' : 'Capital repayment received';

            if (hasDeductions) {
              const grossAmount = tx.gross_amount;
              const netAmount = tx.amount;
              const deductedFee = tx.deducted_fee || 0;
              const deductedInterest = tx.deducted_interest || 0;

              return (
                <div className="flex items-center justify-end gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={cn(iconColor, 'cursor-help')}>
                        {isDisbursement ? <ArrowRightCircle className="w-3.5 h-3.5" /> : <ArrowLeftCircle className="w-3.5 h-3.5" />}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{iconTooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-red-600 cursor-help underline decoration-dotted">
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
                </div>
              );
            }

            return (
              <div className="flex items-center justify-end gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={cn(iconColor, 'cursor-help')}>
                      {isDisbursement ? <ArrowRightCircle className="w-3.5 h-3.5" /> : <ArrowLeftCircle className="w-3.5 h-3.5" />}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{iconTooltip}</p>
                  </TooltipContent>
                </Tooltip>
                <span className={isDisbursement ? 'text-red-600' : 'text-slate-700'}>
                  {isDisbursement ? '+' : ''}{formatCurrency(row.principalChange)}
                </span>
              </div>
            );
          })()
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </TableCell>

      {/* Calculation (Expectations) */}
      <TableCell className={cn("text-base py-0.5", isToday ? "text-amber-600" : "text-slate-500")}>
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
            <TooltipContent className="space-y-1">
              <p className="font-medium">Mid-period capital adjustment</p>
              <p className="text-xs text-slate-300">Principal: {formatCurrency(row.calculationBreakdown.principal)}</p>
              <p className="text-xs text-slate-300">Rate: {row.calculationBreakdown.effectiveRate}% p.a.</p>
              <p className="text-xs text-slate-300">Daily: {formatCurrency(row.calculationBreakdown.principal)} × {row.calculationBreakdown.effectiveRate}% ÷ 365 = {formatCurrency(row.calculationBreakdown.dailyRate)}/day</p>
              <p className="text-xs text-slate-300">{row.calculationBreakdown.days} days × {formatCurrency(row.calculationBreakdown.dailyRate)} = {formatCurrency(Math.abs(row.expectedInterest))}</p>
              <p className="font-medium mt-1">Interest {row.expectedInterest < 0 ? 'credit' : 'due'}: {formatCurrency(Math.abs(row.expectedInterest))}</p>
            </TooltipContent>
          </Tooltip>
        ) : row.calculationBreakdown ? (
          row.calculationBreakdown.breakdown
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </TableCell>

      {/* Principal Balance (Expectations) - only show at start, end, or on changes */}
      <TableCell className="text-right font-mono text-base font-medium py-0.5">
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
      <TableCell className="text-base py-1" colSpan={2}>TOTALS</TableCell>
      <TableCell className="text-right font-mono text-base text-emerald-600 py-1">
        -{formatCurrency(totalInterestPaid)}
      </TableCell>
      <TableCell className="text-right font-mono text-base py-1">
        {formatCurrency(totalExpected)}
      </TableCell>
      <TableCell className={cn('text-right font-mono text-base py-1', statusColor)}>
        <div>{Math.abs(interestBalance) < 0.01 ? formatCurrency(0) : formatCurrency(Math.abs(interestBalance))}</div>
        <div className="text-xs">{statusLabel}</div>
      </TableCell>
      <TableCell className="text-right font-mono text-base py-1 border-r">
        {totalPrincipalChange !== 0 && (
          hasDeductions ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn(
                  'cursor-help underline decoration-dotted',
                  totalPrincipalChange > 0 ? 'text-red-600' : ''
                )}>
                  {totalPrincipalChange > 0 ? '+' : ''}{formatCurrency(totalPrincipalChange)}
                </span>
              </TooltipTrigger>
              <TooltipContent className="text-base">
                <div className="space-y-1">
                  <p className="font-medium">Total Gross: {formatCurrency(totalGross)}</p>
                  {totalDeductedFee > 0 && <p>Less fees: -{formatCurrency(totalDeductedFee)}</p>}
                  {totalDeductedInterest > 0 && <p>Less interest: -{formatCurrency(totalDeductedInterest)}</p>}
                  <p className="border-t pt-1">Total Net transferred: {formatCurrency(totalNet)}</p>
                  <p className="text-slate-400 text-xs">({disbursementsWithDeductions.length} disbursement{disbursementsWithDeductions.length > 1 ? 's' : ''} with deductions)</p>
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className={totalPrincipalChange > 0 ? 'text-red-600' : ''}>
              {totalPrincipalChange > 0 ? '+' : ''}{formatCurrency(totalPrincipalChange)}
            </span>
          )
        )}
      </TableCell>
      <TableCell className="py-1"></TableCell>
      <TableCell className="text-right font-mono text-base py-1">
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

  // Sort order - 'asc' (oldest first) or 'desc' (newest first), default to ascending
  const [sortOrder, setSortOrder] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('schedule-sort-order') || 'asc';
    }
    return 'asc';
  });

  const toggleSortOrder = () => {
    const newOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    setSortOrder(newOrder);
    if (typeof window !== 'undefined') {
      localStorage.setItem('schedule-sort-order', newOrder);
    }
  };

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

  // Sort rows based on current sort order (for flat view)
  // When descending, sort by date DESC but maintain within-day order (typeOrder)
  const sortedTimelineRows = useMemo(() => {
    if (sortOrder === 'desc') {
      const typeOrder = { disbursement: 0, adjustment: 1, due_date: 2, repayment: 3 };
      return [...timelineRows].sort((a, b) => {
        // Sort dates descending (b before a)
        const dateCompare = b.date.localeCompare(a.date);
        if (dateCompare !== 0) return dateCompare;
        // Within same day, keep original type order (ascending)
        // Use ?? instead of || because 0 is a valid typeOrder value
        const aOrder = typeOrder[a.primaryType] ?? 99;
        const bOrder = typeOrder[b.primaryType] ?? 99;
        return aOrder - bOrder;
      });
    }
    return timelineRows;
  }, [timelineRows, sortOrder]);

  // Group rows by month (always use original order, we'll sort groups separately)
  const monthGroups = useMemo(() => {
    const groups = groupRowsByMonth(timelineRows);
    if (sortOrder === 'desc') {
      // Reverse the groups order, and re-sort rows within each group
      // to have dates descending but within-day order preserved
      const typeOrder = { disbursement: 0, adjustment: 1, due_date: 2, repayment: 3 };
      const result = groups.map(group => {
        if (group.isMonthGroup) {
          const sortedRows = [...group.rows].sort((a, b) => {
            const dateCompare = b.date.localeCompare(a.date);
            if (dateCompare !== 0) return dateCompare;
            // Use ?? instead of || because 0 is a valid typeOrder value
            const aOrder = typeOrder[a.primaryType] ?? 99;
            const bOrder = typeOrder[b.primaryType] ?? 99;
            return aOrder - bOrder;
          });
          return { ...group, rows: sortedRows };
        }
        return group;
      }).reverse();
      return result;
    }
    return groups;
  }, [timelineRows, sortOrder]);

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

  // Calculate typical monthly interest from schedule entries for gauge scaling
  const monthlyInterest = useMemo(() => {
    if (!timelineRows || timelineRows.length === 0) return 0;
    // Get all due date entries with positive expected interest (exclude adjustments which can be negative)
    const dueDateInterests = timelineRows
      .filter(r => r.isDueDate && r.primaryType === 'due_date' && r.expectedInterest > 0)
      .map(r => r.expectedInterest);
    if (dueDateInterests.length === 0) return 0;
    // Use the median to avoid outliers from partial periods
    const sorted = [...dueDateInterests].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }, [timelineRows]);

  if (!timelineRows || timelineRows.length === 0) {
    return (
      <div className="text-center text-slate-500 py-8">
        <p>No schedule data available.</p>
        <p className="text-base mt-1">Record transactions to see the schedule timeline.</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs py-0.5 w-80">
              <div className="flex items-center gap-1">
                <span>Date</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={toggleSortOrder}
                      className="h-4 w-4"
                    >
                      {sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {sortOrder === 'asc' ? 'Oldest first (click for newest first)' : 'Newest first (click for oldest first)'}
                  </TooltipContent>
                </Tooltip>
              </div>
            </TableHead>
            <TableHead className="text-xs w-4 py-0.5"></TableHead>
            <TableHead className="text-xs text-right py-0.5">Int Received</TableHead>
            <TableHead className="text-xs text-right py-0.5">Expected</TableHead>
            <TableHead className="text-xs text-right py-0.5">Int Bal</TableHead>
            <TableHead className="text-xs text-right border-r py-0.5">Principal</TableHead>
            <TableHead className="text-xs py-0.5">Calculation</TableHead>
            <TableHead className="text-xs text-right py-0.5">
              <div className="flex items-center justify-end gap-1">
                <span>Prin Bal</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={flatView ? "default" : "ghost"}
                      size="icon"
                      onClick={() => setFlatView(!flatView)}
                      className="h-4 w-4"
                    >
                      {flatView ? <Layers className="w-3 h-3" /> : <List className="w-3 h-3" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {flatView ? 'Switch to Grouped View' : 'Switch to Flat View'}
                  </TooltipContent>
                </Tooltip>
                {!flatView && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={allExpanded ? collapseAll : expandAll}
                        className="h-4 w-4"
                      >
                        <ChevronsUpDown className="w-3 h-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {allExpanded ? 'Collapse All' : 'Expand All'}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {flatView ? (
            /* Flat view - show all rows without month grouping */
            sortedTimelineRows.map((row, idx) => (
              <TimelineRow
                key={row.id}
                row={row}
                product={product}
                isFirst={idx === 0}
                isLast={idx === sortedTimelineRows.length - 1}
                monthlyInterest={monthlyInterest}
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
                    monthlyInterest={monthlyInterest}
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
                    monthlyInterest={monthlyInterest}
                  />
                  {expandedMonths.has(group.monthKey) && group.rows.map((row, idx) => (
                    <TimelineRow
                      key={row.id}
                      row={row}
                      product={product}
                      isFirst={itemIndex === 0 && idx === 0}
                      isLast={itemIndex === monthGroups.length - 1 && idx === group.rows.length - 1}
                      monthlyInterest={monthlyInterest}
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
