import { addMonths, addWeeks, format, startOfMonth, addDays, differenceInDays, endOfMonth } from 'date-fns';

/**
 * Generates a repayment schedule based on loan parameters
 * @param {Object} params - Loan parameters
 * @param {number} params.principal - Principal loan amount
 * @param {number} params.interestRate - Annual interest rate (%)
 * @param {number} params.duration - Number of periods
 * @param {string} params.interestType - 'Flat', 'Reducing', 'Interest-Only', or 'Rolled-Up'
 * @param {string} params.period - 'Monthly' or 'Weekly'
 * @param {Date} params.startDate - Loan start date
 * @param {number} params.interestOnlyPeriod - Number of interest-only periods (optional)
 * @param {string} params.interestAlignment - 'period_based' or 'monthly_first'
 * @param {boolean} params.extendForFullPeriod - If true, extend to complete full final period
 * @param {boolean} params.interestPaidInAdvance - If true, interest due at START of period
 * @returns {Array} Array of repayment schedule objects
 */
export function generateRepaymentSchedule({
  principal,
  interestRate,
  duration,
  interestType,
  period,
  startDate,
  interestOnlyPeriod = 0,
  interestAlignment = 'period_based',
  extendForFullPeriod = false,
  interestPaidInAdvance = false,
  principalPaidToDate = 0,
  transactions = []
}) {
  // If monthly_first alignment and Monthly period, use special logic
  if (interestAlignment === 'monthly_first' && period === 'Monthly') {
    return generateMonthlyFirstSchedule({
      principal,
      interestRate,
      duration,
      interestType,
      startDate,
      interestOnlyPeriod,
      extendForFullPeriod,
      interestPaidInAdvance
    });
  }
  
  // If interest paid in advance, use special logic
  if (interestPaidInAdvance && interestType !== 'Rolled-Up') {
    return generateAdvanceInterestSchedule({
      principal,
      interestRate,
      duration,
      interestType,
      period,
      startDate,
      interestOnlyPeriod
    });
  }
  const schedule = [];
  const periodsPerYear = period === 'Monthly' ? 12 : 52;
  const periodRate = interestRate / 100 / periodsPerYear;
  
  if (interestType === 'Rolled-Up') {
    // Rolled-Up: Only show entry at end of loan period (principal + rolled-up interest),
    // followed by monthly interest-only payments

    // Calculate total rolled-up interest for the entire loan period
    let totalRolledUpInterest = 0;
    let finalPrincipal = principal;

    for (let i = 1; i <= duration; i++) {
      const dueDate = period === 'Monthly'
        ? addMonths(new Date(startDate), i)
        : addWeeks(new Date(startDate), i);

      // Calculate principal outstanding at this point
      const principalPaidBeforeDueDate = transactions
        .filter(tx => new Date(tx.date) < dueDate)
        .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
      const principalOutstandingAtStart = principal - principalPaidBeforeDueDate;

      const interestForPeriod = principalOutstandingAtStart * periodRate;
      totalRolledUpInterest += interestForPeriod;
      finalPrincipal = principalOutstandingAtStart;
    }

    // Single entry at end of loan period: Principal due + ALL rolled-up interest
    const loanEndDate = period === 'Monthly'
      ? addMonths(new Date(startDate), duration)
      : addWeeks(new Date(startDate), duration);

    schedule.push({
      installment_number: 1,
      due_date: format(loanEndDate, 'yyyy-MM-dd'),
      principal_amount: Math.round(finalPrincipal * 100) / 100,
      interest_amount: Math.round(totalRolledUpInterest * 100) / 100,
      total_due: Math.round((finalPrincipal + totalRolledUpInterest) * 100) / 100,
      balance: Math.round(finalPrincipal * 100) / 100,
      principal_paid: 0,
      interest_paid: 0,
      status: 'Pending'
    });

    // After loan period - monthly interest-only payments (show 12 months)
    const additionalMonths = 12;
    for (let i = 1; i <= additionalMonths; i++) {
      const dueDate = addMonths(loanEndDate, i);

      // Monthly interest on remaining principal
      const monthlyInterest = finalPrincipal * (interestRate / 100 / 12);

      schedule.push({
        installment_number: 1 + i,
        due_date: format(dueDate, 'yyyy-MM-dd'),
        principal_amount: 0,
        interest_amount: Math.round(monthlyInterest * 100) / 100,
        total_due: Math.round(monthlyInterest * 100) / 100,
        balance: Math.round(finalPrincipal * 100) / 100,
        principal_paid: 0,
        interest_paid: 0,
        status: 'Pending',
        is_extension_period: true
      });
    }
  } else if (interestType === 'Interest-Only') {
    // Interest-Only: Pay only interest for a period, then principal + interest or balloon
    const effectiveInterestOnlyPeriod = interestOnlyPeriod > 0 ? interestOnlyPeriod : duration;
    
    // Interest-only periods
    for (let i = 1; i <= effectiveInterestOnlyPeriod; i++) {
      const dueDate = period === 'Monthly' 
        ? addMonths(new Date(startDate), i)
        : addWeeks(new Date(startDate), i);
      
      // Calculate principal outstanding at START of this period
      const principalPaidBeforeDueDate = transactions
        .filter(tx => new Date(tx.date) < dueDate)
        .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
      const principalOutstandingAtStart = principal - principalPaidBeforeDueDate;
      
      const interestOnlyPayment = principalOutstandingAtStart * periodRate;
      
      console.log(`Interest-Only Period ${i} (${format(dueDate, 'yyyy-MM-dd')}):`, {
        dueDate: format(dueDate, 'yyyy-MM-dd'),
        transactionsBeforeDueDate: transactions.filter(tx => new Date(tx.date) < dueDate).map(t => ({
          date: t.date,
          principal: t.principal_applied
        })),
        principalPaidBeforeDueDate,
        principalOutstandingAtStart,
        periodRate,
        calculatedInterest: interestOnlyPayment
      });
      
      schedule.push({
        installment_number: i,
        due_date: format(dueDate, 'yyyy-MM-dd'),
        principal_amount: 0,
        interest_amount: Math.round(interestOnlyPayment * 100) / 100,
        total_due: Math.round(interestOnlyPayment * 100) / 100,
        balance: principalOutstandingAtStart,
        principal_paid: 0,
        interest_paid: 0,
        status: 'Pending'
      });
    }
    
    // If there's a repayment period after interest-only
    if (interestOnlyPeriod > 0 && interestOnlyPeriod < duration) {
      const remainingPeriods = duration - interestOnlyPeriod;
      const r = periodRate;
      const n = remainingPeriods;
      
      for (let i = 1; i <= remainingPeriods; i++) {
        const dueDate = period === 'Monthly'
          ? addMonths(new Date(startDate), effectiveInterestOnlyPeriod + i)
          : addWeeks(new Date(startDate), effectiveInterestOnlyPeriod + i);
        
        // Calculate principal outstanding at START of this period
        const principalPaidBeforeDueDate = transactions
          .filter(tx => new Date(tx.date) < dueDate)
          .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
        const principalOutstandingAtStart = principal - principalPaidBeforeDueDate;
        
        // Recalculate payment based on remaining principal and periods
        const periodsLeft = remainingPeriods - i + 1;
        const pmt = principalOutstandingAtStart > 0 
          ? principalOutstandingAtStart * (r * Math.pow(1 + r, periodsLeft)) / (Math.pow(1 + r, periodsLeft) - 1)
          : 0;
        
        const interestForPeriod = principalOutstandingAtStart * r;
        const principalForPeriod = pmt - interestForPeriod;
        const currentBalance = principalOutstandingAtStart - principalForPeriod;
        
        schedule.push({
          installment_number: effectiveInterestOnlyPeriod + i,
          due_date: format(dueDate, 'yyyy-MM-dd'),
          principal_amount: Math.round(principalForPeriod * 100) / 100,
          interest_amount: Math.round(interestForPeriod * 100) / 100,
          total_due: Math.round(pmt * 100) / 100,
          balance: Math.max(0, Math.round(currentBalance * 100) / 100),
          principal_paid: 0,
          interest_paid: 0,
          status: 'Pending'
        });
      }
    } else {
      // Entire term is interest-only, balloon payment at the end
      const lastEntry = schedule[schedule.length - 1];
      const principalPaidBeforeLastDate = transactions
        .filter(tx => new Date(tx.date) < new Date(lastEntry.due_date))
        .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
      const principalOutstanding = principal - principalPaidBeforeLastDate;
      
      lastEntry.principal_amount = principalOutstanding;
      lastEntry.total_due = Math.round((principalOutstanding + lastEntry.interest_amount) * 100) / 100;
      lastEntry.balance = 0;
    }
  } else if (interestType === 'Flat') {
    // Flat Rate: Interest calculated on original principal
    const totalInterest = principal * (interestRate / 100) * (duration / periodsPerYear);
    const interestPerPeriod = totalInterest / duration;
    const principalPerPeriod = principal / duration;
    const installmentAmount = principalPerPeriod + interestPerPeriod;
    
    let remainingBalance = principal;
    
    for (let i = 1; i <= duration; i++) {
      const dueDate = period === 'Monthly' 
        ? addMonths(new Date(startDate), i)
        : addWeeks(new Date(startDate), i);
      
      remainingBalance -= principalPerPeriod;
      
      schedule.push({
        installment_number: i,
        due_date: format(dueDate, 'yyyy-MM-dd'),
        principal_amount: Math.round(principalPerPeriod * 100) / 100,
        interest_amount: Math.round(interestPerPeriod * 100) / 100,
        total_due: Math.round(installmentAmount * 100) / 100,
        balance: Math.max(0, Math.round(remainingBalance * 100) / 100),
        principal_paid: 0,
        interest_paid: 0,
        status: 'Pending'
      });
    }
  } else {
    // Reducing Balance: Calculate interest based on running principal balance
    for (let i = 1; i <= duration; i++) {
      const dueDate = period === 'Monthly'
        ? addMonths(new Date(startDate), i)
        : addWeeks(new Date(startDate), i);
      
      // Calculate principal outstanding at START of this period (after any payments before this period)
      const principalPaidBeforeDueDate = transactions
        .filter(tx => new Date(tx.date) < dueDate)
        .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
      const principalOutstandingAtStart = principal - principalPaidBeforeDueDate;
      
      // Calculate interest on the actual outstanding principal
      const r = periodRate;
      const n = duration - i + 1; // Remaining periods
      
      // Recalculate payment based on remaining principal and periods
      const pmt = principalOutstandingAtStart > 0 
        ? principalOutstandingAtStart * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
        : 0;
      
      const interestForPeriod = principalOutstandingAtStart * r;
      const principalForPeriod = pmt - interestForPeriod;
      
      const currentBalance = principalOutstandingAtStart - principalForPeriod;
      
      schedule.push({
        installment_number: i,
        due_date: format(dueDate, 'yyyy-MM-dd'),
        principal_amount: Math.round(principalForPeriod * 100) / 100,
        interest_amount: Math.round(interestForPeriod * 100) / 100,
        total_due: Math.round(pmt * 100) / 100,
        balance: Math.max(0, Math.round(currentBalance * 100) / 100),
        principal_paid: 0,
        interest_paid: 0,
        status: 'Pending'
      });
    }
  }
  
  return schedule;
}

