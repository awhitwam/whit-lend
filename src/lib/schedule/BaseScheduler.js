/**
 * BaseScheduler - Abstract base class for all loan schedule generators
 *
 * All schedulers must extend this class and implement the required methods.
 * The static properties define metadata used by the UI and registry.
 */

import { api } from '@/api/dataClient';
import {
  calculatePrincipalAtDate,
  calculateInterestForDays,
  getDailyRate,
  getPeriodicRate,
  roundCurrency
} from './utils/interestCalculations.js';
import {
  advancePeriod,
  formatDateISO,
  normalizeDate,
  getPeriodBoundaries,
  differenceInDays
} from './utils/dateUtils.js';
import {
  calculateScheduleDuration,
  buildEventTimeline,
  getCapitalEventsInPeriod
} from './utils/durationCalculation.js';

export class BaseScheduler {
  // Static metadata - override in subclasses
  static id = 'base';
  static displayName = 'Base Scheduler';
  static description = 'Abstract base - do not use directly';
  static category = 'standard'; // 'standard' | 'interest-only' | 'special'
  static generatesSchedule = true; // false for schedulers that don't create schedule entries

  /**
   * Configuration schema - defines what settings this scheduler needs
   * Override in subclasses to add scheduler-specific settings
   */
  static configSchema = {
    // Common settings available to all schedulers
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
      }
    },
    // Scheduler-specific settings - override in subclasses
    specific: {}
  };

  /**
   * Create a new scheduler instance
   * @param {Object} config - Scheduler configuration from product.scheduler_config
   */
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Generate the repayment schedule for a loan
   * This is the main entry point - must be implemented by subclasses
   *
   * @param {Object} params
   * @param {Object} params.loan - Loan record from database
   * @param {Object} params.product - Product record from database
   * @param {Object} params.options - Generation options (endDate, duration, etc.)
   * @returns {Promise<Object>} { loan, schedule, summary }
   */
  async generateSchedule({ loan, product, options = {} }) {
    throw new Error('Subclasses must implement generateSchedule()');
  }

  /**
   * Calculate interest for a single period
   * Override in subclasses for different interest calculation methods
   *
   * @param {Object} params
   * @param {number} params.principal - Principal balance at period start
   * @param {number} params.annualRate - Annual interest rate (percentage)
   * @param {Date} params.periodStart - Period start date
   * @param {Date} params.periodEnd - Period end date
   * @param {Array} params.capitalEvents - Capital events during period
   * @param {number} params.originalPrincipal - Original loan principal
   * @returns {number} Interest amount for the period
   */
  calculatePeriodInterest({ principal, annualRate, periodStart, periodEnd, capitalEvents, originalPrincipal }) {
    throw new Error('Subclasses must implement calculatePeriodInterest()');
  }

  /**
   * Calculate the principal portion for a period
   * Override in subclasses for different principal payment methods
   *
   * @param {Object} params
   * @param {number} params.principalAtStart - Principal at period start
   * @param {number} params.principalAtEnd - Principal at period end
   * @param {number} params.interestForPeriod - Interest calculated for this period
   * @param {number} params.periodNumber - Current period number (1-based)
   * @param {number} params.totalPeriods - Total number of periods
   * @param {number} params.annualRate - Annual interest rate
   * @param {string} params.period - 'Monthly' or 'Weekly'
   * @returns {number} Principal payment amount
   */
  calculatePrincipalPortion({ principalAtStart, principalAtEnd, interestForPeriod, periodNumber, totalPeriods, annualRate, period }) {
    // Default: no principal payment (interest-only behavior)
    return 0;
  }

  // ============ Helper Methods ============

  /**
   * Fetch all required data for schedule generation
   */
  async fetchLoanData(loanId) {
    const transactions = await api.entities.Transaction.filter({
      loan_id: loanId,
      is_deleted: false
    }, 'date');

    return { transactions };
  }

  /**
   * Calculate current principal state from transactions
   */
  calculatePrincipalState(transactions) {
    const totalDisbursed = transactions
      .filter(t => t.type === 'Disbursement')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalCapitalRepaid = transactions
      .filter(t => t.type === 'Repayment')
      .reduce((sum, t) => sum + (t.principal_applied || 0), 0);

    return {
      totalDisbursed,
      totalCapitalRepaid,
      currentOutstanding: totalDisbursed - totalCapitalRepaid
    };
  }

  /**
   * Build the schedule duration and configuration
   */
  buildScheduleConfig({ loan, product, options, currentPrincipalOutstanding }) {
    return calculateScheduleDuration({
      loan,
      product,
      options,
      currentPrincipalOutstanding
    });
  }

  /**
   * Create a schedule entry object with standard structure
   */
  createScheduleEntry({
    installmentNumber,
    dueDate,
    principalAmount,
    interestAmount,
    balance,
    calculationDays,
    calculationPrincipalStart,
    isExtensionPeriod = false
  }) {
    return {
      installment_number: installmentNumber,
      due_date: typeof dueDate === 'string' ? dueDate : formatDateISO(dueDate),
      principal_amount: roundCurrency(principalAmount),
      interest_amount: roundCurrency(interestAmount),
      total_due: roundCurrency(principalAmount + interestAmount),
      balance: Math.max(0, roundCurrency(balance)),
      principal_paid: 0,
      interest_paid: 0,
      status: 'Pending',
      calculation_days: calculationDays,
      calculation_principal_start: roundCurrency(calculationPrincipalStart),
      is_extension_period: isExtensionPeriod
    };
  }

  /**
   * Persist the generated schedule to the database
   */
  async saveSchedule(loanId, schedule) {
    // Delete old schedule
    await api.entities.RepaymentSchedule.deleteWhere({ loan_id: loanId });

    // Batch create new schedule
    const scheduleWithLoanId = schedule.map(row => ({
      loan_id: loanId,
      ...row
    }));
    await api.entities.RepaymentSchedule.createMany(scheduleWithLoanId);
  }

  /**
   * Update the loan record with calculated totals
   */
  async updateLoanTotals(loanId, { totalInterest, totalRepayable, effectiveInterestRate, product }) {
    await api.entities.Loan.update(loanId, {
      interest_rate: effectiveInterestRate,
      interest_type: product.interest_type,
      product_type: product.product_type || 'Standard',
      period: product.period,
      total_interest: roundCurrency(totalInterest),
      total_repayable: roundCurrency(totalRepayable)
    });
  }

  /**
   * Calculate schedule summary totals
   */
  calculateSummary(schedule, currentPrincipalOutstanding, exitFee = 0) {
    const totalInterest = schedule.reduce((sum, row) => sum + row.interest_amount, 0);
    const totalRepayable = totalInterest + currentPrincipalOutstanding + exitFee;

    return {
      totalInterest: roundCurrency(totalInterest),
      totalRepayable: roundCurrency(totalRepayable)
    };
  }

  /**
   * Get the effective interest rate (loan override or product rate)
   */
  getEffectiveInterestRate(loan, product) {
    return loan.override_interest_rate && loan.overridden_rate != null
      ? loan.overridden_rate
      : product.interest_rate;
  }

  // ============ Utility re-exports ============

  // Make utilities available to subclasses
  get utils() {
    return {
      calculatePrincipalAtDate,
      calculateInterestForDays,
      getDailyRate,
      getPeriodicRate,
      roundCurrency,
      advancePeriod,
      formatDateISO,
      normalizeDate,
      getPeriodBoundaries,
      differenceInDays,
      buildEventTimeline,
      getCapitalEventsInPeriod
    };
  }
}
