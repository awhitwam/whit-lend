/**
 * InterestOnlyScheduler
 *
 * For interest-only loans where only interest is paid each period,
 * with the full principal due as a balloon payment on the final period.
 *
 * Extracted from LoanScheduleManager.jsx lines 505-510 and period loop 381-543
 */

import { api } from '@/api/dataClient';
import { BaseScheduler } from '../BaseScheduler.js';
import { registerScheduler } from '../registry.js';
import { format, differenceInDays, addMonths, startOfMonth, addWeeks } from 'date-fns';

// ViewComponent is set by InterestOnlyScheduleView.jsx when it loads (avoids circular import)
let InterestOnlyScheduleViewComponent = null;

export class InterestOnlyScheduler extends BaseScheduler {
  static id = 'interest_only';
  static displayName = 'Interest-Only (Balloon)';
  static description = 'Interest payments each period, principal balloon at end';
  static category = 'interest-only';
  static generatesSchedule = true;

  /**
   * Custom view component - InterestOnlyScheduleView provides reality vs expectations view
   * Set by InterestOnlyScheduleView.jsx via self-registration to avoid circular imports
   */
  static get ViewComponent() {
    return InterestOnlyScheduleViewComponent;
  }

  static set ViewComponent(component) {
    InterestOnlyScheduleViewComponent = component;
  }

  static displayConfig = {
    showInterestColumn: true,
    showPrincipalColumn: true,
    interestColumnLabel: 'Interest',
    principalColumnLabel: 'Principal',
    showCalculationDetails: true,
    // Interest-only specific
    showCreditAnnotations: true // Enable credit/overpaid annotations for advance payment
  };

  static configSchema = {
    common: {
      period: {
        type: 'select',
        options: ['Monthly', 'Weekly'],
        default: 'Monthly',
        label: 'Payment Period'
      },
      interest_calculation_method: {
        type: 'select',
        options: ['daily', 'monthly'],
        default: 'daily',
        label: 'Interest Calculation Method'
      },
      interest_paid_in_advance: {
        type: 'boolean',
        default: false,
        label: 'Interest Paid in Advance'
      },
      interest_alignment: {
        type: 'select',
        options: ['period_based', 'monthly_first'],
        default: 'period_based',
        label: 'Interest Alignment'
      }
    },
    specific: {
      // Interest-only specific settings could go here
    }
  };