/**
 * Generate repayment schedule with interest paid in advance
 * Interest for each period is due at the START of the period
 */
function generateAdvanceInterestSchedule({
  principal,
  interestRate,
  duration,
  interestType,
  period,
  startDate,
  interestOnlyPeriod = 0
}) {
  const schedule = [];
  const periodsPerYear = period === 'Monthly' ? 12 : 52;
  const periodRate = interestRate / 100 / periodsPerYear;
  
  if (interestType === 'Interest-Only') {
    const interestPayment = principal * periodRate;
    const effectiveInterestOnlyPeriod = interestOnlyPeriod > 0 ? interestOnlyPeriod : duration;
    
    for (let i = 0; i < effectiveInterestOnlyPeriod; i++) {
      const dueDate = period === 'Monthly' 
        ? addMonths(new Date(startDate), i)
        : addWeeks(new Date(startDate), i);
      
      schedule.push({
        installment_number: i + 1,
        due_date: format(dueDate, 'yyyy-MM-dd'),
        principal_amount: 0,
        interest_amount: Math.round(interestPayment * 100) / 100,
        total_due: Math.round(interestPayment * 100) / 100,
        balance: principal,
        principal_paid: 0,
        interest_paid: 0,
        status: 'Pending'
      });
    }
    
    if (interestOnlyPeriod > 0 && interestOnlyPeriod < duration) {
      const remainingPeriods = duration - interestOnlyPeriod;
      const r = periodRate;
      const n = remainingPeriods;
      const pmt = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
      let remainingBalance = principal;
      
      for (let i = 0; i < remainingPeriods; i++) {
        const dueDate = period === 'Monthly'
          ? addMonths(new Date(startDate), effectiveInterestOnlyPeriod + i)
          : addWeeks(new Date(startDate), effectiveInterestOnlyPeriod + i);
        
        const interestForPeriod = remainingBalance * r;
        const principalForPeriod = pmt - interestForPeriod;
        remainingBalance -= principalForPeriod;
        
        schedule.push({
          installment_number: effectiveInterestOnlyPeriod + i + 1,
          due_date: format(dueDate, 'yyyy-MM-dd'),
          principal_amount: Math.round(principalForPeriod * 100) / 100,
          interest_amount: Math.round(interestForPeriod * 100) / 100,
          total_due: Math.round(pmt * 100) / 100,
          balance: Math.max(0, Math.round(remainingBalance * 100) / 100),
          principal_paid: 0,
          interest_paid: 0,
          status: 'Pending'
        });
      }
    } else {
      schedule[schedule.length - 1].principal_amount = principal;
      schedule[schedule.length - 1].total_due = Math.round((principal + interestPayment) * 100) / 100;
      schedule[schedule.length - 1].balance = 0;
    }
  } else if (interestType === 'Flat') {
    const totalInterest = principal * (interestRate / 100) * (duration / periodsPerYear);
    const interestPerPeriod = totalInterest / duration;
    const principalPerPeriod = principal / duration;
    const installmentAmount = principalPerPeriod + interestPerPeriod;
    let remainingBalance = principal;
    
    for (let i = 0; i < duration; i++) {
      const dueDate = period === 'Monthly' 
        ? addMonths(new Date(startDate), i)
        : addWeeks(new Date(startDate), i);
      
      remainingBalance -= principalPerPeriod;
      
      schedule.push({
        installment_number: i + 1,
        due_date: format(dueDate, 'yyyy-MM-dd'),
        principal_amount: Math.round(principalPerPeriod * 100) / 100,
        interest_amount: Math.round(interestPerPeriod * 100) / 100,
        total_due: Math.round(installmentAmount * 100) / 100,
        balance: Math.max(0, Math.round(remainingBalance * 100) / 100),
        principal_paid: 0,
        interest_paid: 0,
        status: 'Pending'
      });
    }
  } else {
    // Reducing Balance with interest in advance
    const r = periodRate;
    const n = duration;
    const pmt = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    let remainingBalance = principal;
    
    for (let i = 0; i < duration; i++) {
      const dueDate = period === 'Monthly'
        ? addMonths(new Date(startDate), i)
        : addWeeks(new Date(startDate), i);
      
      const interestForPeriod = remainingBalance * r;
      const principalForPeriod = pmt - interestForPeriod;
      remainingBalance -= principalForPeriod;
      
      schedule.push({
        installment_number: i + 1,
        due_date: format(dueDate, 'yyyy-MM-dd'),
        principal_amount: Math.round(principalForPeriod * 100) / 100,
        interest_amount: Math.round(interestForPeriod * 100) / 100,
        total_due: Math.round(pmt * 100) / 100,
        balance: Math.max(0, Math.round(remainingBalance * 100) / 100),
        principal_paid: 0,
        interest_paid: 0,
        status: 'Pending'
      });
    }
  }
  
  return schedule;
}

