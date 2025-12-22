import { base44 } from '@/api/base44Client';
import { addMonths, addWeeks, format, differenceInDays, startOfMonth } from 'date-fns';

/**
 * Calculate interest for a period based on product rules and principal balance
 */
function calculatePeriodInterest(principal, annualRate, period, interestType, daysInPeriod = null) {
  if (principal <= 0) return 0;
  
  const periodsPerYear = period === 'Monthly' ? 12 : 52;
  
  if (interestType === 'Flat') {
    // Flat rate: based on original principal, spread evenly
    return principal * (annualRate / 100) / periodsPerYear;
  } else {
    // Reducing, Interest-Only, Rolled-Up: based on current principal
    if (daysInPeriod) {
      // Pro-rated for partial period
      return principal * (annualRate / 100) * (daysInPeriod / 365);
    } else {
      return principal * (annualRate / 100) / periodsPerYear;
    }
  }
}

/**
 * Generate forward-looking repayment schedule from current state
 * Event-driven: considers all past transactions and builds schedule from now forward
 */
export async function regenerateLoanSchedule(loanId, options = {}) {
  // Fetch loan, product, and all transactions
  const loans = await base44.entities.Loan.filter({ id: loanId });
  const loan = loans[0];
  if (!loan) throw new Error('Loan not found');

  const products = await base44.entities.LoanProduct.filter({ id: loan.product_id });
  const product = products[0];
  if (!product) throw new Error('Loan product not found');

  const transactions = await base44.entities.Transaction.filter({ 
    loan_id: loanId, 
    is_deleted: false 
  }, 'date'); // Sorted by date ascending

  console.log('=== SCHEDULE ENGINE: Starting Regeneration ===');
  console.log('Loan:', { id: loanId, principal: loan.principal_amount, startDate: loan.start_date });
  console.log('Product:', { type: product.interest_type, rate: product.interest_rate, period: product.period });
  console.log('Events:', transactions.map(t => ({ date: t.date, type: t.type, amount: t.amount, principal: t.principal_applied, interest: t.interest_applied })));

  // Calculate current principal outstanding
  const totalDisbursed = loan.principal_amount + transactions
    .filter(t => t.type === 'Disbursement')
    .reduce((sum, t) => sum + t.amount, 0);
  
  const totalCapitalRepaid = transactions
    .filter(t => t.type === 'Repayment')
    .reduce((sum, t) => sum + (t.principal_applied || 0), 0);
  
  const currentPrincipalOutstanding = totalDisbursed - totalCapitalRepaid;

  console.log('Principal State:', { 
    totalDisbursed, 
    totalCapitalRepaid, 
    currentOutstanding: currentPrincipalOutstanding 
  });

  // Determine schedule horizon
  const loanStartDate = new Date(loan.start_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let scheduleDuration = options.duration || loan.duration;
  
  // For auto-extend loans, extend to cover periods up to today + buffer
  if (loan.auto_extend || currentPrincipalOutstanding > 0.01) {
    const daysElapsed = Math.max(0, differenceInDays(today, loanStartDate));
    const periodsElapsed = product.period === 'Monthly' 
      ? Math.ceil(daysElapsed / 30.44) 
      : Math.ceil(daysElapsed / 7);
    
    scheduleDuration = Math.max(periodsElapsed + 3, scheduleDuration);
  }

  console.log('Schedule Duration:', scheduleDuration, 'periods');

  // Generate schedule based on alignment
  const schedule = [];
  const annualRate = product.interest_rate;
  
  if (product.interest_alignment === 'monthly_first' && product.period === 'Monthly') {
    // Special case: align all interest to 1st of month
    generateMonthlyFirstSchedule(schedule, loan, product, scheduleDuration, currentPrincipalOutstanding, transactions);
  } else {
    // Standard: period-based from start date
    generatePeriodBasedSchedule(schedule, loan, product, scheduleDuration, currentPrincipalOutstanding, transactions);
  }

  console.log(`Generated ${schedule.length} schedule entries`);
  schedule.forEach((row, idx) => {
    console.log(`  [${idx + 1}] ${row.due_date}: Principal=${row.principal_amount}, Interest=${row.interest_amount}, Balance=${row.balance}`);
  });

  // Delete old schedule and create new one
  const oldSchedule = await base44.entities.RepaymentSchedule.filter({ loan_id: loanId });
  for (const row of oldSchedule) {
    await base44.entities.RepaymentSchedule.delete(row.id);
  }

  for (const row of schedule) {
    await base44.entities.RepaymentSchedule.create({
      loan_id: loanId,
      ...row
    });
  }

  // Calculate totals
  const totalInterest = schedule.reduce((sum, row) => sum + row.interest_amount, 0);
  const totalRepayable = totalInterest + currentPrincipalOutstanding + (loan.exit_fee || 0);

  // Update loan
  await base44.entities.Loan.update(loanId, {
    interest_rate: product.interest_rate,
    interest_type: product.interest_type,
    period: product.period,
    duration: scheduleDuration,
    total_interest: Math.round(totalInterest * 100) / 100,
    total_repayable: Math.round(totalRepayable * 100) / 100
  });

  console.log('=== SCHEDULE ENGINE: Regeneration Complete ===');

  return { loan, schedule, summary: { totalInterest, totalRepayable } };
}

/**
 * Generate period-based schedule (standard alignment from loan start date)
 */
function generatePeriodBasedSchedule(schedule, loan, product, duration, currentPrincipal, transactions) {
  const startDate = new Date(loan.start_date);
  const originalPrincipal = loan.principal_amount;
  const annualRate = product.interest_rate;
  const periodsPerYear = product.period === 'Monthly' ? 12 : 52;
  const periodRate = annualRate / 100 / periodsPerYear;

  let runningPrincipalOutstanding = currentPrincipal;

  for (let i = 1; i <= duration; i++) {
    const dueDate = product.period === 'Monthly' 
      ? addMonths(startDate, i)
      : addWeeks(startDate, i);

    // Calculate principal outstanding at START of this period
    // This is based on all capital repayments that occurred BEFORE this due date
    const capitalRepaymentsBeforeDueDate = transactions
      .filter(t => t.type === 'Repayment' && new Date(t.date) < dueDate)
      .reduce((sum, t) => sum + (t.principal_applied || 0), 0);
    
    const principalAtStartOfPeriod = originalPrincipal - capitalRepaymentsBeforeDueDate;

    // Calculate interest based on product type
    let interestForPeriod = 0;
    let principalForPeriod = 0;

    if (product.interest_type === 'Flat') {
      // Flat: interest on original principal
      interestForPeriod = calculatePeriodInterest(originalPrincipal, annualRate, product.period, 'Flat');
      principalForPeriod = 0; // Interest-only unless specified
    } else if (product.interest_type === 'Interest-Only') {
      // Interest-Only: interest on current principal
      interestForPeriod = calculatePeriodInterest(principalAtStartOfPeriod, annualRate, product.period, 'Interest-Only');
      principalForPeriod = 0;
      
      // Balloon payment on last period
      if (i === duration) {
        principalForPeriod = principalAtStartOfPeriod;
      }
    } else if (product.interest_type === 'Reducing') {
      // Reducing balance: calculate interest on outstanding, plus principal repayment
      interestForPeriod = calculatePeriodInterest(principalAtStartOfPeriod, annualRate, product.period, 'Reducing');
      
      // Calculate principal portion (amortizing)
      const remainingPeriods = duration - i + 1;
      const periodicPayment = principalAtStartOfPeriod * (periodRate * Math.pow(1 + periodRate, remainingPeriods)) / (Math.pow(1 + periodRate, remainingPeriods) - 1);
      principalForPeriod = periodicPayment - interestForPeriod;
    } else if (product.interest_type === 'Rolled-Up') {
      // Rolled-up: interest compounds, no payments until end
      interestForPeriod = calculatePeriodInterest(principalAtStartOfPeriod, annualRate, product.period, 'Rolled-Up');
      principalForPeriod = 0;
      
      // Full settlement on last period
      if (i === duration) {
        principalForPeriod = principalAtStartOfPeriod;
      }
    }

    const balanceAfterPeriod = principalAtStartOfPeriod - principalForPeriod;

    schedule.push({
      installment_number: i,
      due_date: format(dueDate, 'yyyy-MM-dd'),
      principal_amount: Math.round(principalForPeriod * 100) / 100,
      interest_amount: Math.round(interestForPeriod * 100) / 100,
      total_due: Math.round((principalForPeriod + interestForPeriod) * 100) / 100,
      balance: Math.max(0, Math.round(balanceAfterPeriod * 100) / 100),
      principal_paid: 0,
      interest_paid: 0,
      status: 'Pending'
    });
  }
}

/**
 * Generate monthly-first aligned schedule (all interest on 1st of month)
 */
function generateMonthlyFirstSchedule(schedule, loan, product, duration, currentPrincipal, transactions) {
  const startDate = new Date(loan.start_date);
  const originalPrincipal = loan.principal_amount;
  const annualRate = product.interest_rate;
  const dailyRate = annualRate / 100 / 365;
  const monthlyRate = annualRate / 100 / 12;

  // First period: pro-rated from start date to end of month (if not already 1st)
  let currentDate = startDate;
  let installmentNum = 1;

  if (startDate.getDate() !== 1) {
    const endOfFirstMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
    const daysInFirstPeriod = differenceInDays(endOfFirstMonth, startDate) + 1;
    
    const interestForFirstPeriod = calculatePeriodInterest(
      currentPrincipal, 
      annualRate, 
      product.period, 
      product.interest_type, 
      daysInFirstPeriod
    );

    schedule.push({
      installment_number: installmentNum++,
      due_date: format(startDate, 'yyyy-MM-dd'),
      principal_amount: 0,
      interest_amount: Math.round(interestForFirstPeriod * 100) / 100,
      total_due: Math.round(interestForFirstPeriod * 100) / 100,
      balance: currentPrincipal,
      principal_paid: 0,
      interest_paid: 0,
      status: 'Pending'
    });
  }

  // Subsequent periods: aligned to 1st of each month
  for (let monthOffset = 1; monthOffset <= duration; monthOffset++) {
    const dueDate = addMonths(startOfMonth(startDate), monthOffset);
    
    // Calculate principal at start of this period
    const capitalRepaymentsBeforeDueDate = transactions
      .filter(t => t.type === 'Repayment' && new Date(t.date) < dueDate)
      .reduce((sum, t) => sum + (t.principal_applied || 0), 0);
    
    const principalAtStart = originalPrincipal - capitalRepaymentsBeforeDueDate;

    // Calculate interest and principal for this period
    let interestForPeriod = calculatePeriodInterest(principalAtStart, annualRate, product.period, product.interest_type);
    let principalForPeriod = 0;

    // Balloon payment on last period for interest-only/rolled-up
    if (monthOffset === duration && (product.interest_type === 'Interest-Only' || product.interest_type === 'Rolled-Up')) {
      principalForPeriod = principalAtStart;
    }

    schedule.push({
      installment_number: installmentNum++,
      due_date: format(dueDate, 'yyyy-MM-dd'),
      principal_amount: Math.round(principalForPeriod * 100) / 100,
      interest_amount: Math.round(interestForPeriod * 100) / 100,
      total_due: Math.round((principalForPeriod + interestForPeriod) * 100) / 100,
      balance: Math.max(0, principalAtStart - principalForPeriod),
      principal_paid: 0,
      interest_paid: 0,
      status: 'Pending'
    });
  }
}

/**
 * Apply schedule to new loan during creation/import
 */
export async function applyScheduleToNewLoan(loanData, product, options = {}) {
  const { duration = 6, autoExtend = true } = options;
  
  const schedule = [];
  generatePeriodBasedSchedule(schedule, 
    { ...loanData, product_id: product.id }, 
    product, 
    duration, 
    loanData.principal_amount,
    [] // No transactions yet
  );

  const totalInterest = schedule.reduce((sum, row) => sum + row.interest_amount, 0);
  const totalRepayable = totalInterest + loanData.principal_amount + (loanData.exit_fee || 0);

  const loan = await base44.entities.Loan.create({
    ...loanData,
    interest_rate: product.interest_rate,
    interest_type: product.interest_type,
    period: product.period,
    duration: duration,
    total_interest: Math.round(totalInterest * 100) / 100,
    total_repayable: Math.round(totalRepayable * 100) / 100,
    auto_extend: autoExtend,
    principal_paid: 0,
    interest_paid: 0
  });

  for (const row of schedule) {
    await base44.entities.RepaymentSchedule.create({
      loan_id: loan.id,
      ...row
    });
  }

  return { loan, schedule, summary: { totalInterest, totalRepayable } };
}

/**
 * Format currency
 */
export function formatCurrency(amount, currency = 'GBP') {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2
  }).format(amount || 0);
}