  /**
   * Generate schedule for interest-only loan
   */
  async generateSchedule({ loan, product, options = {} }) {
    const { transactions } = await this.fetchLoanData(loan.id);
    const principalState = this.calculatePrincipalState(transactions);
    const effectiveRate = this.getEffectiveInterestRate(loan, product);

    const { duration, endDate, isSettledLoan } = this.buildScheduleConfig({
      loan,
      product,
      options,
      currentPrincipalOutstanding: principalState.currentOutstanding
    });

    const startDate = new Date(loan.start_date);
    const originalPrincipal = loan.principal_amount;
    const dailyRate = this.utils.getDailyRate(effectiveRate);
    const period = product.period || 'Monthly';
    const useMonthlyFixed = product.interest_calculation_method === 'monthly' && period === 'Monthly';
    const originalLoanDuration = loan.duration;

    // Check if we should use monthly_first alignment
    if (product.interest_alignment === 'monthly_first' && period === 'Monthly') {
      return this.generateMonthlyFirstSchedule({
        loan, product, transactions, duration, effectiveRate,
        originalPrincipal, dailyRate, endDate, isSettledLoan, originalLoanDuration,
        options // Pass options through for same-day adjustment
      });
    }

    // Build event timeline for mid-period calculations
    const events = this.utils.buildEventTimeline({
      originalPrincipal,
      transactions,
      startDate,
      period,
      duration
    });

    const schedule = [];

    // Generate period-based schedule
    for (let i = 1; i <= duration; i++) {
      const { periodStart, periodEnd } = this.utils.getPeriodBoundaries(startDate, period, i);

      // Get capital events within this period
      const capitalEventsInPeriod = this.utils.getCapitalEventsInPeriod(events, periodStart, periodEnd);

      // Calculate principal at start and end of period
      const principalAtStart = this.utils.calculatePrincipalAtDate(originalPrincipal, transactions, periodStart);
      const principalAtEnd = this.utils.calculatePrincipalAtDate(originalPrincipal, transactions, periodEnd);

      // Calculate interest for this period
      const totalInterestForPeriod = this.calculatePeriodInterestWithEvents({
        principalAtStart,
        originalPrincipal,
        dailyRate,
        effectiveRate,
        periodStart,
        periodEnd,
        capitalEventsInPeriod,
        useMonthlyFixed,
        period,
        periodNumber: i
      });

      // Interest-only: no principal payments except final balloon
      let principalForPeriod = 0;
      if (i === duration) {
        // Balloon payment on last period
        principalForPeriod = principalAtEnd;
      }

      // Determine due date based on interest_paid_in_advance setting
      const dueDate = product.interest_paid_in_advance ? periodStart : periodEnd;
      const daysInPeriod = differenceInDays(periodEnd, periodStart);
      const isExtensionPeriod = originalLoanDuration ? i > originalLoanDuration : false;

      schedule.push(this.createScheduleEntry({
        installmentNumber: i,
        dueDate,
        principalAmount: principalForPeriod,
        interestAmount: totalInterestForPeriod,
        balance: principalAtEnd,
        calculationDays: daysInPeriod,
        calculationPrincipalStart: principalAtStart,
        isExtensionPeriod
      }));

    }

    // Filter for settled loans
    let finalSchedule = schedule;
    if (isSettledLoan) {
      finalSchedule = schedule.filter(row => {
        const dueDate = new Date(row.due_date);
        return dueDate <= endDate;
      });
    }

    // For interest_paid_in_advance loans, create same-day adjustment entries for ALL mid-period capital changes
    if (product.interest_paid_in_advance) {
      const adjustmentEntries = this.createAllSameDayAdjustmentEntries({
        loan,
        product,
        transactions,
        originalPrincipal,
        dailyRate,
        schedule: finalSchedule
      });

      if (adjustmentEntries.length > 0) {

        // Insert each adjustment entry at the correct position (by date)
        for (const adjustmentEntry of adjustmentEntries) {
          const adjustmentDate = new Date(adjustmentEntry.due_date);
          const insertIndex = finalSchedule.findIndex(row =>
            new Date(row.due_date) > adjustmentDate
          );
          if (insertIndex >= 0) {
            finalSchedule.splice(insertIndex, 0, adjustmentEntry);
          } else {
            finalSchedule.push(adjustmentEntry);
          }
        }
      }
    }

    // Save schedule
    await this.saveSchedule(loan.id, finalSchedule);

    // Calculate totals
    const summary = this.calculateSummary(
      finalSchedule,
      principalState.currentOutstanding,
      loan.exit_fee
    );

    // Update loan
    await this.updateLoanTotals(loan.id, {
      totalInterest: summary.totalInterest,
      totalRepayable: summary.totalRepayable,
      effectiveInterestRate: effectiveRate,
      product
    });

    return {
      loan,
      schedule: finalSchedule,
      summary
    };
  }