/**
 * Generate repayment schedule with monthly_first alignment
 * Interest paid in advance, aligned to 1st of each month
 */
function generateMonthlyFirstSchedule({
  principal,
  interestRate,
  duration,
  interestType,
  startDate,
  interestOnlyPeriod = 0,
  extendForFullPeriod = false,
  interestPaidInAdvance = false
}) {
  const schedule = [];
  const start = new Date(startDate);
  const annualRate = interestRate / 100;
  const monthlyRate = annualRate / 12;
  const dailyRate = annualRate / 365;
  
  // Calculate first payment (partial month to end of current month)
  const firstPaymentDate = start;
  const endOfFirstMonth = endOfMonth(start);
  const daysInFirstPeriod = differenceInDays(endOfFirstMonth, start) + 1;
  const firstPeriodInterest = principal * dailyRate * daysInFirstPeriod;
  
  let installmentNum = 1;
  let currentDate = firstPaymentDate;
  let remainingBalance = principal;
  
  if (interestType === 'Reducing' || interestType === 'Flat') {
    // First installment: partial interest only
    schedule.push({
      installment_number: installmentNum++,
      due_date: format(firstPaymentDate, 'yyyy-MM-dd'),
      principal_amount: 0,
      interest_amount: Math.round(firstPeriodInterest * 100) / 100,
      total_due: Math.round(firstPeriodInterest * 100) / 100,
      balance: principal,
      principal_paid: 0,
      interest_paid: 0,
      status: 'Pending'
    });
    
    // Calculate subsequent monthly payments on the 1st
    let monthsProcessed = 0;
    const targetMonths = duration;
    
    while (monthsProcessed < targetMonths) {
      currentDate = addMonths(startOfMonth(start), monthsProcessed + 1);
      const isLastPeriod = monthsProcessed === targetMonths - 1;
      
      let interestForPeriod, principalForPeriod, payment;
      
      if (interestType === 'Flat') {
        const totalInterest = principal * (annualRate) * (duration / 12);
        interestForPeriod = totalInterest / duration;
        principalForPeriod = principal / duration;
        payment = principalForPeriod + interestForPeriod;
      } else {
        // Reducing balance
        const r = monthlyRate;
        const n = duration;
        const pmt = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
        
        interestForPeriod = remainingBalance * r;
        principalForPeriod = pmt - interestForPeriod;
        payment = pmt;
      }
      
      remainingBalance -= principalForPeriod;
      
      // Handle partial last period
      if (isLastPeriod && !extendForFullPeriod) {
        const nextMonth = addMonths(currentDate, 1);
        const actualEndDate = addMonths(start, duration);
        
        if (actualEndDate < nextMonth) {
          const daysInFinalPeriod = differenceInDays(actualEndDate, currentDate);
          interestForPeriod = remainingBalance * dailyRate * daysInFinalPeriod;
          principalForPeriod = remainingBalance;
          payment = principalForPeriod + interestForPeriod;
          remainingBalance = 0;
        }
      }
      
      schedule.push({
        installment_number: installmentNum++,
        due_date: format(currentDate, 'yyyy-MM-dd'),
        principal_amount: Math.round(principalForPeriod * 100) / 100,
        interest_amount: Math.round(interestForPeriod * 100) / 100,
        total_due: Math.round(payment * 100) / 100,
        balance: Math.max(0, Math.round(remainingBalance * 100) / 100),
        principal_paid: 0,
        interest_paid: 0,
        status: 'Pending'
      });
      
      monthsProcessed++;
    }
    
  } else if (interestType === 'Interest-Only') {
    // First payment: partial interest
    schedule.push({
      installment_number: installmentNum++,
      due_date: format(firstPaymentDate, 'yyyy-MM-dd'),
      principal_amount: 0,
      interest_amount: Math.round(firstPeriodInterest * 100) / 100,
      total_due: Math.round(firstPeriodInterest * 100) / 100,
      balance: principal,
      principal_paid: 0,
      interest_paid: 0,
      status: 'Pending'
    });
    
    const effectiveInterestOnlyPeriod = interestOnlyPeriod > 0 ? interestOnlyPeriod : duration;
    
    // Interest-only payments on 1st of each month
    for (let i = 0; i < effectiveInterestOnlyPeriod; i++) {
      currentDate = addMonths(startOfMonth(start), i + 1);
      const monthlyInterest = principal * monthlyRate;
      
      schedule.push({
        installment_number: installmentNum++,
        due_date: format(currentDate, 'yyyy-MM-dd'),
        principal_amount: 0,
        interest_amount: Math.round(monthlyInterest * 100) / 100,
        total_due: Math.round(monthlyInterest * 100) / 100,
        balance: principal,
        principal_paid: 0,
        interest_paid: 0,
        status: 'Pending'
      });
    }
    
    // If there's a repayment period after interest-only
    if (interestOnlyPeriod > 0 && interestOnlyPeriod < duration) {
      const remainingPeriods = duration - interestOnlyPeriod;
      const r = monthlyRate;
      const n = remainingPeriods;
      const pmt = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
      
      for (let i = 0; i < remainingPeriods; i++) {
        currentDate = addMonths(startOfMonth(start), effectiveInterestOnlyPeriod + i + 1);
        const interestForPeriod = remainingBalance * r;
        const principalForPeriod = pmt - interestForPeriod;
        remainingBalance -= principalForPeriod;
        
        schedule.push({
          installment_number: installmentNum++,
          due_date: format(currentDate, 'yyyy-MM-dd'),
          principal_amount: Math.round(principalForPeriod * 100) / 100,
          interest_amount: Math.round(interestForPeriod * 100) / 100,
          total_due: Math.round(pmt * 100) / 100,
          balance: Math.max(0, Math.round(remainingBalance * 100) / 100),
          principal_paid: 0,
          interest_paid: 0,
          status: 'Pending'
        });
      }
    } else {
      // Balloon payment at the end
      schedule[schedule.length - 1].principal_amount = principal;
      schedule[schedule.length - 1].total_due += principal;
      schedule[schedule.length - 1].balance = 0;
    }
  }
  
  return schedule;
}

