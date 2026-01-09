/**
 * RentScheduler
 *
 * For rent-based income loans where payments arrive periodically (typically quarterly).
 * Analyzes historical payment patterns from the ledger to:
 * 1. Determine the rent payment pattern (frequency, typical amount)
 * 2. Assign "interest" (rent) to past quarters based on actual payments
 * 3. Predict when the next rent payment is due and the expected amount
 *
 * Similar to IrregularIncome but with pattern detection and forecasting.
 */

import { api } from '@/api/dataClient';
import { BaseScheduler } from '../BaseScheduler.js';
import { registerScheduler } from '../registry.js';
import { format, addMonths, addQuarters, differenceInDays, differenceInMonths, startOfQuarter, endOfQuarter, subQuarters } from 'date-fns';

// ViewComponent is set by RentScheduleView.jsx when it loads (avoids circular import)
let RentScheduleViewComponent = null;

export class RentScheduler extends BaseScheduler {
  static id = 'rent';
  static displayName = 'Rent (Quarterly)';
  static description = 'Periodic rent income with pattern detection and forecasting';
  static category = 'special';
  static generatesSchedule = true;

  /**
   * Custom view component - RentScheduleView provides quarterly grouping and predictions
   * Set by RentScheduleView.jsx via self-registration to avoid circular imports
   */
  static get ViewComponent() {
    return RentScheduleViewComponent;
  }

  static set ViewComponent(component) {
    RentScheduleViewComponent = component;
  }

  static displayConfig = {
    showInterestColumn: true,
    showPrincipalColumn: false,
    interestColumnLabel: 'Rent',
    principalColumnLabel: 'Principal',
    showCalculationDetails: false
  };

  static configSchema = {
    common: {
      // Rent typically doesn't use standard period settings
    },
    specific: {
      default_frequency: {
        type: 'select',
        options: ['quarterly', 'monthly', 'annual'],
        default: 'quarterly',
        label: 'Expected Payment Frequency',
        description: 'Expected frequency of rent payments (used when no history)'
      },
      lookback_periods: {
        type: 'number',
        default: 4,
        label: 'Lookback Periods',
        description: 'Number of past periods to analyze for pattern detection'
      }
    }
  };

  /**
   * Generate schedule for rent-based loan
   * Analyzes payment history and predicts future rent
   */
  async generateSchedule({ loan, product, options = {} }) {
    console.log('=== SCHEDULE ENGINE: Rent Scheduler ===');

    const { transactions } = await this.fetchLoanData(loan.id);
    const principalState = this.calculatePrincipalState(transactions);

    // Get repayment transactions (rent payments)
    const rentPayments = transactions
      .filter(t => t.type === 'Repayment' && t.amount > 0)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    console.log('Rent Payments Found:', rentPayments.length);

    // Analyze payment pattern
    const pattern = this.analyzePaymentPattern(rentPayments, product);
    console.log('Detected Pattern:', pattern);

    // Build schedule from historical payments + prediction
    const schedule = this.buildRentSchedule({
      loan,
      product,
      transactions,
      rentPayments,
      pattern,
      principalState
    });

    // Save schedule
    await this.saveSchedule(loan.id, schedule);

    // Calculate totals from actual payments
    const totalRent = schedule.reduce((sum, row) => sum + row.interest_amount, 0);
    const totalRepayable = principalState.currentOutstanding + totalRent + (loan.exit_fee || 0);

    // Update loan totals and clear interest-related fields (Rent loans don't accrue interest)
    // Also set product_type to 'Rent' so LoanCalculator skips interest calculations
    await api.entities.Loan.update(loan.id, {
      product_type: 'Rent',
      interest_rate: 0,
      interest_type: null,
      total_interest: this.utils.roundCurrency(totalRent),
      total_repayable: this.utils.roundCurrency(totalRepayable)
    });

    console.log('=== SCHEDULE ENGINE: Rent Scheduler Complete ===');
    console.log(`Generated ${schedule.length} schedule entries`);

    return {
      loan,
      schedule,
      summary: {
        totalInterest: totalRent,
        totalRepayable,
        pattern
      }
    };
  }