  /**
   * Generate monthly-first aligned schedule
   * All due dates fall on 1st of month
   */
  async generateMonthlyFirstSchedule({
    loan, product, transactions, duration, effectiveRate,
    originalPrincipal, dailyRate, endDate, isSettledLoan, originalLoanDuration,
    options = {}
  }) {
    const startDate = new Date(loan.start_date);
    const schedule = [];
    let installmentNum = 1;

    // First period: pro-rated from start date to 1st of next month (if not already 1st)
    if (startDate.getDate() !== 1) {
      const firstOfNextMonth = startOfMonth(addMonths(startDate, 1));
      const principalAtStart = this.utils.calculatePrincipalAtDate(originalPrincipal, transactions, startDate);

      // Calculate pro-rated interest for first partial month
      const capitalEventsInPeriod = transactions.filter(t =>
        (t.type === 'Repayment' && t.principal_applied > 0) &&
        new Date(t.date) >= startDate &&
        new Date(t.date) < firstOfNextMonth
      );

      const totalInterest = this.calculateInterestWithSegments({
        principalAtStart,
        originalPrincipal,
        dailyRate,
        periodStart: startDate,
        periodEnd: firstOfNextMonth,
        capitalEvents: capitalEventsInPeriod
      });

      const daysInFirstPeriod = differenceInDays(firstOfNextMonth, startDate);
      const firstPeriodDueDate = product.interest_paid_in_advance ? startDate : firstOfNextMonth;

      schedule.push(this.createScheduleEntry({
        installmentNumber: installmentNum++,
        dueDate: firstPeriodDueDate,
        principalAmount: 0,
        interestAmount: totalInterest,
        balance: principalAtStart,
        calculationDays: daysInFirstPeriod,
        calculationPrincipalStart: principalAtStart,
        isExtensionPeriod: false
      }));
    }

    // Subsequent periods: aligned to 1st of each month
    for (let monthOffset = 1; monthOffset <= duration; monthOffset++) {
      const periodStart = monthOffset === 1
        ? startOfMonth(addMonths(startDate, 1))
        : addMonths(startOfMonth(startDate), monthOffset);
      const periodEnd = addMonths(periodStart, 1);

      const principalAtStart = this.utils.calculatePrincipalAtDate(originalPrincipal, transactions, periodStart);
      const principalAtEnd = this.utils.calculatePrincipalAtDate(originalPrincipal, transactions, periodEnd);

      // Calculate interest with mid-period events
      const capitalEventsInPeriod = transactions.filter(t =>
        (t.type === 'Repayment' && t.principal_applied > 0) &&
        new Date(t.date) >= periodStart &&
        new Date(t.date) < periodEnd
      );

      const totalInterest = this.calculateInterestWithSegments({
        principalAtStart,
        originalPrincipal,
        dailyRate,
        periodStart,
        periodEnd,
        capitalEvents: capitalEventsInPeriod
      });

      // Balloon payment on last period
      let principalForPeriod = 0;
      if (monthOffset === duration) {
        principalForPeriod = principalAtEnd;
      }

      const daysInPeriod = differenceInDays(periodEnd, periodStart);
      const dueDate = product.interest_paid_in_advance ? periodStart : periodEnd;
      const isExtensionPeriod = originalLoanDuration ? installmentNum > originalLoanDuration : false;

      schedule.push(this.createScheduleEntry({
        installmentNumber: installmentNum++,
        dueDate,
        principalAmount: principalForPeriod,
        interestAmount: totalInterest,
        balance: principalAtEnd,
        calculationDays: daysInPeriod,
        calculationPrincipalStart: principalAtStart,
        isExtensionPeriod
      }));
    }

    // Filter for settled loans
    let finalSchedule = schedule;
    if (isSettledLoan) {
      finalSchedule = schedule.filter(row => {
        const dueDate = new Date(row.due_date);
        return dueDate <= endDate;
      });
    }

    // For interest_paid_in_advance loans, create same-day adjustment entries for ALL mid-period capital changes
    if (product.interest_paid_in_advance) {
      const adjustmentEntries = this.createAllSameDayAdjustmentEntries({
        loan,
        product,
        transactions,
        originalPrincipal,
        dailyRate,
        schedule: finalSchedule
      });

      if (adjustmentEntries.length > 0) {

        // Insert each adjustment entry at the correct position (by date)
        for (const adjustmentEntry of adjustmentEntries) {
          const adjustmentDate = new Date(adjustmentEntry.due_date);
          const insertIndex = finalSchedule.findIndex(row =>
            new Date(row.due_date) > adjustmentDate
          );
          if (insertIndex >= 0) {
            finalSchedule.splice(insertIndex, 0, adjustmentEntry);
          } else {
            finalSchedule.push(adjustmentEntry);
          }
        }
      }
    }

    // Save schedule
    await this.saveSchedule(loan.id, finalSchedule);

    const summary = this.calculateSummary(
      finalSchedule,
      this.calculatePrincipalState(transactions).currentOutstanding,
      loan.exit_fee
    );

    await this.updateLoanTotals(loan.id, {
      totalInterest: summary.totalInterest,
      totalRepayable: summary.totalRepayable,
      effectiveInterestRate: effectiveRate,
      product
    });

    return { loan, schedule: finalSchedule, summary };
  }

  /**
   * Calculate interest for a period accounting for mid-period capital events
   */
  calculatePeriodInterestWithEvents({
    principalAtStart,
    originalPrincipal,
    dailyRate,
    effectiveRate,
    periodStart,
    periodEnd,
    capitalEventsInPeriod,
    useMonthlyFixed,
    period,
    periodNumber
  }) {
    if (useMonthlyFixed && periodNumber > 1) {
      // Monthly fixed calculation
      if (capitalEventsInPeriod.length === 0) {
        // Interest-only uses current principal (not flat)
        return principalAtStart * (effectiveRate / 100 / 12);
      } else {
        // Weighted average for mid-period changes
        return this.calculateWeightedMonthlyInterest({
          principalAtStart,
          periodStart,
          periodEnd,
          capitalEventsInPeriod,
          effectiveRate
        });
      }
    } else {
      // Daily calculation
      return this.calculateInterestWithSegments({
        principalAtStart,
        originalPrincipal,
        dailyRate,
        periodStart,
        periodEnd,
        capitalEvents: capitalEventsInPeriod
      });
    }
  }