/**
 * Calculate loan summary statistics
 */
export function calculateLoanSummary(schedule) {
  const totalPrincipal = schedule.reduce((sum, row) => sum + row.principal_amount, 0);
  const totalInterest = schedule.reduce((sum, row) => sum + row.interest_amount, 0);
  const totalRepayable = schedule.reduce((sum, row) => sum + row.total_due, 0);
  
  return {
    totalPrincipal: Math.round(totalPrincipal * 100) / 100,
    totalInterest: Math.round(totalInterest * 100) / 100,
    totalRepayable: Math.round(totalRepayable * 100) / 100,
    installmentAmount: schedule.length > 0 ? schedule[0].total_due : 0,
    numberOfInstallments: schedule.length
  };
}

/**
 * Apply payment using waterfall logic
 * Order: Interest -> Principal -> Optional (reduce principal or credit)
 * @param {number} payment - Payment amount
 * @param {Array} scheduleRows - Repayment schedule rows
 * @param {number} existingCredit - Existing overpayment credit
 * @param {string} overpaymentOption - 'reduce_principal' or 'credit'
 * @returns {Object} { updates, remainingPayment, principalReduction, creditAmount }
 */
export function applyPaymentWaterfall(payment, scheduleRows, existingCredit = 0, overpaymentOption = 'credit') {
  let remainingPayment = payment + existingCredit;
  const updates = [];
  
  // Sort by due date to pay oldest first
  const sortedRows = [...scheduleRows].sort((a, b) => 
    new Date(a.due_date) - new Date(b.due_date)
  );
  
  // First pass: pay scheduled installments
  for (const row of sortedRows) {
    if (remainingPayment <= 0) break;
    if (row.status === 'Paid') continue;
    
    const interestDue = row.interest_amount - (row.interest_paid || 0);
    const principalDue = row.principal_amount - (row.principal_paid || 0);
    
    // First pay interest
    const interestPayment = Math.min(remainingPayment, interestDue);
    remainingPayment -= interestPayment;
    
    // Then pay principal
    const principalPayment = Math.min(remainingPayment, principalDue);
    remainingPayment -= principalPayment;
    
    const newInterestPaid = (row.interest_paid || 0) + interestPayment;
    const newPrincipalPaid = (row.principal_paid || 0) + principalPayment;
    const totalPaid = newInterestPaid + newPrincipalPaid;
    
    let newStatus = row.status;
    if (totalPaid >= row.total_due - 0.01) {
      newStatus = 'Paid';
    } else if (totalPaid > 0) {
      newStatus = 'Partial';
    }
    
    if (interestPayment > 0 || principalPayment > 0) {
      updates.push({
        id: row.id,
        interest_paid: Math.round(newInterestPaid * 100) / 100,
        principal_paid: Math.round(newPrincipalPaid * 100) / 100,
        status: newStatus,
        interestApplied: interestPayment,
        principalApplied: principalPayment
      });
    }
  }
  
  // Handle overpayment
  let principalReduction = 0;
  let creditAmount = 0;
  
  if (remainingPayment > 0) {
    if (overpaymentOption === 'reduce_principal') {
      // Apply to future principal - find first unpaid installment and reduce principal
      for (const row of sortedRows) {
        if (remainingPayment <= 0) break;
        if (row.status === 'Paid') continue;
        
        const additionalPrincipal = Math.min(remainingPayment, row.principal_amount - (row.principal_paid || 0));
        
        if (additionalPrincipal > 0) {
          const existingUpdate = updates.find(u => u.id === row.id);
          if (existingUpdate) {
            existingUpdate.principal_paid += additionalPrincipal;
            existingUpdate.principalApplied += additionalPrincipal;
          } else {
            updates.push({
              id: row.id,
              interest_paid: row.interest_paid || 0,
              principal_paid: (row.principal_paid || 0) + additionalPrincipal,
              status: row.status,
              interestApplied: 0,
              principalApplied: additionalPrincipal
            });
          }
          
          principalReduction += additionalPrincipal;
          remainingPayment -= additionalPrincipal;
        }
      }
      
      // Any remaining becomes credit
      creditAmount = remainingPayment;
    } else {
      // Keep as credit for future payments
      creditAmount = remainingPayment;
    }
  }
  
  return {
    updates,
    remainingPayment: Math.round(remainingPayment * 100) / 100,
    principalReduction: Math.round(principalReduction * 100) / 100,
    creditAmount: Math.round(creditAmount * 100) / 100
  };
}

