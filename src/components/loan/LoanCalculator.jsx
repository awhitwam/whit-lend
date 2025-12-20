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
  extendForFullPeriod = false
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
      extendForFullPeriod
    });
  }
  const schedule = [];
  const periodsPerYear = period === 'Monthly' ? 12 : 52;
  const periodRate = interestRate / 100 / periodsPerYear;
  
  if (interestType === 'Rolled-Up') {
    // Rolled-Up: No payments until the end, interest compounds on balance
    let balance = principal;
    
    for (let i = 1; i <= duration; i++) {
      const dueDate = period === 'Monthly' 
        ? addMonths(new Date(startDate), i)
        : addWeeks(new Date(startDate), i);
      
      const interestForPeriod = balance * periodRate;
      balance += interestForPeriod;
      
      const isLastPeriod = i === duration;
      const paymentDue = isLastPeriod ? balance : 0;
      const principalDue = isLastPeriod ? principal : 0;
      const interestDue = isLastPeriod ? balance - principal : 0;
      
      schedule.push({
        installment_number: i,
        due_date: format(dueDate, 'yyyy-MM-dd'),
        principal_amount: Math.round(principalDue * 100) / 100,
        interest_amount: Math.round(interestDue * 100) / 100,
        total_due: Math.round(paymentDue * 100) / 100,
        balance: isLastPeriod ? 0 : Math.round(balance * 100) / 100,
        principal_paid: 0,
        interest_paid: 0,
        status: 'Pending'
      });
    }
  } else if (interestType === 'Interest-Only') {
    // Interest-Only: Pay only interest for a period, then principal + interest or balloon
    const interestOnlyPayment = principal * periodRate;
    const effectiveInterestOnlyPeriod = interestOnlyPeriod > 0 ? interestOnlyPeriod : duration;
    
    // Interest-only periods
    for (let i = 1; i <= effectiveInterestOnlyPeriod; i++) {
      const dueDate = period === 'Monthly' 
        ? addMonths(new Date(startDate), i)
        : addWeeks(new Date(startDate), i);
      
      schedule.push({
        installment_number: i,
        due_date: format(dueDate, 'yyyy-MM-dd'),
        principal_amount: 0,
        interest_amount: Math.round(interestOnlyPayment * 100) / 100,
        total_due: Math.round(interestOnlyPayment * 100) / 100,
        balance: principal,
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
      const pmt = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
      
      let remainingBalance = principal;
      
      for (let i = 1; i <= remainingPeriods; i++) {
        const dueDate = period === 'Monthly'
          ? addMonths(new Date(startDate), effectiveInterestOnlyPeriod + i)
          : addWeeks(new Date(startDate), effectiveInterestOnlyPeriod + i);
        
        const interestForPeriod = remainingBalance * r;
        const principalForPeriod = pmt - interestForPeriod;
        remainingBalance -= principalForPeriod;
        
        schedule.push({
          installment_number: effectiveInterestOnlyPeriod + i,
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
      // Entire term is interest-only, balloon payment at the end
      schedule[schedule.length - 1].principal_amount = principal;
      schedule[schedule.length - 1].total_due = Math.round((principal + interestOnlyPayment) * 100) / 100;
      schedule[schedule.length - 1].balance = 0;
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
    // Reducing Balance: Standard Amortization Formula
    // PMT = P * [r(1+r)^n] / [(1+r)^n - 1]
    const r = periodRate;
    const n = duration;
    const pmt = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    
    let remainingBalance = principal;
    
    for (let i = 1; i <= duration; i++) {
      const dueDate = period === 'Monthly'
        ? addMonths(new Date(startDate), i)
        : addWeeks(new Date(startDate), i);
      
      const interestForPeriod = remainingBalance * r;
      const principalForPeriod = pmt - interestForPeriod;
      remainingBalance -= principalForPeriod;
      
      schedule.push({
        installment_number: i,
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
  extendForFullPeriod = false
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
 * Calculate live interest outstanding based on daily accrual
 * @param {Object} loan - Loan object
 * @param {Date} asOfDate - Date to calculate as of (defaults to today)
 * @returns {number} Live interest outstanding (negative if overpaid)
 */
 export function calculateLiveInterestOutstanding(loan, asOfDate = new Date()) {
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
  const annualRate = loan.interest_rate / 100;
  const periodRate = annualRate / periodsPerYear;
  
  let accruedInterest = 0;
  
  if (loan.interest_type === 'Flat') {
    // Flat rate: total interest spread evenly
    const totalInterest = loan.total_interest;
    const interestPerDay = totalInterest / (loan.duration * daysPerPeriod);
    accruedInterest = Math.min(interestPerDay * daysElapsed, totalInterest);
    
  } else if (loan.interest_type === 'Reducing') {
    // Reducing balance: calculate based on what should have been paid by now
    const periodsCompleted = Math.min(Math.floor(periodsElapsed), loan.duration);
    const dailyRate = annualRate / 365;
    
    // Simple approximation: use reducing balance formula for periods completed
    let remainingBalance = principal;
    const r = periodRate;
    const n = loan.duration;
    const pmt = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    
    for (let i = 0; i < periodsCompleted; i++) {
      const interestForPeriod = remainingBalance * r;
      accruedInterest += interestForPeriod;
      const principalForPeriod = pmt - interestForPeriod;
      remainingBalance -= principalForPeriod;
    }
    
    // Add partial period interest
    if (periodsElapsed > periodsCompleted && remainingBalance > 0) {
      const daysInPartialPeriod = daysElapsed - (periodsCompleted * daysPerPeriod);
      accruedInterest += remainingBalance * dailyRate * daysInPartialPeriod;
    }
    
  } else if (loan.interest_type === 'Interest-Only') {
    const interestOnlyPeriod = loan.interest_only_period || loan.duration;
    const periodsCompleted = Math.min(Math.floor(periodsElapsed), interestOnlyPeriod);
    const interestPerPeriod = principal * periodRate;
    
    accruedInterest = periodsCompleted * interestPerPeriod;
    
    // Partial period
    if (periodsElapsed > periodsCompleted && periodsElapsed <= interestOnlyPeriod) {
      const partialPeriod = periodsElapsed - periodsCompleted;
      accruedInterest += partialPeriod * interestPerPeriod;
    }
    
    // If past interest-only period, add reducing balance calculation
    if (periodsElapsed > interestOnlyPeriod) {
      const remainingPeriods = loan.duration - interestOnlyPeriod;
      const r = periodRate;
      const pmt = principal * (r * Math.pow(1 + r, remainingPeriods)) / (Math.pow(1 + r, remainingPeriods) - 1);
      
      let balance = principal;
      const periodsInRepayment = Math.min(Math.floor(periodsElapsed - interestOnlyPeriod), remainingPeriods);
      
      for (let i = 0; i < periodsInRepayment; i++) {
        const interestForPeriod = balance * r;
        accruedInterest += interestForPeriod;
        const principalForPeriod = pmt - interestForPeriod;
        balance -= principalForPeriod;
      }
    }
    
  } else if (loan.interest_type === 'Rolled-Up') {
    // Rolled-up: compound interest daily
    const dailyRate = annualRate / 365;
    accruedInterest = principal * (Math.pow(1 + dailyRate, daysElapsed) - 1);
  }
  
  // Subtract what's already been paid
  const interestPaid = loan.interest_paid || 0;
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