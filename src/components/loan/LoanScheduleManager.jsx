import { api } from '@/api/dataClient';
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
  const loans = await api.entities.Loan.filter({ id: loanId });
  const loan = loans[0];
  if (!loan) throw new Error('Loan not found');

  const products = await api.entities.LoanProduct.filter({ id: loan.product_id });
  const product = products[0];
  if (!product) throw new Error('Loan product not found');

  console.log('Product from DB:', {
    id: product.id,
    name: product.name,
    product_type: product.product_type,
    scheduler_type: product.scheduler_type
  });

  // NEW SCHEDULER SYSTEM: If product has scheduler_type, use the new scheduler-based system
  // This provides a clean migration path - products with scheduler_type use new code,
  // products without it continue using the legacy code below
  if (product.scheduler_type) {
    console.log('=== SCHEDULE ENGINE: Using New Scheduler System ===');
    console.log('Scheduler type:', product.scheduler_type);

    try {
      const { getScheduler, createScheduler } = await import('@/lib/schedule');
      const SchedulerClass = getScheduler(product.scheduler_type);

      if (SchedulerClass) {
        const scheduler = createScheduler(product.scheduler_type, product.scheduler_config || {});
        const result = await scheduler.generateSchedule({ loan, product, options });
        console.log('=== SCHEDULE ENGINE: New Scheduler Complete ===');
        return result;
      } else {
        console.warn(`Scheduler not found: ${product.scheduler_type}, falling back to legacy`);
      }
    } catch (err) {
      console.error('Error using new scheduler system, falling back to legacy:', err);
    }
  }

  // ============ LEGACY CODE BELOW ============
  // This code path handles products without scheduler_type set
  // Once all products are migrated, this can be removed

  // Check if this is an Irregular Income loan - no schedule should be generated
  if (product.product_type === 'Irregular Income') {
    console.log('=== SCHEDULE ENGINE: Irregular Income - Clearing Schedule ===');

    // Delete any existing schedule entries
    await api.entities.RepaymentSchedule.deleteWhere({ loan_id: loanId });

    // Update loan with zero interest values and sync product_type
    await api.entities.Loan.update(loanId, {
      interest_rate: 0,
      interest_type: 'None',
      product_type: 'Irregular Income',
      total_interest: 0,
      total_repayable: loan.principal_amount + (loan.exit_fee || 0)
    });

    console.log('=== SCHEDULE ENGINE: Irregular Income - Schedule Cleared ===');
    return { loan, schedule: [], summary: { totalInterest: 0, totalRepayable: loan.principal_amount } };
  }

  const transactions = await api.entities.Transaction.filter({ 
    loan_id: loanId, 
    is_deleted: false 
  }, 'date'); // Sorted by date ascending

  // Determine effective interest rate - use loan override if set, otherwise product rate
  const effectiveInterestRate = loan.override_interest_rate && loan.overridden_rate != null
    ? loan.overridden_rate
    : product.interest_rate;

  console.log('=== SCHEDULE ENGINE: Starting Regeneration ===');
  console.log('Loan:', { id: loanId, principal: loan.principal_amount, startDate: loan.start_date, overrideRate: loan.override_interest_rate, overriddenRate: loan.overridden_rate });
  console.log('Product:', { type: product.interest_type, rate: product.interest_rate, period: product.period });
  console.log('Effective Interest Rate:', effectiveInterestRate);
  console.log('Events:', transactions.map(t => ({ date: t.date, type: t.type, amount: t.amount, principal: t.principal_applied, interest: t.interest_applied })));

  // Determine schedule horizon - must ensure coverage of all outstanding amounts
  const loanStartDate = new Date(loan.start_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Calculate dynamic principal outstanding from actual disbursement transactions
  // (Don't add loan.principal_amount - disbursements already represent the principal)
  const totalDisbursed = transactions
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

  // Determine schedule duration based on end date or auto-extend logic
  let scheduleDuration;
  let scheduleEndDate = options.endDate ? new Date(options.endDate) : today;
  scheduleEndDate.setHours(0, 0, 0, 0);
  const isSettledLoan = options.endDate && currentPrincipalOutstanding <= 0.01;

  // Base duration from options or loan
  const baseDuration = options.duration !== undefined ? options.duration : loan.duration;

  if (isSettledLoan) {
    // Settled loan: calculate exact periods from start to settlement date
    const daysToEndDate = Math.max(0, differenceInDays(scheduleEndDate, loanStartDate));
    scheduleDuration = product.period === 'Monthly'
      ? Math.ceil(daysToEndDate / 30.44)
      : Math.ceil(daysToEndDate / 7);

    // Ensure at least 1 period
    scheduleDuration = Math.max(1, scheduleDuration);
    console.log('Settled loan: truncating schedule at settlement date');
  } else if (options.endDate && loan.auto_extend) {
    // Auto-extend: generate schedule up to end date AND ensure at least one future period
    const daysToEndDate = Math.max(0, differenceInDays(scheduleEndDate, loanStartDate));
    let calculatedDuration = product.period === 'Monthly'
      ? Math.ceil(daysToEndDate / 30.44)
      : Math.ceil(daysToEndDate / 7);

    console.log('Auto-extend DEBUG:', {
      loanStartDate: format(loanStartDate, 'yyyy-MM-dd'),
      scheduleEndDate: format(scheduleEndDate, 'yyyy-MM-dd'),
      daysToEndDate,
      calculatedDuration,
      interestAlignment: product.interest_alignment
    });

    // Ensure at least 1 period
    calculatedDuration = Math.max(1, calculatedDuration);

    // ALWAYS include the next upcoming period so there's a future due date
    // Calculate what the last period's due date would be, and if it's <= today, add one more
    // For "in advance" loans, due date is at START of period (i-1), not END (i)
    let lastPeriodDate;
    if (product.interest_alignment === 'monthly_first') {
      lastPeriodDate = startOfMonth(addMonths(loanStartDate, calculatedDuration));
    } else if (product.interest_paid_in_advance) {
      // In advance: due date for period N is addMonths(start, N-1)
      // So last due date for calculatedDuration periods is addMonths(start, calculatedDuration - 1)
      lastPeriodDate = addMonths(loanStartDate, calculatedDuration - 1);
    } else {
      // Arrears: due date for period N is addMonths(start, N)
      lastPeriodDate = addMonths(loanStartDate, calculatedDuration);
    }

    console.log('Auto-extend DEBUG lastPeriodDate:', format(lastPeriodDate, 'yyyy-MM-dd'), 'vs scheduleEndDate:', format(scheduleEndDate, 'yyyy-MM-dd'), 'add more?', lastPeriodDate <= scheduleEndDate, 'inAdvance:', product.interest_paid_in_advance);

    if (lastPeriodDate <= scheduleEndDate) {
      calculatedDuration += 1;
    }

    scheduleDuration = calculatedDuration;
    console.log('Auto-extend: generating schedule with', calculatedDuration, 'periods');
  } else if (options.endDate && currentPrincipalOutstanding > 0.01) {
    // Non-auto-extend but has principal outstanding: use full loan duration
    scheduleDuration = baseDuration || 6;
  } else if (options.duration !== undefined) {
    // Explicit duration provided without auto-extend
    scheduleDuration = options.duration;
  } else {
    // Use original loan duration
    scheduleDuration = loan.duration;
  }

  console.log('Schedule Duration:', scheduleDuration, 'periods', `(End Date: ${format(scheduleEndDate, 'yyyy-MM-dd')})`);

  // Create effective product with potentially overridden interest rate
  const effectiveProduct = {
    ...product,
    interest_rate: effectiveInterestRate
  };

  // Generate schedule using event-driven approach
  const schedule = [];

  // Original loan duration (for marking extension periods)
  const originalLoanDuration = loan.duration;

  if (product.interest_alignment === 'monthly_first' && product.period === 'Monthly') {
    // Special case: align all interest to 1st of month
    generateMonthlyFirstSchedule(schedule, loan, effectiveProduct, scheduleDuration, transactions, originalLoanDuration);
  } else {
    // Standard: period-based from start date with event-driven calculations
    generatePeriodBasedSchedule(schedule, loan, effectiveProduct, scheduleDuration, transactions, scheduleEndDate, options, originalLoanDuration);
  }

  console.log(`Generated ${schedule.length} schedule entries`);

  // For settled loans, filter out any periods after the settlement date
  let finalSchedule = schedule;
  if (isSettledLoan) {
    finalSchedule = schedule.filter(row => {
      const dueDate = new Date(row.due_date);
      dueDate.setHours(0, 0, 0, 0);
      return dueDate <= scheduleEndDate;
    });
    console.log(`Settled loan: filtered to ${finalSchedule.length} entries (before settlement date)`);
  }

  finalSchedule.forEach((row, idx) => {
    console.log(`  [${idx + 1}] ${row.due_date}: Principal=${row.principal_amount}, Interest=${row.interest_amount}, Balance=${row.balance}`);
  });

  // Delete old schedule and create new one (using batch operations for speed)
  await api.entities.RepaymentSchedule.deleteWhere({ loan_id: loanId });

  // Batch create all schedule rows at once
  const scheduleWithLoanId = finalSchedule.map(row => ({
    loan_id: loanId,
    ...row
  }));
  await api.entities.RepaymentSchedule.createMany(scheduleWithLoanId);

  // Calculate totals from generated schedule
  const totalInterest = finalSchedule.reduce((sum, row) => sum + row.interest_amount, 0);
  const finalBalance = finalSchedule.length > 0 ? finalSchedule[finalSchedule.length - 1].balance : currentPrincipalOutstanding;
  const totalRepayable = totalInterest + currentPrincipalOutstanding + (loan.exit_fee || 0);

  // Update loan - use effective rate (which may be overridden) and sync product_type
  await api.entities.Loan.update(loanId, {
    interest_rate: effectiveInterestRate,
    interest_type: product.interest_type,
    product_type: product.product_type || 'Standard',
    period: product.period,
    total_interest: Math.round(totalInterest * 100) / 100,
    total_repayable: Math.round(totalRepayable * 100) / 100
  });

  console.log('=== SCHEDULE ENGINE: Regeneration Complete ===');

  return { loan, schedule: finalSchedule, summary: { totalInterest, totalRepayable } };
}

