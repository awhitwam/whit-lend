
import jsPDF from 'jspdf';
import { format, differenceInDays, isValid } from 'date-fns';
import { formatCurrency } from './LoanCalculator';

/**
 * Build a comprehensive interest ledger showing all capital events, rate changes,
 * and running interest balance that the borrower can trace through
 *
 * This builds the ledger directly from transactions to ensure we capture:
 * - Initial disbursement on start date
 * - All further advances
 * - All repayments (with interest and principal breakdown)
 * - Penalty rate changes
 */
function buildInterestLedger(loan, transactions, product) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const loanStartDate = new Date(loan.start_date);
  loanStartDate.setHours(0, 0, 0, 0);

  // Get all active transactions sorted by date
  const activeTransactions = (transactions || [])
    .filter(t => !t.is_deleted)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // Prepare penalty rate info
  const hasPenaltyRate = loan.has_penalty_rate && loan.penalty_rate && loan.penalty_rate_from;
  let penaltyDate = null;
  if (hasPenaltyRate) {
    penaltyDate = new Date(loan.penalty_rate_from);
    penaltyDate.setHours(0, 0, 0, 0);
  }

  // Build ledger entries - each entry is a period where principal and rate are constant
  const ledgerEntries = [];
  let runningPrincipal = 0;
  let runningInterestAccrued = 0;
  let runningInterestPaid = 0;

  // Create a timeline of all events that change state directly from transactions
  const stateChangeEvents = [];

  // Add ALL disbursements (including initial on start date)
  activeTransactions
    .filter(tx => tx.type === 'Disbursement')
    .forEach(tx => {
      const txDate = new Date(tx.date);
      txDate.setHours(0, 0, 0, 0);
      stateChangeEvents.push({
        date: txDate,
        type: 'Disbursement',
        principalChange: tx.gross_amount ?? tx.amount,
        description: tx.reference || 'Funds advanced',
        transaction: tx
      });
    });

  // Add ALL repayments
  activeTransactions
    .filter(tx => tx.type === 'Repayment')
    .forEach(tx => {
      const txDate = new Date(tx.date);
      txDate.setHours(0, 0, 0, 0);
      stateChangeEvents.push({
        date: txDate,
        type: 'Repayment',
        principalChange: -(tx.principal_applied || 0),
        interestApplied: tx.interest_applied || 0,
        description: tx.reference || 'Payment received',
        transaction: tx
      });
    });

  // Add penalty rate change as a state event
  if (hasPenaltyRate && penaltyDate >= loanStartDate && penaltyDate <= today) {
    stateChangeEvents.push({
      date: penaltyDate,
      type: 'RateChange',
      rateChange: { from: loan.interest_rate, to: loan.penalty_rate },
      description: `Penalty rate applied (${loan.interest_rate}% → ${loan.penalty_rate}%)`
    });
  }

  // Sort events by date, then by type (disbursements before repayments on same day)
  stateChangeEvents.sort((a, b) => {
    const dateDiff = a.date - b.date;
    if (dateDiff !== 0) return dateDiff;
    // On same day: Disbursements first, then rate changes, then repayments
    const typeOrder = { Disbursement: 0, RateChange: 1, Repayment: 2 };
    return (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
  });

  // Process timeline
  let currentPrincipal = 0;
  let currentRate = loan.interest_rate;
  let lastEventDate = loanStartDate;

  stateChangeEvents.forEach((event, idx) => {
    const eventDate = event.date;

    // Calculate interest for period before this event (if principal > 0)
    if (eventDate > lastEventDate && currentPrincipal > 0) {
      const days = differenceInDays(eventDate, lastEventDate);
      if (days > 0) {
        const dailyRate = currentPrincipal * (currentRate / 100 / 365);
        const periodInterest = dailyRate * days;
        runningInterestAccrued += periodInterest;

        ledgerEntries.push({
          type: 'InterestAccrual',
          fromDate: new Date(lastEventDate),
          toDate: new Date(eventDate),
          days,
          principal: currentPrincipal,
          rate: currentRate,
          dailyRate: dailyRate,
          interest: periodInterest,
          runningInterestAccrued: runningInterestAccrued,
          runningInterestPaid: runningInterestPaid,
          interestBalance: runningInterestAccrued - runningInterestPaid,
          description: `${days} days @ ${currentRate}% pa on ${formatCurrency(currentPrincipal)}`
        });
      }
    }

    // Process the event itself
    if (event.type === 'Disbursement') {
      currentPrincipal += event.principalChange;
      ledgerEntries.push({
        type: 'Disbursement',
        date: new Date(eventDate),
        amount: event.principalChange,
        principalAfter: currentPrincipal,
        runningInterestAccrued,
        runningInterestPaid,
        interestBalance: runningInterestAccrued - runningInterestPaid,
        description: event.description,
        reference: event.transaction?.reference
      });
    } else if (event.type === 'Repayment') {
      const tx = event.transaction;
      const interestApplied = event.interestApplied || 0;
      const principalApplied = tx?.principal_applied || 0;

      if (interestApplied > 0) {
        runningInterestPaid += interestApplied;
      }

      currentPrincipal = Math.max(0, currentPrincipal - principalApplied);

      ledgerEntries.push({
        type: 'Repayment',
        date: new Date(eventDate),
        amount: tx?.amount || 0,
        interestApplied,
        principalApplied,
        principalAfter: currentPrincipal,
        runningInterestAccrued,
        runningInterestPaid,
        interestBalance: runningInterestAccrued - runningInterestPaid,
        description: event.description,
        reference: tx?.reference
      });
    } else if (event.type === 'RateChange') {
      currentRate = event.rateChange.to;
      ledgerEntries.push({
        type: 'RateChange',
        date: new Date(eventDate),
        fromRate: event.rateChange.from,
        toRate: event.rateChange.to,
        principalBalance: currentPrincipal,
        runningInterestAccrued,
        runningInterestPaid,
        interestBalance: runningInterestAccrued - runningInterestPaid,
        description: event.description
      });
    }

    lastEventDate = eventDate;
  });

  // Calculate interest from last event to today
  if (today > lastEventDate && currentPrincipal > 0) {
    const days = differenceInDays(today, lastEventDate);
    if (days > 0) {
      const dailyRate = currentPrincipal * (currentRate / 100 / 365);
      const periodInterest = dailyRate * days;
      runningInterestAccrued += periodInterest;

      ledgerEntries.push({
        type: 'InterestAccrual',
        fromDate: new Date(lastEventDate),
        toDate: new Date(today),
        days,
        principal: currentPrincipal,
        rate: currentRate,
        dailyRate: dailyRate,
        interest: periodInterest,
        runningInterestAccrued: runningInterestAccrued,
        runningInterestPaid: runningInterestPaid,
        interestBalance: runningInterestAccrued - runningInterestPaid,
        description: `${days} days @ ${currentRate}% pa on ${formatCurrency(currentPrincipal)} (to today)`,
        isToToday: true
      });
    }
  }

  return {
    entries: ledgerEntries,
    summary: {
      totalInterestAccrued: Math.round(runningInterestAccrued * 100) / 100,
      totalInterestPaid: Math.round(runningInterestPaid * 100) / 100,
      interestOutstanding: Math.round((runningInterestAccrued - runningInterestPaid) * 100) / 100,
      principalOutstanding: Math.round(currentPrincipal * 100) / 100,
      currentRate,
      hasPenaltyRate: currentRate !== loan.interest_rate
    }
  };
}

/**
 * Build a timeline for PDF output matching the InterestOnlyScheduleView UI
 * Returns rows with: date, interestPaid, expectedInterest, interestBalance, principalChange, principalBalance
 * Includes calculation notes for all row types
 */
function buildPDFTimeline(loan, schedule, transactions, product) {
  const rows = [];

  const getDateKey = (date) => {
    if (typeof date === 'string') {
      const match = date.match(/^(\d{4}-\d{2}-\d{2})/);
      if (match) return match[1];
    }
    const d = new Date(date);
    return format(d, 'yyyy-MM-dd');
  };

  // 1. Add disbursement rows with fee breakdowns
  (transactions || [])
    .filter(tx => tx.type === 'Disbursement' && !tx.is_deleted)
    .forEach(tx => {
      const dateKey = getDateKey(tx.date);
      const grossAmount = tx.gross_amount ?? tx.amount;
      const netAmount = tx.amount || grossAmount;
      const hasDeductions = Math.abs(grossAmount - netAmount) > 0.01;

      // Build calculation breakdown for disbursements with deductions
      let calcBreakdown = null;
      if (hasDeductions) {
        const deductedFee = tx.deducted_fee || 0;
        const deductedInterest = tx.deducted_interest || 0;
        const otherDeductions = grossAmount - netAmount - deductedFee - deductedInterest;

        // Build the working string (shorter version for PDF)
        const parts = [formatCurrency(grossAmount)];
        if (deductedFee > 0) parts.push(`- ${formatCurrency(deductedFee)} fee`);
        if (deductedInterest > 0) parts.push(`- ${formatCurrency(deductedInterest)} int`);
        if (otherDeductions > 0.01) parts.push(`- ${formatCurrency(otherDeductions)} other`);
        parts.push(`= ${formatCurrency(netAmount)} net`);

        calcBreakdown = {
          isDisbursement: true,
          breakdown: parts.join(' '),
          grossAmount,
          netAmount,
          deductedFee,
          deductedInterest,
          otherDeductions
        };
      }

      rows.push({
        id: `tx-${tx.id}`,
        date: dateKey,
        primaryType: 'disbursement',
        principalChange: grossAmount,
        interestPaid: 0,
        expectedInterest: 0,
        isDueDate: false,
        reference: tx.reference || 'Funds advanced',
        calculationBreakdown: calcBreakdown
      });
    });

  // 2. Add repayment rows
  (transactions || [])
    .filter(tx => tx.type === 'Repayment' && !tx.is_deleted)
    .forEach(tx => {
      const dateKey = getDateKey(tx.date);
      rows.push({
        id: `tx-${tx.id}`,
        date: dateKey,
        primaryType: 'repayment',
        principalChange: -(tx.principal_applied || 0),
        interestPaid: tx.interest_applied || 0,
        expectedInterest: 0,
        isDueDate: false,
        reference: tx.reference || 'Payment received',
        calculationBreakdown: null
      });
    });

  // 3. Add schedule due date rows
  (schedule || []).forEach(scheduleEntry => {
    const dateKey = getDateKey(scheduleEntry.due_date);
    const isAdjustment = scheduleEntry.installment_number === 0;
    const row = {
      id: `schedule-${scheduleEntry.installment_number}-${dateKey}`,
      date: dateKey,
      primaryType: isAdjustment ? 'adjustment' : 'due_date',
      principalChange: 0,
      interestPaid: 0,
      expectedInterest: scheduleEntry.interest_amount || 0,
      isDueDate: true,
      scheduleEntry: scheduleEntry,
      calculationBreakdown: null, // Will be calculated below
      isRollUpPeriod: scheduleEntry.is_roll_up_period || false,
      isServicedPeriod: scheduleEntry.is_serviced_period || false
    };

    rows.push(row);
  });

  // 4. Add rate change row if loan has a penalty rate
  if (loan?.has_penalty_rate && loan?.penalty_rate && loan?.penalty_rate_from) {
    const penaltyDateKey = getDateKey(loan.penalty_rate_from);
    rows.push({
      id: `rate-change-${penaltyDateKey}`,
      date: penaltyDateKey,
      primaryType: 'rate_change',
      principalChange: 0,
      interestPaid: 0,
      expectedInterest: 0,
      isDueDate: false,
      previousRate: loan.interest_rate,
      newRate: loan.penalty_rate,
      calculationBreakdown: null
    });
  }

  // 5. Sort all rows by date, then by type order
  const typeOrder = { disbursement: 0, repayment: 1, adjustment: 2, due_date: 3, rate_change: 4 };
  rows.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    const aOrder = typeOrder[a.primaryType] ?? 99;
    const bOrder = typeOrder[b.primaryType] ?? 99;
    return aOrder - bOrder;
  });

  // 6. Calculate running balances and build calculation breakdowns
  const baseRate = loan?.interest_rate || product?.interest_rate || 0;
  const hasPenaltyRate = loan?.has_penalty_rate && loan?.penalty_rate && loan?.penalty_rate_from;
  const penaltyRate = loan?.penalty_rate || baseRate;
  const penaltyRateFrom = hasPenaltyRate ? new Date(loan.penalty_rate_from) : null;

  // Helper to get the effective rate for a given date
  const getEffectiveRateForDate = (dateStr) => {
    if (!hasPenaltyRate) return baseRate;
    const entryDate = new Date(dateStr);
    return entryDate >= penaltyRateFrom ? penaltyRate : baseRate;
  };

  let runningPrincipal = 0;
  let totalExpectedToDate = 0;
  let totalPaidToDate = 0;

  rows.forEach(row => {
    // Update running principal
    runningPrincipal += row.principalChange;
    row.principalBalance = runningPrincipal;

    // Build calculation breakdowns for schedule entries
    if (row.isDueDate && row.scheduleEntry) {
      const scheduleEntry = row.scheduleEntry;
      const days = scheduleEntry.calculation_days || 0;
      const principalForCalc = runningPrincipal;
      const effectiveRate = getEffectiveRateForDate(scheduleEntry.due_date);
      const isAdjustment = scheduleEntry.installment_number === 0;

      if (isAdjustment) {
        const isCredit = scheduleEntry.interest_amount < 0;
        const adjAmount = Math.abs(scheduleEntry.interest_amount);
        const adjDailyRate = days > 0 ? adjAmount / days : 0;
        row.calculationBreakdown = {
          days,
          dailyRate: adjDailyRate,
          principal: principalForCalc,
          effectiveRate,
          isAdjustment: true,
          isCredit,
          breakdown: isCredit
            ? `${days}d × ${formatCurrency(adjDailyRate)} = -${formatCurrency(adjAmount)}`
            : `${days}d × ${formatCurrency(adjDailyRate)} = +${formatCurrency(adjAmount)}`
        };
      } else {
        // Regular schedule entry
        const storedInterest = scheduleEntry.interest_amount || 0;
        const displayPrincipal = scheduleEntry.calculation_principal_start || principalForCalc;
        const displayDailyRate = displayPrincipal * (effectiveRate / 100 / 365);

        // Build breakdown string with roll-up/serviced prefix if applicable
        let breakdownStr = '';
        if (days > 0 && displayDailyRate > 0) {
          const calcStr = `${days}d × ${formatCurrency(displayDailyRate)}/day (${effectiveRate}%)`;
          if (row.isRollUpPeriod) {
            const rollUpMonths = Math.round(days / 30.44);
            breakdownStr = `Roll-up (${rollUpMonths}m) now capitalised: ${calcStr}`;
          } else if (row.isServicedPeriod) {
            breakdownStr = `Serviced: ${calcStr}`;
          } else {
            breakdownStr = calcStr;
          }
        } else {
          breakdownStr = storedInterest === 0 ? 'Prepaid' : `${days}d`;
        }

        row.calculationBreakdown = {
          days,
          dailyRate: displayDailyRate,
          principal: displayPrincipal,
          effectiveRate,
          breakdown: breakdownStr
        };
      }
    }

    // Track totals
    totalExpectedToDate += row.expectedInterest;
    totalPaidToDate += row.interestPaid;
    row.interestBalance = totalExpectedToDate - totalPaidToDate;
    row.totalExpectedToDate = totalExpectedToDate;
    row.totalPaidToDate = totalPaidToDate;
  });

  return rows;
}

