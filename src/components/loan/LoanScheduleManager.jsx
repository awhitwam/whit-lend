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

  // Determine schedule horizon - must ensure coverage of all outstanding amounts
  const loanStartDate = new Date(loan.start_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let scheduleDuration = options.duration || loan.duration;
  const explicitDuration = options.duration !== undefined;
  
  // Calculate dynamic principal outstanding from transactions
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

  // Dynamic duration: extend schedule until principal is fully repaid (only if duration not explicitly set)
  if (!explicitDuration && (currentPrincipalOutstanding > 0.01 || loan.auto_extend)) {
    const daysElapsed = Math.max(0, differenceInDays(today, loanStartDate));
    const periodsElapsed = product.period === 'Monthly' 
      ? Math.ceil(daysElapsed / 30.44) 
      : Math.ceil(daysElapsed / 7);
    
    // For Interest-Only and Rolled-Up, must extend to show full term
    if (product.interest_type === 'Interest-Only' || product.interest_type === 'Rolled-Up') {
      scheduleDuration = Math.max(periodsElapsed + 6, scheduleDuration);
    } else {
      // For amortizing loans, extend if principal still outstanding
      scheduleDuration = Math.max(periodsElapsed + 3, scheduleDuration);
    }
    
    // Never shorten auto-extend loans
    if (loan.auto_extend) {
      scheduleDuration = Math.max(scheduleDuration, loan.duration || 6);
    }
  }

  console.log('Schedule Duration:', scheduleDuration, 'periods');

  // Generate schedule using event-driven approach
  const schedule = [];
  
  if (product.interest_alignment === 'monthly_first' && product.period === 'Monthly') {
    // Special case: align all interest to 1st of month
    generateMonthlyFirstSchedule(schedule, loan, product, scheduleDuration, transactions);
  } else {
    // Standard: period-based from start date with event-driven calculations
    generatePeriodBasedSchedule(schedule, loan, product, scheduleDuration, transactions);
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

  // Calculate totals from generated schedule
  const totalInterest = schedule.reduce((sum, row) => sum + row.interest_amount, 0);
  const finalBalance = schedule.length > 0 ? schedule[schedule.length - 1].balance : currentPrincipalOutstanding;
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
 * Event-driven approach: calculates interest dynamically based on actual principal at each point in time
 */
function generatePeriodBasedSchedule(schedule, loan, product, duration, transactions) {
  const startDate = new Date(loan.start_date);
  const originalPrincipal = loan.principal_amount;
  const annualRate = product.interest_rate;
  const dailyRate = annualRate / 100 / 365;
  const periodsPerYear = product.period === 'Monthly' ? 12 : 52;
  const periodRate = annualRate / 100 / periodsPerYear;
  const useMonthlyFixedInterest = product.interest_calculation_method === 'monthly' && product.period === 'Monthly';
  const fixedMonthlyDays = 365 / 12; // 30.4167 days per month

  // Build a complete event timeline: all transactions + all schedule due dates
  const events = [];
  
  // Add all capital-affecting transactions as events
  transactions.forEach(t => {
    if (t.type === 'Repayment' && t.principal_applied > 0) {
      events.push({
        date: new Date(t.date),
        type: 'capital_repayment',
        amount: t.principal_applied
      });
    } else if (t.type === 'Disbursement') {
      events.push({
        date: new Date(t.date),
        type: 'disbursement',
        amount: t.amount
      });
    }
  });

  // Add all schedule due dates as events
  for (let i = 1; i <= duration; i++) {
    const dueDate = product.period === 'Monthly' 
      ? addMonths(startDate, i)
      : addWeeks(startDate, i);
    events.push({
      date: dueDate,
      type: 'schedule_due',
      periodNumber: i
    });
  }

  // Sort all events chronologically
  events.sort((a, b) => a.date - b.date);

  // Initialize running state
  let runningPrincipal = originalPrincipal;
  let lastEventDate = startDate;

  console.log('Event Timeline:', events.map(e => ({ date: format(e.date, 'yyyy-MM-dd'), type: e.type, amount: e.amount })));

  // Process each schedule period
  for (let i = 1; i <= duration; i++) {
    const periodStartDate = i === 1 ? startDate : (product.period === 'Monthly' ? addMonths(startDate, i - 1) : addWeeks(startDate, i - 1));
    const periodEndDate = product.period === 'Monthly' ? addMonths(startDate, i) : addWeeks(startDate, i);

    // Get all capital events within this period (between periodStartDate and periodEndDate)
    const capitalEventsInPeriod = events.filter(e => 
      (e.type === 'capital_repayment' || e.type === 'disbursement') &&
      e.date >= periodStartDate && 
      e.date < periodEndDate
    );

    // Calculate principal outstanding at START of period
    const principalAtStart = calculatePrincipalAtDate(originalPrincipal, transactions, periodStartDate);

    // Calculate interest for this period
    let totalInterestForPeriod = 0;
    let totalDaysInPeriod = 0;

    if (useMonthlyFixedInterest && i > 1) {
      // For monthly fixed: use fixed days (365/12) for all periods after the first
      totalDaysInPeriod = Math.round(fixedMonthlyDays);

      // Still need to account for mid-period capital changes
      let currentSegmentStart = periodStartDate;
      let currentSegmentPrincipal = principalAtStart;

      capitalEventsInPeriod.sort((a, b) => a.date - b.date);

      // Calculate weighted interest based on capital changes
      for (const event of capitalEventsInPeriod) {
        const daysInSegment = Math.max(0, differenceInDays(event.date, currentSegmentStart));
        if (daysInSegment > 0 && currentSegmentPrincipal > 0) {
          const segmentInterest = calculateInterestForDays(
            currentSegmentPrincipal, 
            dailyRate, 
            daysInSegment, 
            product.interest_type,
            originalPrincipal
          );
          totalInterestForPeriod += segmentInterest;
        }

        if (event.type === 'capital_repayment') {
          currentSegmentPrincipal -= event.amount;
        } else if (event.type === 'disbursement') {
          currentSegmentPrincipal += event.amount;
        }
        currentSegmentPrincipal = Math.max(0, currentSegmentPrincipal);
        currentSegmentStart = event.date;
      }

      // Final segment to period end
      const finalDays = Math.max(0, differenceInDays(periodEndDate, currentSegmentStart));
      if (finalDays > 0 && currentSegmentPrincipal > 0) {
        const finalSegmentInterest = calculateInterestForDays(
          currentSegmentPrincipal, 
          dailyRate, 
          finalDays, 
          product.interest_type,
          originalPrincipal
        );
        totalInterestForPeriod += finalSegmentInterest;
      }

      // Override total interest with fixed calculation if no mid-period changes
      if (capitalEventsInPeriod.length === 0) {
        totalInterestForPeriod = calculateInterestForDays(
          principalAtStart,
          dailyRate,
          totalDaysInPeriod,
          product.interest_type,
          originalPrincipal
        );
      }
    } else {
      // Daily interest calculation (original logic)
      totalDaysInPeriod = differenceInDays(periodEndDate, periodStartDate);
      let currentSegmentStart = periodStartDate;
      let currentSegmentPrincipal = principalAtStart;

      capitalEventsInPeriod.sort((a, b) => a.date - b.date);

      // Process each segment between capital events
      for (const event of capitalEventsInPeriod) {
        const daysInSegment = Math.max(0, differenceInDays(event.date, currentSegmentStart));
        if (daysInSegment > 0 && currentSegmentPrincipal > 0) {
          const segmentInterest = calculateInterestForDays(
            currentSegmentPrincipal, 
            dailyRate, 
            daysInSegment, 
            product.interest_type,
            originalPrincipal
          );
          totalInterestForPeriod += segmentInterest;
          console.log(`  Segment: ${format(currentSegmentStart, 'MMM dd')} to ${format(event.date, 'MMM dd')}, ${daysInSegment} days, Principal=${currentSegmentPrincipal.toFixed(2)}, Interest=${segmentInterest.toFixed(2)}`);
        }

        // Update principal for next segment
        if (event.type === 'capital_repayment') {
          currentSegmentPrincipal -= event.amount;
        } else if (event.type === 'disbursement') {
          currentSegmentPrincipal += event.amount;
        }
        currentSegmentPrincipal = Math.max(0, currentSegmentPrincipal);
        currentSegmentStart = event.date;
      }

      // Calculate interest for final segment (from last event to period end)
      const finalDays = Math.max(0, differenceInDays(periodEndDate, currentSegmentStart));
      if (finalDays > 0 && currentSegmentPrincipal > 0) {
        const finalSegmentInterest = calculateInterestForDays(
          currentSegmentPrincipal, 
          dailyRate, 
          finalDays, 
          product.interest_type,
          originalPrincipal
        );
        totalInterestForPeriod += finalSegmentInterest;
        console.log(`  Final Segment: ${format(currentSegmentStart, 'MMM dd')} to ${format(periodEndDate, 'MMM dd')}, ${finalDays} days, Principal=${currentSegmentPrincipal.toFixed(2)}, Interest=${finalSegmentInterest.toFixed(2)}`);
      }
    }

    // Calculate principal portion for this period
    let principalForPeriod = 0;
    const principalAtEnd = calculatePrincipalAtDate(originalPrincipal, transactions, periodEndDate);

    if (product.interest_type === 'Flat') {
      principalForPeriod = 0; // Interest-only for flat rate
    } else if (product.interest_type === 'Interest-Only') {
      principalForPeriod = 0;
      // Balloon payment on last period
      if (i === duration) {
        principalForPeriod = principalAtEnd;
      }
    } else if (product.interest_type === 'Reducing') {
      // Amortizing: calculate expected principal repayment
      const remainingPeriods = duration - i + 1;
      if (principalAtStart > 0 && remainingPeriods > 0) {
        const periodicPayment = principalAtStart * (periodRate * Math.pow(1 + periodRate, remainingPeriods)) / (Math.pow(1 + periodRate, remainingPeriods) - 1);
        principalForPeriod = Math.max(0, periodicPayment - totalInterestForPeriod);
      }
    } else if (product.interest_type === 'Rolled-Up') {
      principalForPeriod = 0;
      // Full settlement on last period
      if (i === duration) {
        principalForPeriod = principalAtEnd;
      }
    }

    schedule.push({
      installment_number: i,
      due_date: format(periodEndDate, 'yyyy-MM-dd'),
      principal_amount: Math.round(principalForPeriod * 100) / 100,
      interest_amount: Math.round(totalInterestForPeriod * 100) / 100,
      total_due: Math.round((principalForPeriod + totalInterestForPeriod) * 100) / 100,
      balance: Math.max(0, Math.round(principalAtEnd * 100) / 100),
      principal_paid: 0,
      interest_paid: 0,
      status: 'Pending',
      calculation_days: totalDaysInPeriod,
      calculation_principal_start: Math.round(principalAtStart * 100) / 100
    });

    console.log(`Period ${i} (${format(periodEndDate, 'yyyy-MM-dd')}): Interest=${totalInterestForPeriod.toFixed(2)}, Principal=${principalForPeriod.toFixed(2)}, Balance=${principalAtEnd.toFixed(2)}`);
  }
}

/**
 * Calculate principal outstanding at a specific date
 * Considers all transactions up to (but not including) that date
 */
function calculatePrincipalAtDate(initialPrincipal, transactions, date) {
  const disbursements = transactions
    .filter(t => t.type === 'Disbursement' && new Date(t.date) < date)
    .reduce((sum, t) => sum + t.amount, 0);
  
  const repayments = transactions
    .filter(t => t.type === 'Repayment' && new Date(t.date) < date)
    .reduce((sum, t) => sum + (t.principal_applied || 0), 0);
  
  return Math.max(0, initialPrincipal + disbursements - repayments);
}

/**
 * Calculate interest for a specific number of days on a principal amount
 * Handles different interest types appropriately
 */
function calculateInterestForDays(principal, dailyRate, days, interestType, originalPrincipal) {
  if (principal <= 0 || days <= 0) return 0;
  
  if (interestType === 'Flat') {
    // Flat rate: always based on original principal
    return originalPrincipal * dailyRate * days;
  } else {
    // Reducing, Interest-Only, Rolled-Up: based on current principal
    return principal * dailyRate * days;
  }
}

/**
 * Generate monthly-first aligned schedule (all interest on 1st of month)
 * Event-driven approach with intra-period calculations
 */
function generateMonthlyFirstSchedule(schedule, loan, product, duration, transactions) {
  const startDate = new Date(loan.start_date);
  const originalPrincipal = loan.principal_amount;
  const annualRate = product.interest_rate;
  const dailyRate = annualRate / 100 / 365;
  const monthlyRate = annualRate / 100 / 12;

  let installmentNum = 1;

  // First period: pro-rated from start date to end of month (if not already 1st)
  if (startDate.getDate() !== 1) {
    const endOfFirstMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
    const principalAtStart = calculatePrincipalAtDate(originalPrincipal, transactions, startDate);
    
    // Calculate pro-rated interest for first partial month with event-driven approach
    const capitalEventsInPeriod = transactions.filter(t => 
      (t.type === 'Repayment' && t.principal_applied > 0) &&
      new Date(t.date) >= startDate && 
      new Date(t.date) <= endOfFirstMonth
    );

    let totalInterest = 0;
    let segmentStart = startDate;
    let segmentPrincipal = principalAtStart;

    capitalEventsInPeriod.sort((a, b) => new Date(a.date) - new Date(b.date));

    for (const event of capitalEventsInPeriod) {
      const eventDate = new Date(event.date);
      const daysInSegment = Math.max(0, differenceInDays(eventDate, segmentStart));
      if (daysInSegment > 0 && segmentPrincipal > 0) {
        totalInterest += calculateInterestForDays(segmentPrincipal, dailyRate, daysInSegment, product.interest_type, originalPrincipal);
      }
      segmentPrincipal -= event.principal_applied;
      segmentStart = eventDate;
    }

    const finalDays = Math.max(0, differenceInDays(endOfFirstMonth, segmentStart) + 1);
    if (finalDays > 0 && segmentPrincipal > 0) {
      totalInterest += calculateInterestForDays(segmentPrincipal, dailyRate, finalDays, product.interest_type, originalPrincipal);
    }

    const daysInFirstPeriod = differenceInDays(endOfFirstMonth, startDate) + 1;
    
    schedule.push({
      installment_number: installmentNum++,
      due_date: format(startDate, 'yyyy-MM-dd'),
      principal_amount: 0,
      interest_amount: Math.round(totalInterest * 100) / 100,
      total_due: Math.round(totalInterest * 100) / 100,
      balance: principalAtStart,
      principal_paid: 0,
      interest_paid: 0,
      status: 'Pending',
      calculation_days: daysInFirstPeriod,
      calculation_principal_start: Math.round(principalAtStart * 100) / 100
    });
  }

  // Subsequent periods: aligned to 1st of each month with event-driven calculations
  for (let monthOffset = 1; monthOffset <= duration; monthOffset++) {
    const periodStart = monthOffset === 1 ? startOfMonth(addMonths(startDate, 1)) : addMonths(startOfMonth(startDate), monthOffset);
    const periodEnd = addMonths(periodStart, 1);
    
    const principalAtStart = calculatePrincipalAtDate(originalPrincipal, transactions, periodStart);

    // Calculate pro-rated interest for this month with mid-period events
    const capitalEventsInPeriod = transactions.filter(t => 
      (t.type === 'Repayment' && t.principal_applied > 0) &&
      new Date(t.date) >= periodStart && 
      new Date(t.date) < periodEnd
    );

    let totalInterest = 0;
    let segmentStart = periodStart;
    let segmentPrincipal = principalAtStart;

    capitalEventsInPeriod.sort((a, b) => new Date(a.date) - new Date(b.date));

    for (const event of capitalEventsInPeriod) {
      const eventDate = new Date(event.date);
      const daysInSegment = Math.max(0, differenceInDays(eventDate, segmentStart));
      if (daysInSegment > 0 && segmentPrincipal > 0) {
        totalInterest += calculateInterestForDays(segmentPrincipal, dailyRate, daysInSegment, product.interest_type, originalPrincipal);
      }
      segmentPrincipal -= event.principal_applied;
      segmentStart = eventDate;
    }

    const finalDays = Math.max(0, differenceInDays(periodEnd, segmentStart));
    if (finalDays > 0 && segmentPrincipal > 0) {
      totalInterest += calculateInterestForDays(segmentPrincipal, dailyRate, finalDays, product.interest_type, originalPrincipal);
    }

    let principalForPeriod = 0;
    const principalAtEnd = calculatePrincipalAtDate(originalPrincipal, transactions, periodEnd);

    // Balloon payment on last period for interest-only/rolled-up
    if (monthOffset === duration && (product.interest_type === 'Interest-Only' || product.interest_type === 'Rolled-Up')) {
      principalForPeriod = principalAtEnd;
    }

    const daysInPeriod = differenceInDays(periodEnd, periodStart);
    
    schedule.push({
      installment_number: installmentNum++,
      due_date: format(periodStart, 'yyyy-MM-dd'),
      principal_amount: Math.round(principalForPeriod * 100) / 100,
      interest_amount: Math.round(totalInterest * 100) / 100,
      total_due: Math.round((principalForPeriod + totalInterest) * 100) / 100,
      balance: Math.max(0, Math.round(principalAtEnd * 100) / 100),
      principal_paid: 0,
      interest_paid: 0,
      status: 'Pending',
      calculation_days: daysInPeriod,
      calculation_principal_start: Math.round(principalAtStart * 100) / 100
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