  /**
   * Calculate interest using daily segments for mid-period events
   */
  calculateInterestWithSegments({
    principalAtStart,
    originalPrincipal,
    dailyRate,
    periodStart,
    periodEnd,
    capitalEvents
  }) {
    let totalInterest = 0;
    let segmentStart = periodStart;
    let segmentPrincipal = principalAtStart;

    const sortedEvents = [...capitalEvents].sort((a, b) => new Date(a.date) - new Date(b.date));

    for (const event of sortedEvents) {
      const eventDate = new Date(event.date);
      const daysInSegment = Math.max(0, differenceInDays(eventDate, segmentStart));

      if (daysInSegment > 0 && segmentPrincipal > 0) {
        // Interest-only uses current principal
        totalInterest += segmentPrincipal * dailyRate * daysInSegment;
      }

      // Update principal for next segment
      if (event.type === 'capital_repayment') {
        segmentPrincipal -= event.principal_applied || event.amount || 0;
      } else if (event.type === 'disbursement') {
        segmentPrincipal += event.amount || 0;
      }
      segmentPrincipal = Math.max(0, segmentPrincipal);
      segmentStart = eventDate;
    }

    // Final segment from last event to period end
    const finalDays = Math.max(0, differenceInDays(periodEnd, segmentStart));
    if (finalDays > 0 && segmentPrincipal > 0) {
      totalInterest += segmentPrincipal * dailyRate * finalDays;
    }

    return totalInterest;
  }

  /**
   * Calculate weighted average interest for monthly fixed with mid-period events
   */
  calculateWeightedMonthlyInterest({
    principalAtStart,
    periodStart,
    periodEnd,
    capitalEventsInPeriod,
    effectiveRate
  }) {
    let currentSegmentStart = periodStart;
    let currentSegmentPrincipal = principalAtStart;
    let totalDaysWithPrincipal = 0;
    let weightedPrincipalDays = 0;

    const sortedEvents = [...capitalEventsInPeriod].sort((a, b) => a.date - b.date);

    for (const event of sortedEvents) {
      const daysInSegment = Math.max(0, differenceInDays(event.date, currentSegmentStart));
      if (daysInSegment > 0) {
        totalDaysWithPrincipal += daysInSegment;
        weightedPrincipalDays += currentSegmentPrincipal * daysInSegment;
      }

      if (event.type === 'capital_repayment') {
        currentSegmentPrincipal -= event.amount;
      } else if (event.type === 'disbursement') {
        currentSegmentPrincipal += event.amount;
      }
      currentSegmentPrincipal = Math.max(0, currentSegmentPrincipal);
      currentSegmentStart = event.date;
    }

    // Final segment to period end
    const finalDays = Math.max(0, differenceInDays(periodEnd, currentSegmentStart));
    if (finalDays > 0) {
      totalDaysWithPrincipal += finalDays;
      weightedPrincipalDays += currentSegmentPrincipal * finalDays;
    }

    const avgPrincipal = totalDaysWithPrincipal > 0
      ? weightedPrincipalDays / totalDaysWithPrincipal
      : principalAtStart;

    return avgPrincipal * (effectiveRate / 100 / 12);
  }

  /**
   * Standard period interest calculation
   */
  calculatePeriodInterest({ principal, annualRate, periodStart, periodEnd }) {
    const dailyRate = this.utils.getDailyRate(annualRate);
    const days = differenceInDays(periodEnd, periodStart);
    return principal * dailyRate * days;
  }

  /**
   * Interest-only loans don't have periodic principal payments
   * except balloon on final period
   */
  calculatePrincipalPortion({ periodNumber, totalPeriods, principalAtEnd }) {
    if (periodNumber === totalPeriods) {
      return principalAtEnd;
    }
    return 0;
  }

  // ============ Same-Day Adjustment Methods (Interest Paid in Advance) ============

  /**
   * Fetch existing schedule entries for a loan
   * Used to preserve past paid entries during regeneration
   */
  async fetchExistingSchedule(loanId) {
    const entries = await api.entities.RepaymentSchedule.filter({ loan_id: loanId }, 'due_date');
    return entries || [];
  }

