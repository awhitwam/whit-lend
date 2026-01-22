import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';

/**
 * Generate Accountant Report PDF
 * Lists all bank transactions with associated reconciliation details
 */
export function generateAccountantReportPDF(data, options = {}) {
  const { fromDate, toDate, organization } = options;
  const doc = new jsPDF('landscape');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 15;

  // Helper to add page footer
  const addFooter = (pageNum, totalPages) => {
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(128, 128, 128);
    doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    doc.text(`Generated: ${format(new Date(), 'dd MMM yyyy HH:mm')}`, pageWidth - 15, pageHeight - 10, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  };

  // Helper to check page break
  const checkPageBreak = (requiredSpace = 20) => {
    if (y > pageHeight - 25 - requiredSpace) {
      doc.addPage();
      y = 15;
      return true;
    }
    return false;
  };

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

    y += 2;
    doc.setDrawColor(200, 200, 200);
    doc.line(40, y, pageWidth - 40, y);
    y += 8;
  }

  // Report Title
  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  doc.text('ACCOUNTANT REPORT', pageWidth / 2, y, { align: 'center' });
  y += 8;

  // Date Range
  doc.setFontSize(11);
  doc.setFont(undefined, 'normal');
  const dateRangeText = `Period: ${format(new Date(fromDate), 'dd MMM yyyy')} to ${format(new Date(toDate), 'dd MMM yyyy')}`;
  doc.text(dateRangeText, pageWidth / 2, y, { align: 'center' });
  y += 12;

  // Table Header - landscape mode gives us more width
  const colX = [10, 28, 80, 102, 118, 155, 185, 210, 235, 260, 280];
  const headers = ['Date', 'Description', 'Amount', 'Type', 'Reconciled To', 'Entity Details', 'Borrower ID', 'Principal', 'Interest', 'Fees', 'Reason'];

  doc.setFillColor(240, 240, 240);
  doc.rect(10, y - 4, pageWidth - 20, 8, 'F');
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');

  headers.forEach((header, i) => {
    doc.text(header, colX[i], y);
  });

  y += 8;
  doc.setDrawColor(180, 180, 180);
  doc.line(10, y - 4, pageWidth - 10, y - 4);

  // Table Rows
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8);

  data.forEach((row, index) => {
    checkPageBreak(12);

    // Alternate row background
    if (index % 2 === 0) {
      doc.setFillColor(250, 250, 250);
      doc.rect(10, y - 4, pageWidth - 20, 10, 'F');
    }

    // Date
    doc.text(row.date ? format(new Date(row.date), 'dd/MM/yyyy') : '-', colX[0], y);

    // Description (truncate if too long)
    const desc = (row.description || '-').substring(0, 32);
    doc.text(desc, colX[1], y);

    // Amount
    const amountText = formatCurrency(Math.abs(row.amount));
    doc.setTextColor(row.amount >= 0 ? 0 : 180, row.amount >= 0 ? 128 : 0, 0);
    doc.text(amountText, colX[2], y);
    doc.setTextColor(0, 0, 0);

    // Type (Credit/Debit)
    doc.text(row.type || '-', colX[3], y);

    // Reconciled To
    const reconTo = row.isReconciled ? (row.reconciledTo || 'Yes') : 'Not recon';
    if (!row.isReconciled) {
      doc.setTextColor(200, 100, 100);
    }
    doc.text(reconTo.substring(0, 18), colX[4], y);
    doc.setTextColor(0, 0, 0);

    // Entity Details
    doc.text((row.entityDetails || '-').substring(0, 20), colX[5], y);

    // Borrower ID
    doc.text(row.borrowerId || '-', colX[6], y);

    // Principal
    doc.text(row.principalAmount !== null ? formatCurrency(row.principalAmount) : '-', colX[7], y);

    // Interest
    doc.text(row.interestAmount !== null ? formatCurrency(row.interestAmount) : '-', colX[8], y);

    // Fees
    doc.text(row.feesAmount !== null && row.feesAmount > 0 ? formatCurrency(row.feesAmount) : '-', colX[9], y);

    // Notes/Reason
    const notes = (row.notes || '-').substring(0, 16);
    doc.text(notes, colX[10], y);

    y += 10;
  });

  // Summary Section
  checkPageBreak(50);
  y += 10;
  doc.setDrawColor(180, 180, 180);
  doc.line(10, y, pageWidth - 10, y);
  y += 8;

  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Summary', 10, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');

  const totalCredits = data.filter(r => r.amount > 0).reduce((sum, r) => sum + r.amount, 0);
  const totalDebits = data.filter(r => r.amount < 0).reduce((sum, r) => sum + Math.abs(r.amount), 0);
  const netMovement = totalCredits - totalDebits;
  const reconciledCount = data.filter(r => r.isReconciled).length;
  const reconciledPercent = data.length > 0 ? Math.round((reconciledCount / data.length) * 100) : 0;

  doc.text(`Total Transactions: ${data.length}`, 10, y);
  y += 6;
  doc.text(`Total Credits: ${formatCurrency(totalCredits)}`, 10, y);
  y += 6;
  doc.text(`Total Debits: ${formatCurrency(totalDebits)}`, 10, y);
  y += 6;
  doc.text(`Net Movement: ${formatCurrency(netMovement)}`, 10, y);
  y += 6;
  doc.text(`Reconciled: ${reconciledCount} of ${data.length} (${reconciledPercent}%)`, 10, y);

  // Add page numbers
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addFooter(i, totalPages);
  }

  // Save the PDF
  const fileName = `accountant-report-${format(new Date(fromDate), 'yyyyMMdd')}-${format(new Date(toDate), 'yyyyMMdd')}.pdf`;
  doc.save(fileName);
}

/**
 * Generate Accountant Report CSV
 */
export function generateAccountantReportCSV(data, options = {}) {
  const { fromDate, toDate } = options;

  const headers = [
    'Date',
    'Description',
    'Amount',
    'Type',
    'Reconciled',
    'Reconciled To',
    'Entity Details',
    'Borrower ID',
    'Principal',
    'Interest',
    'Fees',
    'Unreconcilable Reason'
  ];

  // Helper to escape CSV values
  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = data.map(row => [
    row.date ? format(new Date(row.date), 'dd/MM/yyyy') : '',
    escapeCSV(row.description),
    row.amount?.toFixed(2) || '0.00',
    row.type || '',
    row.isReconciled ? 'Yes' : 'No',
    escapeCSV(row.reconciledTo),
    escapeCSV(row.entityDetails),
    escapeCSV(row.borrowerId),
    row.principalAmount !== null ? row.principalAmount.toFixed(2) : '',
    row.interestAmount !== null ? row.interestAmount.toFixed(2) : '',
    row.feesAmount !== null && row.feesAmount > 0 ? row.feesAmount.toFixed(2) : '',
    escapeCSV(row.notes)
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');

  // Create and download the file
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `accountant-report-${format(new Date(fromDate), 'yyyyMMdd')}-${format(new Date(toDate), 'yyyyMMdd')}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
