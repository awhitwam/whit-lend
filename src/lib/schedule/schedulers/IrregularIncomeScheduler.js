/**
 * IrregularIncomeScheduler
 *
 * For loans where repayment is based on irregular income patterns.
 * No schedule is generated - repayments are recorded as they occur.
 *
 * Extracted from LoanScheduleManager.jsx lines 40-58
 */

import { api } from '@/api/dataClient';
import { BaseScheduler } from '../BaseScheduler.js';
import { registerScheduler } from '../registry.js';

export class IrregularIncomeScheduler extends BaseScheduler {
  static id = 'irregular_income';
  static displayName = 'Irregular Income';
  static description = 'No fixed schedule - repayments recorded as they occur';
  static category = 'special';
  static generatesSchedule = false;

  static configSchema = {
    common: {
      // No common settings needed for this scheduler
    },
    specific: {
      // No specific settings
    }
  };

  /**
   * Generate schedule for irregular income loan
   * This scheduler clears any existing schedule and sets interest to 0
   */
  async generateSchedule({ loan, product, options = {} }) {
    console.log('=== SCHEDULE ENGINE: Irregular Income - Clearing Schedule ===');

    // Delete any existing schedule entries
    await api.entities.RepaymentSchedule.deleteWhere({ loan_id: loan.id });

    // Update loan with zero interest values and sync product_type
    await api.entities.Loan.update(loan.id, {
      interest_rate: 0,
      interest_type: 'None',
      product_type: 'Irregular Income',
      total_interest: 0,
      total_repayable: loan.principal_amount + (loan.exit_fee || 0)
    });

    console.log('=== SCHEDULE ENGINE: Irregular Income - Schedule Cleared ===');

    return {
      loan,
      schedule: [],
      summary: {
        totalInterest: 0,
        totalRepayable: loan.principal_amount + (loan.exit_fee || 0)
      }
    };
  }

  /**
   * Not applicable for this scheduler
   */
  calculatePeriodInterest() {
    return 0;
  }

  /**
   * Not applicable for this scheduler
   */
  calculatePrincipalPortion() {
    return 0;
  }
}

// Register the scheduler
registerScheduler(IrregularIncomeScheduler);
