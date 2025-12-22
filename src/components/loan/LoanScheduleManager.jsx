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

  // For auto-extended loans or when recalculating, extend schedule to cover all transactions
  const transactions = await base44.entities.Transaction.filter({ 
    loan_id: loanId, 
    is_deleted: false,
    type: 'Repayment'
  }, '-date');

  console.log('=== REGENERATE SCHEDULE DEBUG ===');
  console.log('Loan ID:', loanId);
  console.log('Loan Start Date:', loan.start_date);
  console.log('Loan Principal:', loan.principal_amount);
  console.log('Interest Type:', product.interest_type);
  console.log('Interest Rate:', product.interest_rate);
  console.log('Period:', product.period);
  console.log('Number of transactions:', transactions.length);
  console.log('Auto-extend?:', loan.auto_extend);
  console.log('Original duration:', loan.duration);

  if (loan.auto_extend || !options.duration) {
    const loanStartDate = new Date(loan.start_date);
    const today = new Date();

    console.log('Today:', format(today, 'yyyy-MM-dd'));
    console.log('Days since loan start:', Math.ceil((today - loanStartDate) / (1000 * 60 * 60 * 24)));

    // For auto-extend loans, extend to cover period up to TODAY
    const daysElapsed = Math.ceil((today - loanStartDate) / (1000 * 60 * 60 * 24));
    const periodsNeeded = product.period === 'Monthly' 
      ? Math.ceil(daysElapsed / 30.44) 
      : Math.ceil(daysElapsed / 7);

    console.log('Periods needed to cover up to today:', periodsNeeded);

    // Ensure schedule covers up to today plus a buffer period
    duration = Math.max(periodsNeeded + 1, duration);
    console.log('Extended duration to:', duration);
  }

  // Calculate principal paid to date for reducing balance adjustment
  const principalPaidToDate = transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);

  console.log('Total principal paid (from transactions):', principalPaidToDate);
  console.log('Final duration for schedule generation:', duration);
  console.log('Transactions:', transactions.map(t => ({
    date: t.date,
    amount: t.amount,
    principal: t.principal_applied,
    interest: t.interest_applied
  })));

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
    extendForFullPeriod: product.extend_for_full_period || false,
    interestPaidInAdvance: product.interest_paid_in_advance || false,
    principalPaidToDate: principalPaidToDate,
    transactions: transactions
  });

  console.log(`Generated schedule (${newSchedule.length} total rows):`);
  newSchedule.forEach((row, idx) => {
    console.log(`  [${idx+1}] ${row.due_date}: Principal=${row.principal_amount}, Interest=${row.interest_amount}, Total=${row.total_due}`);
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
    extendForFullPeriod: product.extend_for_full_period || false,
    interestPaidInAdvance: product.interest_paid_in_advance || false
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