  /**
   * Find which period a given date falls within
   * For monthly_first alignment, periods run from 1st to 1st of each month
   * @param {Date} startDate - Loan start date
   * @param {string} period - 'Monthly' or 'Weekly'
   * @param {Date} targetDate - Date to find period for
   * @param {Object} product - Product config (to check interest_alignment)
   * @returns {Object|null} { periodStart, periodEnd, periodNum }
   */
  findPeriodContainingDate(startDate, period, targetDate, product = null) {
    // For monthly_first alignment, use calendar month boundaries
    if (product?.interest_alignment === 'monthly_first' && period === 'Monthly') {
      return this.findMonthlyFirstPeriodContainingDate(startDate, targetDate);
    }

    // Standard period calculation based on loan start date
    let periodNum = 1;
    const maxPeriods = 1000; // Safety limit

    while (periodNum <= maxPeriods) {
      const { periodStart, periodEnd } = this.utils.getPeriodBoundaries(startDate, period, periodNum);

      if (targetDate >= periodStart && targetDate < periodEnd) {
        return { periodStart, periodEnd, periodNum };
      }

      if (periodEnd > targetDate) break;
      periodNum++;
    }

    return null;
  }

  /**
   * Find period boundaries for monthly_first alignment
   * Periods run from 1st of month to 1st of next month
   */
  findMonthlyFirstPeriodContainingDate(loanStartDate, targetDate) {
    // Normalize target date
    const target = new Date(targetDate);
    target.setHours(0, 0, 0, 0);

    // Get the 1st of the month containing the target date
    const periodStart = startOfMonth(target);

    // Period ends on 1st of next month
    const periodEnd = startOfMonth(addMonths(target, 1));

    // Calculate period number (months since loan start)
    const loanStart = new Date(loanStartDate);
    loanStart.setHours(0, 0, 0, 0);

    // Period 1 starts from loan start to first of next month
    // Period 2+ are full calendar months
    const firstPeriodEnd = startOfMonth(addMonths(loanStart, 1));

    let periodNum;
    if (target < firstPeriodEnd) {
      periodNum = 1;
    } else {
      // Count months from first period end
      const monthsDiff = (target.getFullYear() - firstPeriodEnd.getFullYear()) * 12
        + (target.getMonth() - firstPeriodEnd.getMonth());
      periodNum = 2 + monthsDiff;
    }

    console.log(`[Schedule] findMonthlyFirstPeriodContainingDate: target=${format(target, 'yyyy-MM-dd')}, periodStart=${format(periodStart, 'yyyy-MM-dd')}, periodEnd=${format(periodEnd, 'yyyy-MM-dd')}, periodNum=${periodNum}`);

    return { periodStart, periodEnd, periodNum };
  }

