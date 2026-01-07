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

  // Days elapsed since loan start (add 1 to include today's interest)
  const daysElapsed = Math.max(0, Math.floor((today - startDate) / (1000 * 60 * 60 * 24)) + 1);

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
 * Calculate accrued interest using day-by-day method with actual principal tracking
 * This matches the Settlement Modal calculation and accounts for principal reductions from payments
 * @param {Object} loan - Loan object
 * @param {Array} transactions - Array of transaction objects
 * @param {Date} asOfDate - Date to calculate as of (defaults to today)
 * @returns {Object} { interestAccrued, interestPaid, interestRemaining, principalRemaining }
 */
export function calculateAccruedInterestWithTransactions(loan, transactions = [], asOfDate = new Date(), schedule = []) {
  if (!loan || loan.status === 'Pending') {
    return {
      interestAccrued: 0,
      interestPaid: 0,
      interestRemaining: 0,
      principalRemaining: loan?.principal_amount || 0
    };
  }

  const startDate = new Date(loan.start_date);
  const today = new Date(asOfDate);
  today.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);
  const startDateKey = startDate.toISOString().split('T')[0];

  const principal = loan.principal_amount;

  // Get repayment transactions sorted by date
  const repayments = transactions
    .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // Get disbursement transactions (further advances) - exclude initial disbursement on start date
  const disbursements = transactions
    .filter(tx => !tx.is_deleted && tx.type === 'Disbursement')
    .filter(tx => {
      const txDate = new Date(tx.date);
      txDate.setHours(0, 0, 0, 0);
      return txDate.toISOString().split('T')[0] !== startDateKey;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // Calculate totals from actual transactions
  const totalPrincipalPaid = repayments.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
  const totalInterestPaid = repayments.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
  // Use gross_amount for disbursements (what borrower owes), fallback to amount for legacy data
  const totalDisbursed = disbursements.reduce((sum, tx) => sum + ((tx.gross_amount ?? tx.amount) || 0), 0);
  const principalRemaining = principal + totalDisbursed - totalPrincipalPaid;

  // If schedule is provided, use the accurate calculateLoanInterestBalance function
  // This recalculates interest dynamically, handling penalty rates, mid-period capital changes, etc.
  if (schedule && schedule.length > 0) {
    // Debug logging for specific loans
    if (loan.loan_number === '1000025' || loan.loan_number === '1000001') {
      console.log(`[AccruedInterestWithTx] Loan ${loan.loan_number} - USING schedule-based calc:`, {
        scheduleLength: schedule.length,
        transactionsLength: transactions.length
      });
    }
    const interestCalc = calculateLoanInterestBalance(loan, schedule, transactions, asOfDate);

    return {
      interestAccrued: interestCalc.totalInterestDue,
      interestPaid: interestCalc.totalInterestPaid,
      interestRemaining: interestCalc.interestBalance,
      principalRemaining: Math.round(principalRemaining * 100) / 100
    };
  }

  // Fall back to day-by-day calculation for loans without schedules
  // Note: This uses a single rate and won't handle rate changes correctly
  // Debug logging for specific loans
  if (loan.loan_number === '1000025' || loan.loan_number === '1000001') {
    console.log(`[AccruedInterestWithTx] Loan ${loan.loan_number} - FALLBACK day-by-day calc:`, {
      scheduleProvided: !!schedule,
      scheduleLength: schedule?.length || 0
    });
  }
  const daysElapsed = Math.max(0, Math.floor((today - startDate) / (1000 * 60 * 60 * 24)) + 1);
  const annualRate = loan.interest_rate / 100;
  const dailyRate = annualRate / 365;

  // Create a map of principal payments by date
  const principalPaymentsByDate = {};
  repayments.forEach(tx => {
    if (tx.principal_applied > 0) {
      const txDate = new Date(tx.date);
      txDate.setHours(0, 0, 0, 0);
      const dateKey = txDate.toISOString().split('T')[0];
      principalPaymentsByDate[dateKey] = (principalPaymentsByDate[dateKey] || 0) + tx.principal_applied;
    }
  });

  // Create a map of disbursements (further advances) by date
  // Use gross_amount (what borrower owes), fallback to amount for legacy data
  const disbursementsByDate = {};
  disbursements.forEach(tx => {
    const txDate = new Date(tx.date);
    txDate.setHours(0, 0, 0, 0);
    const dateKey = txDate.toISOString().split('T')[0];
    disbursementsByDate[dateKey] = (disbursementsByDate[dateKey] || 0) + ((tx.gross_amount ?? tx.amount) || 0);
  });

  // Calculate interest day by day, adjusting principal when payments/disbursements occur
  let totalInterestAccrued = 0;
  let runningPrincipal = principal;

  for (let day = 0; day < daysElapsed; day++) {
    const currentDate = new Date(startDate.getTime() + day * 24 * 60 * 60 * 1000);
    const dateKey = currentDate.toISOString().split('T')[0];

    // Check if principal was increased by disbursement on this day
    if (disbursementsByDate[dateKey]) {
      runningPrincipal += disbursementsByDate[dateKey];
    }

    // Check if principal was reduced on this day
    if (principalPaymentsByDate[dateKey]) {
      runningPrincipal -= principalPaymentsByDate[dateKey];
      runningPrincipal = Math.max(0, runningPrincipal);
    }

    // Calculate interest for this day based on current principal
    const dayInterest = runningPrincipal * dailyRate;
    totalInterestAccrued += dayInterest;
  }

  const interestRemaining = totalInterestAccrued - totalInterestPaid;

  return {
    interestAccrued: Math.round(totalInterestAccrued * 100) / 100,
    interestPaid: Math.round(totalInterestPaid * 100) / 100,
    interestRemaining: Math.round(interestRemaining * 100) / 100,
    principalRemaining: Math.round(principalRemaining * 100) / 100
  };
}

/**
 * Calculate the accurate interest balance for a loan
 * This matches the RepaymentScheduleTable's calculation exactly, handling:
 * - Penalty rates
 * - Mid-period capital changes (further advances, principal repayments)
 * - Transaction assignment to schedule periods
 *
 * @param {Object} loan - Loan object with interest_rate, penalty_rate, penalty_rate_from, start_date, principal_amount
 * @param {Array} schedule - Repayment schedule rows
 * @param {Array} transactions - All transactions for the loan
 * @param {Date} asOfDate - Calculate interest due up to this date (default: today)
 * @returns {Object} { totalInterestDue, totalInterestPaid, interestBalance }
 */
export function calculateLoanInterestBalance(loan, schedule = [], transactions = [], asOfDate = new Date()) {
  if (!loan || !schedule || schedule.length === 0) {
    return {
      totalInterestDue: 0,
      totalInterestPaid: 0,
      interestBalance: 0
    };
  }

  const today = new Date(asOfDate);
  today.setHours(0, 0, 0, 0);

  // Debug logging for specific loans
  const isDebugLoan = loan.loan_number === '1000025' || loan.loan_number === '1000001';
  if (isDebugLoan) {
    // Get first and last schedule entries
    const scheduleByDate = [...schedule].sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    const firstSchedule = scheduleByDate[0];
    const lastSchedule = scheduleByDate[scheduleByDate.length - 1];

    console.log(`[InterestCalc DEBUG] Loan ${loan.loan_number}:`, {
      scheduleLength: schedule.length,
      transactionsLength: transactions.length,
      asOfDate: today.toISOString(),
      loanRate: loan.interest_rate,
      penaltyRate: loan.penalty_rate,
      penaltyRateFrom: loan.penalty_rate_from,
      firstScheduleDueDate: firstSchedule?.due_date,
      lastScheduleDueDate: lastSchedule?.due_date,
      repaymentTxCount: transactions.filter(tx => !tx.is_deleted && tx.type === 'Repayment').length,
      disbursementTxCount: transactions.filter(tx => !tx.is_deleted && tx.type === 'Disbursement').length
    });
  }

  // Sort schedule by due_date ascending
  const sortedSchedule = [...schedule].sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

  // Separate transactions
  const repaymentTransactions = transactions
    .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const disbursementTransactions = transactions
    .filter(tx => !tx.is_deleted && tx.type === 'Disbursement')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // PASS 1: Assign each repayment transaction to its closest schedule period
  const txAssignments = new Map();

  repaymentTransactions.forEach(tx => {
    const txDate = new Date(tx.date);
    let closestSchedule = null;
    let closestDiff = Infinity;

    sortedSchedule.forEach(scheduleRow => {
      const dueDate = new Date(scheduleRow.due_date);
      const diff = Math.abs(txDate - dueDate);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestSchedule = scheduleRow;
      }
    });

    if (closestSchedule) {
      if (!txAssignments.has(closestSchedule.id)) {
        txAssignments.set(closestSchedule.id, []);
      }
      txAssignments.get(closestSchedule.id).push(tx);
    }
  });

  // PASS 2: Redistribute excess transactions from crowded periods to empty adjacent periods
  const RANGE_DAYS = 60;
  const rangeMsec = RANGE_DAYS * 24 * 60 * 60 * 1000;

  const scheduleIndexById = new Map();
  sortedSchedule.forEach((s, idx) => scheduleIndexById.set(s.id, idx));

  const emptyPeriodIds = new Set(
    sortedSchedule
      .filter(s => !txAssignments.has(s.id) || txAssignments.get(s.id).length === 0)
      .map(s => s.id)
  );

  for (const [periodId, periodTxs] of txAssignments.entries()) {
    while (periodTxs.length > 1 && emptyPeriodIds.size > 0) {
      const periodIdx = scheduleIndexById.get(periodId);
      const periodDueDate = new Date(sortedSchedule[periodIdx].due_date);

      let furthestTx = null;
      let furthestDiff = -1;
      periodTxs.forEach(tx => {
        const diff = Math.abs(new Date(tx.date) - periodDueDate);
        if (diff > furthestDiff) {
          furthestDiff = diff;
          furthestTx = tx;
        }
      });

      let bestEmptyId = null;
      let bestDistance = Infinity;

      for (const emptyId of emptyPeriodIds) {
        const emptyIdx = scheduleIndexById.get(emptyId);
        const emptyDueDate = new Date(sortedSchedule[emptyIdx].due_date);
        const txDate = new Date(furthestTx.date);

        const txToEmptyDiff = Math.abs(txDate - emptyDueDate);
        if (txToEmptyDiff <= rangeMsec) {
          const indexDistance = Math.abs(emptyIdx - periodIdx);
          if (indexDistance < bestDistance) {
            bestDistance = indexDistance;
            bestEmptyId = emptyId;
          }
        }
      }

      if (bestEmptyId) {
        const txIndex = periodTxs.indexOf(furthestTx);
        periodTxs.splice(txIndex, 1);

        if (!txAssignments.has(bestEmptyId)) {
          txAssignments.set(bestEmptyId, []);
        }
        txAssignments.get(bestEmptyId).push(furthestTx);
        emptyPeriodIds.delete(bestEmptyId);
      } else {
        break;
      }
    }
  }

  // Build capital events ledger for consistent interest calculation (same as UI schedule table)
  const capitalEvents = buildCapitalEvents(loan, transactions);

  // Build rows array for tracking principal and calculating interest
  const rows = [];

  // Add disbursement rows
  disbursementTransactions.forEach((tx, index) => {
    const isInitial = index === 0;
    const grossAmount = tx.gross_amount ?? tx.amount;

    rows.push({
      type: isInitial ? 'disbursement' : 'further_advance',
      date: new Date(tx.date),
      principal: grossAmount,
      sortOrder: isInitial ? 0 : 1
    });
  });

  // Detect if this is an "interest paid in advance" loan
  // For advance loans, the first due date equals the loan start date
  // For arrears loans, the first due date is after the loan start date
  const loanStartDate = new Date(loan.start_date);
  loanStartDate.setHours(0, 0, 0, 0);
  const firstDueDate = sortedSchedule.length > 0 ? new Date(sortedSchedule[0].due_date) : null;
  if (firstDueDate) firstDueDate.setHours(0, 0, 0, 0);

  const isInterestPaidInAdvance = firstDueDate && firstDueDate.getTime() === loanStartDate.getTime();

  if (isDebugLoan) {
    console.log(`[InterestCalc DEBUG] isInterestPaidInAdvance: ${isInterestPaidInAdvance}`, {
      loanStartDate: loanStartDate.toISOString(),
      firstDueDate: firstDueDate?.toISOString(),
      match: firstDueDate?.getTime() === loanStartDate.getTime()
    });
  }

  // Add schedule header rows (only for periods up to asOfDate)
  sortedSchedule.forEach((scheduleRow, idx) => {
    const dueDate = new Date(scheduleRow.due_date);
    dueDate.setHours(0, 0, 0, 0);

    // Only include periods where due_date <= asOfDate
    if (dueDate > today) return;

    // Calculate period boundaries based on payment timing
    let periodStartDate, periodEndDate;

    if (isInterestPaidInAdvance) {
      // For ADVANCE loans: due date is at START of period
      // Period covers: current due date → next due date
      periodStartDate = dueDate;

      if (idx < sortedSchedule.length - 1) {
        // Use next period's due date as end
        periodEndDate = new Date(sortedSchedule[idx + 1].due_date);
        periodEndDate.setHours(0, 0, 0, 0);
      } else {
        // Last period: use schedule's calculation_days to estimate end
        // Or default to 30 days after start
        const calcDays = scheduleRow.calculation_days || 30;
        periodEndDate = addDays(dueDate, calcDays);
      }
    } else {
      // For ARREARS loans: due date is at END of period
      // Period covers: previous due date → current due date
      periodStartDate = idx > 0
        ? new Date(sortedSchedule[idx - 1].due_date)
        : new Date(loan.start_date);
      periodEndDate = dueDate;
    }

    const periodTransactions = txAssignments.get(scheduleRow.id) || [];

    rows.push({
      type: 'schedule_header',
      scheduleRow,
      date: dueDate,
      expectedInterest: scheduleRow.interest_amount || 0,
      sortOrder: 2,
      periodStartDate,
      periodEndDate,
      periodTransactions,
      isAdvancePayment: isInterestPaidInAdvance
    });
  });

  // Sort all rows by date, then by sortOrder
  rows.sort((a, b) => {
    const dateDiff = a.date - b.date;
    if (dateDiff !== 0) return dateDiff;
    return (a.sortOrder || 0) - (b.sortOrder || 0);
  });

  // Calculate running balances
  let runningPrincipalBalance = 0;
  let runningInterestAccrued = 0;
  let runningInterestPaid = 0;

  // Track principal balance at each period boundary
  const principalAtDate = new Map();
  const startDateKey = new Date(loan.start_date).toISOString().split('T')[0];
  principalAtDate.set(startDateKey, loan.principal_amount);

  rows.forEach(row => {
    if (row.type === 'disbursement') {
      runningPrincipalBalance = row.principal;
      principalAtDate.set(row.date.toISOString().split('T')[0], runningPrincipalBalance);
    } else if (row.type === 'further_advance') {
      runningPrincipalBalance += row.principal;
      principalAtDate.set(row.date.toISOString().split('T')[0], runningPrincipalBalance);
    } else if (row.type === 'schedule_header') {
      // Calculate principalAtPeriodStart
      let principalAtPeriodStart = loan.principal_amount;
      if (row.periodStartDate) {
        const periodStartKey = row.periodStartDate.toISOString().split('T')[0];
        let bestDate = null;
        let bestBalance = loan.principal_amount;
        for (const [dateKey, balance] of principalAtDate.entries()) {
          if (dateKey <= periodStartKey && (!bestDate || dateKey > bestDate)) {
            bestDate = dateKey;
            bestBalance = balance;
          }
        }
        principalAtPeriodStart = bestBalance;
      }

      // Recalculate expectedInterest using the capital events ledger (same as UI schedule table)
      if (row.periodStartDate) {
        const periodStart = row.periodStartDate;
        const periodEnd = row.periodEndDate || row.date;

        // Use the shared ledger-based calculation for consistency
        const ledgerResult = calculateInterestFromLedger(loan, capitalEvents, periodStart, periodEnd);
        row.expectedInterest = ledgerResult.totalInterest;
        row._hadCapitalChanges = ledgerResult.segments.length > 1;
        row._ledgerSegments = ledgerResult.segments;
      }

      // Accrue interest for this period
      runningInterestAccrued += row.expectedInterest;

      // Track interest paid from transactions in this period
      const periodInterestPaid = (row.periodTransactions || [])
        .reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
      runningInterestPaid += periodInterestPaid;

      // Track principal paid to update running balance
      const periodPrincipalPaid = (row.periodTransactions || [])
        .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
      runningPrincipalBalance = Math.max(0, runningPrincipalBalance - periodPrincipalPaid);

      // Record balance at this period end date (AFTER principal reduction)
      // This ensures next period's lookup finds the correct reduced principal
      principalAtDate.set(row.date.toISOString().split('T')[0], runningPrincipalBalance);
    }
  });

  // Build periods array for comparison/debugging
  const scheduleRows = rows.filter(r => r.type === 'schedule_header');
  const periods = scheduleRows.map((row, idx) => {
    const periodStart = row.periodStartDate;
    const periodEnd = row.date;
    const days = periodStart && periodEnd ? differenceInDays(periodEnd, periodStart) : 0;

    // Recalculate principalAtPeriodStart for logging (same logic as above)
    let principalAtPeriodStart = loan.principal_amount;
    if (periodStart) {
      const periodStartKey = periodStart.toISOString().split('T')[0];
      let bestDate = null;
      let bestBalance = loan.principal_amount;
      for (const [dateKey, balance] of principalAtDate.entries()) {
        if (dateKey <= periodStartKey && (!bestDate || dateKey > bestDate)) {
          bestDate = dateKey;
          bestBalance = balance;
        }
      }
      principalAtPeriodStart = bestBalance;
    }

    return {
      periodNumber: row.scheduleRow?.installment_number || (idx + 1),
      dueDate: row.date ? format(row.date, 'yyyy-MM-dd') : null,
      days: days,
      principalAtPeriodStart: Math.round(principalAtPeriodStart * 100) / 100,
      expectedInterest: Math.round((row.expectedInterest || 0) * 100) / 100,
      periodInterestPaid: (row.periodTransactions || []).reduce((sum, tx) => sum + (tx.interest_applied || 0), 0),
      hadCapitalChanges: row._hadCapitalChanges || false
    };
  });

  const result = {
    totalInterestDue: Math.round(runningInterestAccrued * 100) / 100,
    totalInterestPaid: Math.round(runningInterestPaid * 100) / 100,
    interestBalance: Math.round((runningInterestAccrued - runningInterestPaid) * 100) / 100,
    periods: periods // Include per-period data for comparison
  };

  // Debug logging for specific loans
  if (loan.loan_number === '1000025' || loan.loan_number === '1000001') {
    // Count how many schedule rows were processed (had due_date <= today)
    const processedScheduleCount = scheduleRows.length;
    console.log(`[InterestCalc RESULT] Loan ${loan.loan_number}:`, {
      totalInterestDue: result.totalInterestDue,
      totalInterestPaid: result.totalInterestPaid,
      interestBalance: result.interestBalance,
      processedScheduleCount,
      totalScheduleCount: sortedSchedule.length,
      rowsBuilt: rows.length
    });
  }

  return result;
}