/**
 * Apply payment with manual interest/principal split
 * Applies specified amounts to oldest unpaid schedule rows
 * @param {number} interestAmount - Amount to apply to interest
 * @param {number} principalAmount - Amount to apply to principal
 * @param {Array} scheduleRows - Repayment schedule rows
 * @param {number} existingCredit - Existing overpayment credit
 * @param {string} overpaymentOption - 'reduce_principal' or 'credit'
 * @returns {Object} { updates, principalReduction, creditAmount }
 */
export function applyManualPayment(interestAmount, principalAmount, scheduleRows, existingCredit = 0, overpaymentOption = 'credit') {
  let remainingInterest = interestAmount;
  let remainingPrincipal = principalAmount + existingCredit;
  const updates = [];

  // Sort by due date to pay oldest first
  const sortedRows = [...scheduleRows].sort((a, b) =>
    new Date(a.due_date) - new Date(b.due_date)
  );

  // Apply interest first to oldest unpaid rows
  for (const row of sortedRows) {
    if (remainingInterest <= 0) break;
    if (row.status === 'Paid') continue;

    const interestDue = row.interest_amount - (row.interest_paid || 0);
    const interestPayment = Math.min(remainingInterest, interestDue);
    remainingInterest -= interestPayment;

    if (interestPayment > 0) {
      const newInterestPaid = (row.interest_paid || 0) + interestPayment;
      const newPrincipalPaid = row.principal_paid || 0;
      const totalPaid = newInterestPaid + newPrincipalPaid;

      let newStatus = row.status;
      if (totalPaid >= row.total_due - 0.01) {
        newStatus = 'Paid';
      } else if (totalPaid > 0) {
        newStatus = 'Partial';
      }

      updates.push({
        id: row.id,
        interest_paid: Math.round(newInterestPaid * 100) / 100,
        principal_paid: Math.round(newPrincipalPaid * 100) / 100,
        status: newStatus,
        interestApplied: interestPayment,
        principalApplied: 0
      });
    }
  }

  // Apply principal to oldest unpaid rows
  for (const row of sortedRows) {
    if (remainingPrincipal <= 0) break;
    if (row.status === 'Paid') continue;

    const principalDue = row.principal_amount - (row.principal_paid || 0);
    const principalPayment = Math.min(remainingPrincipal, principalDue);
    remainingPrincipal -= principalPayment;

    if (principalPayment > 0) {
      const existingUpdate = updates.find(u => u.id === row.id);

      if (existingUpdate) {
        existingUpdate.principal_paid = Math.round(((row.principal_paid || 0) + principalPayment) * 100) / 100;
        existingUpdate.principalApplied += principalPayment;

        // Recalculate status
        const totalPaid = existingUpdate.interest_paid + existingUpdate.principal_paid;
        if (totalPaid >= row.total_due - 0.01) {
          existingUpdate.status = 'Paid';
        } else if (totalPaid > 0) {
          existingUpdate.status = 'Partial';
        }
      } else {
        const newPrincipalPaid = (row.principal_paid || 0) + principalPayment;
        const newInterestPaid = row.interest_paid || 0;
        const totalPaid = newInterestPaid + newPrincipalPaid;

        let newStatus = row.status;
        if (totalPaid >= row.total_due - 0.01) {
          newStatus = 'Paid';
        } else if (totalPaid > 0) {
          newStatus = 'Partial';
        }

        updates.push({
          id: row.id,
          interest_paid: Math.round(newInterestPaid * 100) / 100,
          principal_paid: Math.round(newPrincipalPaid * 100) / 100,
          status: newStatus,
          interestApplied: 0,
          principalApplied: principalPayment
        });
      }
    }
  }

  // Handle overpayment (remaining principal)
  let principalReduction = 0;
  let creditAmount = 0;

  if (remainingPrincipal > 0) {
    if (overpaymentOption === 'reduce_principal') {
      // Continue applying to future principal
      for (const row of sortedRows) {
        if (remainingPrincipal <= 0) break;

        const existingUpdate = updates.find(u => u.id === row.id);
        const currentPrincipalPaid = existingUpdate ? existingUpdate.principal_paid : (row.principal_paid || 0);
        const additionalPrincipal = Math.min(remainingPrincipal, row.principal_amount - currentPrincipalPaid);

        if (additionalPrincipal > 0) {
          if (existingUpdate) {
            existingUpdate.principal_paid = Math.round((existingUpdate.principal_paid + additionalPrincipal) * 100) / 100;
            existingUpdate.principalApplied += additionalPrincipal;
          } else {
            updates.push({
              id: row.id,
              interest_paid: row.interest_paid || 0,
              principal_paid: Math.round(((row.principal_paid || 0) + additionalPrincipal) * 100) / 100,
              status: row.status,
              interestApplied: 0,
              principalApplied: additionalPrincipal
            });
          }

          principalReduction += additionalPrincipal;
          remainingPrincipal -= additionalPrincipal;
        }
      }

      creditAmount = remainingPrincipal;
    } else {
      creditAmount = remainingPrincipal;
    }
  }

  return {
    updates,
    principalReduction: Math.round(principalReduction * 100) / 100,
    creditAmount: Math.round(creditAmount * 100) / 100
  };
}