  /**
   * Create adjustment entries for ALL mid-period capital changes
   * Scans all transactions and creates adjustment entries for any capital change
   * that falls mid-period (not on a due date).
   *
   * @returns {Array} Array of adjustment schedule entries
   */
  createAllSameDayAdjustmentEntries({
    loan, product, transactions, originalPrincipal, dailyRate, schedule
  }) {
    const startDate = new Date(loan.start_date);
    const period = product.period || 'Monthly';
    const adjustmentEntries = [];

    // Get all schedule due dates for quick lookup
    const dueDates = new Set(schedule.map(row => row.due_date));

    // Find all capital-changing transactions (disbursements after start, repayments with principal)
    const capitalChangeTxs = transactions.filter(t => {
      if (t.type === 'Disbursement') {
        // Only include disbursements AFTER loan start (further advances)
        const txDate = new Date(t.date);
        txDate.setHours(0, 0, 0, 0);
        const loanStart = new Date(startDate);
        loanStart.setHours(0, 0, 0, 0);
        return txDate > loanStart;
      }
      if (t.type === 'Repayment' && t.principal_applied > 0) {
        return true;
      }
      return false;
    });

    // For each capital change, check if it falls mid-period (not on a due date)
    for (const tx of capitalChangeTxs) {
      const txDate = new Date(tx.date);
      const txDateStr = format(txDate, 'yyyy-MM-dd');

      // Skip if this transaction falls on a due date (not mid-period)
      if (dueDates.has(txDateStr)) {
        continue;
      }

      // Find which period this falls in (pass product for monthly_first alignment)
      const periodInfo = this.findPeriodContainingDate(startDate, period, txDate, product);
      if (!periodInfo) {
        console.log(`[Schedule] Skipping ${tx.type} on ${txDateStr} - could not find containing period`);
        continue;
      }

      const { periodStart, periodEnd } = periodInfo;

      // Calculate days remaining in period after capital change
      const daysRemaining = differenceInDays(periodEnd, txDate);
      console.log(`[Schedule] ${tx.type} on ${txDateStr}: periodEnd=${format(periodEnd, 'yyyy-MM-dd')}, daysRemaining=${daysRemaining}`);
      if (daysRemaining <= 0) {
        console.log(`[Schedule] Skipping ${tx.type} on ${txDateStr} - no days remaining (periodEnd=${format(periodEnd, 'yyyy-MM-dd')})`);
        continue;
      }

      // Calculate principal BEFORE this transaction
      const transactionsBeforeThis = transactions.filter(t => {
        if (t.id === tx.id) return false;
        return new Date(t.date) < txDate;
      });

      const principalBefore = this.utils.calculatePrincipalAtDate(
        originalPrincipal,
        transactionsBeforeThis,
        txDate
      );

      // Calculate the change amount
      const principalChange = tx.type === 'Disbursement'
        ? tx.amount
        : -(tx.principal_applied || 0);

      const principalAfter = principalBefore + principalChange;

      // Calculate interest difference for remaining days
      const oldDailyInterest = principalBefore * dailyRate;
      const newDailyInterest = principalAfter * dailyRate;
      const interestDifference = (newDailyInterest - oldDailyInterest) * daysRemaining;

      // Round to 2 decimal places
      const roundedDifference = Math.round(interestDifference * 100) / 100;

      // Only create entry if there's a meaningful adjustment
      if (Math.abs(roundedDifference) < 0.01) {
        continue;
      }

      adjustmentEntries.push({
        installment_number: 0, // Special adjustment entry
        due_date: txDateStr,
        principal_amount: 0,
        interest_amount: roundedDifference,
        total_due: roundedDifference,
        balance: Math.max(0, Math.round(principalAfter * 100) / 100),
        principal_paid: 0,
        interest_paid: 0,
        status: 'Pending',
        calculation_days: daysRemaining,
        calculation_principal_start: Math.round(principalBefore * 100) / 100,
        is_extension_period: false,
        is_adjustment_entry: true,
        adjustment_type: roundedDifference < 0 ? 'credit' : 'debit',
        adjustment_reason: tx.type === 'Disbursement'
          ? 'Further advance - additional interest due for remaining days'
          : 'Capital repayment - interest credit for remaining days'
      });
    }

    // Sort by date
    adjustmentEntries.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

    return adjustmentEntries;
  }

  /**
   * Create a same-day adjustment entry for capital changes mid-period
   * Only applies to interest_paid_in_advance loans
   *
   * For capital repayment: Creates a CREDIT (negative interest) because borrower overpaid
   * For further advance: Creates a DEBIT (positive interest) because borrower underpaid
   *
   * @returns {Object|null} Schedule entry with credit (negative) or debit (positive) amount
   */
  createSameDayAdjustmentEntry({
    loan, product, transactions, capitalChangeDate,
    originalPrincipal, dailyRate
  }) {
    const startDate = new Date(loan.start_date);
    const period = product.period || 'Monthly';

    // Find which period the capital change falls in (pass product for monthly_first alignment)
    const periodInfo = this.findPeriodContainingDate(startDate, period, capitalChangeDate, product);
    if (!periodInfo) {
      return null;
    }

    const { periodStart, periodEnd } = periodInfo;

    // Calculate days remaining in period after capital change
    const daysRemaining = differenceInDays(periodEnd, capitalChangeDate);
    if (daysRemaining <= 0) {
      return null;
    }

    // Calculate principal BEFORE the capital change (excluding the change itself)
    // We need to find the transaction and exclude it from the calculation
    const capitalChangeTx = transactions.find(t => {
      const txDate = format(new Date(t.date), 'yyyy-MM-dd');
      const changeDate = format(capitalChangeDate, 'yyyy-MM-dd');
      return txDate === changeDate &&
        (t.type === 'Disbursement' || (t.type === 'Repayment' && t.principal_applied > 0));
    });

    if (!capitalChangeTx) {
      return null;
    }

    // Calculate principal before this transaction
    const transactionsBeforeChange = transactions.filter(t => {
      if (t.id === capitalChangeTx.id) return false;
      return new Date(t.date) < capitalChangeDate;
    });

    const principalBefore = this.utils.calculatePrincipalAtDate(
      originalPrincipal,
      transactionsBeforeChange,
      capitalChangeDate
    );

    // Calculate the change amount
    const principalChange = capitalChangeTx.type === 'Disbursement'
      ? capitalChangeTx.amount
      : -(capitalChangeTx.principal_applied || 0);

    const principalAfter = principalBefore + principalChange;

    // Calculate interest difference for remaining days
    // If capital decreased (repayment): new daily interest < old daily interest → negative difference (credit)
    // If capital increased (advance): new daily interest > old daily interest → positive difference (debit)
    const oldDailyInterest = principalBefore * dailyRate;
    const newDailyInterest = principalAfter * dailyRate;
    const interestDifference = (newDailyInterest - oldDailyInterest) * daysRemaining;

    // Round to 2 decimal places
    const roundedDifference = Math.round(interestDifference * 100) / 100;

    // Only create entry if there's a meaningful adjustment
    if (Math.abs(roundedDifference) < 0.01) return null;

    return {
      installment_number: 0, // Special adjustment entry
      due_date: format(capitalChangeDate, 'yyyy-MM-dd'),
      principal_amount: 0,
      interest_amount: roundedDifference,
      total_due: roundedDifference,
      balance: Math.max(0, Math.round(principalAfter * 100) / 100),
      principal_paid: 0,
      interest_paid: 0,
      status: 'Pending',
      calculation_days: daysRemaining,
      calculation_principal_start: Math.round(principalBefore * 100) / 100,
      is_extension_period: false,
      is_adjustment_entry: true,
      adjustment_type: roundedDifference < 0 ? 'credit' : 'debit',
      adjustment_reason: capitalChangeTx.type === 'Disbursement'
        ? 'Further advance - additional interest due for remaining days'
        : 'Capital repayment - interest credit for remaining days'
    };
  }

