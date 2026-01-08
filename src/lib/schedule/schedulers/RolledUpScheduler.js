/**
 * RolledUpScheduler
 *
 * For rolled-up/capitalized interest loans where interest compounds
 * during the loan term and is due as a balloon payment at the end.
 * After the original term, extension periods are interest-only monthly.
 *
 * Extracted from LoanScheduleManager.jsx lines 302-378
 */

import { BaseScheduler } from '../BaseScheduler.js';
import { registerScheduler } from '../registry.js';
import { format, addMonths, differenceInDays } from 'date-fns';

export class RolledUpScheduler extends BaseScheduler {
  static id = 'rolled_up';
  static displayName = 'Rolled-Up (Capitalized)';
  static description = 'Interest compounds during term, balloon payment at end';
  static category = 'interest-only';
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
      }
    },
    specific: {
      // Rolled-up specific settings could go here
    }
  };

  /**
   * Generate schedule for rolled-up interest loan
   *
   * Structure:
   * 1. Single balloon entry at end of original term (principal + all rolled-up interest)
   * 2. Interest-only monthly entries for extension periods
   */
  async generateSchedule({ loan, product, options = {} }) {
    console.log('=== SCHEDULE ENGINE: Rolled-Up Interest ===');

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

    // Use the ORIGINAL loan duration for the roll-up period, not the extended duration
    const originalDuration = loan.duration || options.duration || duration;

    console.log('Rolled-Up Config:', {
      originalDuration,
      extendedDuration: duration,
      effectiveRate,
      originalPrincipal
    });

    const schedule = [];
    let totalRolledUpInterest = 0;
    let finalPrincipal = originalPrincipal;

    // Calculate total rolled-up interest across the ORIGINAL loan duration
    for (let i = 1; i <= originalDuration; i++) {
      const { periodStart, periodEnd } = this.utils.getPeriodBoundaries(startDate, period, i);
      const principalAtStart = this.utils.calculatePrincipalAtDate(originalPrincipal, transactions, periodStart);

      const daysInPeriod = differenceInDays(periodEnd, periodStart);
      const interestForPeriod = principalAtStart * dailyRate * daysInPeriod;
      totalRolledUpInterest += interestForPeriod;
      finalPrincipal = principalAtStart;
    }

    // Single entry at end of ORIGINAL loan period (not extended)
    const loanEndDate = this.utils.advancePeriod(startDate, period, originalDuration);
    const totalDaysInLoan = differenceInDays(loanEndDate, startDate);

    schedule.push(this.createScheduleEntry({
      installmentNumber: 1,
      dueDate: loanEndDate,
      principalAmount: finalPrincipal,
      interestAmount: totalRolledUpInterest,
      balance: finalPrincipal,
      calculationDays: totalDaysInLoan,
      calculationPrincipalStart: originalPrincipal,
      isExtensionPeriod: false
    }));

    // Calculate how many extension periods are needed
    let extensionMonths = 0;
    if (options.endDate || loan.auto_extend) {
      const monthsFromLoanEnd = period === 'Monthly'
        ? Math.ceil(differenceInDays(endDate, loanEndDate) / 30.44)
        : Math.ceil(differenceInDays(endDate, loanEndDate) / 7);
      // Only add extension months if endDate is after loanEndDate
      extensionMonths = Math.max(0, monthsFromLoanEnd);
    } else {
      // If not auto-extend and no endDate, default to 12 months of extensions
      extensionMonths = 12;
    }

    // Add interest-only payments after loan period ends (extension periods)
    for (let i = 1; i <= extensionMonths; i++) {
      const periodStart = i === 1 ? loanEndDate : addMonths(loanEndDate, i - 1);
      const dueDate = addMonths(loanEndDate, i);
      const daysInPeriod = differenceInDays(dueDate, periodStart);
      const periodInterest = finalPrincipal * dailyRate * daysInPeriod;

      schedule.push(this.createScheduleEntry({
        installmentNumber: 1 + i,
        dueDate: dueDate,
        principalAmount: 0,
        interestAmount: periodInterest,
        balance: finalPrincipal,
        calculationDays: daysInPeriod,
        calculationPrincipalStart: finalPrincipal,
        isExtensionPeriod: true
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

    console.log('=== SCHEDULE ENGINE: Rolled-Up Complete ===');
    console.log(`Generated ${finalSchedule.length} schedule entries`);
    finalSchedule.forEach((row, idx) => {
      console.log(`  [${idx + 1}] ${row.due_date}: Principal=${row.principal_amount}, Interest=${row.interest_amount}, Balance=${row.balance}`);
    });

    return {
      loan,
      schedule: finalSchedule,
      summary
    };
  }

  /**
   * Calculate interest for a period using daily calculation
   * For rolled-up, interest is calculated on current balance
   */
  calculatePeriodInterest({ principal, annualRate, periodStart, periodEnd, capitalEvents, originalPrincipal }) {
    const dailyRate = this.utils.getDailyRate(annualRate);
    const days = differenceInDays(periodEnd, periodStart);
    return principal * dailyRate * days;
  }

  /**
   * Rolled-up loans don't have periodic principal payments
   * All principal is due as balloon at term end
   */
  calculatePrincipalPortion({ periodNumber, totalPeriods, principalAtEnd }) {
    // Only return principal on the final period (balloon)
    if (periodNumber === totalPeriods) {
      return principalAtEnd;
    }
    return 0;
  }
}

// Register the scheduler
registerScheduler(RolledUpScheduler);
