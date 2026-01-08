/**
 * FlatRateScheduler
 *
 * For flat rate loans where interest is always calculated on the
 * ORIGINAL principal amount, not the reducing balance.
 * This results in interest-only style payments.
 *
 * Extracted from LoanScheduleManager.jsx - Flat rate branches
 */

import { BaseScheduler } from '../BaseScheduler.js';
import { registerScheduler } from '../registry.js';
import { format, differenceInDays, addMonths, startOfMonth } from 'date-fns';

export class FlatRateScheduler extends BaseScheduler {
  static id = 'flat_rate';
  static displayName = 'Flat Rate';
  static description = 'Interest calculated on original principal throughout';
  static category = 'standard';
  static generatesSchedule = true;

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
      // Flat rate specific settings could go here
    }
  };

  /**
   * Generate schedule for flat rate loan
   * Interest is always based on original principal
   */
  async generateSchedule({ loan, product, options = {} }) {
    console.log('=== SCHEDULE ENGINE: Flat Rate ===');

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

    console.log('Flat Rate Config:', {
      duration,
      effectiveRate,
      originalPrincipal,
      useMonthlyFixed,
      interestAlignment: product.interest_alignment
    });

    // Check if we should use monthly_first alignment
    if (product.interest_alignment === 'monthly_first' && period === 'Monthly') {
      return this.generateMonthlyFirstSchedule({
        loan, product, transactions, duration, effectiveRate,
        originalPrincipal, dailyRate, endDate, isSettledLoan, originalLoanDuration
      });
    }

    // Build event timeline
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

      // Calculate principal at start and end (for balance tracking)
      const principalAtStart = this.utils.calculatePrincipalAtDate(originalPrincipal, transactions, periodStart);
      const principalAtEnd = this.utils.calculatePrincipalAtDate(originalPrincipal, transactions, periodEnd);

      // Calculate interest for this period - ALWAYS based on original principal
      const totalInterestForPeriod = this.calculateFlatInterest({
        originalPrincipal,
        dailyRate,
        effectiveRate,
        periodStart,
        periodEnd,
        useMonthlyFixed,
        periodNumber: i
      });

      // Flat rate: no principal payments (interest-only behavior)
      const principalForPeriod = 0;

      // Determine due date
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
        calculationPrincipalStart: originalPrincipal, // Always show original for flat
        isExtensionPeriod
      }));

      console.log(`Period ${i} (${format(dueDate, 'yyyy-MM-dd')}): Interest=${totalInterestForPeriod.toFixed(2)}, Principal=${principalForPeriod.toFixed(2)}, Balance=${principalAtEnd.toFixed(2)}`);
    }

    // Filter for settled loans
    let finalSchedule = schedule;
    if (isSettledLoan) {
      finalSchedule = schedule.filter(row => {
        const dueDate = new Date(row.due_date);
        return dueDate <= endDate;
      });
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

    console.log('=== SCHEDULE ENGINE: Flat Rate Complete ===');

    return {
      loan,
      schedule: finalSchedule,
      summary
    };
  }

  /**
   * Generate monthly-first aligned schedule
   */
  async generateMonthlyFirstSchedule({
    loan, product, transactions, duration, effectiveRate,
    originalPrincipal, dailyRate, endDate, isSettledLoan, originalLoanDuration
  }) {
    const startDate = new Date(loan.start_date);
    const schedule = [];
    let installmentNum = 1;

    // First period: pro-rated from start date to 1st of next month (if not already 1st)
    if (startDate.getDate() !== 1) {
      const firstOfNextMonth = startOfMonth(addMonths(startDate, 1));
      const daysInFirstPeriod = differenceInDays(firstOfNextMonth, startDate);

      // Flat rate: always use original principal
      const totalInterest = originalPrincipal * dailyRate * daysInFirstPeriod;

      const firstPeriodDueDate = product.interest_paid_in_advance ? startDate : firstOfNextMonth;

      schedule.push(this.createScheduleEntry({
        installmentNumber: installmentNum++,
        dueDate: firstPeriodDueDate,
        principalAmount: 0,
        interestAmount: totalInterest,
        balance: originalPrincipal,
        calculationDays: daysInFirstPeriod,
        calculationPrincipalStart: originalPrincipal,
        isExtensionPeriod: false
      }));
    }

    // Subsequent periods: aligned to 1st of each month
    for (let monthOffset = 1; monthOffset <= duration; monthOffset++) {
      const periodStart = monthOffset === 1
        ? startOfMonth(addMonths(startDate, 1))
        : addMonths(startOfMonth(startDate), monthOffset);
      const periodEnd = addMonths(periodStart, 1);

      const principalAtEnd = this.utils.calculatePrincipalAtDate(originalPrincipal, transactions, periodEnd);
      const daysInPeriod = differenceInDays(periodEnd, periodStart);

      // Flat rate: always use original principal
      const totalInterest = originalPrincipal * dailyRate * daysInPeriod;

      const dueDate = product.interest_paid_in_advance ? periodStart : periodEnd;
      const isExtensionPeriod = originalLoanDuration ? installmentNum > originalLoanDuration : false;

      schedule.push(this.createScheduleEntry({
        installmentNumber: installmentNum++,
        dueDate,
        principalAmount: 0,
        interestAmount: totalInterest,
        balance: principalAtEnd,
        calculationDays: daysInPeriod,
        calculationPrincipalStart: originalPrincipal,
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

    // Save and return
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
   * Calculate flat rate interest for a period
   * Always uses original principal, regardless of current balance
   */
  calculateFlatInterest({
    originalPrincipal,
    dailyRate,
    effectiveRate,
    periodStart,
    periodEnd,
    useMonthlyFixed,
    periodNumber
  }) {
    if (useMonthlyFixed) {
      // Fixed monthly: original principal × annual rate / 12
      return originalPrincipal * (effectiveRate / 100 / 12);
    } else {
      // Daily: original principal × daily rate × days
      const days = differenceInDays(periodEnd, periodStart);
      return originalPrincipal * dailyRate * days;
    }
  }

  /**
   * Standard period interest calculation for flat rate
   * Always uses original principal
   */
  calculatePeriodInterest({ annualRate, periodStart, periodEnd, originalPrincipal }) {
    const dailyRate = this.utils.getDailyRate(annualRate);
    const days = differenceInDays(periodEnd, periodStart);
    return originalPrincipal * dailyRate * days;
  }

  /**
   * Flat rate loans have no principal payments (interest-only behavior)
   */
  calculatePrincipalPortion() {
    return 0;
  }
}

// Register the scheduler
registerScheduler(FlatRateScheduler);
