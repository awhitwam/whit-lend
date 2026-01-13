/**
 * RollUpServicedScheduler
 *
 * For loans where:
 * 1. Interest "rolls up" (accrues but isn't paid) during an initial period
 * 2. After the roll-up period, monthly serviced interest payments begin
 * 3. Serviced interest calculated on (principal + roll_up_amount)
 * 4. Optional compounding: if enabled, interest calculated on (principal + roll_up + unpaid_accrued)
 * 5. Roll-up amount tracked separately (not capitalised to principal)
 * 6. Final period includes balloon principal payment
 */

import { BaseScheduler } from '../BaseScheduler.js';
import { registerScheduler } from '../registry.js';
import { format, addMonths, differenceInDays, startOfMonth } from 'date-fns';

// Import the shared view component
import InterestOnlyScheduleView from '@/components/loan/InterestOnlyScheduleView';

export class RollUpServicedScheduler extends BaseScheduler {
  static id = 'roll_up_serviced';
  static displayName = 'Roll-Up & Serviced';
  static description = 'Interest rolls up during initial period, then monthly serviced payments begin';
  static category = 'interest-only';
  static generatesSchedule = true;

  // Use the same view component as InterestOnly but with roll-up styling
  static ViewComponent = InterestOnlyScheduleView;

  static displayConfig = {
    showInterestColumn: true,
    showPrincipalColumn: true,
    interestColumnLabel: 'Interest',
    principalColumnLabel: 'Principal',
    showCalculationDetails: true,
    showRollUpAnnotations: true
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
      }
    },
    specific: {
      roll_up_length: {
        type: 'number',
        default: 6,
        min: 1,
        max: 120,
        label: 'Roll-Up Period (Months)'
      },
      compound_after_rollup: {
        type: 'boolean',
        default: false,
        label: 'Compound Interest After Roll-Up'
      }
    }
  };

  /**
   * Generate schedule for roll-up & serviced loan
   *
   * Structure:
   * Row 0: Disbursement info (implicit, not in schedule)
   * Row 1: Roll-Up Due (start_date + roll_up_length months)
   * Row 2+: Serviced Interest (monthly thereafter)
   * Final Row: Includes balloon principal payment
   */
  async generateSchedule({ loan, product, options = {} }) {
    console.log('=== SCHEDULE ENGINE: Roll-Up & Serviced ===');

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

    // Get roll-up configuration from loan (set during creation/edit)
    const rollUpLength = loan.roll_up_length || 6;
    const rollUpAmountOverride = loan.roll_up_amount_override && loan.roll_up_amount != null;
    const compoundAfterRollup = product.compound_after_rollup || false;

    // Principal amount IS the gross amount (what borrower owes)
    // Additional deducted fees are just a memo of what wasn't disbursed - they don't add to principal
    const grossPrincipal = originalPrincipal;

    console.log('Roll-Up & Serviced Config:', {
      rollUpLength,
      rollUpAmountOverride,
      compoundAfterRollup,
      effectiveRate,
      originalPrincipal,
      grossPrincipal
    });

    const schedule = [];
    let installmentNumber = 1;

    // Calculate roll-up interest (or use override)
    let rollUpInterest;
    if (rollUpAmountOverride) {
      rollUpInterest = parseFloat(loan.roll_up_amount);
    } else {
      rollUpInterest = this.calculateRollUpInterest({
        principal: grossPrincipal,
        transactions,
        startDate,
        rollUpLength,
        period,
        dailyRate
      });
    }

    // Roll-up due date
    const rollUpDueDate = addMonths(startDate, rollUpLength);
    const daysInRollUp = differenceInDays(rollUpDueDate, startDate);

    // Row 1: Roll-Up Due entry
    // The roll-up interest is tracked separately, not added to principal
    schedule.push({
      ...this.createScheduleEntry({
        installmentNumber: installmentNumber++,
        dueDate: rollUpDueDate,
        principalAmount: 0,  // No principal due at roll-up end
        interestAmount: rollUpInterest,
        balance: grossPrincipal,  // Principal unchanged
        calculationDays: daysInRollUp,
        calculationPrincipalStart: grossPrincipal,
        isExtensionPeriod: false
      }),
      is_roll_up_period: true,
      rolled_up_interest: rollUpInterest
    });

    // Calculate serviced periods after roll-up
    const totalLoanDuration = duration;
    const servicedPeriods = Math.max(0, totalLoanDuration - rollUpLength);

    // Base for serviced interest calculation
    // For serviced periods: interest is on (principal + roll_up_amount)
    // If compounding is enabled: interest on (principal + roll_up + any unpaid_accrued)
    let servicedBase = grossPrincipal + rollUpInterest;
    let unpaidAccrued = 0;  // Track any unpaid interest for compounding

    console.log('Serviced Config:', {
      totalLoanDuration,
      servicedPeriods,
      servicedBase,
      compoundAfterRollup
    });

    // Generate serviced period entries
    for (let i = 1; i <= servicedPeriods; i++) {
      const periodStart = addMonths(rollUpDueDate, i - 1);
      const periodEnd = addMonths(rollUpDueDate, i);
      const daysInPeriod = differenceInDays(periodEnd, periodStart);

      // Calculate principal at this date accounting for any capital events
      const principalAtStart = this.utils.calculatePrincipalAtDate(
        originalPrincipal,
        transactions,
        periodStart,
        startDate
      );

      // Determine interest calculation base
      let interestBase = principalAtStart + rollUpInterest;
      if (compoundAfterRollup && unpaidAccrued > 0) {
        // Add unpaid accrued interest to base if compounding
        interestBase += unpaidAccrued;
      }

      // Calculate interest for this period
      const periodInterest = interestBase * dailyRate * daysInPeriod;

      // Is this the final period? Include balloon payment
      const isFinalPeriod = i === servicedPeriods;
      const principalDue = isFinalPeriod ? principalAtStart : 0;

      // Balance after this period
      const balanceAfter = isFinalPeriod ? 0 : principalAtStart;

      schedule.push({
        ...this.createScheduleEntry({
          installmentNumber: installmentNumber++,
          dueDate: periodEnd,
          principalAmount: principalDue,
          interestAmount: periodInterest,
          balance: balanceAfter,
          calculationDays: daysInPeriod,
          calculationPrincipalStart: interestBase,
          isExtensionPeriod: false
        }),
        is_roll_up_period: false,
        is_serviced_period: true
      });

      // For compounding: if this interest isn't paid, add to unpaidAccrued
      // (In practice, this would be determined by actual payments)
      // For schedule generation, assume payments are made
    }

    // If no serviced periods (loan ends at roll-up), add balloon to roll-up entry
    if (servicedPeriods === 0) {
      schedule[0].principal_amount = grossPrincipal;
      schedule[0].total_due = schedule[0].principal_amount + schedule[0].interest_amount;
      schedule[0].balance = 0;
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

    // Update loan with roll-up amount if auto-calculated
    const updateData = {
      totalInterest: summary.totalInterest,
      totalRepayable: summary.totalRepayable,
      effectiveInterestRate: effectiveRate,
      product
    };

    await this.updateLoanTotals(loan.id, updateData);

    // Store calculated roll-up amount if not overridden
    if (!rollUpAmountOverride) {
      const { api } = await import('@/api/dataClient');
      await api.entities.Loan.update(loan.id, {
        roll_up_amount: rollUpInterest
      });
    }

    console.log('=== SCHEDULE ENGINE: Roll-Up & Serviced Complete ===');
    console.log(`Generated ${finalSchedule.length} schedule entries`);
    console.log(`Roll-up interest: ${rollUpInterest}`);
    finalSchedule.forEach((row, idx) => {
      const type = row.is_roll_up_period ? '[ROLL-UP]' : '[SERVICED]';
      console.log(`  ${type} [${idx + 1}] ${row.due_date}: Principal=${row.principal_amount}, Interest=${row.interest_amount}, Balance=${row.balance}`);
    });

    return {
      loan,
      schedule: finalSchedule,
      summary,
      rollUpInterest
    };
  }

  /**
   * Calculate roll-up interest using daily accrual over roll-up months
   * Handles mid-period capital events (further advances)
   */
  calculateRollUpInterest({
    principal,
    transactions,
    startDate,
    rollUpLength,
    period,
    dailyRate
  }) {
    let totalInterest = 0;

    // Calculate interest for each month in roll-up period
    for (let i = 1; i <= rollUpLength; i++) {
      const { periodStart, periodEnd } = this.utils.getPeriodBoundaries(startDate, period, i);

      // Get principal at period start (accounting for capital events)
      const principalAtStart = this.utils.calculatePrincipalAtDate(
        principal,
        transactions,
        periodStart,
        startDate
      );

      const daysInPeriod = differenceInDays(periodEnd, periodStart);
      const interestForPeriod = principalAtStart * dailyRate * daysInPeriod;

      totalInterest += interestForPeriod;
    }

    return this.utils.roundCurrency(totalInterest);
  }

  /**
   * Calculate interest for a period
   */
  calculatePeriodInterest({ principal, annualRate, periodStart, periodEnd }) {
    const dailyRate = this.utils.getDailyRate(annualRate);
    const days = differenceInDays(periodEnd, periodStart);
    return principal * dailyRate * days;
  }

  /**
   * Principal portion - balloon payment on final period only
   */
  calculatePrincipalPortion({ periodNumber, totalPeriods, principalAtEnd }) {
    if (periodNumber === totalPeriods) {
      return principalAtEnd;
    }
    return 0;
  }

  /**
   * Format period description for roll-up & serviced loans
   */
  formatPeriodDescription({ row, loan, product, periodContext = {} }) {
    const days = row.calculation_days || 0;
    const principalStart = row.calculation_principal_start || 0;
    const rate = loan?.interest_rate || product?.interest_rate || 0;
    const dailyRate = principalStart * (rate / 100 / 365);

    let description = `${days}d × £${dailyRate.toFixed(2)}/day`;
    let annotation = null;
    let annotationType = null;

    if (row.is_roll_up_period) {
      annotation = `Roll-up period: ${loan?.roll_up_length || 0} months`;
      annotationType = 'rollup';
    } else if (row.is_serviced_period) {
      annotation = 'Serviced period';
      annotationType = 'serviced';
    }

    return {
      description,
      annotation,
      annotationType
    };
  }

  /**
   * Explain the scheduler's decision
   */
  explainDecision(row, loan, product) {
    const days = row.calculation_days || 0;
    const principal = row.calculation_principal_start || 0;
    const interest = row.interest_amount || 0;
    const rate = loan?.interest_rate || product?.interest_rate || 0;

    if (row.is_roll_up_period) {
      return `Roll-Up Period: ${days} days at ${rate}% on £${principal.toFixed(2)} = £${interest.toFixed(2)}. Interest accrues but is not due until end of roll-up period.`;
    }

    const rollUpAmount = loan?.roll_up_amount || 0;
    return `Serviced Period: ${days} days at ${rate}% on £${principal.toFixed(2)} (principal + £${rollUpAmount.toFixed(2)} rolled-up interest) = £${interest.toFixed(2)}`;
  }

  /**
   * Get summary string for display
   */
  static getSummaryString(product) {
    const parts = ['roll_up_serviced (Roll-Up & Serviced)'];

    if (product?.compound_after_rollup) {
      parts.push('Compounding');
    } else {
      parts.push('Non-Compounding');
    }

    parts.push(product?.interest_calculation_method === 'monthly' ? 'Monthly calc' : 'Daily calc');

    return parts.join(' • ');
  }
}

// Register the scheduler
registerScheduler(RollUpServicedScheduler);
