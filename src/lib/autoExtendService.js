import { api } from '@/api/dataClient';
import { regenerateLoanSchedule } from '@/components/loan/LoanScheduleManager';
import { applyPaymentWaterfall } from '@/components/loan/LoanCalculator';
import { format } from 'date-fns';

/**
 * Auto-Extend Service
 * Automatically extends loan schedules for loans with auto_extend enabled
 * This ensures schedules always cover up to the current date
 */

/**
 * Process a single loan for auto-extension
 * @param {Object} loan - The loan to process
 * @param {Date} endDate - The date to extend to (defaults to today)
 * @returns {Object} Result of the extension operation
 */
async function processLoanAutoExtend(loan, endDate = new Date()) {
  const loanId = loan.id;
  const formattedEndDate = format(endDate, 'yyyy-MM-dd');

  console.log(`[AutoExtend] Processing loan ${loan.loan_number || loanId}...`);

  try {
    // Regenerate the schedule with the new end date
    // skipDisbursement: true because auto-extend only extends existing loans
    // that should already have their initial disbursement
    await regenerateLoanSchedule(loanId, {
      endDate: formattedEndDate,
      duration: loan.duration,
      skipDisbursement: true
    });

    // Fetch and reapply all non-deleted repayment transactions
    const transactions = await api.entities.Transaction.filter({
      loan_id: loanId,
      is_deleted: false
    }, 'date');

    const repayments = transactions.filter(t => t.type === 'Repayment');

    if (repayments.length > 0) {
      // Get the new schedule
      const newScheduleRows = await api.entities.RepaymentSchedule.filter(
        { loan_id: loanId },
        'installment_number'
      );

      let totalPrincipalPaid = 0;
      let totalInterestPaid = 0;

      // Reapply each repayment
      for (const tx of repayments) {
        const { updates } = applyPaymentWaterfall(tx.amount, newScheduleRows, 0, 'credit');

        for (const update of updates) {
          await api.entities.RepaymentSchedule.update(update.id, {
            interest_paid: update.interest_paid,
            principal_paid: update.principal_paid,
            status: update.status
          });
          totalPrincipalPaid += update.principalApplied;
          totalInterestPaid += update.interestApplied;
        }
      }

      // Update loan payment totals
      await api.entities.Loan.update(loanId, {
        principal_paid: totalPrincipalPaid,
        interest_paid: totalInterestPaid
      });
    }

    console.log(`[AutoExtend] Successfully extended loan ${loan.loan_number || loanId}`);

    return {
      success: true,
      loanId,
      loanNumber: loan.loan_number,
      message: `Extended to ${formattedEndDate}`
    };

  } catch (error) {
    console.error(`[AutoExtend] Error processing loan ${loan.loan_number || loanId}:`, error);

    return {
      success: false,
      loanId,
      loanNumber: loan.loan_number,
      error: error.message
    };
  }
}

/**
 * Run auto-extend for all eligible loans
 * Eligible loans: auto_extend = true AND status = 'Live'
 *
 * @param {Object} options - Options for the auto-extend run
 * @param {Date} options.endDate - Date to extend schedules to (defaults to today)
 * @param {string} options.organizationId - Optional organization ID to filter by
 * @param {Function} options.onProgress - Optional callback for progress updates
 * @returns {Object} Summary of the auto-extend run
 */