  /**
   * Enhanced saveSchedule that preserves past paid entries
   * and can insert same-day adjustment entries
   */
  async saveScheduleWithPreservation(loanId, newSchedule, options = {}) {
    const { capitalChangeDate, preservePaidEntries = true } = options;

    if (!preservePaidEntries) {
      // Standard save - delete all and recreate
      return this.saveSchedule(loanId, newSchedule);
    }

    // Fetch existing schedule
    const existingSchedule = await this.fetchExistingSchedule(loanId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Identify entries to preserve (past + paid)
    const preservedEntries = existingSchedule.filter(entry => {
      const dueDate = new Date(entry.due_date);
      dueDate.setHours(0, 0, 0, 0);
      // Preserve entries that are in the past AND marked as paid
      return dueDate < today && entry.status === 'Paid';
    });

    // Get due dates of preserved entries to avoid duplicates
    const preservedDates = new Set(preservedEntries.map(e => e.due_date));

    // Filter new schedule to exclude dates that are preserved
    const filteredNewSchedule = newSchedule.filter(entry => !preservedDates.has(entry.due_date));

    // Combine preserved + new (sorted by date)
    const combinedSchedule = [...preservedEntries, ...filteredNewSchedule].sort((a, b) => {
      return new Date(a.due_date) - new Date(b.due_date);
    });

    // Re-number installments
    combinedSchedule.forEach((entry, idx) => {
      if (!entry.is_adjustment_entry) {
        entry.installment_number = idx + 1;
      }
    });

    // Delete old and save new
    await api.entities.RepaymentSchedule.deleteWhere({ loan_id: loanId });
    const scheduleWithLoanId = combinedSchedule.map(row => ({
      loan_id: loanId,
      ...row
    }));
    await api.entities.RepaymentSchedule.createMany(scheduleWithLoanId);

    return combinedSchedule;
  }

  // ============ Display Methods ============

  /**
   * Format period description for interest-only loans
   * Handles advance payment credit/overpaid annotations
   */
  formatPeriodDescription({ row, loan, product, periodContext = {} }) {
    const days = row.calculation_days || 0;
    const principalStart = row.calculation_principal_start || 0;
    const rate = loan?.interest_rate || product?.interest_rate || 0;
    const dailyRate = principalStart * (rate / 100 / 365);

    // Base description
    let description = `${days}d × £${dailyRate.toFixed(2)}/day`;

    // For arrears payment, no special annotations needed
    if (!product?.interest_paid_in_advance) {
      return {
        description,
        annotation: null,
        annotationType: null
      };
    }

    // For advance payment, check for capital changes and credits
    const { capitalChanged, overpaidDays, overpaidAmount, creditFromPrior, adjustedInterest } = periodContext;

    if (capitalChanged && overpaidDays > 0 && overpaidAmount > 0) {
      // This period had a capital change - overpaid some days
      return {
        description,
        annotation: `Overpaid ${overpaidDays}d @ £${(overpaidAmount / overpaidDays).toFixed(2)}/day → credited next`,
        annotationType: 'overpaid'
      };
    }

    if (creditFromPrior > 0) {
      // This period receives a credit from prior overpayment
      return {
        description: `${description} - £${creditFromPrior.toFixed(2)} credit`,
        annotation: `Credit from prior period`,
        annotationType: 'credit'
      };
    }

    return {
      description,
      annotation: null,
      annotationType: null
    };
  }

  /**
   * Calculate period-to-period adjustments for advance payment loans
   * Tracks overpayments from capital changes and credits them to following periods
   */
  calculatePeriodAdjustments({ schedule, loan, product, transactions }) {
    // Only applies to advance payment loans
    if (!product?.interest_paid_in_advance) {
      return schedule;
    }

    const adjustedSchedule = [...schedule];
    let pendingCredit = 0;
    const rate = loan?.interest_rate || product?.interest_rate || 0;
    const dailyRate = rate / 100 / 365;

    for (let i = 0; i < adjustedSchedule.length; i++) {
      const row = adjustedSchedule[i];
      const periodStart = new Date(row.due_date);
      const periodEnd = i < adjustedSchedule.length - 1
        ? new Date(adjustedSchedule[i + 1].due_date)
        : new Date(periodStart);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      // Find capital changes within this period
      const capitalRepayments = transactions.filter(t =>
        t.type === 'Repayment' &&
        t.principal_applied > 0 &&
        new Date(t.date) >= periodStart &&
        new Date(t.date) < periodEnd
      );

      // Apply any pending credit from prior period
      if (pendingCredit > 0) {
        row._creditFromPrior = pendingCredit;
        row._adjustedInterest = Math.max(0, row.interest_amount - pendingCredit);
        pendingCredit = 0;
      }

      // If capital changed mid-period, calculate overpayment
      if (capitalRepayments.length > 0) {
        const principalAtStart = row.calculation_principal_start || 0;

        // Calculate what was overpaid
        for (const repayment of capitalRepayments) {
          const repaymentDate = new Date(repayment.date);
          const daysRemaining = differenceInDays(periodEnd, repaymentDate);
          const principalReduction = repayment.principal_applied;

          // Overpaid interest = days remaining × reduction × daily rate
          const overpaidAmount = daysRemaining * principalReduction * dailyRate;

          if (overpaidAmount > 0) {
            row._capitalChanged = true;
            row._overpaidDays = daysRemaining;
            row._overpaidAmount = overpaidAmount;
            pendingCredit += overpaidAmount;
          }
        }
      }
    }

    return adjustedSchedule;
  }

  /**
   * Explain the scheduler's decision for a specific period
   */
  explainDecision(row, loan, product) {
    const days = row.calculation_days || 0;
    const principal = row.calculation_principal_start || 0;
    const interest = row.interest_amount || 0;
    const rate = loan?.interest_rate || product?.interest_rate || 0;

    let explanation = `Interest-only: ${days} days at ${rate}% on £${principal.toFixed(2)} = £${interest.toFixed(2)}`;

    if (!product?.interest_paid_in_advance) {
      explanation += '. Arrears payment - interest calculated for period just ended.';
      return explanation;
    }

    // Advance payment explanations
    if (row._capitalChanged && row._overpaidAmount > 0) {
      explanation += `. Capital changed mid-period. Advance payment = overpaid ${row._overpaidDays}d at old rate. £${row._overpaidAmount.toFixed(2)} credit carries to next period.`;
    } else if (row._creditFromPrior > 0) {
      explanation += `. Applied £${row._creditFromPrior.toFixed(2)} credit from prior period overpayment. Adjusted interest: £${row._adjustedInterest.toFixed(2)}.`;
    } else {
      explanation += '. Advance payment - interest due at start of period.';
    }

    return explanation;
  }

  /**
   * Get summary string for interest-only scheduler
   */
  static getSummaryString(product) {
    const parts = ['interest_only (Interest-Only)'];

    if (product?.interest_paid_in_advance) {
      parts.push('Advance');
      if (product?.interest_alignment === 'monthly_first') {
        parts.push('1st of Month');
      }
    } else {
      parts.push('Arrears');
    }

    parts.push(product?.interest_calculation_method === 'monthly' ? 'Monthly calc' : 'Daily calc');

    return parts.join(' • ');
  }
}

// Register the scheduler
registerScheduler(InterestOnlyScheduler);