/**
 * Build a chronological list of capital events (principal changes) from transactions
 * Used for ledger-based interest calculation
 *
 * @param {Object} loan - Loan object with start_date and principal_amount
 * @param {Array} transactions - All transactions for the loan
 * @returns {Array} Sorted array of { date, principalChange, description, txId }
 */
export function buildCapitalEvents(loan, transactions) {
  const loanStartDate = new Date(loan.start_date);
  loanStartDate.setHours(0, 0, 0, 0);
  const startDateKey = loanStartDate.toISOString().split('T')[0];

  // Principal repayments (reduce principal)
  const repayments = transactions
    .filter(tx => !tx.is_deleted && tx.type === 'Repayment' && tx.principal_applied > 0)
    .map(tx => ({
      date: new Date(tx.date),
      principalChange: -(tx.principal_applied || 0),
      description: `Repayment: -£${(tx.principal_applied || 0).toFixed(2)} principal`,
      txId: tx.id
    }));

  // Further advances (increase principal) - exclude initial disbursement on start date
  const advances = transactions
    .filter(tx => !tx.is_deleted && tx.type === 'Disbursement')
    .filter(tx => {
      const txDate = new Date(tx.date);
      txDate.setHours(0, 0, 0, 0);
      return txDate.toISOString().split('T')[0] !== startDateKey;
    })
    .map(tx => ({
      date: new Date(tx.date),
      principalChange: tx.gross_amount ?? tx.amount,
      description: `Further Advance: +£${(tx.gross_amount ?? tx.amount).toFixed(2)}`,
      txId: tx.id
    }));

  // Sort by date
  const events = [...repayments, ...advances].sort((a, b) => a.date - b.date);

  // Normalize all dates
  events.forEach(e => e.date.setHours(0, 0, 0, 0));

  return events;
}

