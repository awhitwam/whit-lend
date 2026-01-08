/**
 * ReducingBalanceScheduler
 *
 * Standard amortizing loan scheduler where interest is calculated on
 * the reducing principal balance. Uses standard amortization formula
 * to calculate principal and interest portions of each payment.
 *
 * Extracted from LoanScheduleManager.jsx lines 381-543 and 584-720
 */

import { BaseScheduler } from '../BaseScheduler.js';
import { registerScheduler } from '../registry.js';
import { format, differenceInDays, addMonths, startOfMonth } from 'date-fns';

export class ReducingBalanceScheduler extends BaseScheduler {
  static id = 'reducing_balance';
  static displayName = 'Reducing Balance (Amortizing)';
  static description = 'Standard amortizing loan with principal + interest payments';
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
      // Reducing balance specific settings could go here
    }
  };

  /**
   * Generate schedule for reducing balance (amortizing) loan
   */
  async generateSchedule({ loan, product, options = {} }) {
    console.log('=== SCHEDULE ENGINE: Reducing Balance ===');

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
    const periodRate = this.utils.getPeriodicRate(effectiveRate, product.period || 'Monthly');
    const period = product.period || 'Monthly';
    const useMonthlyFixed = product.interest_calculation_method === 'monthly' && period === 'Monthly';
    const originalLoanDuration = loan.duration;

    console.log('Reducing Balance Config:', {
      duration,
      effectiveRate,
      originalPrincipal,
      useMonthlyFixed,
      periodRate,
      interestAlignment: product.interest_alignment
    });

    // Check if we should use monthly_first alignment
    if (product.interest_alignment === 'monthly_first' && period === 'Monthly') {
      return this.generateMonthlyFirstSchedule({
        loan, product, transactions, duration, effectiveRate,
        originalPrincipal, dailyRate, periodRate, endDate, isSettledLoan, originalLoanDuration
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

    console.log('Event Timeline:', events.map(e => ({
      date: format(e.date, 'yyyy-MM-dd'),
      type: e.type,
      amount: e.amount
    })));

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

      // Calculate principal portion using amortization formula
      const principalForPeriod = this.calculateAmortizedPrincipal({
        principalAtStart,
        totalInterestForPeriod,
        periodRate,
        remainingPeriods: duration - i + 1
      });

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
        calculationPrincipalStart: principalAtStart,
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

    console.log('=== SCHEDULE ENGINE: Reducing Balance Complete ===');

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
    originalPrincipal, dailyRate, periodRate, endDate, isSettledLoan, originalLoanDuration
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
        dailyRate,
        periodStart: startDate,
        periodEnd: firstOfNextMonth,
        capitalEvents: capitalEventsInPeriod
      });

      const daysInFirstPeriod = differenceInDays(firstOfNextMonth, startDate);
      const firstPeriodDueDate = product.interest_paid_in_advance ? startDate : firstOfNextMonth;

      // First period typically interest-only (no principal)
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
        dailyRate,
        periodStart,
        periodEnd,
        capitalEvents: capitalEventsInPeriod
      });

      // Calculate principal using amortization
      const remainingPeriods = duration - monthOffset + 1;
      const principalForPeriod = this.calculateAmortizedPrincipal({
        principalAtStart,
        totalInterestForPeriod: totalInterest,
        periodRate,
        remainingPeriods
      });

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
        // Reducing balance uses current principal
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
        totalInterest += segmentPrincipal * dailyRate * daysInSegment;
        console.log(`  Segment: ${format(segmentStart, 'MMM dd')} to ${format(eventDate, 'MMM dd')}, ${daysInSegment} days, Principal=${segmentPrincipal.toFixed(2)}, Interest=${(segmentPrincipal * dailyRate * daysInSegment).toFixed(2)}`);
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
      const finalInterest = segmentPrincipal * dailyRate * finalDays;
      totalInterest += finalInterest;
      console.log(`  Final Segment: ${format(segmentStart, 'MMM dd')} to ${format(periodEnd, 'MMM dd')}, ${finalDays} days, Principal=${segmentPrincipal.toFixed(2)}, Interest=${finalInterest.toFixed(2)}`);
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
   * Calculate amortized principal payment using standard formula
   */
  calculateAmortizedPrincipal({
    principalAtStart,
    totalInterestForPeriod,
    periodRate,
    remainingPeriods
  }) {
    if (principalAtStart <= 0 || remainingPeriods <= 0) {
      return 0;
    }

    // Standard amortization formula: P * (r(1+r)^n) / ((1+r)^n - 1)
    const factor = Math.pow(1 + periodRate, remainingPeriods);
    const periodicPayment = principalAtStart * (periodRate * factor) / (factor - 1);

    // Principal portion = total payment - interest
    return Math.max(0, periodicPayment - totalInterestForPeriod);
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
   * Calculate principal portion for amortizing schedule
   */
  calculatePrincipalPortion({ principalAtStart, interestForPeriod, periodNumber, totalPeriods, annualRate, period }) {
    const periodRate = this.utils.getPeriodicRate(annualRate, period);
    return this.calculateAmortizedPrincipal({
      principalAtStart,
      totalInterestForPeriod: interestForPeriod,
      periodRate,
      remainingPeriods: totalPeriods - periodNumber + 1
    });
  }
}

// Register the scheduler
registerScheduler(ReducingBalanceScheduler);