  /**
   * Analyze historical rent payments to detect pattern
   */
  analyzePaymentPattern(rentPayments, product) {
    const config = product.scheduler_config || {};
    const defaultFrequency = config.default_frequency || 'quarterly';

    // Default pattern if no history
    if (rentPayments.length < 2) {
      return {
        frequency: defaultFrequency,
        averageAmount: rentPayments.length === 1 ? rentPayments[0].amount : 0,
        confidence: 'low',
        intervalDays: defaultFrequency === 'quarterly' ? 91 : defaultFrequency === 'annual' ? 365 : 30,
        lastPaymentDate: rentPayments.length > 0 ? new Date(rentPayments[rentPayments.length - 1].date) : null,
        paymentCount: rentPayments.length
      };
    }

    // Calculate intervals between payments
    const intervals = [];
    for (let i = 1; i < rentPayments.length; i++) {
      const days = differenceInDays(
        new Date(rentPayments[i].date),
        new Date(rentPayments[i - 1].date)
      );
      intervals.push(days);
    }

    // Average interval
    const avgInterval = intervals.reduce((sum, d) => sum + d, 0) / intervals.length;

    // Determine frequency based on average interval
    let frequency;
    let normalizedInterval;
    if (avgInterval >= 300 && avgInterval <= 400) {
      frequency = 'annual';
      normalizedInterval = 365;
    } else if (avgInterval >= 75 && avgInterval <= 120) {
      frequency = 'quarterly';
      normalizedInterval = 91;
    } else if (avgInterval >= 25 && avgInterval <= 40) {
      frequency = 'monthly';
      normalizedInterval = 30;
    } else {
      // Use actual average if doesn't fit standard patterns
      frequency = 'irregular';
      normalizedInterval = Math.round(avgInterval);
    }

    // Calculate average amount (use recent payments, weighted towards most recent)
    const recentPayments = rentPayments.slice(-4); // Last 4 payments
    const weights = recentPayments.map((_, i) => i + 1); // 1, 2, 3, 4
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const weightedSum = recentPayments.reduce((sum, p, i) => sum + (p.amount * weights[i]), 0);
    const averageAmount = weightedSum / totalWeight;

    // Confidence based on consistency
    const variance = intervals.reduce((sum, d) => sum + Math.pow(d - avgInterval, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const confidence = stdDev < 15 ? 'high' : stdDev < 30 ? 'medium' : 'low';

    return {
      frequency,
      averageAmount: this.utils.roundCurrency(averageAmount),
      confidence,
      intervalDays: normalizedInterval,
      avgIntervalDays: Math.round(avgInterval),
      lastPaymentDate: new Date(rentPayments[rentPayments.length - 1].date),
      paymentCount: rentPayments.length,
      stdDev: Math.round(stdDev)
    };
  }

  /**
   * Build rent schedule with historical entries and prediction
   */
  buildRentSchedule({ loan, product, transactions, rentPayments, pattern, principalState }) {
    const schedule = [];
    const startDate = new Date(loan.start_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let installmentNum = 1;

    // Group payments by quarter for historical view
    const quarterlyPayments = this.groupPaymentsByQuarter(rentPayments, startDate);

    // Add historical quarters with actual payments
    for (const [quarterKey, payments] of Object.entries(quarterlyPayments)) {
      const [year, quarter] = quarterKey.split('-Q').map(Number);
      const quarterStart = new Date(year, (quarter - 1) * 3, 1);
      const quarterEnd = endOfQuarter(quarterStart);

      const totalRent = payments.reduce((sum, p) => sum + p.amount, 0);
      const principalPaid = payments.reduce((sum, p) => sum + (p.principal_applied || 0), 0);

      schedule.push({
        installment_number: installmentNum++,
        due_date: format(quarterEnd, 'yyyy-MM-dd'),
        principal_amount: 0,
        interest_amount: this.utils.roundCurrency(totalRent),
        total_due: this.utils.roundCurrency(totalRent),
        balance: this.utils.roundCurrency(principalState.currentOutstanding),
        principal_paid: this.utils.roundCurrency(principalPaid),
        interest_paid: this.utils.roundCurrency(totalRent), // Rent received = paid
        status: 'Paid',
        calculation_days: differenceInDays(quarterEnd, quarterStart),
        calculation_principal_start: this.utils.roundCurrency(loan.principal_amount),
        is_extension_period: false
        // Note: Custom rent fields (quarter, payment_count, payment_dates) stored in schedule metadata
      });
    }

    // Add prediction for next rent payment
    if (pattern.lastPaymentDate && pattern.averageAmount > 0) {
      const nextDueDate = this.predictNextPaymentDate(pattern);

      // Only add prediction if it's in the future
      if (nextDueDate > today) {
        const nextQuarter = Math.ceil((nextDueDate.getMonth() + 1) / 3);
        const nextYear = nextDueDate.getFullYear();

        schedule.push({
          installment_number: installmentNum++,
          due_date: format(nextDueDate, 'yyyy-MM-dd'),
          principal_amount: 0,
          interest_amount: this.utils.roundCurrency(pattern.averageAmount),
          total_due: this.utils.roundCurrency(pattern.averageAmount),
          balance: this.utils.roundCurrency(principalState.currentOutstanding),
          principal_paid: 0,
          interest_paid: 0,
          status: 'Pending',
          calculation_days: pattern.intervalDays,
          calculation_principal_start: this.utils.roundCurrency(loan.principal_amount),
          is_extension_period: false
          // Note: This is a predicted payment (Q${nextQuarter} ${nextYear}, confidence: ${pattern.confidence})
        });
      }
    }

    return schedule;
  }

  /**
   * Group rent payments by quarter
   */
  groupPaymentsByQuarter(payments, startDate) {
    const quarters = {};

    for (const payment of payments) {
      const paymentDate = new Date(payment.date);
      const year = paymentDate.getFullYear();
      const quarter = Math.ceil((paymentDate.getMonth() + 1) / 3);
      const key = `${year}-Q${quarter}`;

      if (!quarters[key]) {
        quarters[key] = [];
      }
      quarters[key].push(payment);
    }

    // Sort by quarter
    const sortedQuarters = {};
    Object.keys(quarters)
      .sort()
      .forEach(key => {
        sortedQuarters[key] = quarters[key];
      });

    return sortedQuarters;
  }

  /**
   * Predict next payment date based on pattern
   */
  predictNextPaymentDate(pattern) {
    if (!pattern.lastPaymentDate) {
      return new Date();
    }

    const lastDate = new Date(pattern.lastPaymentDate);

    switch (pattern.frequency) {
      case 'quarterly':
        return addQuarters(lastDate, 1);
      case 'annual':
        return addMonths(lastDate, 12);
      case 'monthly':
        return addMonths(lastDate, 1);
      default:
        // Use actual average interval
        const nextDate = new Date(lastDate);
        nextDate.setDate(nextDate.getDate() + pattern.avgIntervalDays);
        return nextDate;
    }
  }

  /**
   * Not applicable for rent - no interest calculation
   */
  calculatePeriodInterest() {
    return 0;
  }

  /**
   * Not applicable for rent
   */
  calculatePrincipalPortion() {
    return 0;
  }

  // ============ Display Methods ============

  /**
   * Format period description for rent - shows quarter info
   */
  formatPeriodDescription({ row }) {
    const dueDate = new Date(row.due_date);
    const quarter = Math.ceil((dueDate.getMonth() + 1) / 3);
    const year = dueDate.getFullYear();

    return {
      description: `Q${quarter} ${year}`,
      annotation: row.status === 'Pending' ? 'Predicted' : null,
      annotationType: row.status === 'Pending' ? 'info' : null
    };
  }

  /**
   * Explain rent scheduler decision
   */
  explainDecision(row) {
    if (row.status === 'Pending') {
      return 'Predicted rent payment based on historical pattern analysis.';
    }
    return `Rent received for quarter. Total: £${(row.interest_amount || 0).toFixed(2)}`;
  }

  /**
   * Get summary string for rent scheduler
   */
  static getSummaryString(product) {
    const config = product?.scheduler_config || {};
    const frequency = config.default_frequency || 'quarterly';
    return `rent (Rent) • ${frequency}`;
  }
}

// Register the scheduler
registerScheduler(RentScheduler);
