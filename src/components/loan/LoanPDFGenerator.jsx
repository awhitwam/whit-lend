
import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { formatCurrency } from './LoanCalculator';

export function generateLoanStatementPDF(loan, schedule, transactions) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 20;

  // Header
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text('LOAN STATEMENT', pageWidth / 2, y, { align: 'center' });
  
  y += 15;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Generated: ${format(new Date(), 'MMM dd, yyyy HH:mm')}`, pageWidth / 2, y, { align: 'center' });
  
  // Borrower Info
  y += 15;
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('Borrower Information', 15, y);
  
  y += 8;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Name: ${loan.borrower_name}`, 15, y);
  y += 6;
  doc.text(`Loan ID: ${loan.id}`, 15, y);
  
  // Loan Details
  y += 12;
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('Loan Details', 15, y);
  
  y += 8;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Product: ${loan.product_name}`, 15, y);
  y += 6;
  doc.text(`Principal: ${formatCurrency(loan.principal_amount)}`, 15, y);
  y += 6;
  doc.text(`Interest Rate: ${loan.interest_rate}% (${loan.interest_type})`, 15, y);
  y += 6;
  doc.text(`Duration: ${loan.duration} ${loan.period === 'Monthly' ? 'months' : 'weeks'}`, 15, y);
  y += 6;
  doc.text(`Start Date: ${format(new Date(loan.start_date), 'MMM dd, yyyy')}`, 15, y);
  y += 6;
  doc.text(`Status: ${loan.status}`, 15, y);
  
  if (loan.arrangement_fee > 0 || loan.exit_fee > 0) {
    y += 6;
    if (loan.arrangement_fee > 0) {
      doc.text(`Arrangement Fee: ${formatCurrency(loan.arrangement_fee)}`, 15, y);
      y += 6;
    }
    if (loan.exit_fee > 0) {
      doc.text(`Exit Fee: ${formatCurrency(loan.exit_fee)}`, 15, y);
      y += 6;
    }
  }
  
  // Financial Summary
  y += 8;
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('Financial Summary', 15, y);
  
  y += 8;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Total Interest: ${formatCurrency(loan.total_interest)}`, 15, y);
  y += 6;
  doc.text(`Total Repayable: ${formatCurrency(loan.total_repayable)}`, 15, y);
  y += 6;
  doc.text(`Amount Paid: ${formatCurrency((loan.principal_paid || 0) + (loan.interest_paid || 0))}`, 15, y);
  y += 6;
  const outstanding = (loan.principal_amount - (loan.principal_paid || 0)) + (loan.total_interest - (loan.interest_paid || 0));
  doc.text(`Outstanding: ${formatCurrency(outstanding)}`, 15, y);
  
  // Repayment Schedule
  if (schedule && schedule.length > 0) {
    y += 12;
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('Repayment Schedule', 15, y);
    
    y += 8;
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text('#', 15, y);
    doc.text('Due Date', 30, y);
    doc.text('Interest', 80, y, { align: 'right' });
    doc.text('Total Due', 120, y, { align: 'right' });
    doc.text('Paid', 160, y, { align: 'right' });
    doc.text('Status', 185, y);
    
    y += 2;
    doc.line(15, y, 195, y);
    
    doc.setFont(undefined, 'normal');
    schedule.slice(0, 25).forEach((row) => {
      y += 6;
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(String(row.installment_number), 15, y);
      doc.text(format(new Date(row.due_date), 'MMM dd, yyyy'), 30, y);
      doc.text(formatCurrency(row.interest_amount), 80, y, { align: 'right' });
      doc.text(formatCurrency(row.total_due), 120, y, { align: 'right' });
      doc.text(formatCurrency((row.principal_paid || 0) + (row.interest_paid || 0)), 160, y, { align: 'right' });
      doc.text(row.status, 185, y);
    });
  }
  
  // Transactions
  if (transactions && transactions.filter(t => !t.is_deleted).length > 0) {
    const activeTransactions = transactions.filter(t => !t.is_deleted);
    y += 12;
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('Transaction History', 15, y);
    
    y += 8;
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text('Date', 15, y);
    doc.text('Type', 60, y);
    doc.text('Amount', 120, y, { align: 'right' });
    doc.text('Reference', 160, y);
    
    y += 2;
    doc.line(15, y, 195, y);
    
    doc.setFont(undefined, 'normal');
    activeTransactions.slice(0, 20).forEach((tx) => {
      y += 6;
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(format(new Date(tx.date), 'MMM dd, yyyy'), 15, y);
      doc.text(tx.type, 60, y);
      doc.text(formatCurrency(tx.amount), 120, y, { align: 'right' });
      doc.text(tx.reference || '-', 160, y);
    });
  }
  
  // Footer
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, 290, { align: 'center' });
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