/**
 * Internal function to render loan statement content to a jsPDF document
 * Used by both generateLoanStatementPDF (download) and generateLoanStatementPDFBytes (merge)
 */
function renderLoanStatementToDoc(doc, loan, schedule, transactions, product, interestCalc, organization) {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 15;

  // Organization Details (if available)
  if (organization) {
    // Organization Name
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text(organization.name || '', pageWidth / 2, y, { align: 'center' });
    y += 6;

    // Address lines
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');

    const addressParts = [];
    if (organization.address_line1) addressParts.push(organization.address_line1);
    if (organization.address_line2) addressParts.push(organization.address_line2);

    const cityPostcode = [organization.city, organization.postcode].filter(Boolean).join(' ');
    if (cityPostcode) addressParts.push(cityPostcode);
    if (organization.country) addressParts.push(organization.country);

    // Print each address line centered
    for (const line of addressParts) {
      doc.text(line, pageWidth / 2, y, { align: 'center' });
      y += 4;
    }

    // Contact details on one line
    const contactParts = [];
    if (organization.phone) contactParts.push(`Tel: ${organization.phone}`);
    if (organization.email) contactParts.push(`Email: ${organization.email}`);
    if (organization.website) contactParts.push(organization.website);

    if (contactParts.length > 0) {
      doc.setFontSize(8);
      doc.text(contactParts.join('  |  '), pageWidth / 2, y, { align: 'center' });
      y += 4;
    }

    // Add a line separator
    y += 2;
    doc.setDrawColor(200, 200, 200);
    doc.line(40, y, pageWidth - 40, y);
    y += 8;
  }

  // Header
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text('LOAN STATEMENT', pageWidth / 2, y, { align: 'center' });

  y += 12;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Generated: ${format(new Date(), 'dd MMM yyyy HH:mm')}`, pageWidth / 2, y, { align: 'center' });

  // Borrower Info
  y += 12;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Borrower Information', 15, y);

  y += 7;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Name: ${loan.borrower_name}`, 15, y);
  y += 5;
  doc.text(`Loan Reference: #${loan.loan_number || loan.id.slice(0, 8)}`, 15, y);
  if (loan.description) {
    y += 5;
    doc.text(`Description: ${loan.description}`, 15, y);
  }

  // Calculate total disbursed from transactions (includes additional advances)
  const allActiveTxs = (transactions || []).filter(t => !t.is_deleted);
  const disbursementTxs = allActiveTxs.filter(t => t.type === 'Disbursement');
  const totalDisbursed = disbursementTxs.reduce((sum, t) => sum + (t.amount || 0), 0);
  const additionalAdvances = totalDisbursed - loan.principal_amount;
  const hasAdditionalAdvances = additionalAdvances > 0.01;

  // Loan Details
  y += 10;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Loan Details', 15, y);

  y += 7;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Product: ${loan.product_name}`, 15, y);
  y += 5;
  // Show total principal if there are additional advances
  if (hasAdditionalAdvances) {
    doc.text(`Total Principal: ${formatCurrency(totalDisbursed)}`, 15, y);
  } else {
    doc.text(`Principal: ${formatCurrency(loan.principal_amount)}`, 15, y);
  }
  y += 5;

  // Show rate info including penalty if applicable
  let rateText = `Interest Rate: ${loan.interest_rate}% pa (${loan.interest_type})`;
  if (loan.has_penalty_rate && loan.penalty_rate) {
    rateText += ` | Penalty Rate: ${loan.penalty_rate}% pa`;
    if (loan.penalty_rate_from) {
      rateText += ` from ${format(new Date(loan.penalty_rate_from), 'dd/MM/yyyy')}`;
    }
  }
  doc.text(rateText, 15, y);

  y += 5;
  doc.text(`Duration: ${loan.duration} ${loan.period === 'Monthly' ? 'months' : 'weeks'}`, 15, y);
  y += 5;
  doc.text(`Start Date: ${format(new Date(loan.start_date), 'dd MMM yyyy')}`, 15, y);
  y += 5;
  doc.text(`Status: ${loan.status}`, 15, y);

  // Exit fee (if any)
  if (loan.exit_fee > 0) {
    y += 5;
    doc.text(`Exit Fee: ${formatCurrency(loan.exit_fee)}`, 15, y);
  }

  // Roll-up loan specific info
  if (loan.roll_up_length || loan.roll_up_amount) {
    y += 5;
    let rollUpText = 'Roll-Up Period: ';
    const parts = [];
    if (loan.roll_up_length) parts.push(`${loan.roll_up_length} months`);
    if (loan.roll_up_amount) parts.push(`Accrued Interest: ${formatCurrency(loan.roll_up_amount)}`);
    rollUpText += parts.join(' | ');
    doc.text(rollUpText, 15, y);
  }

  // Deducted fees section - show as separate block with calculation breakdown
  const arrangementFee = loan.arrangement_fee || 0;
  const additionalFees = loan.additional_deducted_fees || 0;
  const totalDeducted = arrangementFee + additionalFees;

  // Show disbursement breakdown if there are deducted fees OR additional advances
  if (totalDeducted > 0 || hasAdditionalAdvances) {
    y += 8;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Disbursement Breakdown', 15, y);

    y += 6;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');

    // Initial disbursement
    const initialGross = loan.principal_amount;
    const initialNetDisbursed = initialGross - totalDeducted;

    doc.text(`Initial Principal: ${formatCurrency(initialGross)}`, 15, y);
    y += 5;

    if (arrangementFee > 0) {
      doc.text(`Less Arrangement Fee: -${formatCurrency(arrangementFee)}`, 15, y);
      y += 5;
    }

    if (additionalFees > 0) {
      const feesNote = loan.additional_deducted_fees_note ? ` (${loan.additional_deducted_fees_note})` : '';
      doc.text(`Less Other Deducted Fees: -${formatCurrency(additionalFees)}${feesNote}`, 15, y);
      y += 5;
    }

    if (totalDeducted > 0) {
      doc.text(`Initial Net Disbursed: ${formatCurrency(initialNetDisbursed)}`, 15, y);
      y += 5;
    }

    // Show additional advances if any
    if (hasAdditionalAdvances) {
      y += 2;
      // List individual additional disbursements (excluding the first one which is the original)
      const sortedDisbursements = [...disbursementTxs].sort((a, b) => new Date(a.date) - new Date(b.date));

      // Skip the first disbursement (original principal) and show the rest
      let additionalTotal = 0;
      sortedDisbursements.forEach((tx, idx) => {
        if (idx === 0) return; // Skip initial disbursement
        additionalTotal += tx.amount || 0;
        const txDate = format(new Date(tx.date), 'dd/MM/yyyy');
        const reference = tx.reference ? ` - ${tx.reference}` : '';
        doc.text(`Additional Advance (${txDate})${reference}: +${formatCurrency(tx.amount)}`, 15, y);
        y += 5;
      });

      // Summary lines
      y += 2;
      doc.setFont(undefined, 'bold');
      doc.text(`Total Principal Advanced: ${formatCurrency(totalDisbursed)}`, 15, y);
      y += 5;
      // Calculate total net disbursed (total principal minus fees deducted from initial)
      const totalNetDisbursed = totalDisbursed - totalDeducted;
      doc.text(`Total Net Disbursed: ${formatCurrency(totalNetDisbursed)}`, 15, y);
      doc.setFont(undefined, 'normal');
    } else if (totalDeducted > 0) {
      // Just show net disbursed if no additional advances
      doc.setFont(undefined, 'bold');
      doc.text(`Net Disbursed: ${formatCurrency(initialNetDisbursed)}`, 15, y);
      doc.setFont(undefined, 'normal');
    }
  }

  // Build interest ledger for detailed transaction history
  const ledger = buildInterestLedger(loan, transactions, product);

  // Use pre-calculated schedule-based values if provided (these match the UI)
  // Otherwise fall back to ledger summary (day-by-day calculation)
  const summaryValues = interestCalc ? {
    principalOutstanding: interestCalc.principalRemaining,
    interestAccrued: interestCalc.interestAccrued,
    interestPaid: interestCalc.interestPaid,
    interestOutstanding: interestCalc.interestRemaining
  } : {
    principalOutstanding: ledger.summary.principalOutstanding,
    interestAccrued: ledger.summary.totalInterestAccrued,
    interestPaid: ledger.summary.totalInterestPaid,
    interestOutstanding: ledger.summary.interestOutstanding
  };

  // Current Position Summary
  y += 12;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Current Position (as of today)', 15, y);

  y += 7;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Principal Outstanding: ${formatCurrency(summaryValues.principalOutstanding)}`, 15, y);
  y += 5;
  doc.text(`Total Interest Due: ${formatCurrency(summaryValues.interestAccrued)}`, 15, y);
  y += 5;
  doc.text(`Total Interest Paid: ${formatCurrency(summaryValues.interestPaid)}`, 15, y);
  y += 5;
  doc.setFont(undefined, 'bold');
  doc.text(`Interest Outstanding: ${formatCurrency(summaryValues.interestOutstanding)}`, 15, y);
  doc.setFont(undefined, 'normal');
  y += 5;
  const totalOutstanding = summaryValues.principalOutstanding + summaryValues.interestOutstanding + (loan.exit_fee || 0);
  doc.setFont(undefined, 'bold');
  doc.text(`Total Outstanding: ${formatCurrency(totalOutstanding)}`, 15, y);
  if (loan.exit_fee > 0) {
    doc.setFont(undefined, 'normal');
    doc.text(` (inc. ${formatCurrency(loan.exit_fee)} exit fee)`, 95, y);
  }

  // ============================================
  // PAGE 2+: LOAN LEDGER (Timeline View)
  // ============================================
  doc.addPage();
  y = 15;

  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text('LOAN LEDGER', pageWidth / 2, y, { align: 'center' });

  y += 8;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Loan: #${loan.loan_number || loan.id.slice(0, 8)} - ${loan.borrower_name}`, pageWidth / 2, y, { align: 'center' });

  y += 10;

  // Build timeline for ledger display
  const timelineRows = buildPDFTimeline(loan, schedule, transactions, product);

  // Column positions (A4 = 210mm, margins = 10mm each side = 190mm usable)
  const cols = {
    date: 12,
    intReceived: 55,
    expected: 85,
    intBal: 115,
    principal: 150,
    prinBal: 190
  };

  // Ledger table header
  const drawTimelineHeader = (yPos) => {
    doc.setFillColor(240, 240, 240);
    doc.rect(10, yPos - 4, 190, 7, 'F');
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text('Date', cols.date, yPos);
    doc.text('Int Received', cols.intReceived, yPos, { align: 'right' });
    doc.text('Expected', cols.expected, yPos, { align: 'right' });
    doc.text('Int Bal', cols.intBal, yPos, { align: 'right' });
    doc.text('Principal', cols.principal, yPos, { align: 'right' });
    doc.text('Prin Bal', cols.prinBal, yPos, { align: 'right' });
    return yPos + 5;
  };

  y = drawTimelineHeader(y);
  doc.line(10, y, 200, y);
  y += 1;

  doc.setFont(undefined, 'normal');
  doc.setFontSize(8);

  timelineRows.forEach((row, idx) => {
    // Check for page break
    if (y > 275) {
      doc.addPage();
      y = 20;
      y = drawTimelineHeader(y);
      doc.line(10, y, 200, y);
      y += 1;
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);
    }

    y += 5;

    // Row background color based on type
    if (row.primaryType === 'disbursement') {
      doc.setFillColor(255, 235, 235); // Light red
      doc.rect(10, y - 4, 190, 5.5, 'F');
    } else if (row.primaryType === 'repayment') {
      doc.setFillColor(235, 255, 235); // Light green
      doc.rect(10, y - 4, 190, 5.5, 'F');
    } else if (row.primaryType === 'due_date') {
      if (row.isRollUpPeriod) {
        doc.setFillColor(245, 235, 255); // Light purple for roll-up
      } else if (row.isServicedPeriod) {
        doc.setFillColor(235, 245, 255); // Light blue for serviced
      } else {
        doc.setFillColor(235, 245, 255); // Light blue default
      }
      doc.rect(10, y - 4, 190, 5.5, 'F');
    } else if (row.primaryType === 'adjustment') {
      doc.setFillColor(255, 250, 235); // Light amber
      doc.rect(10, y - 4, 190, 5.5, 'F');
    } else if (row.primaryType === 'rate_change') {
      doc.setFillColor(255, 243, 220); // Light orange
      doc.rect(10, y - 4, 190, 5.5, 'F');
    }

    // Date
    doc.text(format(new Date(row.date), 'dd/MM/yy'), cols.date, y);

    // Interest Received (green for payments)
    if (row.interestPaid > 0.01) {
      doc.setTextColor(22, 163, 74); // Green
      doc.text(`-${formatCurrency(row.interestPaid)}`, cols.intReceived, y, { align: 'right' });
      doc.setTextColor(0, 0, 0);
    } else {
      doc.setTextColor(180, 180, 180);
      doc.text('-', cols.intReceived, y, { align: 'right' });
      doc.setTextColor(0, 0, 0);
    }

    // Expected Interest (purple for roll-up, blue for serviced/due dates, amber for adjustments)
    if (row.expectedInterest > 0.01 || row.expectedInterest < -0.01) {
      if (row.primaryType === 'adjustment') {
        doc.setTextColor(180, 83, 9); // Amber
      } else if (row.isRollUpPeriod) {
        doc.setTextColor(102, 51, 153); // Purple for roll-up
      } else {
        doc.setTextColor(37, 99, 235); // Blue
      }
      doc.text(formatCurrency(row.expectedInterest), cols.expected, y, { align: 'right' });
      doc.setTextColor(0, 0, 0);
    } else {
      doc.setTextColor(180, 180, 180);
      doc.text('-', cols.expected, y, { align: 'right' });
      doc.setTextColor(0, 0, 0);
    }

    // Interest Balance
    if (Math.abs(row.interestBalance) < 0.01) {
      doc.text(formatCurrency(0), cols.intBal, y, { align: 'right' });
    } else if (row.interestBalance > 0) {
      doc.text(formatCurrency(row.interestBalance), cols.intBal, y, { align: 'right' });
    } else {
      doc.text(`-${formatCurrency(Math.abs(row.interestBalance))}`, cols.intBal, y, { align: 'right' });
    }

    // Principal Change (red for disbursements, blue for repayments)
    if (Math.abs(row.principalChange) > 0.01) {
      if (row.principalChange > 0) {
        doc.setTextColor(220, 38, 38); // Red for disbursement
        doc.text(`+${formatCurrency(row.principalChange)}`, cols.principal, y, { align: 'right' });
      } else {
        doc.setTextColor(37, 99, 235); // Blue for capital repayment
        doc.text(formatCurrency(row.principalChange), cols.principal, y, { align: 'right' });
      }
      doc.setTextColor(0, 0, 0);
    } else if (row.primaryType === 'rate_change') {
      doc.setTextColor(180, 83, 9); // Amber
      doc.text(`${row.previousRate}%→${row.newRate}%`, cols.principal, y, { align: 'right' });
      doc.setTextColor(0, 0, 0);
    } else {
      doc.setTextColor(180, 180, 180);
      doc.text('-', cols.principal, y, { align: 'right' });
      doc.setTextColor(0, 0, 0);
    }

    // Principal Balance
    doc.setFont(undefined, 'bold');
    doc.text(formatCurrency(row.principalBalance), cols.prinBal, y, { align: 'right' });
    doc.setFont(undefined, 'normal');

    // Add note line with calculation breakdown for all applicable row types
    if (row.calculationBreakdown) {
      y += 4;
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);

      let noteText = '';
      if (row.primaryType === 'adjustment') {
        // Adjustment rows
        noteText = row.calculationBreakdown.isCredit
          ? `Interest credit: ${row.calculationBreakdown.breakdown} (mid-period capital change)`
          : `Interest debit: ${row.calculationBreakdown.breakdown} (mid-period capital change)`;
      } else if (row.primaryType === 'disbursement' && row.calculationBreakdown.isDisbursement) {
        // Disbursement with deductions
        noteText = `Disbursement: ${row.calculationBreakdown.breakdown}`;
      } else if (row.primaryType === 'due_date') {
        // Schedule due dates - show calculation breakdown
        if (row.isRollUpPeriod) {
          doc.setTextColor(102, 51, 153); // Purple for roll-up
        } else if (row.isServicedPeriod) {
          doc.setTextColor(37, 99, 235); // Blue for serviced
        }
        noteText = row.calculationBreakdown.breakdown;
      }

      if (noteText) {
        doc.text(noteText, cols.date + 2, y);
      }
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(8);
    }
  });

  // Totals row
  y += 4;
  doc.line(10, y, 200, y);
  y += 6;

  const lastRow = timelineRows.length > 0 ? timelineRows[timelineRows.length - 1] : null;
  const totalInterestPaid = lastRow?.totalPaidToDate || 0;
  const totalExpected = lastRow?.totalExpectedToDate || 0;
  const finalInterestBalance = lastRow?.interestBalance || 0;
  const finalPrincipalBalance = lastRow?.principalBalance || 0;

  doc.setFillColor(240, 240, 240);
  doc.rect(10, y - 4, 190, 7, 'F');
  doc.setFont(undefined, 'bold');
  doc.setFontSize(8);
  doc.text('TOTALS', cols.date, y);

  doc.setTextColor(22, 163, 74);
  doc.text(`-${formatCurrency(totalInterestPaid)}`, cols.intReceived, y, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  doc.text(formatCurrency(totalExpected), cols.expected, y, { align: 'right' });
  doc.text(formatCurrency(Math.abs(finalInterestBalance)), cols.intBal, y, { align: 'right' });
  doc.text('', cols.principal, y, { align: 'right' });
  doc.text(formatCurrency(finalPrincipalBalance), cols.prinBal, y, { align: 'right' });

  // ============================================
  // PAGE 3+: TRANSACTION HISTORY
  // ============================================
  const activeTransactions = (transactions || []).filter(t => !t.is_deleted);
  if (activeTransactions.length > 0) {
    doc.addPage();
    y = 15;

    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text('TRANSACTION HISTORY', pageWidth / 2, y, { align: 'center' });

    y += 10;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Loan: #${loan.loan_number || loan.id.slice(0, 8)} - ${loan.borrower_name}`, pageWidth / 2, y, { align: 'center' });

    y += 10;

    // Transaction table header
    const drawTxHeader = (yPos) => {
      doc.setFillColor(240, 240, 240);
      doc.rect(15, yPos - 4, 180, 7, 'F');
      doc.setFontSize(8);
      doc.setFont(undefined, 'bold');
      doc.text('Date', 17, yPos);
      doc.text('Type', 45, yPos);
      doc.text('Reference', 75, yPos);
      doc.text('Amount', 120, yPos, { align: 'right' });
      doc.text('Interest', 145, yPos, { align: 'right' });
      doc.text('Principal', 170, yPos, { align: 'right' });
      return yPos + 5;
    };

    y = drawTxHeader(y);
    doc.line(15, y, 195, y);

    doc.setFont(undefined, 'normal');

    // Sort by date
    const sortedTx = [...activeTransactions].sort((a, b) => new Date(a.date) - new Date(b.date));

    sortedTx.forEach((tx) => {
      y += 6;
      if (y > 275) {
        doc.addPage();
        y = 20;
        y = drawTxHeader(y);
        doc.line(15, y, 195, y);
        y += 6;
        doc.setFont(undefined, 'normal');
      }

      // Color code by type
      if (tx.type === 'Disbursement') {
        doc.setFillColor(239, 246, 255);
        doc.rect(15, y - 4, 180, 5.5, 'F');
      } else if (tx.type === 'Repayment') {
        doc.setFillColor(240, 253, 244);
        doc.rect(15, y - 4, 180, 5.5, 'F');
      }

      doc.setFontSize(8);
      doc.text(format(new Date(tx.date), 'dd/MM/yyyy'), 17, y);
      doc.text(tx.type, 45, y);

      const ref = tx.reference || '-';
      const truncRef = ref.length > 20 ? ref.slice(0, 18) + '...' : ref;
      doc.text(truncRef, 75, y);

      // Amount with color
      if (tx.type === 'Disbursement') {
        doc.setTextColor(37, 99, 235);
      } else {
        doc.setTextColor(22, 163, 74);
      }
      doc.text(formatCurrency(tx.amount), 120, y, { align: 'right' });
      doc.setTextColor(0, 0, 0);

      // Interest and principal applied
      if (tx.interest_applied > 0) {
        doc.text(formatCurrency(tx.interest_applied), 145, y, { align: 'right' });
      } else {
        doc.text('-', 145, y, { align: 'right' });
      }

      if (tx.principal_applied > 0) {
        doc.text(formatCurrency(tx.principal_applied), 170, y, { align: 'right' });
      } else {
        doc.text('-', 170, y, { align: 'right' });
      }
    });

    // Transaction totals
    y += 8;
    doc.line(15, y, 195, y);
    y += 6;

    const totalDisbursed = sortedTx.filter(t => t.type === 'Disbursement').reduce((s, t) => s + t.amount, 0);
    const totalRepaid = sortedTx.filter(t => t.type === 'Repayment').reduce((s, t) => s + t.amount, 0);
    const totalAmount = sortedTx.reduce((s, t) => s + t.amount, 0);
    const totalInterestPaid = sortedTx.reduce((s, t) => s + (t.interest_applied || 0), 0);
    const totalPrincipalPaid = sortedTx.reduce((s, t) => s + (t.principal_applied || 0), 0);

    doc.setFillColor(240, 240, 240);
    doc.rect(15, y - 4, 180, 7, 'F');
    doc.setFont(undefined, 'bold');
    doc.setFontSize(8);
    doc.text('TOTALS', 17, y);
    doc.text(formatCurrency(totalAmount), 120, y, { align: 'right' });
    doc.text(formatCurrency(totalInterestPaid), 145, y, { align: 'right' });
    doc.text(formatCurrency(totalPrincipalPaid), 170, y, { align: 'right' });

    // Summary below totals
    y += 8;
    doc.setFont(undefined, 'normal');
    doc.text(`Disbursed: ${formatCurrency(totalDisbursed)}  |  Interest Received: ${formatCurrency(totalInterestPaid)}`, 17, y);
  }

  // Footer on all pages
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(128, 128, 128);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, 290, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  }
  // Note: caller is responsible for saving or returning the doc
}

