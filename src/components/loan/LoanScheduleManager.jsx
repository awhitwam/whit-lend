import { base44 } from '@/api/base44Client';
import { generateRepaymentSchedule, calculateLoanSummary } from './LoanCalculator';

/**
 * Regenerates and applies a repayment schedule to a loan based on product settings
 * This clears the existing schedule and creates a new one
 * 
 * @param {string} loanId - The loan ID
 * @param {Object} options - Optional overrides
 * @param {number} options.duration - Custom duration (otherwise calculates from transactions)
 * @param {boolean} options.autoExtend - Enable auto-extend
 * @returns {Promise<Object>} - Updated loan and schedule summary
 */
export async function regenerateLoanSchedule(loanId, options = {}) {
  // Fetch loan details
  const loans = await base44.entities.Loan.filter({ id: loanId });
  const loan = loans[0];
  
  if (!loan) {
    throw new Error('Loan not found');
  }

  // Fetch product to get latest settings
  const products = await base44.entities.LoanProduct.filter({ id: loan.product_id });
  const product = products[0];
  
  if (!product) {
    throw new Error('Loan product not found');
  }

  // Determine duration
  let duration = options.duration || loan.duration;
  
  // If calculating from transactions, find the latest transaction date
  if (!options.duration) {
    const transactions = await base44.entities.Transaction.filter({ 
      loan_id: loanId, 
      is_deleted: false 
    }, '-date');
    
    if (transactions.length > 0) {
      const latestTx = transactions[0];
      const loanStartDate = new Date(loan.start_date);
      const latestTxDate = new Date(latestTx.date);
      
      const monthsDiff = Math.ceil(
        (latestTxDate - loanStartDate) / (1000 * 60 * 60 * 24 * 30.44)
      );
      duration = Math.max(monthsDiff + 6, duration); // Add buffer
    }
  }

  // Generate new schedule
  const newSchedule = generateRepaymentSchedule({
    principal: loan.principal_amount,
    interestRate: product.interest_rate,
    duration: duration,
    interestType: product.interest_type,
    period: product.period,
    startDate: loan.start_date,
    interestOnlyPeriod: product.interest_only_period || 0,
    interestAlignment: product.interest_alignment || 'period_based',
    extendForFullPeriod: product.extend_for_full_period || false
  });

  const summary = calculateLoanSummary(newSchedule);

  // Delete old schedule
  const oldSchedule = await base44.entities.RepaymentSchedule.filter({ loan_id: loanId });
  for (const row of oldSchedule) {
    await base44.entities.RepaymentSchedule.delete(row.id);
  }

  // Create new schedule
  for (const row of newSchedule) {
    await base44.entities.RepaymentSchedule.create({
      loan_id: loanId,
      ...row
    });
  }

  // Update loan with new settings and totals
  await base44.entities.Loan.update(loanId, {
    interest_rate: product.interest_rate,
    interest_type: product.interest_type,
    period: product.period,
    duration: duration,
    total_interest: summary.totalInterest,
    total_repayable: summary.totalRepayable + (loan.exit_fee || 0),
    auto_extend: options.autoExtend !== undefined ? options.autoExtend : loan.auto_extend
  });

  return {
    loan: { ...loan, duration },
    schedule: newSchedule,
    summary
  };
}

/**
 * Applies a schedule to a newly created loan during import
 * Similar to regenerateLoanSchedule but optimized for bulk operations
 */
export async function applyScheduleToNewLoan(loanData, product, options = {}) {
  const { duration = 6, autoExtend = true } = options;
  
  // Generate schedule
  const schedule = generateRepaymentSchedule({
    principal: loanData.principal_amount,
    interestRate: product.interest_rate,
    duration: duration,
    interestType: product.interest_type,
    period: product.period,
    startDate: loanData.start_date,
    interestOnlyPeriod: product.interest_only_period || 0,
    interestAlignment: product.interest_alignment || 'period_based',
    extendForFullPeriod: product.extend_for_full_period || false
  });

  const summary = calculateLoanSummary(schedule);

  // Create loan
  const loan = await base44.entities.Loan.create({
    ...loanData,
    interest_rate: product.interest_rate,
    interest_type: product.interest_type,
    period: product.period,
    duration: duration,
    total_interest: summary.totalInterest,
    total_repayable: summary.totalRepayable + (loanData.exit_fee || 0),
    auto_extend: autoExtend,
    principal_paid: 0,
    interest_paid: 0
  });

  // Create schedule
  for (const row of schedule) {
    await base44.entities.RepaymentSchedule.create({
      loan_id: loan.id,
      ...row
    });
  }

  return { loan, schedule, summary };
}