/**
 * Calculate interest accrued between two dates using capital events ledger
 * This is the core ledger-based calculation that handles mid-period capital changes correctly
 *
 * @param {Object} loan - Loan object with principal_amount, interest_rate, penalty_rate, penalty_rate_from
 * @param {Array} capitalEvents - Sorted array from buildCapitalEvents()
 * @param {Date} fromDate - Start date (exclusive for interest, but events on this date apply)
 * @param {Date} toDate - End date (inclusive)
 * @returns {Object} { totalInterest, segments[] } with detailed breakdown
 */
export function calculateInterestFromLedger(loan, capitalEvents, fromDate, toDate) {
  let periodStart = new Date(fromDate);
  periodStart.setHours(0, 0, 0, 0);

  const endDate = new Date(toDate);
  endDate.setHours(0, 0, 0, 0);

  // If dates are same or invalid range, return 0
  if (periodStart >= endDate) {
    return { totalInterest: 0, segments: [], days: 0 };
  }

  // Determine starting principal by applying all events up to and including fromDate
  let runningPrincipal = loan.principal_amount;
  let eventIndex = 0;

  // Apply all capital events that occurred on or before fromDate
  while (eventIndex < capitalEvents.length) {
    const event = capitalEvents[eventIndex];
    if (event.date <= periodStart) {
      runningPrincipal = Math.max(0, runningPrincipal + event.principalChange);
      eventIndex++;
    } else {
      break;
    }
  }

  let totalInterest = 0;
  const segments = [];

  while (periodStart < endDate) {
    // Determine the rate for this segment
    let rate = loan.interest_rate;
    if (loan.penalty_rate && loan.penalty_rate_from) {
      const penaltyDate = new Date(loan.penalty_rate_from);
      penaltyDate.setHours(0, 0, 0, 0);
      if (periodStart >= penaltyDate) {
        rate = loan.penalty_rate;
      }
    }
    const dailyRate = rate / 100 / 365;

    // Find the end of this segment (next capital event or endDate)
    let segmentEnd;
    if (eventIndex < capitalEvents.length && capitalEvents[eventIndex].date < endDate) {
      segmentEnd = capitalEvents[eventIndex].date;
    } else {
      segmentEnd = endDate;
    }

    // Calculate days and interest for this segment
    const days = differenceInDays(segmentEnd, periodStart);
    if (days > 0 && runningPrincipal > 0) {
      const segmentInterest = runningPrincipal * dailyRate * days;
      totalInterest += segmentInterest;

      segments.push({
        startDate: new Date(periodStart),
        endDate: new Date(segmentEnd),
        days,
        principal: runningPrincipal,
        rate,
        dailyRate,
        interest: segmentInterest
      });
    }

    // Move to next segment
    periodStart = segmentEnd;

    // Apply capital event if we stopped at one
    if (eventIndex < capitalEvents.length && capitalEvents[eventIndex].date.getTime() === segmentEnd.getTime()) {
      runningPrincipal = Math.max(0, runningPrincipal + capitalEvents[eventIndex].principalChange);
      eventIndex++;
    }
  }

  const totalDays = segments.reduce((sum, s) => sum + s.days, 0);

  return {
    totalInterest: Math.round(totalInterest * 100) / 100,
    segments,
    days: totalDays
  };
}

