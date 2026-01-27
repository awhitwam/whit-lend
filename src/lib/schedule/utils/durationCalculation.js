/**
 * Duration Calculation Utilities
 *
 * Logic for calculating schedule duration, including auto-extend behavior.
 * Extracted from LoanScheduleManager.jsx lines 100-168.
 */

import { differenceInDays, addMonths, startOfMonth, format } from 'date-fns';
import { periodsToCoverDays, advancePeriod } from './dateUtils.js';

/**
 * Calculate the schedule duration based on loan settings and current state
 *
 * @param {Object} params
 * @param {Object} params.loan - Loan record
 * @param {Object} params.product - Product record
 * @param {Object} params.options - Generation options
 * @param {number} params.currentPrincipalOutstanding - Current principal balance
 * @returns {Object} { duration, endDate, isSettledLoan }
 */
export function calculateScheduleDuration({ loan, product, options, currentPrincipalOutstanding }) {
  const loanStartDate = new Date(loan.start_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let scheduleEndDate = options.endDate ? new Date(options.endDate) : today;
  scheduleEndDate.setHours(0, 0, 0, 0);

  // Don't treat auto_extend loans as settled - they should always have future periods
  const isSettledLoan = options.endDate && currentPrincipalOutstanding <= 0.01 && !loan.auto_extend;
  const baseDuration = options.duration !== undefined ? options.duration : loan.duration;

  let scheduleDuration;

  if (isSettledLoan) {
    // Settled loan: calculate exact periods from start to settlement date
    const daysToEndDate = Math.max(0, differenceInDays(scheduleEndDate, loanStartDate));
    scheduleDuration = periodsToCoverDays(daysToEndDate, product.period);

    // Ensure at least 1 period
    scheduleDuration = Math.max(1, scheduleDuration);

    console.log('Settled loan: truncating schedule at settlement date');
  } else if (options.endDate && loan.auto_extend) {
    // Auto-extend: generate schedule up to end date AND ensure at least one future period
    const daysToEndDate = Math.max(0, differenceInDays(scheduleEndDate, loanStartDate));
    let calculatedDuration = periodsToCoverDays(daysToEndDate, product.period);

    console.log('Auto-extend DEBUG:', {
      loanStartDate: format(loanStartDate, 'yyyy-MM-dd'),
      scheduleEndDate: format(scheduleEndDate, 'yyyy-MM-dd'),
      daysToEndDate,
      calculatedDuration,
      interestAlignment: product.interest_alignment
    });

    // Ensure at least 1 period
    calculatedDuration = Math.max(1, calculatedDuration);

    // ALWAYS include the next upcoming period so there's a future due date
    // Calculate what the last period's due date would be, and if it's <= today, add one more
    // For "in advance" loans, due date is at START of period (i-1), not END (i)
    let lastPeriodDate;
    if (product.interest_alignment === 'monthly_first') {
      lastPeriodDate = startOfMonth(addMonths(loanStartDate, calculatedDuration));
    } else if (product.interest_paid_in_advance) {
      // In advance: due date for period N is addMonths(start, N-1)
      // So last due date for calculatedDuration periods is addMonths(start, calculatedDuration - 1)
      lastPeriodDate = addMonths(loanStartDate, calculatedDuration - 1);
    } else {
      // Arrears: due date for period N is addMonths(start, N)
      lastPeriodDate = addMonths(loanStartDate, calculatedDuration);
    }

    console.log('Auto-extend DEBUG lastPeriodDate:',
      format(lastPeriodDate, 'yyyy-MM-dd'),
      'vs scheduleEndDate:', format(scheduleEndDate, 'yyyy-MM-dd'),
      'add more?', lastPeriodDate <= scheduleEndDate,
      'inAdvance:', product.interest_paid_in_advance
    );

    if (lastPeriodDate <= scheduleEndDate) {
      calculatedDuration += 1;
    }

    scheduleDuration = calculatedDuration;
    console.log('Auto-extend: generating schedule with', calculatedDuration, 'periods');
  } else if (options.endDate && currentPrincipalOutstanding > 0.01) {
    // Non-auto-extend but has principal outstanding: use full loan duration
    scheduleDuration = baseDuration || 6;
  } else if (options.duration !== undefined) {
    // Explicit duration provided without auto-extend
    scheduleDuration = options.duration;
  } else {
    // Use original loan duration
    scheduleDuration = loan.duration;
  }

  return {
    duration: scheduleDuration,
    endDate: scheduleEndDate,
    isSettledLoan
  };
}

/**
 * Build an event timeline from transactions for interest calculation
 *
 * @param {Object} params
 * @param {number} params.originalPrincipal - Original loan principal
 * @param {Array} params.transactions - All loan transactions
 * @param {Date} params.startDate - Loan start date
 * @param {string} params.period - 'Monthly' or 'Weekly'
 * @param {number} params.duration - Number of periods
 * @returns {Array} Sorted array of events
 */
export function buildEventTimeline({ originalPrincipal, transactions, startDate, period, duration }) {
  const events = [];

  // Add all capital-affecting transactions as events
  transactions.forEach(t => {
    if (t.type === 'Repayment' && t.principal_applied > 0) {
      events.push({
        date: new Date(t.date),
        type: 'capital_repayment',
        amount: t.principal_applied
      });
    } else if (t.type === 'Disbursement') {
      // Only include disbursements AFTER the loan start (further advances)
      // Initial disbursement is already accounted for in loan.principal_amount
      const txDate = new Date(t.date);
      txDate.setHours(0, 0, 0, 0);
      if (txDate > startDate) {
        events.push({
          date: txDate,
          type: 'disbursement',
          amount: t.amount
        });
      }
    }
  });

  // Add all schedule due dates as events
  for (let i = 1; i <= duration; i++) {
    const dueDate = advancePeriod(startDate, period, i);
    events.push({
      date: dueDate,
      type: 'schedule_due',
      periodNumber: i
    });
  }

  // Sort all events chronologically
  events.sort((a, b) => a.date - b.date);

  return events;
}

/**
 * Get capital events within a specific period
 *
 * @param {Array} events - All events from buildEventTimeline
 * @param {Date} periodStart - Period start date
 * @param {Date} periodEnd - Period end date
 * @returns {Array} Capital events within the period
 */
export function getCapitalEventsInPeriod(events, periodStart, periodEnd) {
  return events.filter(e =>
    (e.type === 'capital_repayment' || e.type === 'disbursement') &&
    e.date >= periodStart &&
    e.date < periodEnd
  );
}