/**
 * Generate loan statement PDF and download it
 */
export function generateLoanStatementPDF(loan, schedule, transactions, product = null, interestCalc = null, organization = null) {
  const doc = new jsPDF();
  renderLoanStatementToDoc(doc, loan, schedule, transactions, product, interestCalc, organization);
  doc.save(`loan-statement-${loan.loan_number || loan.id.slice(0,8)}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
}

/**
 * Generate loan statement PDF and return as ArrayBuffer (for merging)
 * Uses the same rendering as generateLoanStatementPDF for consistency
 */
export function generateLoanStatementPDFBytes(loan, schedule, transactions, product = null, interestCalc = null, organization = null) {
  const doc = new jsPDF();
  renderLoanStatementToDoc(doc, loan, schedule, transactions, product, interestCalc, organization);
  return doc.output('arraybuffer');
}

export function generateSettlementStatementPDF(loan, settlementData, schedule = [], transactions = [], product = null) {
  // Use shared rendering function to generate the document
  const doc = renderSettlementStatementToDoc(loan, settlementData, schedule, transactions, product);

  // Build filename using borrower name (business or first+last)
  const filenameBorrower = settlementData.borrower;
  const borrowerNameForFile = filenameBorrower?.business
    || filenameBorrower?.full_name
    || `${filenameBorrower?.first_name || ''} ${filenameBorrower?.last_name || ''}`.trim()
    || loan.borrower_name
    || 'Unknown';
  // Sanitize name for filename (remove special characters)
  const safeBorrowerName = borrowerNameForFile.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');
  const productionDate = format(new Date(), 'yyyy-MM-dd');
  const redemptionDate = format(new Date(settlementData.settlementDate), 'yyyy-MM-dd');

  doc.save(`${safeBorrowerName}_${productionDate}_Redemption-to-${redemptionDate}.pdf`);
}

/**
 * Generate settlement statement PDF and return as ArrayBuffer (for merging)
 * Uses the same full logic as generateSettlementStatementPDF
 */
export function generateSettlementStatementPDFBytes(loan, settlementData, schedule = [], transactions = [], product = null) {
  // Use shared rendering function
  const doc = renderSettlementStatementToDoc(loan, settlementData, schedule, transactions, product);

  // Return as ArrayBuffer (page numbers will be added during merge if needed)
  return doc.output('arraybuffer');
}

/**
 * Internal shared function that renders settlement statement to a jsPDF document
 * Used by both generateSettlementStatementPDF (downloads) and generateSettlementStatementPDFBytes (returns bytes)
 */
function renderSettlementStatementToDoc(loan, settlementData, schedule = [], transactions = [], product = null) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 15;

  // Organization Details (if available)
  const org = settlementData.organization;
  if (org) {
    // Organization Name
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text(org.name || '', pageWidth / 2, y, { align: 'center' });
    y += 6;

    // Address lines
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');

    const addressParts = [];
    if (org.address_line1) addressParts.push(org.address_line1);
    if (org.address_line2) addressParts.push(org.address_line2);

    const cityPostcode = [org.city, org.postcode].filter(Boolean).join(' ');
    if (cityPostcode) addressParts.push(cityPostcode);
    if (org.country) addressParts.push(org.country);

    // Print each address line centered
    for (const line of addressParts) {
      doc.text(line, pageWidth / 2, y, { align: 'center' });
      y += 4;
    }

    // Contact details on one line
    const contactParts = [];
    if (org.phone) contactParts.push(`Tel: ${org.phone}`);
    if (org.email) contactParts.push(`Email: ${org.email}`);
    if (org.website) contactParts.push(org.website);

    if (contactParts.length > 0) {
      doc.setFontSize(8);
      doc.text(contactParts.join('  |  '), pageWidth / 2, y, { align: 'center' });
      y += 4;
    }

    // Add a line separator
    y += 2;
    doc.setDrawColor(200, 200, 200);
    doc.line(40, y, pageWidth - 40, y);
    y += 8;
  } else if (settlementData.organizationName) {
    // Fallback for legacy data with just organization name
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text(settlementData.organizationName, pageWidth / 2, y, { align: 'center' });
    y += 10;
  }

  // Header
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text('SETTLEMENT STATEMENT', pageWidth / 2, y, { align: 'center' });

  y += 12;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Settlement Date: ${format(new Date(settlementData.settlementDate), 'MMM dd, yyyy')}`, pageWidth / 2, y, { align: 'center' });
  y += 5;
  doc.text(`Generated: ${format(new Date(), 'MMM dd, yyyy')}`, pageWidth / 2, y, { align: 'center' });

  // Borrower Info
  y += 12;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Borrower Information', 15, y);

  y += 7;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');

  // Use borrower object if available, otherwise fall back to loan.borrower_name
  const borrower = settlementData.borrower;
  if (borrower) {
    // Display name (business name or individual name)
    const displayName = borrower.business || borrower.full_name || `${borrower.first_name || ''} ${borrower.last_name || ''}`.trim() || loan.borrower_name;
    doc.text(`Name: ${displayName}`, 15, y);
    y += 5;

    // Address
    if (borrower.address) {
      doc.text(`Address: ${borrower.address}`, 15, y);
      y += 5;
    }

    // Phone
    if (borrower.phone) {
      doc.text(`Phone: ${borrower.phone}`, 15, y);
      y += 5;
    }

    // Email
    if (borrower.email) {
      doc.text(`Email: ${borrower.email}`, 15, y);
      y += 5;
    }
  } else {
    doc.text(`Name: ${loan.borrower_name}`, 15, y);
    y += 5;
  }

  // Loan Reference
  doc.text(`Loan Reference: #${loan.loan_number || loan.id.slice(0, 8)}`, 15, y);
  if (loan.description) {
    y += 5;
    doc.text(`Description: ${loan.description}`, 15, y);
  }
  y += 5;
  doc.text(`Product: ${loan.product_name}`, 15, y);

  // Interest Summary Section
  y += 12;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Interest Summary', 15, y);

  y += 7;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');

  // Interest details
  const daysElapsed = settlementData.daysElapsed || 0;
  const dailyRate = settlementData.dailyRate || (loan.interest_rate / 100 / 365);
  const interestAccrued = settlementData.interestAccrued || settlementData.interestDue;
  const interestPaid = settlementData.interestPaid || 0;

  doc.text(`Days Elapsed: ${daysElapsed}`, 15, y);
  y += 5;
  doc.text(`Daily Interest Rate: ${(dailyRate * 100).toFixed(4)}%`, 15, y);
  y += 5;
  doc.text(`Total Interest Accrued: ${formatCurrency(interestAccrued)}`, 15, y);
  y += 5;
  doc.text(`Interest Already Paid: ${formatCurrency(interestPaid)}`, 15, y);
  y += 5;
  doc.setFont(undefined, 'bold');
  doc.text(`Interest Outstanding: ${formatCurrency(settlementData.interestDue)}`, 15, y);
  doc.setFont(undefined, 'normal');

  // Settlement Breakdown
  y += 12;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Settlement Breakdown', 15, y);

  y += 10;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');

  // Draw table header
  doc.setFillColor(240, 240, 240);
  doc.rect(15, y - 5, 180, 8, 'F');
  doc.setFont(undefined, 'bold');
  doc.text('Description', 20, y);
  doc.text('Amount', 160, y, { align: 'right' });

  y += 10;
  doc.setFont(undefined, 'normal');

  // Principal Remaining
  doc.text('Principal Remaining', 20, y);
  doc.text(formatCurrency(settlementData.principalRemaining), 160, y, { align: 'right' });
  y += 8;

  // Interest Due
  doc.text('Interest Due (up to settlement date)', 20, y);
  doc.text(formatCurrency(settlementData.interestDue), 160, y, { align: 'right' });
  y += 8;

  // Exit Fee
  if (settlementData.exitFee > 0) {
    doc.text('Exit Fee', 20, y);
    doc.text(formatCurrency(settlementData.exitFee), 160, y, { align: 'right' });
    y += 8;
  }

  // Line separator
  y += 2;
  doc.line(15, y, 195, y);
  y += 8;

  // Total Settlement Amount
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('TOTAL SETTLEMENT AMOUNT', 20, y);
  doc.text(formatCurrency(settlementData.totalSettlement), 160, y, { align: 'right' });

  // Payment Instructions
  y += 15;
  if (y > 250) {
    doc.addPage();
    y = 20;
  }
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('Important Notes:', 15, y);
  y += 8;
  doc.setFont(undefined, 'normal');
  doc.text('• This settlement amount is valid for the specified settlement date only.', 20, y);
  y += 6;
  doc.text('• Interest continues to accrue daily if payment is made after this date.', 20, y);
  y += 6;
  doc.text('• Please ensure payment is received by the settlement date to avoid additional charges.', 20, y);

  // ============================================
  // PAGE 2: DETAILED INTEREST CALCULATION
  // ============================================
  if (settlementData.interestPeriods && settlementData.interestPeriods.length > 0) {
    doc.addPage();
    y = 15;

    // Header
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text('INTEREST CALCULATION DETAILS', pageWidth / 2, y, { align: 'center' });

    y += 10;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Loan: #${loan.loan_number || loan.id.slice(0, 8)} - ${loan.borrower_name}`, pageWidth / 2, y, { align: 'center' });

    // Check if this is a roll-up loan by examining the schedule
    const scheduleEntries = settlementData.schedule || [];
    const isRollUpLoan = scheduleEntries.some(s => s.is_roll_up_period || s.is_serviced_period);
    const rollUpEntry = scheduleEntries.find(s => s.is_roll_up_period);
    const rolledUpInterest = rollUpEntry?.interest_amount || rollUpEntry?.rolled_up_interest || 0;

    // Calculation Formula
    y += 12;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Calculation Method', 15, y);

    y += 7;
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    const annualRate = settlementData.annualRate || (loan.interest_rate / 100);
    const dailyRateVal = settlementData.dailyRate || (annualRate / 365);
    doc.text(`Annual Interest Rate: ${(annualRate * 100).toFixed(2)}%`, 15, y);
    y += 5;
    doc.text(`Daily Interest Rate: ${(annualRate * 100).toFixed(2)}% ÷ 365 = ${(dailyRateVal * 100).toFixed(6)}%`, 15, y);
    y += 5;
    doc.text(`Formula: Daily Interest = Calculation Basis × Daily Rate`, 15, y);

    // Add roll-up explanation if applicable
    if (isRollUpLoan && rolledUpInterest > 0) {
      y += 8;
      doc.setFontSize(9);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(102, 51, 153); // Purple
      doc.text('Roll-Up & Serviced Loan:', 15, y);
      doc.setFont(undefined, 'normal');
      y += 5;
      doc.text(`Initial roll-up interest (${formatCurrency(rolledUpInterest)}) is capitalised for subsequent period calculations.`, 15, y);
      y += 4;
      doc.text('Serviced periods calculate interest on: Principal + Rolled-Up Interest (compounded basis).', 15, y);
      doc.setTextColor(0, 0, 0);
    }

    // Interest Periods Table
    y += 12;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Interest Accrual by Period', 15, y);

    y += 8;

    // Table header - use different columns for roll-up loans
    doc.setFillColor(240, 240, 240);
    doc.rect(15, y - 4, 180, 7, 'F');
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text('Period', 17, y);
    doc.text('Days', 55, y, { align: 'right' });
    doc.text('Calculation Basis', 110, y, { align: 'right' });
    doc.text('Interest Accrued', 160, y, { align: 'right' });
    doc.text('Payment', 190, y, { align: 'right' });

    y += 6;
    doc.line(15, y, 195, y);

    doc.setFont(undefined, 'normal');

    // Use the authoritative interest accrued value from the schedule-based calculation
    const authoritativeInterest = settlementData.interestAccrued || 0;

    // For roll-up loans, use schedule entries directly for accurate display
    // For other loans, use the interestPeriods from settlement calculation
    let displayPeriods = [];

    if (isRollUpLoan && scheduleEntries.length > 0) {
      // Build display periods from schedule entries for roll-up loans
      // Note: scheduler creates entries with due_date (end) and calculation_days
      let runningPrincipal = loan.principal_amount;
      let runningRolledUpInterest = 0;
      let prevDueDate = loan.start_date; // Track previous due date to calculate period start

      for (const entry of scheduleEntries) {
        const periodInterest = entry.interest_amount || entry.rolled_up_interest || 0;
        // Use calculation_principal_start from scheduler, or calculate based on period type
        const calculationBasis = entry.calculation_principal_start || (entry.is_serviced_period
          ? runningPrincipal + runningRolledUpInterest
          : runningPrincipal);

        // Use due_date as period end (from scheduler), fallback to period_end/date
        const endDate = entry.due_date || entry.period_end || entry.date;
        // Use calculation_days from scheduler, fallback to days_in_period
        const days = entry.calculation_days || entry.days_in_period || 0;

        displayPeriods.push({
          startDate: prevDueDate,
          endDate: endDate,
          days: days,
          calculationBasis: calculationBasis,
          interest: periodInterest,
          principalPayment: entry.principal_payment || entry.principal_amount || 0,
          isRollUpPeriod: entry.is_roll_up_period,
          isServicedPeriod: entry.is_serviced_period,
          isAccrualToSettlement: false
        });

        // Update prev due date for next period's start
        prevDueDate = endDate;

        // Track rolled-up interest for next period calculation basis
        if (entry.is_roll_up_period) {
          runningRolledUpInterest += periodInterest;
        }
        if (entry.principal_payment || entry.principal_amount) {
          runningPrincipal -= (entry.principal_payment || entry.principal_amount || 0);
        }
      }

      // Add accrual to settlement if needed
      if (settlementData.accrualToSettlement && settlementData.accrualToSettlement > 0) {
        const lastScheduleDate = scheduleEntries[scheduleEntries.length - 1]?.due_date ||
                                  scheduleEntries[scheduleEntries.length - 1]?.period_end;
        displayPeriods.push({
          startDate: lastScheduleDate,
          endDate: settlementData.settlementDate,
          days: settlementData.daysToSettlement || 0,
          calculationBasis: runningPrincipal + runningRolledUpInterest,
          interest: settlementData.accrualToSettlement,
          principalPayment: 0,
          isRollUpPeriod: false,
          isServicedPeriod: false,
          isAccrualToSettlement: true
        });
      }
    } else {
      displayPeriods = settlementData.interestPeriods || [];
    }

    let runningInterestTotal = 0;
    let showedCapitalizationNote = false;

    for (const period of displayPeriods) {
      y += 6;

      // Check if we need a new page
      if (y > 270) {
        doc.addPage();
        y = 20;

        // Re-add header on new page
        doc.setFillColor(240, 240, 240);
        doc.rect(15, y - 4, 180, 7, 'F');
        doc.setFontSize(8);
        doc.setFont(undefined, 'bold');
        doc.text('Period', 17, y);
        doc.text('Days', 55, y, { align: 'right' });
        doc.text('Calculation Basis', 110, y, { align: 'right' });
        doc.text('Interest Accrued', 160, y, { align: 'right' });
        doc.text('Payment', 190, y, { align: 'right' });
        y += 6;
        doc.line(15, y, 195, y);
        doc.setFont(undefined, 'normal');
        y += 6;
      }

      // Period date range
      const startStr = period.startDate ? format(new Date(period.startDate), 'dd/MM/yy') : '-';
      const endStr = period.endDate ? format(new Date(period.endDate), 'dd/MM/yy') : '-';
      doc.text(`${startStr} - ${endStr}`, 17, y);

      // Days
      doc.text(String(period.days), 55, y, { align: 'right' });

      // Calculation basis
      doc.text(formatCurrency(period.calculationBasis), 110, y, { align: 'right' });

      // Interest accrued
      doc.text(formatCurrency(period.interest), 160, y, { align: 'right' });

      // Payment (if any)
      if (period.principalPayment > 0) {
        doc.setTextColor(0, 128, 0);
        doc.text(`-${formatCurrency(period.principalPayment)}`, 190, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.text('-', 190, y, { align: 'right' });
      }

      runningInterestTotal += period.interest;

      // Add period type annotation
      if (period.isRollUpPeriod || period.isServicedPeriod || period.isAccrualToSettlement) {
        y += 4;
        doc.setFontSize(7);
        doc.setTextColor(100, 100, 100);
        if (period.isRollUpPeriod) {
          doc.setTextColor(102, 51, 153); // Purple
          doc.text(`Roll-up period: ${period.days}d × ${formatCurrency(period.calculationBasis * dailyRateVal)}/day`, 19, y);
        } else if (period.isServicedPeriod) {
          doc.setTextColor(37, 99, 235); // Blue
          doc.text(`Serviced: ${period.days}d × ${formatCurrency(period.calculationBasis * dailyRateVal)}/day (compounded basis)`, 19, y);
        } else if (period.isAccrualToSettlement) {
          doc.setTextColor(34, 139, 34); // Forest green
          doc.text(`Accrued to settlement: ${period.days}d × ${formatCurrency(period.calculationBasis * dailyRateVal)}/day`, 19, y);
        }
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(8);
      }

      // Show capitalization annotation after roll-up period
      if (period.isRollUpPeriod && !showedCapitalizationNote && rolledUpInterest > 0) {
        y += 6;
        doc.setFillColor(255, 250, 235); // Light amber
        doc.rect(15, y - 4, 180, 6, 'F');
        doc.setFontSize(7);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(180, 83, 9); // Amber
        doc.text(`↳ Interest capitalised: ${formatCurrency(rolledUpInterest)} added to calculation basis for serviced periods`, 19, y);
        doc.setTextColor(0, 0, 0);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(8);
        showedCapitalizationNote = true;
      }
    }

    // Totals section
    y += 4;
    doc.line(15, y, 195, y);
    y += 7;

    doc.setFont(undefined, 'bold');
    doc.text('Total Interest Accrued', 17, y);
    doc.text(String(settlementData.daysElapsed), 55, y, { align: 'right' });
    doc.text('', 110, y, { align: 'right' });
    doc.text(formatCurrency(authoritativeInterest), 160, y, { align: 'right' });

    y += 6;
    doc.setTextColor(0, 128, 0);
    doc.text('Less: Interest Paid', 17, y);
    doc.text(`(${formatCurrency(settlementData.interestPaid || 0)})`, 160, y, { align: 'right' });
    doc.setTextColor(0, 0, 0);

    y += 6;
    doc.setFillColor(255, 243, 205);
    doc.rect(15, y - 4, 180, 7, 'F');
    doc.setFont(undefined, 'bold');
    doc.text('Interest Outstanding', 17, y);
    doc.text(formatCurrency(settlementData.interestRemaining || settlementData.interestDue), 160, y, { align: 'right' });
  }

  // ============================================
  // PAGE 3: TRANSACTION HISTORY
  // ============================================
  if (settlementData.transactionHistory && settlementData.transactionHistory.length > 0) {
    doc.addPage();
    y = 15;

    // Header
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text('TRANSACTION HISTORY', pageWidth / 2, y, { align: 'center' });

    y += 10;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Loan: #${loan.loan_number || loan.id.slice(0, 8)} - ${loan.borrower_name}`, pageWidth / 2, y, { align: 'center' });

    y += 12;

    // Table header - adjusted column positions to prevent overlap
    doc.setFillColor(240, 240, 240);
    doc.rect(15, y - 4, 180, 7, 'F');
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text('Date', 17, y);
    doc.text('Type', 42, y);
    doc.text('Description', 70, y);
    doc.text('Amount', 120, y, { align: 'right' });
    doc.text('Principal', 145, y, { align: 'right' });
    doc.text('Interest', 168, y, { align: 'right' });
    doc.text('Balance', 193, y, { align: 'right' });

    y += 6;
    doc.line(15, y, 195, y);
    y += 2;
    doc.setFont(undefined, 'normal');

    for (const tx of settlementData.transactionHistory) {
      y += 6;

      // Check if we need a new page
      if (y > 270) {
        doc.addPage();
        y = 20;

        // Re-add header on new page
        doc.setFillColor(240, 240, 240);
        doc.rect(15, y - 4, 180, 7, 'F');
        doc.setFontSize(8);
        doc.setFont(undefined, 'bold');
        doc.text('Date', 17, y);
        doc.text('Type', 42, y);
        doc.text('Description', 70, y);
        doc.text('Amount', 120, y, { align: 'right' });
        doc.text('Principal', 145, y, { align: 'right' });
        doc.text('Interest', 168, y, { align: 'right' });
        doc.text('Balance', 193, y, { align: 'right' });
        y += 6;
        doc.line(15, y, 195, y);
        doc.setFont(undefined, 'normal');
        y += 6;
      }

      // Date
      doc.text(format(new Date(tx.date), 'dd/MM/yy'), 17, y);

      // Type
      doc.text(tx.type || '', 42, y);

      // Description (truncate if too long)
      const desc = (tx.description || '').substring(0, 25);
      doc.text(desc, 70, y);

      // Amount with color
      if (tx.type === 'Disbursement') {
        doc.setTextColor(37, 99, 235); // Blue
      } else {
        doc.setTextColor(22, 163, 74); // Green
      }
      doc.text(formatCurrency(tx.amount), 120, y, { align: 'right' });
      doc.setTextColor(0, 0, 0);

      // Principal and interest applied
      if (tx.principalApplied > 0) {
        doc.setTextColor(22, 163, 74);
        doc.text(`-${formatCurrency(tx.principalApplied)}`, 145, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.text('-', 145, y, { align: 'right' });
      }

      if (tx.interestApplied > 0) {
        doc.setTextColor(217, 119, 6); // Amber
        doc.text(`-${formatCurrency(tx.interestApplied)}`, 168, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.text('-', 168, y, { align: 'right' });
      }

      doc.text(formatCurrency(tx.principalBalance), 193, y, { align: 'right' });
    }

    // Summary
    y += 10;
    doc.line(15, y, 195, y);
    y += 8;

    const repaymentCount = settlementData.transactionHistory.filter(t => t.type === 'Repayment').length;

    doc.setFont(undefined, 'bold');
    doc.text(`Total Repayments: ${repaymentCount}`, 17, y);
  }

  // ============================================
  // PAGE 4+: LOAN LEDGER (Timeline View)
  // ============================================
  // Use the same buildPDFTimeline function as the main loan statement for consistent output
  const timelineRows = buildPDFTimeline(loan, schedule, transactions, product);

  if (timelineRows && timelineRows.length > 0) {
    doc.addPage();
    y = 15;

    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text('LOAN LEDGER', pageWidth / 2, y, { align: 'center' });

    y += 8;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Loan: #${loan.loan_number || loan.id.slice(0, 8)} - ${loan.borrower_name}`, pageWidth / 2, y, { align: 'center' });

    y += 10;

    // Column positions (same as main loan statement)
    const cols = {
      date: 12,
      intReceived: 55,
      expected: 85,
      intBal: 115,
      principal: 150,
      prinBal: 190
    };

    // Ledger table header
    const drawTimelineHeader = (yPos) => {
      doc.setFillColor(240, 240, 240);
      doc.rect(10, yPos - 4, 190, 7, 'F');
      doc.setFontSize(8);
      doc.setFont(undefined, 'bold');
      doc.text('Date', cols.date, yPos);
      doc.text('Int Received', cols.intReceived, yPos, { align: 'right' });
      doc.text('Expected', cols.expected, yPos, { align: 'right' });
      doc.text('Int Bal', cols.intBal, yPos, { align: 'right' });
      doc.text('Principal', cols.principal, yPos, { align: 'right' });
      doc.text('Prin Bal', cols.prinBal, yPos, { align: 'right' });
      return yPos + 5;
    };

    y = drawTimelineHeader(y);
    doc.line(10, y, 200, y);
    y += 1;

    doc.setFont(undefined, 'normal');
    doc.setFontSize(8);

    timelineRows.forEach((row) => {
      // Check for page break
      if (y > 275) {
        doc.addPage();
        y = 20;
        y = drawTimelineHeader(y);
        doc.line(10, y, 200, y);
        y += 1;
        doc.setFont(undefined, 'normal');
        doc.setFontSize(8);
      }

      y += 5;

      // Row background color based on type
      if (row.primaryType === 'disbursement') {
        doc.setFillColor(255, 235, 235); // Light red
        doc.rect(10, y - 4, 190, 5.5, 'F');
      } else if (row.primaryType === 'repayment') {
        doc.setFillColor(235, 255, 235); // Light green
        doc.rect(10, y - 4, 190, 5.5, 'F');
      } else if (row.primaryType === 'due_date') {
        if (row.isRollUpPeriod) {
          doc.setFillColor(245, 235, 255); // Light purple for roll-up
        } else if (row.isServicedPeriod) {
          doc.setFillColor(235, 245, 255); // Light blue for serviced
        } else {
          doc.setFillColor(235, 245, 255); // Light blue default
        }
        doc.rect(10, y - 4, 190, 5.5, 'F');
      } else if (row.primaryType === 'adjustment') {
        doc.setFillColor(255, 250, 235); // Light amber
        doc.rect(10, y - 4, 190, 5.5, 'F');
      } else if (row.primaryType === 'rate_change') {
        doc.setFillColor(255, 243, 220); // Light orange
        doc.rect(10, y - 4, 190, 5.5, 'F');
      }

      // Date
      doc.text(format(new Date(row.date), 'dd/MM/yy'), cols.date, y);

      // Interest Received (green for payments)
      if (row.interestPaid > 0.01) {
        doc.setTextColor(22, 163, 74); // Green
        doc.text(`-${formatCurrency(row.interestPaid)}`, cols.intReceived, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.setTextColor(180, 180, 180);
        doc.text('-', cols.intReceived, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      }

      // Expected Interest (purple for roll-up, blue for serviced/due dates, amber for adjustments)
      if (row.expectedInterest > 0.01 || row.expectedInterest < -0.01) {
        if (row.primaryType === 'adjustment') {
          doc.setTextColor(180, 83, 9); // Amber
        } else if (row.isRollUpPeriod) {
          doc.setTextColor(102, 51, 153); // Purple for roll-up
        } else {
          doc.setTextColor(37, 99, 235); // Blue
        }
        doc.text(formatCurrency(row.expectedInterest), cols.expected, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.setTextColor(180, 180, 180);
        doc.text('-', cols.expected, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      }

      // Interest Balance
      if (Math.abs(row.interestBalance) < 0.01) {
        doc.text(formatCurrency(0), cols.intBal, y, { align: 'right' });
      } else if (row.interestBalance > 0) {
        doc.text(formatCurrency(row.interestBalance), cols.intBal, y, { align: 'right' });
      } else {
        doc.text(`-${formatCurrency(Math.abs(row.interestBalance))}`, cols.intBal, y, { align: 'right' });
      }

      // Principal Change (red for disbursements, blue for repayments)
      if (Math.abs(row.principalChange) > 0.01) {
        if (row.principalChange > 0) {
          doc.setTextColor(220, 38, 38); // Red for disbursement
          doc.text(`+${formatCurrency(row.principalChange)}`, cols.principal, y, { align: 'right' });
        } else {
          doc.setTextColor(37, 99, 235); // Blue for capital repayment
          doc.text(formatCurrency(row.principalChange), cols.principal, y, { align: 'right' });
        }
        doc.setTextColor(0, 0, 0);
      } else if (row.primaryType === 'rate_change') {
        doc.setTextColor(180, 83, 9); // Amber
        doc.text(`${row.previousRate}%→${row.newRate}%`, cols.principal, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.setTextColor(180, 180, 180);
        doc.text('-', cols.principal, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      }

      // Principal Balance
      doc.setFont(undefined, 'bold');
      doc.text(formatCurrency(row.principalBalance), cols.prinBal, y, { align: 'right' });
      doc.setFont(undefined, 'normal');

      // Add note line with calculation breakdown for all applicable row types
      if (row.calculationBreakdown) {
        y += 4;
        doc.setFontSize(7);
        doc.setTextColor(120, 120, 120);

        let noteText = '';
        if (row.primaryType === 'adjustment') {
          noteText = row.calculationBreakdown.isCredit
            ? `Interest credit: ${row.calculationBreakdown.breakdown} (mid-period capital change)`
            : `Interest debit: ${row.calculationBreakdown.breakdown} (mid-period capital change)`;
        } else if (row.primaryType === 'disbursement' && row.calculationBreakdown.isDisbursement) {
          noteText = `Disbursement: ${row.calculationBreakdown.breakdown}`;
        } else if (row.primaryType === 'due_date') {
          if (row.isRollUpPeriod) {
            doc.setTextColor(102, 51, 153); // Purple for roll-up
          } else if (row.isServicedPeriod) {
            doc.setTextColor(37, 99, 235); // Blue for serviced
          }
          noteText = row.calculationBreakdown.breakdown;
        }

        if (noteText) {
          doc.text(noteText, cols.date + 2, y);
        }
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(8);
      }
    });

    // Totals row
    y += 4;
    doc.line(10, y, 200, y);
    y += 6;

    const lastRow = timelineRows.length > 0 ? timelineRows[timelineRows.length - 1] : null;
    const totalInterestPaid = lastRow?.totalPaidToDate || 0;
    const totalExpected = lastRow?.totalExpectedToDate || 0;
    const finalInterestBalance = lastRow?.interestBalance || 0;
    const finalPrincipalBalance = lastRow?.principalBalance || 0;

    doc.setFillColor(240, 240, 240);
    doc.rect(10, y - 4, 190, 7, 'F');
    doc.setFont(undefined, 'bold');
    doc.setFontSize(8);
    doc.text('TOTALS', cols.date, y);

    doc.setTextColor(22, 163, 74);
    doc.text(`-${formatCurrency(totalInterestPaid)}`, cols.intReceived, y, { align: 'right' });
    doc.setTextColor(0, 0, 0);

    doc.text(formatCurrency(totalExpected), cols.expected, y, { align: 'right' });
    doc.text(formatCurrency(Math.abs(finalInterestBalance)), cols.intBal, y, { align: 'right' });
    doc.text('', cols.principal, y, { align: 'right' });
    doc.text(formatCurrency(finalPrincipalBalance), cols.prinBal, y, { align: 'right' });

    // Add explanatory note about difference between ledger and settlement interest
    const settlementInterest = settlementData?.interestAccrued || 0;
    const ledgerToSettlementDiff = settlementInterest - totalExpected;

    if (Math.abs(ledgerToSettlementDiff) > 0.01) {
      y += 12;
      doc.setFontSize(8);
      doc.setFont(undefined, 'italic');
      doc.setTextColor(100, 100, 100);
      doc.text('Note: The ledger shows interest accrued per scheduled periods. The settlement statement', cols.date, y);
      y += 4;
      doc.text(`includes an additional ${formatCurrency(ledgerToSettlementDiff)} accrued from the last scheduled date to the settlement date.`, cols.date, y);
      y += 4;
      doc.text(`Total interest to settlement: ${formatCurrency(settlementInterest)}`, cols.date, y);
      doc.setTextColor(0, 0, 0);
      doc.setFont(undefined, 'normal');
    }
  }

  return doc;
}

/**
 * Generate combined loan statements PDF for multiple loans (contact group view)
 * Creates a header page with totals, then individual statements for each loan
 */
export function generateContactStatementsPDF({
  contactEmail,
  loans,
  loansData, // Array of { loan, schedule, transactions, product, interestCalc }
  totals,
  organization = null
}) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 15;

  // ============================================
  // PAGE 1: SUMMARY/HEADER PAGE
  // ============================================

  // Organization Details (if available)
  if (organization) {
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text(organization.name || '', pageWidth / 2, y, { align: 'center' });
    y += 6;

    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');

    const addressParts = [];
    if (organization.address_line1) addressParts.push(organization.address_line1);
    if (organization.address_line2) addressParts.push(organization.address_line2);
    const cityPostcode = [organization.city, organization.postcode].filter(Boolean).join(' ');
    if (cityPostcode) addressParts.push(cityPostcode);
    if (organization.country) addressParts.push(organization.country);

    for (const line of addressParts) {
      doc.text(line, pageWidth / 2, y, { align: 'center' });
      y += 4;
    }

    const contactParts = [];
    if (organization.phone) contactParts.push(`Tel: ${organization.phone}`);
    if (organization.email) contactParts.push(`Email: ${organization.email}`);
    if (organization.website) contactParts.push(organization.website);

    if (contactParts.length > 0) {
      doc.setFontSize(8);
      doc.text(contactParts.join('  |  '), pageWidth / 2, y, { align: 'center' });
      y += 4;
    }

    y += 2;
    doc.setDrawColor(200, 200, 200);
    doc.line(40, y, pageWidth - 40, y);
    y += 8;
  }

  // Header
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text('COMBINED LOAN STATEMENTS', pageWidth / 2, y, { align: 'center' });

  y += 10;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Generated: ${format(new Date(), 'dd MMM yyyy HH:mm')}`, pageWidth / 2, y, { align: 'center' });

  // Contact Info
  y += 12;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Contact Group', 15, y);

  y += 7;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Contact: ${contactEmail}`, 15, y);
  y += 5;
  doc.text(`Number of Loans: ${loans.length}`, 15, y);

  // Summary Totals
  y += 12;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Portfolio Summary', 15, y);

  y += 10;

  // Summary table header
  doc.setFillColor(240, 240, 240);
  doc.rect(15, y - 5, 180, 8, 'F');
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.text('Category', 20, y);
  doc.text('Amount', 160, y, { align: 'right' });

  y += 10;
  doc.setFont(undefined, 'normal');

  // Principal Outstanding
  doc.text('Principal Outstanding', 20, y);
  doc.text(formatCurrency(totals.totalPrincipalBalance), 160, y, { align: 'right' });
  y += 7;

  // Interest Outstanding
  doc.text('Interest Outstanding', 20, y);
  doc.text(formatCurrency(totals.totalInterestOutstanding), 160, y, { align: 'right' });
  y += 7;

  // Exit Fees
  if (totals.totalExitFees > 0) {
    doc.text('Exit Fees', 20, y);
    doc.text(formatCurrency(totals.totalExitFees), 160, y, { align: 'right' });
    y += 7;
  }

  // Total line
  y += 2;
  doc.line(15, y, 195, y);
  y += 8;

  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text('TOTAL OUTSTANDING', 20, y);
  doc.text(formatCurrency(totals.totalOutstanding), 160, y, { align: 'right' });

  // Build roll-up footnotes data (for loans in roll-up period with pending interest)
  const rollUpFootnotes = [];
  loansData.forEach(({ loan }) => {
    if (!loan.roll_up_length || !loan.start_date) return;
    const rollUpEndDate = new Date(loan.start_date);
    rollUpEndDate.setMonth(rollUpEndDate.getMonth() + loan.roll_up_length);
    if (new Date() < rollUpEndDate && loan.roll_up_amount > 0) {
      rollUpFootnotes.push({
        loanId: loan.id,
        footnoteNum: rollUpFootnotes.length + 1,
        amount: loan.roll_up_amount,
        dueDate: rollUpEndDate,
        loanRef: loan.loan_number || loan.id.slice(0, 8)
      });
    }
  });

  // Create a map for quick lookup
  const rollUpFootnoteMap = new Map(rollUpFootnotes.map(fn => [fn.loanId, fn]));

  // Loan Summary Table
  y += 15;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Loan Summary', 15, y);

  y += 10;

  // Column positions for better spacing
  const sumCols = {
    ref: 17,
    borrower: 38,
    principal: 115,
    interest: 145,
    exitFee: 170,
    total: 195
  };

  // Table header
  doc.setFillColor(240, 240, 240);
  doc.rect(15, y - 5, 185, 8, 'F');
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.text('Ref', sumCols.ref, y);
  doc.text('Borrower', sumCols.borrower, y);
  doc.text('Principal', sumCols.principal, y, { align: 'right' });
  doc.text('Interest', sumCols.interest, y, { align: 'right' });
  doc.text('Exit Fee', sumCols.exitFee, y, { align: 'right' });
  doc.text('Total', sumCols.total, y, { align: 'right' });

  y += 5;
  doc.line(15, y, 200, y);
  y += 1;

  doc.setFont(undefined, 'normal');

  // List each loan
  loansData.forEach(({ loan, interestCalc }, idx) => {
    y += 5;

    // Check for page break
    if (y > 260) {
      doc.addPage();
      y = 20;
      // Repeat header
      doc.setFillColor(240, 240, 240);
      doc.rect(15, y - 5, 185, 8, 'F');
      doc.setFontSize(7);
      doc.setFont(undefined, 'bold');
      doc.text('Ref', sumCols.ref, y);
      doc.text('Borrower', sumCols.borrower, y);
      doc.text('Principal', sumCols.principal, y, { align: 'right' });
      doc.text('Interest', sumCols.interest, y, { align: 'right' });
      doc.text('Exit Fee', sumCols.exitFee, y, { align: 'right' });
      doc.text('Total', sumCols.total, y, { align: 'right' });
      y += 5;
      doc.line(15, y, 200, y);
      y += 6;
      doc.setFont(undefined, 'normal');
    }

    const loanRef = loan.loan_number || loan.id.slice(0, 8);
    const borrowerName = (loan.borrower_name || '').slice(0, 30);
    const principalBal = interestCalc?.principalRemaining ?? loan.principal_remaining ?? loan.principal_amount;
    const interestBal = interestCalc?.interestRemaining ?? loan.interest_remaining ?? 0;
    const exitFee = loan.exit_fee || 0;
    const totalBal = principalBal + interestBal + exitFee;

    // Check if this loan has a roll-up footnote
    const footnote = rollUpFootnoteMap.get(loan.id);

    doc.setFontSize(7);
    doc.text(`#${loanRef}`, sumCols.ref, y);
    doc.text(borrowerName, sumCols.borrower, y);
    doc.text(formatCurrency(principalBal), sumCols.principal, y, { align: 'right' });

    // Interest column - add footnote number if applicable
    if (footnote) {
      const interestText = formatCurrency(interestBal);
      doc.text(interestText, sumCols.interest, y, { align: 'right' });
      // Add superscript footnote number
      doc.setFontSize(5);
      const textWidth = doc.getTextWidth(interestText);
      doc.text(`(${footnote.footnoteNum})`, sumCols.interest + 1, y - 1);
      doc.setFontSize(7);
    } else {
      doc.text(formatCurrency(interestBal), sumCols.interest, y, { align: 'right' });
    }

    doc.text(exitFee > 0 ? formatCurrency(exitFee) : '-', sumCols.exitFee, y, { align: 'right' });
    doc.text(formatCurrency(totalBal), sumCols.total, y, { align: 'right' });
  });

  // Totals row
  y += 3;
  doc.line(15, y, 200, y);
  y += 5;

  // Calculate total exit fees
  const totalExitFeesSum = loansData.reduce((sum, { loan }) => sum + (loan.exit_fee || 0), 0);

  doc.setFillColor(240, 240, 240);
  doc.rect(15, y - 3, 185, 6, 'F');
  doc.setFont(undefined, 'bold');
  doc.setFontSize(7);
  doc.text('TOTALS', sumCols.ref, y);
  doc.text(formatCurrency(totals.totalPrincipalBalance), sumCols.principal, y, { align: 'right' });
  doc.text(formatCurrency(totals.totalInterestOutstanding), sumCols.interest, y, { align: 'right' });
  doc.text(totalExitFeesSum > 0 ? formatCurrency(totalExitFeesSum) : '-', sumCols.exitFee, y, { align: 'right' });
  doc.text(formatCurrency(totals.totalOutstanding), sumCols.total, y, { align: 'right' });

  // Roll-up footnotes at bottom of table
  if (rollUpFootnotes.length > 0) {
    y += 10;
    doc.setFontSize(7);
    doc.setFont(undefined, 'italic');
    doc.setTextColor(100, 100, 100);

    rollUpFootnotes.forEach((fn) => {
      doc.text(`(${fn.footnoteNum}) ${formatCurrency(fn.amount)} roll-up interest falling due ${format(fn.dueDate, 'dd MMM yyyy')}`, 17, y);
      y += 4;
    });

    doc.setTextColor(0, 0, 0);
    doc.setFont(undefined, 'normal');
  }

  // ============================================
  // INDIVIDUAL LOAN STATEMENTS
  // ============================================
  loansData.forEach(({ loan, schedule, transactions, product, interestCalc }, index) => {
    // Add new page for each loan statement
    doc.addPage();
    y = 15;

    // Loan Statement Header (simplified - no org header on subsequent pages)
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text(`LOAN STATEMENT - ${loan.loan_number || loan.id.slice(0, 8)}`, pageWidth / 2, y, { align: 'center' });

    y += 8;
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(128, 128, 128);
    doc.text(`Statement ${index + 1} of ${loansData.length} | Contact: ${contactEmail}`, pageWidth / 2, y, { align: 'center' });
    doc.setTextColor(0, 0, 0);

    // Borrower Info
    y += 10;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Borrower Information', 15, y);

    y += 6;
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(`Name: ${loan.borrower_name}`, 15, y);
    y += 5;
    doc.text(`Loan Reference: #${loan.loan_number || loan.id.slice(0, 8)}`, 15, y);
    if (loan.description) {
      y += 5;
      doc.text(`Description: ${loan.description}`, 15, y);
    }

    // Loan Details
    y += 10;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Loan Details', 15, y);

    y += 6;
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(`Product: ${loan.product_name}`, 15, y);
    y += 5;
    doc.text(`Principal: ${formatCurrency(loan.principal_amount)}`, 15, y);
    y += 5;

    let rateText = `Interest Rate: ${loan.interest_rate}% pa (${loan.interest_type})`;
    if (loan.has_penalty_rate && loan.penalty_rate) {
      rateText += ` | Penalty: ${loan.penalty_rate}%`;
    }
    doc.text(rateText, 15, y);
    y += 5;
    doc.text(`Duration: ${loan.duration} ${loan.period === 'Monthly' ? 'months' : 'weeks'} | Start: ${format(new Date(loan.start_date), 'dd MMM yyyy')} | Status: ${loan.status}`, 15, y);

    if (loan.exit_fee > 0) {
      y += 5;
      doc.text(`Exit Fee: ${formatCurrency(loan.exit_fee)}`, 15, y);
    }

    // Roll-up info
    if (loan.roll_up_length || loan.roll_up_amount) {
      y += 5;
      const rollUpParts = [];
      if (loan.roll_up_length) rollUpParts.push(`${loan.roll_up_length} months`);
      if (loan.roll_up_amount) rollUpParts.push(`Accrued: ${formatCurrency(loan.roll_up_amount)}`);
      doc.text(`Roll-Up: ${rollUpParts.join(' | ')}`, 15, y);
    }

    // Disbursement Breakdown (if deductions)
    const arrangementFee = loan.arrangement_fee || 0;
    const additionalFees = loan.additional_deducted_fees || 0;
    const totalDeducted = arrangementFee + additionalFees;

    if (totalDeducted > 0) {
      y += 8;
      doc.setFontSize(10);
      doc.setFont(undefined, 'bold');
      doc.text('Disbursement Breakdown', 15, y);

      y += 5;
      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');

      const grossAmount = loan.principal_amount;
      const netDisbursed = grossAmount - totalDeducted;

      doc.text(`Gross: ${formatCurrency(grossAmount)}`, 15, y);
      if (arrangementFee > 0) {
        y += 4;
        doc.text(`Less Arrangement Fee: -${formatCurrency(arrangementFee)}`, 15, y);
      }
      if (additionalFees > 0) {
        y += 4;
        const feesNote = loan.additional_deducted_fees_note ? ` (${loan.additional_deducted_fees_note})` : '';
        doc.text(`Less Other Fees: -${formatCurrency(additionalFees)}${feesNote}`, 15, y);
      }
      y += 4;
      doc.setFont(undefined, 'bold');
      doc.text(`Net Disbursed: ${formatCurrency(netDisbursed)}`, 15, y);
      doc.setFont(undefined, 'normal');
    }

    // Current Position
    const summaryValues = interestCalc ? {
      principalOutstanding: interestCalc.principalRemaining,
      interestAccrued: interestCalc.interestAccrued,
      interestPaid: interestCalc.interestPaid,
      interestOutstanding: interestCalc.interestRemaining
    } : {
      principalOutstanding: loan.principal_remaining ?? loan.principal_amount,
      interestAccrued: 0,
      interestPaid: 0,
      interestOutstanding: loan.interest_remaining ?? 0
    };

    y += 10;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Current Position (as of today)', 15, y);

    y += 6;
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(`Principal Outstanding: ${formatCurrency(summaryValues.principalOutstanding)}`, 15, y);
    y += 5;
    doc.text(`Interest Due: ${formatCurrency(summaryValues.interestAccrued)} | Paid: ${formatCurrency(summaryValues.interestPaid)} | Outstanding: ${formatCurrency(summaryValues.interestOutstanding)}`, 15, y);
    y += 5;
    const totalOutstanding = summaryValues.principalOutstanding + summaryValues.interestOutstanding + (loan.exit_fee || 0);
    doc.setFont(undefined, 'bold');
    doc.text(`Total Outstanding: ${formatCurrency(totalOutstanding)}${loan.exit_fee > 0 ? ` (inc. ${formatCurrency(loan.exit_fee)} exit fee)` : ''}`, 15, y);
    doc.setFont(undefined, 'normal');

    // ============================================
    // LOAN LEDGER (Timeline) - Compact version
    // ============================================
    y += 12;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Loan Ledger', 15, y);

    y += 8;

    // Build timeline
    const timelineRows = buildPDFTimeline(loan, schedule, transactions, product);

    // Column positions
    const cols = {
      date: 17,
      intReceived: 55,
      expected: 85,
      intBal: 115,
      principal: 145,
      prinBal: 185
    };

    // Table header
    const drawLedgerHeader = (yPos) => {
      doc.setFillColor(240, 240, 240);
      doc.rect(15, yPos - 4, 175, 6, 'F');
      doc.setFontSize(7);
      doc.setFont(undefined, 'bold');
      doc.text('Date', cols.date, yPos);
      doc.text('Int Rcvd', cols.intReceived, yPos, { align: 'right' });
      doc.text('Expected', cols.expected, yPos, { align: 'right' });
      doc.text('Int Bal', cols.intBal, yPos, { align: 'right' });
      doc.text('Principal', cols.principal, yPos, { align: 'right' });
      doc.text('Prin Bal', cols.prinBal, yPos, { align: 'right' });
      return yPos + 4;
    };

    y = drawLedgerHeader(y);
    doc.line(15, y, 190, y);
    y += 1;

    doc.setFont(undefined, 'normal');
    doc.setFontSize(7);

    timelineRows.forEach((row) => {
      // Check for page break
      if (y > 280) {
        doc.addPage();
        y = 20;
        y = drawLedgerHeader(y);
        doc.line(15, y, 190, y);
        y += 1;
        doc.setFont(undefined, 'normal');
        doc.setFontSize(7);
      }

      y += 4;

      // Row background
      if (row.primaryType === 'disbursement') {
        doc.setFillColor(255, 240, 240);
        doc.rect(15, y - 3, 175, 4, 'F');
      } else if (row.primaryType === 'repayment') {
        doc.setFillColor(240, 255, 240);
        doc.rect(15, y - 3, 175, 4, 'F');
      } else if (row.isRollUpPeriod) {
        doc.setFillColor(248, 240, 255);
        doc.rect(15, y - 3, 175, 4, 'F');
      } else if (row.isDueDate) {
        doc.setFillColor(240, 248, 255);
        doc.rect(15, y - 3, 175, 4, 'F');
      }

      // Date
      doc.text(format(new Date(row.date), 'dd/MM/yy'), cols.date, y);

      // Interest Received
      if (row.interestPaid > 0.01) {
        doc.setTextColor(22, 163, 74);
        doc.text(`-${formatCurrency(row.interestPaid)}`, cols.intReceived, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.setTextColor(180, 180, 180);
        doc.text('-', cols.intReceived, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      }

      // Expected
      if (Math.abs(row.expectedInterest) > 0.01) {
        doc.setTextColor(37, 99, 235);
        doc.text(formatCurrency(row.expectedInterest), cols.expected, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.setTextColor(180, 180, 180);
        doc.text('-', cols.expected, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      }

      // Interest Balance
      doc.text(formatCurrency(Math.abs(row.interestBalance) < 0.01 ? 0 : row.interestBalance), cols.intBal, y, { align: 'right' });

      // Principal
      if (Math.abs(row.principalChange) > 0.01) {
        if (row.principalChange > 0) {
          doc.setTextColor(220, 38, 38);
          doc.text(`+${formatCurrency(row.principalChange)}`, cols.principal, y, { align: 'right' });
        } else {
          doc.setTextColor(37, 99, 235);
          doc.text(formatCurrency(row.principalChange), cols.principal, y, { align: 'right' });
        }
        doc.setTextColor(0, 0, 0);
      } else {
        doc.setTextColor(180, 180, 180);
        doc.text('-', cols.principal, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      }

      // Principal Balance
      doc.setFont(undefined, 'bold');
      doc.text(formatCurrency(row.principalBalance), cols.prinBal, y, { align: 'right' });
      doc.setFont(undefined, 'normal');
    });

    // Totals
    y += 3;
    doc.line(15, y, 190, y);
    y += 5;

    const lastRow = timelineRows.length > 0 ? timelineRows[timelineRows.length - 1] : null;
    const totalIntPaid = lastRow?.totalPaidToDate || 0;
    const totalExp = lastRow?.totalExpectedToDate || 0;
    const finalIntBal = lastRow?.interestBalance || 0;
    const finalPrinBal = lastRow?.principalBalance || 0;

    doc.setFillColor(240, 240, 240);
    doc.rect(15, y - 3, 175, 5, 'F');
    doc.setFont(undefined, 'bold');
    doc.setFontSize(7);
    doc.text('TOTALS', cols.date, y);
    doc.setTextColor(22, 163, 74);
    doc.text(`-${formatCurrency(totalIntPaid)}`, cols.intReceived, y, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    doc.text(formatCurrency(totalExp), cols.expected, y, { align: 'right' });
    doc.text(formatCurrency(Math.abs(finalIntBal)), cols.intBal, y, { align: 'right' });
    doc.text('', cols.principal, y, { align: 'right' });
    doc.text(formatCurrency(finalPrinBal), cols.prinBal, y, { align: 'right' });
  });

  // Add page numbers to all pages
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(128, 128, 128);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, 290, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  }

  // Generate filename
  const safeContactEmail = contactEmail.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
  doc.save(`combined-statements-${safeContactEmail}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
}

/**
 * Generate a valuation request letter PDF
 * Used to request updated property valuations from borrowers when valuations are stale
 */
export function generateValuationRequestPDF({
  loan,
  loanProperties,
  borrower,
  organization,
  headerText,
  footerText,
  ltvMetrics = null
}) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const leftMargin = 20;
  const rightMargin = pageWidth - 20;
  const contentWidth = rightMargin - leftMargin;
  let y = 20;

  // Organization Header
  if (organization) {
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text(organization.name || '', pageWidth / 2, y, { align: 'center' });
    y += 6;

    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');

    const addressParts = [];
    if (organization.address_line1) addressParts.push(organization.address_line1);
    if (organization.address_line2) addressParts.push(organization.address_line2);
    const cityPostcode = [organization.city, organization.postcode].filter(Boolean).join(' ');
    if (cityPostcode) addressParts.push(cityPostcode);

    for (const line of addressParts) {
      doc.text(line, pageWidth / 2, y, { align: 'center' });
      y += 4;
    }

    const contactParts = [];
    if (organization.phone) contactParts.push(`Tel: ${organization.phone}`);
    if (organization.email) contactParts.push(`Email: ${organization.email}`);
    if (contactParts.length > 0) {
      doc.setFontSize(8);
      doc.text(contactParts.join('  |  '), pageWidth / 2, y, { align: 'center' });
      y += 4;
    }

    // Separator line
    y += 4;
    doc.setDrawColor(180, 180, 180);
    doc.line(leftMargin, y, rightMargin, y);
    y += 12;
  }

  // Date
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(format(new Date(), 'dd MMMM yyyy'), leftMargin, y);
  y += 12;

  // Recipient Address
  const borrowerName = borrower?.business || `${borrower?.first_name || ''} ${borrower?.last_name || ''}`.trim() || 'The Borrower';
  doc.setFont(undefined, 'bold');
  doc.text(borrowerName, leftMargin, y);
  y += 5;
  doc.setFont(undefined, 'normal');

  if (borrower?.address) {
    const addressLines = borrower.address.split('\n');
    for (const line of addressLines) {
      doc.text(line.trim(), leftMargin, y);
      y += 5;
    }
  }
  if (borrower?.city || borrower?.zipcode) {
    const cityLine = [borrower.city, borrower.zipcode].filter(Boolean).join(' ');
    doc.text(cityLine, leftMargin, y);
    y += 5;
  }

  y += 8;

  // Header Text (customizable)
  doc.setFontSize(10);
  // Replace placeholder with actual name
  const processedHeaderText = headerText.replace(/{borrowerName}/g, borrowerName);
  const headerLines = doc.splitTextToSize(processedHeaderText, contentWidth);
  for (const line of headerLines) {
    if (line.startsWith('Re:') || line.startsWith('RE:')) {
      doc.setFont(undefined, 'bold');
    } else if (line.startsWith('Dear')) {
      doc.setFont(undefined, 'normal');
    }
    doc.text(line, leftMargin, y);
    y += 5;
    doc.setFont(undefined, 'normal');
  }

  y += 8;

  // Loan Details Section
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text('LOAN DETAILS', leftMargin, y);
  y += 2;
  doc.setDrawColor(100, 100, 100);
  doc.line(leftMargin, y, leftMargin + 40, y);
  y += 6;

  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');

  const loanDetails = [
    ['Loan Reference:', `#${loan.loan_number || loan.id?.slice(0, 8) || 'N/A'}`],
    ['Principal Amount:', formatCurrency(loan.principal_amount || 0)],
    ['Status:', loan.status || 'N/A']
  ];

  if (ltvMetrics?.ltv != null) {
    loanDetails.push(['Current LTV:', `${ltvMetrics.ltv.toFixed(1)}%`]);
  }

  for (const [label, value] of loanDetails) {
    doc.setFont(undefined, 'normal');
    doc.text(label, leftMargin, y);
    doc.text(value, leftMargin + 45, y);
    y += 5;
  }

  y += 8;

  // Security Details Section
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text('SECURITY DETAILS', leftMargin, y);
  y += 2;
  doc.setDrawColor(100, 100, 100);
  doc.line(leftMargin, y, leftMargin + 50, y);
  y += 6;

  if (loanProperties && loanProperties.length > 0) {
    // Table header
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setFillColor(240, 240, 240);
    doc.rect(leftMargin, y - 3, contentWidth, 6, 'F');

    const colWidths = [75, 25, 30, 40];
    let x = leftMargin + 2;

    doc.text('Property Address', x, y);
    x += colWidths[0];
    doc.text('Type', x, y);
    x += colWidths[1];
    doc.text('Charge', x, y);
    x += colWidths[2];
    doc.text('Value / Age', x, y);

    y += 6;

    // Table rows
    doc.setFont(undefined, 'normal');
    for (const lp of loanProperties) {
      const property = lp.property || lp;
      const address = property?.address || 'Unknown';
      const type = property?.property_type || 'N/A';
      const chargeType = lp.charge_type === 'Second Charge' ? '2nd' : '1st';
      const value = formatCurrency(property?.current_value || 0);

      // Calculate valuation age
      let ageText = 'No valuation';
      if (lp.lastValuationDate) {
        const months = Math.floor((new Date() - new Date(lp.lastValuationDate)) / (1000 * 60 * 60 * 24 * 30));
        ageText = `${months} mths`;
      }

      x = leftMargin + 2;

      // Truncate address if too long
      const truncatedAddress = address.length > 35 ? address.slice(0, 32) + '...' : address;
      doc.text(truncatedAddress, x, y);
      x += colWidths[0];
      doc.text(type.slice(0, 10), x, y);
      x += colWidths[1];
      doc.text(chargeType, x, y);
      x += colWidths[2];
      doc.text(`${value}`, x, y);
      y += 5;
      // Age on second line
      doc.setTextColor(100, 100, 100);
      doc.text(`(${ageText})`, x, y);
      doc.setTextColor(0, 0, 0);
      y += 6;

      // Add row separator
      doc.setDrawColor(220, 220, 220);
      doc.line(leftMargin, y - 2, rightMargin, y - 2);
    }
  } else {
    doc.setFontSize(10);
    doc.setFont(undefined, 'italic');
    doc.text('No properties linked to this loan.', leftMargin, y);
    y += 6;
  }

  y += 8;

  // Footer Text (customizable)
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  const footerLines = doc.splitTextToSize(footerText, contentWidth);
  for (const line of footerLines) {
    doc.text(line, leftMargin, y);
    y += 5;
  }

  y += 10;

  // Organization signature
  if (organization?.name) {
    doc.setFont(undefined, 'bold');
    doc.text(organization.name, leftMargin, y);
  }

  return doc;
}