/**
 * Calculate interest for each schedule period using the capital events ledger
 * Returns per-period breakdown that can be used for display
 *
 * @param {Object} loan - Loan object
 * @param {Array} schedule - Repayment schedule (sorted by due_date ascending)
 * @param {Array} transactions - All transactions
 * @param {Date} asOfDate - Calculate up to this date
 * @returns {Object} { periods[], totalInterestDue, capitalEvents }
 */
export function calculateInterestByPeriod(loan, schedule, transactions, asOfDate = new Date()) {
  const capitalEvents = buildCapitalEvents(loan, transactions);

  const today = new Date(asOfDate);
  today.setHours(0, 0, 0, 0);

  const loanStartDate = new Date(loan.start_date);
  loanStartDate.setHours(0, 0, 0, 0);

  // Sort schedule by due date
  const sortedSchedule = [...schedule].sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

  const periods = [];
  let runningInterestAccrued = 0;

  sortedSchedule.forEach((scheduleRow, idx) => {
    const dueDate = new Date(scheduleRow.due_date);
    dueDate.setHours(0, 0, 0, 0);

    // Only process periods up to asOfDate
    if (dueDate > today) return;

    // Period boundaries: previous due date (or loan start) to current due date
    const periodStart = idx === 0 ? loanStartDate : new Date(sortedSchedule[idx - 1].due_date);
    periodStart.setHours(0, 0, 0, 0);
    const periodEnd = dueDate;

    // Calculate interest for this period using the ledger
    const result = calculateInterestFromLedger(loan, capitalEvents, periodStart, periodEnd);

    runningInterestAccrued += result.totalInterest;

    periods.push({
      installmentNumber: scheduleRow.installment_number,
      scheduleId: scheduleRow.id,
      dueDate: dueDate,
      periodStart: periodStart,
      periodEnd: periodEnd,
      days: result.days,
      interestDue: result.totalInterest,
      segments: result.segments,
      runningInterestAccrued: Math.round(runningInterestAccrued * 100) / 100,
      // Keep reference to original schedule row
      scheduleRow
    });
  });

  return {
    periods,
    totalInterestDue: Math.round(runningInterestAccrued * 100) / 100,
    capitalEvents
  };
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

/**
 * Export detailed schedule calculation data for debugging/analysis
 * Returns raw data showing how each period's interest was calculated
 *
 * @param {Object} loan - Loan object
 * @param {Array} schedule - Repayment schedule rows
 * @param {Array} transactions - All transactions for the loan
 * @param {Date} asOfDate - Calculate up to this date (default: today)
 * @returns {Object} { summary, periods[] }
 */
export function exportScheduleCalculationData(loan, schedule = [], transactions = [], asOfDate = new Date()) {
  if (!loan || !schedule || schedule.length === 0) {
    return {
      summary: {
        loanNumber: loan?.loan_number,
        error: 'No schedule data available',
        scheduleLength: schedule?.length || 0
      },
      periods: []
    };
  }

  const today = new Date(asOfDate);
  today.setHours(0, 0, 0, 0);

  // Sort schedule by due_date ascending
  const sortedSchedule = [...schedule].sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

  // Build capital events ledger for consistent interest calculation (same as UI)
  const capitalEvents = buildCapitalEvents(loan, transactions);
  const loanStartDateForLedger = new Date(loan.start_date);
  loanStartDateForLedger.setHours(0, 0, 0, 0);

  // Separate transactions
  const repaymentTransactions = transactions
    .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const disbursementTransactions = transactions
    .filter(tx => !tx.is_deleted && tx.type === 'Disbursement')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // PASS 1: Assign each repayment transaction to its closest schedule period
  const txAssignments = new Map();

  repaymentTransactions.forEach(tx => {
    const txDate = new Date(tx.date);
    let closestSchedule = null;
    let closestDiff = Infinity;

    sortedSchedule.forEach(scheduleRow => {
      const dueDate = new Date(scheduleRow.due_date);
      const diff = Math.abs(txDate - dueDate);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestSchedule = scheduleRow;
      }
    });

    if (closestSchedule) {
      if (!txAssignments.has(closestSchedule.id)) {
        txAssignments.set(closestSchedule.id, []);
      }
      txAssignments.get(closestSchedule.id).push(tx);
    }
  });

  // PASS 2: Redistribute excess transactions from crowded periods to empty adjacent periods
  const RANGE_DAYS = 60;
  const rangeMsec = RANGE_DAYS * 24 * 60 * 60 * 1000;

  const scheduleIndexById = new Map();
  sortedSchedule.forEach((s, idx) => scheduleIndexById.set(s.id, idx));

  const emptyPeriodIds = new Set(
    sortedSchedule
      .filter(s => !txAssignments.has(s.id) || txAssignments.get(s.id).length === 0)
      .map(s => s.id)
  );

  for (const [periodId, periodTxs] of txAssignments.entries()) {
    while (periodTxs.length > 1 && emptyPeriodIds.size > 0) {
      const periodIdx = scheduleIndexById.get(periodId);
      const periodDueDate = new Date(sortedSchedule[periodIdx].due_date);

      let furthestTx = null;
      let furthestDiff = -1;
      periodTxs.forEach(tx => {
        const diff = Math.abs(new Date(tx.date) - periodDueDate);
        if (diff > furthestDiff) {
          furthestDiff = diff;
          furthestTx = tx;
        }
      });

      let bestEmptyId = null;
      let bestDistance = Infinity;

      for (const emptyId of emptyPeriodIds) {
        const emptyIdx = scheduleIndexById.get(emptyId);
        const emptyDueDate = new Date(sortedSchedule[emptyIdx].due_date);
        const txDate = new Date(furthestTx.date);

        const txToEmptyDiff = Math.abs(txDate - emptyDueDate);
        if (txToEmptyDiff <= rangeMsec) {
          const indexDistance = Math.abs(emptyIdx - periodIdx);
          if (indexDistance < bestDistance) {
            bestDistance = indexDistance;
            bestEmptyId = emptyId;
          }
        }
      }

      if (bestEmptyId) {
        const txIndex = periodTxs.indexOf(furthestTx);
        periodTxs.splice(txIndex, 1);

        if (!txAssignments.has(bestEmptyId)) {
          txAssignments.set(bestEmptyId, []);
        }
        txAssignments.get(bestEmptyId).push(furthestTx);
        emptyPeriodIds.delete(bestEmptyId);
      } else {
        break;
      }
    }
  }

  // Build detailed period data
  const periods = [];
  let runningPrincipalBalance = 0;
  let runningInterestAccrued = 0;
  let runningInterestPaid = 0;
  let runningLedgerInterestAccrued = 0; // Ledger-based running total (matches UI)

  // Track principal balance at each date
  const principalAtDate = new Map();
  const startDateKey = new Date(loan.start_date).toISOString().split('T')[0];
  principalAtDate.set(startDateKey, loan.principal_amount);

  // Process disbursements first to track principal
  disbursementTransactions.forEach((tx, index) => {
    const isInitial = index === 0;
    const grossAmount = tx.gross_amount ?? tx.amount;
    const txDateKey = new Date(tx.date).toISOString().split('T')[0];

    if (isInitial) {
      runningPrincipalBalance = grossAmount;
    } else {
      runningPrincipalBalance += grossAmount;
    }
    principalAtDate.set(txDateKey, runningPrincipalBalance);
  });

  // Detect if this is an "interest paid in advance" loan
  const loanStartDate = new Date(loan.start_date);
  loanStartDate.setHours(0, 0, 0, 0);
  const firstDueDate = sortedSchedule.length > 0 ? new Date(sortedSchedule[0].due_date) : null;
  if (firstDueDate) firstDueDate.setHours(0, 0, 0, 0);
  const isInterestPaidInAdvance = firstDueDate && firstDueDate.getTime() === loanStartDate.getTime();

  // Process each schedule period
  sortedSchedule.forEach((scheduleRow, idx) => {
    const dueDate = new Date(scheduleRow.due_date);
    dueDate.setHours(0, 0, 0, 0);

    // Only include periods where due_date <= asOfDate
    if (dueDate > today) return;

    // Calculate period boundaries based on payment timing
    let periodStartDate, periodEndDate;

    if (isInterestPaidInAdvance) {
      // For ADVANCE loans: due date is at START of period
      // Period covers: current due date → next due date
      periodStartDate = dueDate;

      if (idx < sortedSchedule.length - 1) {
        periodEndDate = new Date(sortedSchedule[idx + 1].due_date);
        periodEndDate.setHours(0, 0, 0, 0);
      } else {
        const calcDays = scheduleRow.calculation_days || 30;
        periodEndDate = addDays(dueDate, calcDays);
      }
    } else {
      // For ARREARS loans: due date is at END of period
      periodStartDate = idx > 0
        ? new Date(sortedSchedule[idx - 1].due_date)
        : new Date(loan.start_date);
      periodEndDate = dueDate;
    }

    const periodTransactions = txAssignments.get(scheduleRow.id) || [];

    // Find principalAtPeriodStart
    const periodStartKey = periodStartDate.toISOString().split('T')[0];
    let bestDate = null;
    let principalAtPeriodStart = loan.principal_amount;
    for (const [dateKey, balance] of principalAtDate.entries()) {
      if (dateKey <= periodStartKey && (!bestDate || dateKey > bestDate)) {
        bestDate = dateKey;
        principalAtPeriodStart = balance;
      }
    }

    // Calculate expected interest for this period
    const rateToUse = (loan.penalty_rate && loan.penalty_rate_from && new Date(loan.penalty_rate_from) <= periodEndDate)
      ? loan.penalty_rate
      : loan.interest_rate;
    const dailyRate = rateToUse / 100 / 365;
    const days = differenceInDays(periodEndDate, periodStartDate);

    let expectedInterest = scheduleRow.interest_amount || 0;
    let calculationMethod = 'database_value';
    let calculationDetails = {};

    // Recalculate interest if we have valid data
    if (principalAtPeriodStart > 0 && days > 0) {
      // Find capital changes during this period
      const capitalChanges = [];

      // Further advances
      disbursementTransactions
        .filter(tx => {
          const txDate = new Date(tx.date);
          return txDate > periodStartDate && txDate <= periodEndDate;
        })
        .forEach((tx, i) => {
          if (i > 0 || disbursementTransactions.indexOf(tx) > 0) { // Skip first disbursement
            capitalChanges.push({
              type: 'advance',
              date: new Date(tx.date),
              amount: tx.gross_amount ?? tx.amount
            });
          }
        });

      // Principal repayments (only those within period boundaries)
      periodTransactions
        .filter(tx => {
          if (tx.principal_applied <= 0) return false;
          const txDate = new Date(tx.date);
          txDate.setHours(0, 0, 0, 0);
          return txDate > periodStartDate && txDate <= periodEndDate;
        })
        .forEach(tx => {
          capitalChanges.push({
            type: 'repayment',
            date: new Date(tx.date),
            amount: tx.principal_applied
          });
        });

      capitalChanges.sort((a, b) => a.date - b.date);

      if (capitalChanges.length > 0) {
        // Segmented calculation
        let segmentPrincipal = principalAtPeriodStart;
        let segmentStart = periodStartDate;
        let totalInterest = 0;
        const segments = [];

        capitalChanges.forEach(change => {
          const daysInSegment = differenceInDays(change.date, segmentStart);
          if (daysInSegment > 0) {
            const segmentInterest = segmentPrincipal * dailyRate * daysInSegment;
            totalInterest += segmentInterest;
            segments.push({
              from: format(segmentStart, 'yyyy-MM-dd'),
              to: format(change.date, 'yyyy-MM-dd'),
              days: daysInSegment,
              principal: Math.round(segmentPrincipal * 100) / 100,
              interest: Math.round(segmentInterest * 100) / 100
            });
          }
          if (change.type === 'advance') {
            segmentPrincipal += change.amount;
          } else {
            segmentPrincipal = Math.max(0, segmentPrincipal - change.amount);
          }
          segmentStart = change.date;
        });

        // Final segment
        const finalDays = differenceInDays(periodEndDate, segmentStart);
        if (finalDays > 0 && segmentPrincipal > 0) {
          const segmentInterest = segmentPrincipal * dailyRate * finalDays;
          totalInterest += segmentInterest;
          segments.push({
            from: format(segmentStart, 'yyyy-MM-dd'),
            to: format(periodEndDate, 'yyyy-MM-dd'),
            days: finalDays,
            principal: Math.round(segmentPrincipal * 100) / 100,
            interest: Math.round(segmentInterest * 100) / 100
          });
        }

        expectedInterest = totalInterest;
        calculationMethod = 'segmented';
        calculationDetails = { segments, capitalChanges: capitalChanges.map(c => ({ ...c, date: format(c.date, 'yyyy-MM-dd') })) };
      } else {
        // Simple calculation
        expectedInterest = principalAtPeriodStart * dailyRate * days;
        calculationMethod = 'simple';
        calculationDetails = {
          principal: principalAtPeriodStart,
          dailyRate: dailyRate,
          days: days,
          formula: `${principalAtPeriodStart} × ${dailyRate.toFixed(8)} × ${days} = ${expectedInterest.toFixed(2)}`
        };
      }
    }

    // Calculate interest received for this period
    const periodInterestPaid = periodTransactions.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
    const periodPrincipalPaid = periodTransactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);

    // Calculate ledger-based interest (same method as UI RepaymentScheduleTable)
    // Period boundaries depend on payment timing (advance vs arrears)
    let ledgerPeriodStart, ledgerPeriodEnd;

    if (isInterestPaidInAdvance) {
      // For ADVANCE payment: due date is at START of period
      // Period covers: current due date → next due date
      ledgerPeriodStart = new Date(scheduleRow.due_date);
      ledgerPeriodStart.setHours(0, 0, 0, 0);

      if (idx < sortedSchedule.length - 1) {
        ledgerPeriodEnd = new Date(sortedSchedule[idx + 1].due_date);
        ledgerPeriodEnd.setHours(0, 0, 0, 0);
      } else {
        // Last period - use calculation_days or default 30 days
        const calcDays = scheduleRow.calculation_days || 30;
        ledgerPeriodEnd = addDays(ledgerPeriodStart, calcDays);
      }
    } else {
      // For ARREARS payment: due date is at END of period
      // Period covers: previous due date (or loan start) → current due date
      ledgerPeriodStart = idx === 0
        ? loanStartDateForLedger
        : new Date(sortedSchedule[idx - 1].due_date);
      ledgerPeriodStart.setHours(0, 0, 0, 0);
      ledgerPeriodEnd = new Date(scheduleRow.due_date);
      ledgerPeriodEnd.setHours(0, 0, 0, 0);
    }

    const ledgerResult = calculateInterestFromLedger(loan, capitalEvents, ledgerPeriodStart, ledgerPeriodEnd);
    const ledgerInterest = ledgerResult.totalInterest;

    runningInterestAccrued += expectedInterest;
    runningInterestPaid += periodInterestPaid;
    runningLedgerInterestAccrued += ledgerInterest;

    // Update principal balance for repayments
    runningPrincipalBalance = Math.max(0, runningPrincipalBalance - periodPrincipalPaid);
    principalAtDate.set(dueDate.toISOString().split('T')[0], runningPrincipalBalance);

    periods.push({
      periodNumber: scheduleRow.installment_number,
      dueDate: format(dueDate, 'yyyy-MM-dd'),
      periodStart: format(periodStartDate, 'yyyy-MM-dd'),
      periodEnd: format(periodEndDate, 'yyyy-MM-dd'),
      days: days,
      isAdvancePayment: isInterestPaidInAdvance,
      // Principal tracking
      principalAtPeriodStart: Math.round(principalAtPeriodStart * 100) / 100,
      principalBalanceAfter: Math.round(runningPrincipalBalance * 100) / 100,
      principalPaidThisPeriod: Math.round(periodPrincipalPaid * 100) / 100,
      // Interest calculation
      interestRate: loan.interest_rate,
      penaltyRate: loan.penalty_rate || null,
      rateUsed: rateToUse,
      isPenaltyRate: rateToUse !== loan.interest_rate,
      calculationMethod: calculationMethod,
      calculationDetails: calculationDetails,
      // Interest values
      interestDueThisPeriod: Math.round(expectedInterest * 100) / 100,
      interestReceivedThisPeriod: Math.round(periodInterestPaid * 100) / 100,
      databaseInterestAmount: scheduleRow.interest_amount,
      // Ledger-based interest (same as UI)
      ledgerInterestDue: Math.round(ledgerInterest * 100) / 100,
      ledgerSegments: ledgerResult.segments,
      // Running totals
      runningInterestAccrued: Math.round(runningInterestAccrued * 100) / 100,
      runningInterestPaid: Math.round(runningInterestPaid * 100) / 100,
      runningInterestBalance: Math.round((runningInterestAccrued - runningInterestPaid) * 100) / 100,
      // Ledger-based running totals (matches UI)
      runningLedgerInterestAccrued: Math.round(runningLedgerInterestAccrued * 100) / 100,
      runningLedgerInterestBalance: Math.round((runningLedgerInterestAccrued - runningInterestPaid) * 100) / 100,
      // Transactions assigned to this period
      transactionsInPeriod: periodTransactions.map(tx => ({
        id: tx.id,
        date: tx.date,
        amount: tx.amount,
        principalApplied: tx.principal_applied,
        interestApplied: tx.interest_applied,
        feesApplied: tx.fees_applied
      }))
    });
  });

  return {
    summary: {
      loanNumber: loan.loan_number,
      loanId: loan.id,
      borrower: loan.borrower_name,
      asOfDate: format(today, 'yyyy-MM-dd'),
      loanStartDate: loan.start_date,
      originalPrincipal: loan.principal_amount,
      interestRate: loan.interest_rate,
      penaltyRate: loan.penalty_rate,
      penaltyRateFrom: loan.penalty_rate_from,
      isInterestPaidInAdvance: isInterestPaidInAdvance,
      totalSchedulePeriods: sortedSchedule.length,
      periodsProcessed: periods.length,
      totalRepaymentTransactions: repaymentTransactions.length,
      totalDisbursements: disbursementTransactions.length,
      // Final totals (period-based calculation)
      totalInterestDue: Math.round(runningInterestAccrued * 100) / 100,
      totalInterestReceived: Math.round(runningInterestPaid * 100) / 100,
      interestBalance: Math.round((runningInterestAccrued - runningInterestPaid) * 100) / 100,
      // Final totals (ledger-based calculation - matches UI)
      totalLedgerInterestDue: Math.round(runningLedgerInterestAccrued * 100) / 100,
      ledgerInterestBalance: Math.round((runningLedgerInterestAccrued - runningInterestPaid) * 100) / 100,
      finalPrincipalBalance: Math.round(runningPrincipalBalance * 100) / 100
    },
    periods: periods
  };
}