/**
 * Generate period-based schedule (standard alignment from loan start date)
 * Event-driven approach: calculates interest dynamically based on actual principal at each point in time
 */
function generatePeriodBasedSchedule(schedule, loan, product, duration, transactions, scheduleEndDate, options = {}, originalLoanDuration = null) {
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
      // Only include disbursements AFTER the loan start (further advances)
      // Initial disbursement is already accounted for in loan.principal_amount
      // Including it would double-count the principal for interest calculation
      const txDate = new Date(t.date);
      txDate.setHours(0, 0, 0, 0);
      if (txDate > startDate) {
        events.push({
          date: txDate,
          type: 'disbursement',
          amount: t.amount
        });
      }
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

  // Handle Rolled-Up loans separately - only show end of loan period + monthly interest after
  if (product.interest_type === 'Rolled-Up') {
    // Use the ORIGINAL loan duration for the roll-up period, not the extended duration
    const originalDuration = loan.duration || options.duration || duration;
    let totalRolledUpInterest = 0;
    let finalPrincipal = originalPrincipal;

    console.log('Rolled-Up: Using original duration:', originalDuration, 'vs extended duration:', duration);

    // Calculate total rolled-up interest across the ORIGINAL loan duration
    for (let i = 1; i <= originalDuration; i++) {
      const periodStartDate = i === 1 ? startDate : (product.period === 'Monthly' ? addMonths(startDate, i - 1) : addWeeks(startDate, i - 1));
      const periodEndDate = product.period === 'Monthly' ? addMonths(startDate, i) : addWeeks(startDate, i);
      const principalAtStart = calculatePrincipalAtDate(originalPrincipal, transactions, periodStartDate);

      const daysInPeriod = differenceInDays(periodEndDate, periodStartDate);
      const interestForPeriod = principalAtStart * dailyRate * daysInPeriod;
      totalRolledUpInterest += interestForPeriod;
      finalPrincipal = principalAtStart;
    }

    // Single entry at end of ORIGINAL loan period (not extended)
    const loanEndDate = product.period === 'Monthly' ? addMonths(startDate, originalDuration) : addWeeks(startDate, originalDuration);
    const totalDaysInLoan = differenceInDays(loanEndDate, startDate);
    schedule.push({
      installment_number: 1,
      due_date: format(loanEndDate, 'yyyy-MM-dd'),
      principal_amount: Math.round(finalPrincipal * 100) / 100,
      interest_amount: Math.round(totalRolledUpInterest * 100) / 100,
      total_due: Math.round((finalPrincipal + totalRolledUpInterest) * 100) / 100,
      balance: Math.round(finalPrincipal * 100) / 100,
      principal_paid: 0,
      interest_paid: 0,
      status: 'Pending',
      calculation_days: totalDaysInLoan,
      calculation_principal_start: Math.round(originalPrincipal * 100) / 100,
      is_extension_period: false
    });

    // Calculate how many extension periods are needed
    // Only add extensions if we're past the loan end date
    let extensionMonths = 0;
    if (options.endDate || loan.auto_extend) {
      const monthsFromLoanEnd = product.period === 'Monthly'
        ? Math.ceil(differenceInDays(scheduleEndDate, loanEndDate) / 30.44)
        : Math.ceil(differenceInDays(scheduleEndDate, loanEndDate) / 7);
      // Only add extension months if scheduleEndDate is after loanEndDate
      extensionMonths = Math.max(0, monthsFromLoanEnd);
    } else {
      // If not auto-extend and no endDate, default to 12 months of extensions
      extensionMonths = 12;
    }

    // Add interest-only payments after loan period ends
    for (let i = 1; i <= extensionMonths; i++) {
      const periodStart = i === 1 ? loanEndDate : addMonths(loanEndDate, i - 1);
      const dueDate = addMonths(loanEndDate, i);
      const daysInPeriod = differenceInDays(dueDate, periodStart);
      const periodInterest = finalPrincipal * dailyRate * daysInPeriod;

      schedule.push({
        installment_number: 1 + i,
        due_date: format(dueDate, 'yyyy-MM-dd'),
        principal_amount: 0,
        interest_amount: Math.round(periodInterest * 100) / 100,
        total_due: Math.round(periodInterest * 100) / 100,
        balance: Math.round(finalPrincipal * 100) / 100,
        principal_paid: 0,
        interest_paid: 0,
        status: 'Pending',
        calculation_days: daysInPeriod,
        calculation_principal_start: Math.round(finalPrincipal * 100) / 100,
        is_extension_period: true
      });
    }

    return; // Exit early for Rolled-Up loans
  }

  // Process each schedule period (for non-Rolled-Up loans)
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
      // For monthly fixed: use fixed monthly calculation (Principal × Annual Rate / 12)
      totalDaysInPeriod = Math.round(fixedMonthlyDays);

      if (capitalEventsInPeriod.length === 0) {
        // No mid-period changes: use fixed monthly interest
        if (product.interest_type === 'Flat') {
          totalInterestForPeriod = originalPrincipal * (annualRate / 100 / 12);
        } else {
          // Reducing, Interest-Only, Rolled-Up: based on current principal
          totalInterestForPeriod = principalAtStart * (annualRate / 100 / 12);
        }
      } else {
        // Mid-period capital changes: calculate weighted average
        let currentSegmentStart = periodStartDate;
        let currentSegmentPrincipal = principalAtStart;
        let totalDaysWithPrincipal = 0;
        let weightedPrincipalDays = 0;

        capitalEventsInPeriod.sort((a, b) => a.date - b.date);

        for (const event of capitalEventsInPeriod) {
          const daysInSegment = Math.max(0, differenceInDays(event.date, currentSegmentStart));
          if (daysInSegment > 0) {
            totalDaysWithPrincipal += daysInSegment;
            weightedPrincipalDays += currentSegmentPrincipal * daysInSegment;
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
        if (finalDays > 0) {
          totalDaysWithPrincipal += finalDays;
          weightedPrincipalDays += currentSegmentPrincipal * finalDays;
        }

        // Calculate average principal and apply monthly rate
        const avgPrincipal = totalDaysWithPrincipal > 0 ? weightedPrincipalDays / totalDaysWithPrincipal : principalAtStart;
        if (product.interest_type === 'Flat') {
          totalInterestForPeriod = originalPrincipal * (annualRate / 100 / 12);
        } else {
          totalInterestForPeriod = avgPrincipal * (annualRate / 100 / 12);
        }
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
    }

    // Determine due date based on interest_paid_in_advance setting
    // If paid in advance, interest is due at START of period; otherwise at END
    const dueDate = product.interest_paid_in_advance ? periodStartDate : periodEndDate;

    // Determine if this period is beyond the original loan term
    const isExtensionPeriod = originalLoanDuration ? i > originalLoanDuration : false;

    schedule.push({
      installment_number: i,
      due_date: format(dueDate, 'yyyy-MM-dd'),
      principal_amount: Math.round(principalForPeriod * 100) / 100,
      interest_amount: Math.round(totalInterestForPeriod * 100) / 100,
      total_due: Math.round((principalForPeriod + totalInterestForPeriod) * 100) / 100,
      balance: Math.max(0, Math.round(principalAtEnd * 100) / 100),
      principal_paid: 0,
      interest_paid: 0,
      status: 'Pending',
      calculation_days: totalDaysInPeriod,
      calculation_principal_start: Math.round(principalAtStart * 100) / 100,
      is_extension_period: isExtensionPeriod
    });

    console.log(`Period ${i} (${format(dueDate, 'yyyy-MM-dd')}): Interest=${totalInterestForPeriod.toFixed(2)}, Principal=${principalForPeriod.toFixed(2)}, Balance=${principalAtEnd.toFixed(2)}`);
  }
}

/**
 * Calculate principal outstanding at a specific date for schedule/interest purposes.
 * Uses GROSS principal (loan.principal_amount) minus repayments.
 *
 * NOTE: We do NOT add disbursement transactions here because:
 * - initialPrincipal IS the GROSS loan amount (what borrower owes)
 * - Disbursement transactions represent NET cash given (after arrangement fee)
 * - Adding them would double-count: GROSS + NET = wrong
 *
 * For cash flow/ledger purposes, use disbursement transactions directly.
 */
function calculatePrincipalAtDate(initialPrincipal, transactions, date) {
  const repayments = transactions
    .filter(t => t.type === 'Repayment' && new Date(t.date) < date)
    .reduce((sum, t) => sum + (t.principal_applied || 0), 0);

  return Math.max(0, initialPrincipal - repayments);
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
function generateMonthlyFirstSchedule(schedule, loan, product, duration, transactions, originalLoanDuration = null) {
  const startDate = new Date(loan.start_date);
  const originalPrincipal = loan.principal_amount;
  const annualRate = product.interest_rate;
  const dailyRate = annualRate / 100 / 365;
  const monthlyRate = annualRate / 100 / 12;

  let installmentNum = 1;

  // First period: pro-rated from start date to 1st of next month (if not already 1st)
  if (startDate.getDate() !== 1) {
    // First period covers from start date to the 1st of next month (not end of current month)
    const firstOfNextMonth = startOfMonth(addMonths(startDate, 1));
    const principalAtStart = calculatePrincipalAtDate(originalPrincipal, transactions, startDate);

    // Calculate pro-rated interest for first partial month with event-driven approach
    const capitalEventsInPeriod = transactions.filter(t =>
      (t.type === 'Repayment' && t.principal_applied > 0) &&
      new Date(t.date) >= startDate &&
      new Date(t.date) < firstOfNextMonth
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

    // Final segment from last event (or start) to 1st of next month
    const finalDays = Math.max(0, differenceInDays(firstOfNextMonth, segmentStart));
    if (finalDays > 0 && segmentPrincipal > 0) {
      totalInterest += calculateInterestForDays(segmentPrincipal, dailyRate, finalDays, product.interest_type, originalPrincipal);
    }

    // Days from start date to 1st of next month
    const daysInFirstPeriod = differenceInDays(firstOfNextMonth, startDate);

    // Determine due date based on interest_paid_in_advance setting
    // If paid in advance, interest is due at START of period (start date); otherwise at END (1st of next month)
    const firstPeriodDueDate = product.interest_paid_in_advance ? startDate : firstOfNextMonth;

    schedule.push({
      installment_number: installmentNum++,
      due_date: format(firstPeriodDueDate, 'yyyy-MM-dd'),
      principal_amount: 0,
      interest_amount: Math.round(totalInterest * 100) / 100,
      total_due: Math.round(totalInterest * 100) / 100,
      balance: principalAtStart,
      principal_paid: 0,
      interest_paid: 0,
      status: 'Pending',
      calculation_days: daysInFirstPeriod,
      calculation_principal_start: Math.round(principalAtStart * 100) / 100,
      is_extension_period: false // First period is never an extension
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

    // Determine due date based on interest_paid_in_advance setting
    // If paid in advance, interest is due at START of period (1st of month); otherwise at END (last day or 1st of next)
    const dueDate = product.interest_paid_in_advance ? periodStart : periodEnd;

    // Account for first period offset when checking extension (if there was a partial first period, installmentNum is already 2)
    const effectiveInstallmentNumber = installmentNum;
    const isExtensionPeriod = originalLoanDuration ? effectiveInstallmentNumber > originalLoanDuration : false;

    schedule.push({
      installment_number: installmentNum++,
      due_date: format(dueDate, 'yyyy-MM-dd'),
      principal_amount: Math.round(principalForPeriod * 100) / 100,
      interest_amount: Math.round(totalInterest * 100) / 100,
      total_due: Math.round((principalForPeriod + totalInterest) * 100) / 100,
      balance: Math.max(0, Math.round(principalAtEnd * 100) / 100),
      principal_paid: 0,
      interest_paid: 0,
      status: 'Pending',
      calculation_days: daysInPeriod,
      calculation_principal_start: Math.round(principalAtStart * 100) / 100,
      is_extension_period: isExtensionPeriod
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

  const loan = await api.entities.Loan.create({
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
    await api.entities.RepaymentSchedule.create({
      loan_id: loan.id,
      ...row
    });
  }

  // Create initial Disbursement transaction if loan is released (has start_date)
  // Skip if already created (e.g., during import) via options.skipDisbursement
  if (loan.start_date && loan.status !== 'Pending' && !options.skipDisbursement) {
    // Check if a disbursement already exists for this loan
    const existingDisbursements = transactions.filter(t => t.type === 'Disbursement');
    if (existingDisbursements.length === 0) {
      const disbursementAmount = loan.net_disbursed || (loan.principal_amount - (loan.arrangement_fee || 0));
      if (disbursementAmount > 0) {
        await api.entities.Transaction.create({
          loan_id: loan.id,
          borrower_id: loan.borrower_id,
          date: loan.start_date,
          type: 'Disbursement',
          amount: disbursementAmount,
          principal_applied: disbursementAmount,
          interest_applied: 0,
          fees_applied: 0,
          notes: 'Initial loan disbursement'
        });
      }
    }
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