export async function runAutoExtend(options = {}) {
  const {
    endDate = new Date(),
    organizationId = null,
    onProgress = null
  } = options;

  console.log('[AutoExtend] Starting auto-extend run...');
  console.log(`[AutoExtend] End date: ${format(endDate, 'yyyy-MM-dd')}`);

  const startTime = Date.now();
  const results = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    loans: [],
    startTime: new Date().toISOString(),
    endTime: null,
    duration: null
  };

  try {
    // Build filter for eligible loans
    const filter = {
      auto_extend: true,
      status: 'Live',
      is_deleted: false
    };

    if (organizationId) {
      filter.organization_id = organizationId;
    }

    // Fetch all eligible loans
    const eligibleLoans = await api.entities.Loan.filter(filter, 'loan_number');

    console.log(`[AutoExtend] Found ${eligibleLoans.length} eligible loans`);

    if (eligibleLoans.length === 0) {
      results.endTime = new Date().toISOString();
      results.duration = Date.now() - startTime;
      return results;
    }

    // Process each loan
    for (let i = 0; i < eligibleLoans.length; i++) {
      const loan = eligibleLoans[i];

      // Report progress if callback provided
      if (onProgress) {
        onProgress({
          current: i + 1,
          total: eligibleLoans.length,
          loan: loan.loan_number || loan.id,
          percent: Math.round(((i + 1) / eligibleLoans.length) * 100)
        });
      }

      // Check if schedule already extends to/beyond the end date
      const schedule = await api.entities.RepaymentSchedule.filter(
        { loan_id: loan.id },
        '-due_date'  // Sort descending to get latest first
      );

      if (schedule.length > 0) {
        const latestDueDate = new Date(schedule[0].due_date);
        if (latestDueDate >= endDate) {
          console.log(`[AutoExtend] Loan ${loan.loan_number || loan.id} already extends to ${format(latestDueDate, 'yyyy-MM-dd')}, skipping`);
          results.skipped++;
          results.loans.push({
            loanId: loan.id,
            loanNumber: loan.loan_number,
            status: 'skipped',
            reason: `Already extends to ${format(latestDueDate, 'yyyy-MM-dd')}`
          });
          continue;
        }
      }

      // Process the loan
      const result = await processLoanAutoExtend(loan, endDate);
      results.processed++;

      if (result.success) {
        results.succeeded++;
      } else {
        results.failed++;
      }

      results.loans.push({
        loanId: result.loanId,
        loanNumber: result.loanNumber,
        status: result.success ? 'success' : 'failed',
        message: result.success ? result.message : result.error
      });

      // Small delay between loans to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

  } catch (error) {
    console.error('[AutoExtend] Fatal error during auto-extend run:', error);
    results.error = error.message;
  }

  results.endTime = new Date().toISOString();
  results.duration = Date.now() - startTime;

  console.log('[AutoExtend] Run complete:', {
    processed: results.processed,
    succeeded: results.succeeded,
    failed: results.failed,
    skipped: results.skipped,
    duration: `${results.duration}ms`
  });

  return results;
}

/**
 * Check if any loans need auto-extension
 * Useful for showing a notification or badge in the UI
 *
 * @param {string} organizationId - Optional organization ID to filter by
 * @returns {Object} Count and list of loans needing extension
 */
export async function checkLoansNeedingExtension(organizationId = null) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const filter = {
    auto_extend: true,
    status: 'Live',
    is_deleted: false
  };

  if (organizationId) {
    filter.organization_id = organizationId;
  }

  const eligibleLoans = await api.entities.Loan.filter(filter, 'loan_number');
  const loansNeedingExtension = [];

  for (const loan of eligibleLoans) {
    const schedule = await api.entities.RepaymentSchedule.filter(
      { loan_id: loan.id },
      '-due_date'
    );

    if (schedule.length > 0) {
      const latestDueDate = new Date(schedule[0].due_date);
      if (latestDueDate < today) {
        loansNeedingExtension.push({
          id: loan.id,
          loanNumber: loan.loan_number,
          borrowerName: loan.borrower_name,
          latestDueDate: format(latestDueDate, 'yyyy-MM-dd'),
          daysOverdue: Math.floor((today - latestDueDate) / (1000 * 60 * 60 * 24))
        });
      }
    }
  }

  return {
    count: loansNeedingExtension.length,
    loans: loansNeedingExtension
  };
}

export default {
  runAutoExtend,
  checkLoansNeedingExtension
};
