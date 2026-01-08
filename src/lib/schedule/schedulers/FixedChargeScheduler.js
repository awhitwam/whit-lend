/**
 * FixedChargeScheduler
 *
 * For fixed charge facility loans where a fixed monthly fee is charged
 * regardless of principal balance. No interest calculation - just a flat
 * fee per period.
 */

import { BaseScheduler } from '../BaseScheduler.js';
import { registerScheduler } from '../registry.js';

export class FixedChargeScheduler extends BaseScheduler {
  static id = 'fixed_charge';
  static displayName = 'Fixed Charge Facility';
  static description = 'Fixed monthly fee regardless of balance';
  static category = 'special';
  static generatesSchedule = true;

  static configSchema = {
    common: {
      period: {
        type: 'select',
        options: ['Monthly', 'Weekly'],
        default: 'Monthly',
        label: 'Payment Period'
      }
    },
    specific: {
      monthly_charge: {
        type: 'number',
        default: 0,
        label: 'Monthly Charge Amount',
        description: 'Fixed amount charged each period'
      }
    }
  };

  /**
   * Generate schedule for fixed charge facility
   * Each period has the same fixed charge amount
   */
  async generateSchedule({ loan, product, options = {} }) {
    console.log('=== SCHEDULE ENGINE: Fixed Charge Facility ===');

    const { transactions } = await this.fetchLoanData(loan.id);
    const principalState = this.calculatePrincipalState(transactions);
    const effectiveRate = 0; // No interest rate for fixed charge

    const { duration, endDate, isSettledLoan } = this.buildScheduleConfig({
      loan,
      product,
      options,
      currentPrincipalOutstanding: principalState.currentOutstanding
    });

    const startDate = new Date(loan.start_date);
    const monthlyCharge = product.monthly_charge || this.config.monthly_charge || 0;
    const period = product.period || this.config.period || 'Monthly';
    const originalLoanDuration = loan.duration;

    console.log('Fixed Charge Config:', {
      monthlyCharge,
      period,
      duration,
      principal: loan.principal_amount
    });

    const schedule = [];

    // Generate fixed charge entries for each period
    for (let i = 1; i <= duration; i++) {
      const { periodStart, periodEnd } = this.utils.getPeriodBoundaries(startDate, period, i);
      const daysInPeriod = this.utils.differenceInDays(periodEnd, periodStart);

      // Determine if this is an extension period
      const isExtensionPeriod = originalLoanDuration ? i > originalLoanDuration : false;

      schedule.push(this.createScheduleEntry({
        installmentNumber: i,
        dueDate: periodEnd,
        principalAmount: 0, // No principal scheduled for fixed charge
        interestAmount: monthlyCharge, // Use the fixed charge as "interest"
        balance: loan.principal_amount, // Balance remains constant
        calculationDays: daysInPeriod,
        calculationPrincipalStart: loan.principal_amount,
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

    // Save schedule
    await this.saveSchedule(loan.id, finalSchedule);

    // Calculate totals
    const totalCharges = finalSchedule.reduce((sum, row) => sum + row.interest_amount, 0);
    const totalRepayable = totalCharges + principalState.currentOutstanding + (loan.exit_fee || 0);

    // Update loan
    await this.updateLoanTotals(loan.id, {
      totalInterest: totalCharges,
      totalRepayable,
      effectiveInterestRate: effectiveRate,
      product: { ...product, interest_type: 'Fixed Charge' }
    });

    console.log('=== SCHEDULE ENGINE: Fixed Charge Complete ===');

    return {
      loan,
      schedule: finalSchedule,
      summary: {
        totalInterest: totalCharges,
        totalRepayable
      }
    };
  }

  /**
   * Fixed charge - just returns the configured monthly charge
   */
  calculatePeriodInterest() {
    return this.config.monthly_charge || 0;
  }
}

// Register the scheduler
registerScheduler(FixedChargeScheduler);
