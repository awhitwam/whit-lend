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

  // Table layout - widths in mm across the 277mm usable width of a landscape page.
  // Positions are derived from the widths so the layout is tuned in one place.
  const columns = [
    { key: 'date', header: 'Date', width: 16 },
    { key: 'bankReference', header: 'Bank Ref', width: 22 },
    { key: 'description', header: 'Description', width: 38 },
    { key: 'amount', header: 'Amount', width: 21 },
    { key: 'allocated', header: 'Allocated', width: 21 },
    { key: 'type', header: 'Type', width: 12 },
    { key: 'reconciledTo', header: 'Reconciled To', width: 26 },
    { key: 'entityDetails', header: 'Entity Details', width: 32 },
    { key: 'borrowerId', header: 'Borrower ID', width: 16 },
    { key: 'principal', header: 'Principal', width: 18 },
    { key: 'interest', header: 'Interest', width: 18 },
    { key: 'fees', header: 'Fees', width: 16 },
    { key: 'notes', header: 'Reason', width: 18 }
  ];

  const colX = [];
  columns.reduce((x, col) => {
    colX.push(x);
    return x + col.width;
  }, 10);

  // Roughly how many characters fit in a column at the given font size
  const fitChars = (width, fontSize) => Math.max(1, Math.floor(width / (fontSize * 0.19)));
  const clip = (value, i, fontSize) => String(value ?? '-').substring(0, fitChars(columns[i].width, fontSize));

  doc.setFillColor(240, 240, 240);
  doc.rect(10, y - 4, pageWidth - 20, 8, 'F');
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');

  columns.forEach((col, i) => {
    doc.text(clip(col.header, i, 7), colX[i], y);
  });

  y += 8;
  doc.setDrawColor(180, 180, 180);
  doc.line(10, y - 4, pageWidth - 10, y - 4);

  // Table Rows
  doc.setFont(undefined, 'normal');
  doc.setFontSize(7);

  data.forEach((row, index) => {
    checkPageBreak(12);

    // Alternate row background
    if (index % 2 === 0) {
      doc.setFillColor(250, 250, 250);
      doc.rect(10, y - 4, pageWidth - 20, 10, 'F');
    }

    // Date - stated once per bank entry
    doc.text(row.isContinuation ? '' : (row.date ? format(new Date(row.date), 'dd/MM/yyyy') : '-'), colX[0], y);

    // Bank Reference - repeated on every line so a split block stays traceable
    doc.text(clip(row.bankReference || '-', 1, 7), colX[1], y);

    // Description - allocations after the first are indented under their bank entry
    const desc = row.isContinuation ? `  > ${row.description || ''}` : (row.description || '-');
    doc.text(clip(desc, 2, 7), colX[2], y);

    // Amount - the bank movement, on the entry's first line only
    if (row.amount === null || row.amount === undefined) {
      doc.setTextColor(150, 150, 150);
      doc.text('-', colX[3], y);
    } else {
      doc.setTextColor(row.amount >= 0 ? 0 : 180, row.amount >= 0 ? 128 : 0, 0);
      doc.text(formatCurrency(Math.abs(row.amount)), colX[3], y);
    }
    doc.setTextColor(0, 0, 0);

    // Allocated - what this line was assigned to
    doc.text(
      row.allocatedAmount === null || row.allocatedAmount === undefined
        ? '-'
        : formatCurrency(Math.abs(row.allocatedAmount)),
      colX[4],
      y
    );

    // Type (Credit/Debit)
    doc.text(row.type || '', colX[5], y);

    // Reconciled To
    const reconTo = row.isReconciled ? (row.reconciledTo || 'Yes') : 'Not recon';
    if (!row.isReconciled) {
      doc.setTextColor(200, 100, 100);
    }
    doc.text(clip(reconTo, 6, 7), colX[6], y);
    doc.setTextColor(0, 0, 0);

    // Entity Details
    doc.text(clip(row.entityDetails || '-', 7, 7), colX[7], y);

    // Borrower ID
    doc.text(clip(row.borrowerId || '-', 8, 7), colX[8], y);

    // Principal
    doc.text(row.principalAmount !== null ? formatCurrency(row.principalAmount) : '-', colX[9], y);

    // Interest
    doc.text(row.interestAmount !== null ? formatCurrency(row.interestAmount) : '-', colX[10], y);

    // Fees
    doc.text(row.feesAmount !== null && row.feesAmount > 0 ? formatCurrency(row.feesAmount) : '-', colX[11], y);

    // Notes/Reason
    doc.text(clip(row.notes || '-', 12, 7), colX[12], y);

    y += 10;
  });

  // Summary Section
  checkPageBreak(62);
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

  // A bank entry split across several transactions produces one line per allocation. Only the
  // entry's first line carries the bank movement, so credits/debits sum those lines while the
  // allocated total sums every line.
  const entryLines = data.filter(r => r.isFirstLine !== false);
  const totalCredits = entryLines.filter(r => r.amount > 0).reduce((sum, r) => sum + r.amount, 0);
  const totalDebits = entryLines.filter(r => r.amount < 0).reduce((sum, r) => sum + Math.abs(r.amount), 0);
  const netMovement = totalCredits - totalDebits;
  const totalAllocated = data.reduce((sum, r) => sum + (r.allocatedAmount || 0), 0);
  const bankEntryCount = new Set(data.map(r => r.bankEntryId ?? r.id)).size;
  const reconciledCount = new Set(data.filter(r => r.isReconciled).map(r => r.bankEntryId ?? r.id)).size;
  const reconciledPercent = bankEntryCount > 0 ? Math.round((reconciledCount / bankEntryCount) * 100) : 0;

  doc.text(`Total Transactions: ${bankEntryCount}`, 10, y);
  y += 6;
  doc.text(`Total Credits: ${formatCurrency(totalCredits)}`, 10, y);
  y += 6;
  doc.text(`Total Debits: ${formatCurrency(totalDebits)}`, 10, y);
  y += 6;
  doc.text(`Net Movement: ${formatCurrency(netMovement)}`, 10, y);
  y += 6;
  doc.text(`Total Allocated: ${formatCurrency(totalAllocated)}`, 10, y);
  y += 6;
  doc.text(`Unallocated: ${formatCurrency(netMovement - totalAllocated)}`, 10, y);
  y += 6;
  doc.text(`Reconciled: ${reconciledCount} of ${bankEntryCount} (${reconciledPercent}%)`, 10, y);

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
    'Bank Reference',
    'Description',
    'Amount',
    'Allocated',
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
    // Date and Amount belong to the bank entry and are stated once, on its first line.
    // Bank Reference is repeated on every line so split blocks group and filter in Excel.
    row.isContinuation ? '' : (row.date ? format(new Date(row.date), 'dd/MM/yyyy') : ''),
    escapeCSV(row.bankReference),
    escapeCSV(row.isContinuation ? `    ↳ ${row.description || ''}` : row.description),
    row.amount !== null && row.amount !== undefined ? row.amount.toFixed(2) : '',
    row.allocatedAmount !== null && row.allocatedAmount !== undefined ? row.allocatedAmount.toFixed(2) : '',
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
