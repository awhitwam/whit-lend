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
  let y = 20;

  // Header
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text('SETTLEMENT STATEMENT', pageWidth / 2, y, { align: 'center' });
  
  y += 15;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Settlement Date: ${format(new Date(settlementData.settlementDate), 'MMM dd, yyyy')}`, pageWidth / 2, y, { align: 'center' });
  y += 6;
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
  
  // Settlement Breakdown
  y += 12;
  doc.setFontSize(14);
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
  
  // Interest Breakdown
  if (settlementData.dailyBreakdown && settlementData.dailyBreakdown.length > 0) {
    y += 15;
    doc.setFontSize(14);
    doc.text('Daily Interest Breakdown', 15, y);
    
    y += 8;
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text('Date', 15, y);
    doc.text('Daily Interest', 120, y, { align: 'right' });
    doc.text('Balance', 160, y, { align: 'right' });
    
    y += 2;
    doc.line(15, y, 195, y);
    
    doc.setFont(undefined, 'normal');
    settlementData.dailyBreakdown.forEach((day) => {
      y += 6;
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(format(new Date(day.date), 'MMM dd, yyyy'), 15, y);
      doc.text(formatCurrency(day.interest), 120, y, { align: 'right' });
      doc.text(formatCurrency(day.balance), 160, y, { align: 'right' });
    });
  }
  
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
  
  doc.save(`settlement-statement-${loan.id}-${format(new Date(settlementData.settlementDate), 'yyyy-MM-dd')}.pdf`);
}