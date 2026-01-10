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
   * Custom view component for this scheduler
   * If null, the default RepaymentScheduleTable is used
   * Override in subclasses to provide a completely custom view (e.g., RentScheduleView)
   */
  static ViewComponent = null;

  /**
   * Display configuration for the default table view
   * Override in subclasses to customize column visibility, labels, etc.
   */
  static displayConfig = {
    showInterestColumn: true,
    showPrincipalColumn: true,
    interestColumnLabel: 'Interest',
    principalColumnLabel: 'Principal',
    showCalculationDetails: true
  };

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
    // IMPORTANT: Only include fields that exist in the database schema
    // Adjustment entry fields (is_adjustment_entry, adjustment_type, adjustment_reason)
    // are NOT in the DB schema yet and must be excluded
    const scheduleWithLoanId = schedule.map(row => {
      // Explicitly construct object with ONLY database columns - no spreading!
      // Ensure numeric fields are valid numbers (not null/undefined/NaN)
      const principalAmount = Number.isFinite(row.principal_amount) ? row.principal_amount : 0;
      const interestAmount = Number.isFinite(row.interest_amount) ? row.interest_amount : 0;
      const balance = Number.isFinite(row.balance) ? row.balance : 0;
      const calcDays = Number.isFinite(row.calculation_days) ? row.calculation_days : 0;
      const calcPrincipalStart = Number.isFinite(row.calculation_principal_start) ? row.calculation_principal_start : 0;

      return {
        loan_id: loanId,
        installment_number: row.installment_number,
        due_date: row.due_date,
        principal_amount: principalAmount,
        interest_amount: interestAmount,
        total_due: principalAmount + interestAmount,
        balance: Math.max(0, balance),
        principal_paid: row.principal_paid || 0,
        interest_paid: row.interest_paid || 0,
        status: row.status || 'Pending',
        calculation_days: calcDays,
        calculation_principal_start: calcPrincipalStart,
        is_extension_period: row.is_extension_period || false
      };
    });

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

  // ============ Display Methods ============

  /**
   * Format the description for a period row
   * Override in subclasses for custom period descriptions (e.g., credit annotations)
   *
   * @param {Object} params
   * @param {Object} params.row - Schedule row data
   * @param {Object} params.loan - Loan record
   * @param {Object} params.product - Product record
   * @param {Object} params.periodContext - Additional context (transactions, capital events, etc.)
   * @returns {Object} { description: string, annotation?: string, annotationType?: 'credit'|'overpaid'|'info' }
   */
  formatPeriodDescription({ row, loan, product, periodContext = {} }) {
    // Default implementation - just return standard description
    const days = row.calculation_days || row.periodDays || 0;
    const dailyRate = row.calculation_principal_start
      ? (product?.interest_rate || 0) / 100 / 365 * row.calculation_principal_start
      : 0;

    return {
      description: `${days}d × £${dailyRate.toFixed(2)}/day`,
      annotation: null,
      annotationType: null
    };
  }

  /**
   * Calculate any adjustments between periods (e.g., credits from overpayment)
   * Override in subclasses that need period-to-period adjustments
   *
   * @param {Object} params
   * @param {Array} params.schedule - Full schedule array
   * @param {Object} params.loan - Loan record
   * @param {Object} params.product - Product record
   * @param {Array} params.transactions - All loan transactions
   * @returns {Array} Schedule with adjustment annotations added
   */
  calculatePeriodAdjustments({ schedule, loan, product, transactions }) {
    // Default: no adjustments
    return schedule;
  }

  /**
   * Explain the scheduler's decision for a specific period
   * Used for CSV export debug column
   *
   * @param {Object} row - Schedule row
   * @param {Object} loan - Loan record
   * @param {Object} product - Product record
   * @returns {string} Human-readable explanation of the calculation
   */
  explainDecision(row, loan, product) {
    const days = row.calculation_days || 0;
    const principal = row.calculation_principal_start || 0;
    const interest = row.interest_amount || 0;

    return `Standard calculation: ${days} days at ${product?.interest_rate || 0}% on £${principal.toFixed(2)} = £${interest.toFixed(2)}`;
  }

  /**
   * Get debug information for this scheduler and a specific row
   * Used for CSV export and loan details visibility
   *
   * @param {Object} params
   * @param {Object} params.row - Schedule row (optional, for row-specific info)
   * @param {Object} params.loan - Loan record
   * @param {Object} params.product - Product record
   * @returns {Object} Debug information object
   */
  getDebugInfo({ row = null, loan, product }) {
    const baseInfo = {
      schedulerType: this.constructor.id,
      schedulerName: this.constructor.displayName,
      viewComponent: this.constructor.ViewComponent?.name || 'StandardTable',
      generatesSchedule: this.constructor.generatesSchedule,
      config: {
        period: product?.period || 'Monthly',
        interestPaidInAdvance: product?.interest_paid_in_advance || false,
        calculationMethod: product?.interest_calculation_method || 'daily',
        alignment: product?.interest_alignment || 'period_based',
        interestType: product?.interest_type,
        productType: product?.product_type
      }
    };

    if (row) {
      baseInfo.periodCalculation = {
        periodNumber: row.installment_number,
        dueDate: row.due_date,
        principalStart: row.calculation_principal_start,
        days: row.calculation_days,
        interestDue: row.interest_amount,
        principalDue: row.principal_amount,
        balance: row.balance
      };
      baseInfo.decisionTrail = this.explainDecision(row, loan, product);
    }

    return baseInfo;
  }

  /**
   * Get a summary string for display in loan details
   * Shows the active scheduler configuration
   *
   * @param {Object} product - Product record
   * @returns {string} Summary string like "interest_only (Interest-Only) • Advance • Daily"
   */
  static getSummaryString(product) {
    const parts = [
      `${this.id} (${this.displayName})`
    ];

    if (product?.interest_paid_in_advance) {
      parts.push('Advance');
    } else {
      parts.push('Arrears');
    }

    parts.push(product?.interest_calculation_method === 'monthly' ? 'Monthly calc' : 'Daily calc');

    return parts.join(' • ');
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