/**
 * Get the effective interest rate for a loan on a given date
 * @param {Object} loan - Loan object
 * @param {Date} date - Date to check
 * @returns {number} Interest rate as percentage (e.g., 12 for 12%)
 */
export function getEffectiveRate(loan, date = new Date()) {
  if (!loan) return 0;

  // Check if penalty rate applies
  if (loan.has_penalty_rate && loan.penalty_rate && loan.penalty_rate_from) {
    const penaltyDate = new Date(loan.penalty_rate_from);
    penaltyDate.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);

    if (checkDate >= penaltyDate) {
      return loan.penalty_rate;
    }
  }

  return loan.interest_rate;
}

/**
 * Calculate accrued interest to date (what would be owed if settled today)
 * Supports penalty rate from a specific date
 * @param {Object} loan - Loan object
 * @param {Date} asOfDate - Date to calculate as of (defaults to today)
 * @returns {number} Total accrued interest (not reduced by payments)
 */
export function calculateAccruedInterest(loan, asOfDate = new Date()) {
  if (!loan || loan.status === 'Pending') {
    return 0;
  }

  const startDate = new Date(loan.start_date);
  const today = new Date(asOfDate);
  today.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);

  // Days elapsed since loan start
  const daysElapsed = Math.max(0, Math.floor((today - startDate) / (1000 * 60 * 60 * 24)));

  const periodsPerYear = loan.period === 'Monthly' ? 12 : 52;
  const daysPerPeriod = loan.period === 'Monthly' ? 30.417 : 7; // Average days
  const periodsElapsed = daysElapsed / daysPerPeriod;
  const principal = loan.principal_amount;

  // Check if there's a penalty rate that applies
  let penaltyDateObj = null;
  let daysToPenalty = daysElapsed;
  let daysAtPenalty = 0;

  if (loan.has_penalty_rate && loan.penalty_rate && loan.penalty_rate_from) {
    penaltyDateObj = new Date(loan.penalty_rate_from);
    penaltyDateObj.setHours(0, 0, 0, 0);

    if (penaltyDateObj > startDate && penaltyDateObj <= today) {
      // Split the calculation period
      daysToPenalty = Math.floor((penaltyDateObj - startDate) / (1000 * 60 * 60 * 24));
      daysAtPenalty = daysElapsed - daysToPenalty;
    } else if (penaltyDateObj <= startDate) {
      // Penalty rate applies from the start
      daysToPenalty = 0;
      daysAtPenalty = daysElapsed;
    }
    // else: penalty date is in the future, use normal rate for all days
  }

  const annualRate = loan.interest_rate / 100;
  const penaltyAnnualRate = loan.penalty_rate ? loan.penalty_rate / 100 : annualRate;
  const periodRate = annualRate / periodsPerYear;
  const penaltyPeriodRate = penaltyAnnualRate / periodsPerYear;

  let accruedInterest = 0;

  // Helper function to calculate interest for a period with given rate
  const calculateDailyInterest = (days, rate, balance) => {
    return balance * (rate / 365) * days;
  };

  if (loan.interest_type === 'Flat') {
    // Flat rate: total interest spread evenly
    // For penalty rate, recalculate based on rates
    if (daysAtPenalty > 0) {
      const totalDays = loan.duration * daysPerPeriod;
      // Normal rate portion
      const normalInterestPerDay = (principal * annualRate) / 365;
      const penaltyInterestPerDay = (principal * penaltyAnnualRate) / 365;
      accruedInterest = (normalInterestPerDay * daysToPenalty) + (penaltyInterestPerDay * daysAtPenalty);
    } else {
      const totalInterest = loan.total_interest;
      const interestPerDay = totalInterest / (loan.duration * daysPerPeriod);
      accruedInterest = Math.min(interestPerDay * daysElapsed, totalInterest);
    }

  } else if (loan.interest_type === 'Reducing') {
    // Reducing balance: calculate based on what should have been paid by now
    const periodsCompleted = Math.min(Math.floor(periodsElapsed), loan.duration);
    const dailyRate = annualRate / 365;
    const penaltyDailyRate = penaltyAnnualRate / 365;

    // Simple approximation: use reducing balance formula for periods completed
    let remainingBalance = principal;
    const r = periodRate;
    const n = loan.duration;
    const pmt = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);

    for (let i = 0; i < periodsCompleted; i++) {
      const periodEndDay = (i + 1) * daysPerPeriod;
      // Use penalty rate if this period falls after penalty date
      const usePenalty = penaltyDateObj && daysToPenalty < periodEndDay;
      const currentPeriodRate = usePenalty ? penaltyPeriodRate : periodRate;

      const interestForPeriod = remainingBalance * currentPeriodRate;
      accruedInterest += interestForPeriod;
      const principalForPeriod = pmt - (remainingBalance * periodRate); // Use original pmt calculation
      remainingBalance -= principalForPeriod;
    }

    // Add partial period interest
    if (periodsElapsed > periodsCompleted && remainingBalance > 0) {
      const daysInPartialPeriod = daysElapsed - (periodsCompleted * daysPerPeriod);
      const currentDailyRate = daysAtPenalty > 0 ? penaltyDailyRate : dailyRate;
      accruedInterest += remainingBalance * currentDailyRate * daysInPartialPeriod;
    }

  } else if (loan.interest_type === 'Interest-Only') {
    // For Interest-Only loans, interest accrues continuously at the period rate
    // Support split calculation for penalty rate
    if (daysAtPenalty > 0) {
      // Calculate interest before penalty date
      const normalInterest = calculateDailyInterest(daysToPenalty, annualRate, principal);
      // Calculate interest at penalty rate
      const penaltyInterest = calculateDailyInterest(daysAtPenalty, penaltyAnnualRate, principal);
      accruedInterest = normalInterest + penaltyInterest;
    } else {
      const interestPerPeriod = principal * periodRate;
      const periodsCompleted = Math.floor(periodsElapsed);

      accruedInterest = periodsCompleted * interestPerPeriod;

      // Add partial period interest
      const partialPeriod = periodsElapsed - periodsCompleted;
      if (partialPeriod > 0) {
        accruedInterest += partialPeriod * interestPerPeriod;
      }
    }

  } else if (loan.interest_type === 'Rolled-Up') {
    // Rolled-up: compound interest daily
    if (daysAtPenalty > 0) {
      // Calculate compound interest up to penalty date
      const dailyRate = annualRate / 365;
      const penaltyDailyRate = penaltyAnnualRate / 365;
      const amountAtPenaltyDate = principal * Math.pow(1 + dailyRate, daysToPenalty);
      const finalAmount = amountAtPenaltyDate * Math.pow(1 + penaltyDailyRate, daysAtPenalty);
      accruedInterest = finalAmount - principal;
    } else {
      const dailyRate = annualRate / 365;
      accruedInterest = principal * (Math.pow(1 + dailyRate, daysElapsed) - 1);
    }
  } else {
    // Fallback: use simple daily accrual based on total scheduled interest
    // This handles unknown interest types or missing data
    if (daysAtPenalty > 0) {
      const normalInterest = calculateDailyInterest(daysToPenalty, annualRate, principal);
      const penaltyInterest = calculateDailyInterest(daysAtPenalty, penaltyAnnualRate, principal);
      accruedInterest = normalInterest + penaltyInterest;
    } else {
      const totalDays = loan.duration * daysPerPeriod;
      const interestPerDay = (loan.total_interest || 0) / totalDays;
      accruedInterest = Math.min(interestPerDay * daysElapsed, loan.total_interest || 0);
    }
  }

  return Math.round(accruedInterest * 100) / 100;
}

/**
 * Calculate live interest outstanding based on daily accrual
 * @param {Object} loan - Loan object
 * @param {number} actualInterestPaid - Actual interest paid from transactions (optional, defaults to loan.interest_paid)
 * @param {Date} asOfDate - Date to calculate as of (defaults to today)
 * @returns {number} Live interest outstanding (negative if overpaid)
 */
export function calculateLiveInterestOutstanding(loan, actualInterestPaid = null, asOfDate = new Date()) {
  const accruedInterest = calculateAccruedInterest(loan, asOfDate);
  const interestPaid = actualInterestPaid !== null ? actualInterestPaid : (loan.interest_paid || 0);
  const liveOutstanding = accruedInterest - interestPaid;

  return Math.round(liveOutstanding * 100) / 100;
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