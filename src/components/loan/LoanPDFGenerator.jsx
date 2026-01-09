
import jsPDF from 'jspdf';
import { format, differenceInDays } from 'date-fns';
import { formatCurrency, buildCapitalEvents, getEffectiveRate } from './LoanCalculator';

/**
 * Build a comprehensive interest ledger showing all capital events, rate changes,
 * and running interest balance that the borrower can trace through
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

  // Build capital events from transactions
  const capitalEvents = buildCapitalEvents(loan, activeTransactions);

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
  let periodStart = loanStartDate;
  let eventIndex = 0;

  // Create a timeline of all events that change state
  const stateChangeEvents = [];

  // Add capital events (disbursements and principal repayments)
  capitalEvents.forEach(event => {
    stateChangeEvents.push({
      date: event.date,
      type: event.type,
      principalChange: event.principalChange,
      description: event.description || event.type,
      transaction: event.transaction
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

  // Sort events by date
  stateChangeEvents.sort((a, b) => a.date - b.date);

  // Process timeline
  let currentPrincipal = 0;
  let currentRate = loan.interest_rate;
  let lastEventDate = loanStartDate;

  stateChangeEvents.forEach((event, idx) => {
    const eventDate = event.date;

    // Calculate interest for period before this event
    if (eventDate > lastEventDate && currentPrincipal > 0) {
      const days = differenceInDays(eventDate, lastEventDate);
      if (days > 0) {
        const dailyRate = currentPrincipal * (currentRate / 100 / 365);
        const periodInterest = dailyRate * days;
        runningInterestAccrued += periodInterest;

        ledgerEntries.push({
          type: 'InterestAccrual',
          fromDate: lastEventDate,
          toDate: eventDate,
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
        date: eventDate,
        amount: event.principalChange,
        principalAfter: currentPrincipal,
        runningInterestAccrued,
        runningInterestPaid,
        interestBalance: runningInterestAccrued - runningInterestPaid,
        description: event.description || 'Funds advanced',
        reference: event.transaction?.reference
      });
    } else if (event.type === 'PrincipalRepayment' || event.type === 'Repayment') {
      // Handle repayment - split into interest and principal portions
      const tx = event.transaction;
      if (tx) {
        const interestApplied = tx.interest_applied || 0;
        const principalApplied = tx.principal_applied || 0;

        if (interestApplied > 0) {
          runningInterestPaid += interestApplied;
        }

        currentPrincipal = Math.max(0, currentPrincipal - principalApplied);

        ledgerEntries.push({
          type: 'Repayment',
          date: eventDate,
          amount: tx.amount,
          interestApplied,
          principalApplied,
          principalAfter: currentPrincipal,
          runningInterestAccrued,
          runningInterestPaid,
          interestBalance: runningInterestAccrued - runningInterestPaid,
          description: tx.reference || 'Payment received',
          reference: tx.reference
        });
      }
    } else if (event.type === 'RateChange') {
      currentRate = event.rateChange.to;
      ledgerEntries.push({
        type: 'RateChange',
        date: eventDate,
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
        fromDate: lastEventDate,
        toDate: today,
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

export function generateLoanStatementPDF(loan, schedule, transactions, product = null) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 20;

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
  doc.text(`Principal: ${formatCurrency(loan.principal_amount)}`, 15, y);
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

  if (loan.arrangement_fee > 0 || loan.exit_fee > 0) {
    y += 5;
    const fees = [];
    if (loan.arrangement_fee > 0) fees.push(`Arrangement: ${formatCurrency(loan.arrangement_fee)}`);
    if (loan.exit_fee > 0) fees.push(`Exit: ${formatCurrency(loan.exit_fee)}`);
    doc.text(`Fees: ${fees.join(' | ')}`, 15, y);
  }

  // Build and display interest ledger
  const ledger = buildInterestLedger(loan, transactions, product);

  // Current Position Summary
  y += 12;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Current Position (as of today)', 15, y);

  y += 7;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Principal Outstanding: ${formatCurrency(ledger.summary.principalOutstanding)}`, 15, y);
  y += 5;
  doc.text(`Total Interest Accrued: ${formatCurrency(ledger.summary.totalInterestAccrued)}`, 15, y);
  y += 5;
  doc.text(`Total Interest Paid: ${formatCurrency(ledger.summary.totalInterestPaid)}`, 15, y);
  y += 5;
  doc.setFont(undefined, 'bold');
  doc.text(`Interest Outstanding: ${formatCurrency(ledger.summary.interestOutstanding)}`, 15, y);
  doc.setFont(undefined, 'normal');
  y += 5;
  const totalOutstanding = ledger.summary.principalOutstanding + ledger.summary.interestOutstanding + (loan.exit_fee || 0);
  doc.setFont(undefined, 'bold');
  doc.text(`Total Outstanding: ${formatCurrency(totalOutstanding)}`, 15, y);
  if (loan.exit_fee > 0) {
    doc.setFont(undefined, 'normal');
    doc.text(` (inc. ${formatCurrency(loan.exit_fee)} exit fee)`, 95, y);
  }

  // ============================================
  // PAGE 2+: INTEREST CALCULATION LEDGER
  // ============================================
  doc.addPage();
  y = 15;

  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text('INTEREST CALCULATION LEDGER', pageWidth / 2, y, { align: 'center' });

  y += 8;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Loan: #${loan.loan_number || loan.id.slice(0, 8)} - ${loan.borrower_name}`, pageWidth / 2, y, { align: 'center' });

  // Calculation Method explanation
  y += 10;
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.text('Calculation Method:', 15, y);
  y += 5;
  doc.setFont(undefined, 'normal');
  doc.text(`Daily Interest = Principal Balance × (Annual Rate / 365)`, 15, y);
  y += 4;
  doc.text(`Interest accrues daily on the outstanding principal balance.`, 15, y);
  y += 4;
  doc.text(`Rate changes and capital movements are reflected immediately from their effective date.`, 15, y);

  y += 10;

  // Ledger entries table
  const drawLedgerHeader = (yPos) => {
    doc.setFillColor(240, 240, 240);
    doc.rect(10, yPos - 4, 190, 7, 'F');
    doc.setFontSize(7);
    doc.setFont(undefined, 'bold');
    doc.text('Date/Period', 12, yPos);
    doc.text('Description', 50, yPos);
    doc.text('Days', 105, yPos, { align: 'right' });
    doc.text('Rate', 118, yPos, { align: 'right' });
    doc.text('Interest', 140, yPos, { align: 'right' });
    doc.text('Int. Paid', 160, yPos, { align: 'right' });
    doc.text('Int. O/S', 180, yPos, { align: 'right' });
    doc.text('Princ. O/S', 198, yPos, { align: 'right' });
    return yPos + 5;
  };

  y = drawLedgerHeader(y);
  doc.line(10, y, 200, y);
  y += 1;

  doc.setFont(undefined, 'normal');
  doc.setFontSize(7);

  ledger.entries.forEach((entry, idx) => {
    // Check for page break
    if (y > 275) {
      doc.addPage();
      y = 20;
      y = drawLedgerHeader(y);
      doc.line(10, y, 200, y);
      y += 1;
      doc.setFont(undefined, 'normal');
      doc.setFontSize(7);
    }

    y += 5;

    if (entry.type === 'InterestAccrual') {
      // Interest accrual row - show period
      const fromStr = format(entry.fromDate, 'dd/MM/yy');
      const toStr = format(entry.toDate, 'dd/MM/yy');
      doc.text(`${fromStr}-${toStr}`, 12, y);

      // Truncate description if needed
      const desc = entry.description.length > 35 ? entry.description.slice(0, 33) + '...' : entry.description;
      doc.text(desc, 50, y);

      doc.text(String(entry.days), 105, y, { align: 'right' });
      doc.text(`${entry.rate}%`, 118, y, { align: 'right' });
      doc.text(formatCurrency(entry.interest), 140, y, { align: 'right' });
      doc.text('-', 160, y, { align: 'right' });
      doc.text(formatCurrency(entry.interestBalance), 180, y, { align: 'right' });
      doc.text(formatCurrency(entry.principal), 198, y, { align: 'right' });

    } else if (entry.type === 'Disbursement') {
      // Disbursement row
      doc.setFillColor(239, 246, 255); // Light blue
      doc.rect(10, y - 4, 190, 5.5, 'F');

      doc.text(format(entry.date, 'dd/MM/yy'), 12, y);
      doc.setTextColor(37, 99, 235); // Blue
      doc.text(`DISBURSEMENT: ${entry.description}`, 50, y);
      doc.text(formatCurrency(entry.amount), 140, y, { align: 'right' });
      doc.setTextColor(0, 0, 0);
      doc.text('-', 160, y, { align: 'right' });
      doc.text(formatCurrency(entry.interestBalance), 180, y, { align: 'right' });
      doc.text(formatCurrency(entry.principalAfter), 198, y, { align: 'right' });

    } else if (entry.type === 'Repayment') {
      // Repayment row
      doc.setFillColor(240, 253, 244); // Light green
      doc.rect(10, y - 4, 190, 5.5, 'F');

      doc.text(format(entry.date, 'dd/MM/yy'), 12, y);
      doc.setTextColor(22, 163, 74); // Green

      let repaymentDesc = `REPAYMENT: ${formatCurrency(entry.amount)}`;
      if (entry.interestApplied > 0 && entry.principalApplied > 0) {
        repaymentDesc += ` (${formatCurrency(entry.interestApplied)} int, ${formatCurrency(entry.principalApplied)} princ)`;
      } else if (entry.interestApplied > 0) {
        repaymentDesc += ` (${formatCurrency(entry.interestApplied)} to interest)`;
      } else if (entry.principalApplied > 0) {
        repaymentDesc += ` (${formatCurrency(entry.principalApplied)} to principal)`;
      }
      const truncDesc = repaymentDesc.length > 48 ? repaymentDesc.slice(0, 46) + '...' : repaymentDesc;
      doc.text(truncDesc, 50, y);
      doc.setTextColor(0, 0, 0);

      doc.text('-', 105, y, { align: 'right' });
      doc.text('-', 118, y, { align: 'right' });
      doc.text('-', 140, y, { align: 'right' });

      if (entry.interestApplied > 0) {
        doc.setTextColor(22, 163, 74);
        doc.text(`-${formatCurrency(entry.interestApplied)}`, 160, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.text('-', 160, y, { align: 'right' });
      }

      doc.text(formatCurrency(entry.interestBalance), 180, y, { align: 'right' });
      doc.text(formatCurrency(entry.principalAfter), 198, y, { align: 'right' });

    } else if (entry.type === 'RateChange') {
      // Rate change row
      doc.setFillColor(254, 243, 199); // Light amber
      doc.rect(10, y - 4, 190, 5.5, 'F');

      doc.text(format(entry.date, 'dd/MM/yy'), 12, y);
      doc.setTextColor(180, 83, 9); // Amber
      doc.text(`RATE CHANGE: ${entry.fromRate}% → ${entry.toRate}%`, 50, y);
      doc.setTextColor(0, 0, 0);
      doc.text('-', 105, y, { align: 'right' });
      doc.text(`${entry.toRate}%`, 118, y, { align: 'right' });
      doc.text('-', 140, y, { align: 'right' });
      doc.text('-', 160, y, { align: 'right' });
      doc.text(formatCurrency(entry.interestBalance), 180, y, { align: 'right' });
      doc.text(formatCurrency(entry.principalBalance), 198, y, { align: 'right' });
    }
  });

  // Totals
  y += 4;
  doc.line(10, y, 200, y);
  y += 6;

  doc.setFillColor(255, 243, 205);
  doc.rect(10, y - 4, 190, 7, 'F');
  doc.setFont(undefined, 'bold');
  doc.setFontSize(8);
  doc.text('TOTALS', 12, y);
  doc.text(formatCurrency(ledger.summary.totalInterestAccrued), 140, y, { align: 'right' });
  doc.text(formatCurrency(ledger.summary.totalInterestPaid), 160, y, { align: 'right' });
  doc.text(formatCurrency(ledger.summary.interestOutstanding), 180, y, { align: 'right' });
  doc.text(formatCurrency(ledger.summary.principalOutstanding), 198, y, { align: 'right' });

  // ============================================
  // PAGE 3+: REPAYMENT SCHEDULE
  // ============================================
  if (schedule && schedule.length > 0) {
    doc.addPage();
    y = 15;

    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text('REPAYMENT SCHEDULE', pageWidth / 2, y, { align: 'center' });

    y += 10;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Loan: #${loan.loan_number || loan.id.slice(0, 8)} - ${loan.borrower_name}`, pageWidth / 2, y, { align: 'center' });

    y += 10;

    // Schedule table header
    const drawScheduleHeader = (yPos) => {
      doc.setFillColor(240, 240, 240);
      doc.rect(15, yPos - 4, 180, 7, 'F');
      doc.setFontSize(8);
      doc.setFont(undefined, 'bold');
      doc.text('#', 17, yPos);
      doc.text('Due Date', 28, yPos);
      doc.text('Interest Due', 85, yPos, { align: 'right' });
      doc.text('Total Due', 115, yPos, { align: 'right' });
      doc.text('Paid', 145, yPos, { align: 'right' });
      doc.text('Status', 160, yPos);
      return yPos + 5;
    };

    y = drawScheduleHeader(y);
    doc.line(15, y, 195, y);

    doc.setFont(undefined, 'normal');
    schedule.forEach((row) => {
      y += 6;
      if (y > 275) {
        doc.addPage();
        y = 20;
        y = drawScheduleHeader(y);
        doc.line(15, y, 195, y);
        y += 6;
        doc.setFont(undefined, 'normal');
      }

      // Color code by status
      if (row.status === 'Paid') {
        doc.setFillColor(240, 253, 244);
        doc.rect(15, y - 4, 180, 5.5, 'F');
      } else if (row.status === 'Overdue') {
        doc.setFillColor(254, 242, 242);
        doc.rect(15, y - 4, 180, 5.5, 'F');
      }

      doc.setFontSize(8);
      doc.text(String(row.installment_number), 17, y);
      doc.text(format(new Date(row.due_date), 'dd MMM yyyy'), 28, y);
      doc.text(formatCurrency(row.interest_amount), 85, y, { align: 'right' });
      doc.text(formatCurrency(row.total_due), 115, y, { align: 'right' });

      const paid = (row.principal_paid || 0) + (row.interest_paid || 0);
      if (paid > 0) {
        doc.setTextColor(22, 163, 74);
        doc.text(formatCurrency(paid), 145, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.text('-', 145, y, { align: 'right' });
      }

      // Status with color
      if (row.status === 'Paid') {
        doc.setTextColor(22, 163, 74);
      } else if (row.status === 'Overdue') {
        doc.setTextColor(220, 38, 38);
      }
      doc.text(row.status, 160, y);
      doc.setTextColor(0, 0, 0);
    });
  }

  // ============================================
  // FINAL PAGE: TRANSACTION HISTORY
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
    const totalInterestPaid = sortedTx.reduce((s, t) => s + (t.interest_applied || 0), 0);
    const totalPrincipalPaid = sortedTx.reduce((s, t) => s + (t.principal_applied || 0), 0);

    doc.setFont(undefined, 'bold');
    doc.setFontSize(8);
    doc.text('TOTALS:', 17, y);
    doc.text(`Disbursed: ${formatCurrency(totalDisbursed)}`, 45, y);
    doc.text(`Repaid: ${formatCurrency(totalRepaid)}`, 120, y, { align: 'right' });
    doc.text(formatCurrency(totalInterestPaid), 145, y, { align: 'right' });
    doc.text(formatCurrency(totalPrincipalPaid), 170, y, { align: 'right' });
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

  doc.save(`loan-statement-${loan.id}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
}

export function generateSettlementStatementPDF(loan, settlementData) {
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
  doc.text(`Generated: ${format(new Date(), 'MMM dd, yyyy HH:mm')}`, pageWidth / 2, y, { align: 'center' });

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
    doc.text(`Formula: Daily Interest = Principal Balance × Daily Rate`, 15, y);

    // Interest Periods Table
    y += 12;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Interest Accrual by Period', 15, y);

    y += 8;

    // Table header
    doc.setFillColor(240, 240, 240);
    doc.rect(15, y - 4, 180, 7, 'F');
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text('Period', 17, y);
    doc.text('Days', 70, y, { align: 'right' });
    doc.text('Principal Balance', 115, y, { align: 'right' });
    doc.text('Interest Accrued', 160, y, { align: 'right' });
    doc.text('Payment', 190, y, { align: 'right' });

    y += 6;
    doc.line(15, y, 195, y);

    doc.setFont(undefined, 'normal');
    let runningInterestTotal = 0;

    for (const period of settlementData.interestPeriods) {
      y += 6;
      if (y > 275) {
        doc.addPage();
        y = 20;
        // Repeat header on new page
        doc.setFillColor(240, 240, 240);
        doc.rect(15, y - 4, 180, 7, 'F');
        doc.setFontSize(8);
        doc.setFont(undefined, 'bold');
        doc.text('Period', 17, y);
        doc.text('Days', 70, y, { align: 'right' });
        doc.text('Principal Balance', 115, y, { align: 'right' });
        doc.text('Interest Accrued', 160, y, { align: 'right' });
        doc.text('Payment', 190, y, { align: 'right' });
        y += 6;
        doc.line(15, y, 195, y);
        y += 6;
        doc.setFont(undefined, 'normal');
      }

      const startStr = format(period.startDate, 'dd/MM/yy');
      const endStr = format(period.endDate, 'dd/MM/yy');
      doc.text(`${startStr} - ${endStr}`, 17, y);
      doc.text(String(period.days), 70, y, { align: 'right' });
      doc.text(formatCurrency(period.openingPrincipal), 115, y, { align: 'right' });
      doc.text(formatCurrency(period.periodInterest), 160, y, { align: 'right' });

      if (period.principalPayment > 0) {
        doc.setTextColor(0, 128, 0);
        doc.text(`-${formatCurrency(period.principalPayment)}`, 190, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.text('-', 190, y, { align: 'right' });
      }

      runningInterestTotal += period.periodInterest;
    }

    // Totals section
    y += 4;
    doc.line(15, y, 195, y);
    y += 7;

    doc.setFont(undefined, 'bold');
    doc.text('Total Interest Accrued', 17, y);
    doc.text(String(settlementData.daysElapsed), 70, y, { align: 'right' });
    doc.text('', 115, y, { align: 'right' });
    doc.text(formatCurrency(settlementData.interestAccrued || runningInterestTotal), 160, y, { align: 'right' });

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
    doc.text(formatCurrency(settlementData.interestDue), 160, y, { align: 'right' });
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

    // Table header
    doc.setFillColor(240, 240, 240);
    doc.rect(15, y - 4, 180, 7, 'F');
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text('Date', 17, y);
    doc.text('Type', 45, y);
    doc.text('Description', 75, y);
    doc.text('Amount', 115, y, { align: 'right' });
    doc.text('Principal', 140, y, { align: 'right' });
    doc.text('Interest', 165, y, { align: 'right' });
    doc.text('Balance', 190, y, { align: 'right' });

    y += 6;
    doc.line(15, y, 195, y);

    doc.setFont(undefined, 'normal');

    for (const tx of settlementData.transactionHistory) {
      y += 6;
      if (y > 275) {
        doc.addPage();
        y = 20;
        // Repeat header on new page
        doc.setFillColor(240, 240, 240);
        doc.rect(15, y - 4, 180, 7, 'F');
        doc.setFontSize(8);
        doc.setFont(undefined, 'bold');
        doc.text('Date', 17, y);
        doc.text('Type', 45, y);
        doc.text('Description', 75, y);
        doc.text('Amount', 115, y, { align: 'right' });
        doc.text('Principal', 140, y, { align: 'right' });
        doc.text('Interest', 165, y, { align: 'right' });
        doc.text('Balance', 190, y, { align: 'right' });
        y += 6;
        doc.line(15, y, 195, y);
        y += 6;
        doc.setFont(undefined, 'normal');
      }

      // Set row background color based on type
      if (tx.type === 'Disbursement') {
        doc.setFillColor(239, 246, 255); // Light blue
        doc.rect(15, y - 4, 180, 6, 'F');
      } else if (tx.type === 'Repayment') {
        doc.setFillColor(240, 253, 244); // Light green
        doc.rect(15, y - 4, 180, 6, 'F');
      }

      doc.text(format(tx.date, 'dd/MM/yyyy'), 17, y);
      doc.text(tx.type, 45, y);

      // Truncate description if too long
      const desc = tx.description || '-';
      const truncatedDesc = desc.length > 18 ? desc.slice(0, 16) + '...' : desc;
      doc.text(truncatedDesc, 75, y);

      // Amount with color
      if (tx.type === 'Disbursement') {
        doc.setTextColor(37, 99, 235); // Blue
      } else {
        doc.setTextColor(22, 163, 74); // Green
      }
      doc.text(formatCurrency(tx.amount), 115, y, { align: 'right' });
      doc.setTextColor(0, 0, 0);

      // Principal and interest applied
      if (tx.principalApplied > 0) {
        doc.setTextColor(22, 163, 74);
        doc.text(`-${formatCurrency(tx.principalApplied)}`, 140, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.text('-', 140, y, { align: 'right' });
      }

      if (tx.interestApplied > 0) {
        doc.setTextColor(217, 119, 6); // Amber
        doc.text(`-${formatCurrency(tx.interestApplied)}`, 165, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.text('-', 165, y, { align: 'right' });
      }

      doc.text(formatCurrency(tx.principalBalance), 190, y, { align: 'right' });
    }

    // Summary
    y += 10;
    doc.line(15, y, 195, y);
    y += 8;

    const repaymentCount = settlementData.transactionHistory.filter(t => t.type === 'Repayment').length;

    doc.setFont(undefined, 'bold');
    doc.text(`Total Repayments: ${repaymentCount}`, 17, y);
  }

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

  doc.save(`settlement-statement-${loan.id}-${format(new Date(settlementData.settlementDate), 'yyyy-MM-dd')}.pdf`);
}
