import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';

/**
 * Generate Accountant Report PDF
 * Lists all bank transactions with associated reconciliation details
 */
export function generateAccountantReportPDF(data, options = {}) {
  const { fromDate, toDate, organization, sortOrder = 'desc' } = options;
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

  // Lowest y a row may occupy before it would collide with the footer
  const bottomLimit = pageHeight - 16;

  // Helper to check page break
  const checkPageBreak = (requiredSpace = 20) => {
    if (y + requiredSpace > bottomLimit) {
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
  // The rows arrive pre-sorted; state the direction so the reader knows the listing is complete
  // rather than an arbitrary slice
  const orderText = sortOrder === 'asc' ? 'oldest first' : 'newest first';
  const dateRangeText = `Period: ${format(new Date(fromDate), 'dd MMM yyyy')} to ${format(new Date(toDate), 'dd MMM yyyy')} (${orderText})`;
  doc.text(dateRangeText, pageWidth / 2, y, { align: 'center' });
  y += 12;

  // Table layout - widths in mm, summing to the 281mm usable width of a landscape A4 page.
  // Positions are derived from the widths so the layout is tuned in one place.
  const MARGIN = 8;
  const CELL_PAD = 1.5;
  const LINE_HEIGHT = 3.2;
  const ROW_PAD = 1.6;
  const BODY_FONT = 7;
  // Free-text columns wrap to as many lines as their content needs - an accountant reconciles
  // against these values, so dropping characters is worse than a taller row. The cap is only a
  // backstop against pathological data; 10 lines still leaves a row shorter than a page.
  const MAX_LINES = 10;

  const columns = [
    { key: 'date', header: 'Date', width: 16 },
    { key: 'bankReference', header: 'Bank Ref', width: 24 },
    { key: 'description', header: 'Description', width: 42 },
    { key: 'amount', header: 'Amount', width: 19, align: 'right' },
    { key: 'allocated', header: 'Allocated', width: 19, align: 'right' },
    { key: 'type', header: 'Type', width: 11 },
    { key: 'reconciledTo', header: 'Reconciled To', width: 26 },
    { key: 'entityDetails', header: 'Entity Details', width: 34 },
    { key: 'borrowerId', header: 'Borrower ID', width: 15 },
    { key: 'principal', header: 'Principal', width: 18, align: 'right' },
    { key: 'interest', header: 'Interest', width: 18, align: 'right' },
    { key: 'fees', header: 'Fees', width: 15, align: 'right' },
    { key: 'notes', header: 'Reason', width: 24 }
  ];

  const tableWidth = columns.reduce((sum, col) => sum + col.width, 0);
  const colX = [];
  columns.reduce((x, col) => {
    colX.push(x);
    return x + col.width;
  }, MARGIN);

  // Break a value into lines that actually fit the column at the current font. Widths are measured
  // rather than estimated from a character count - the old estimate under-counted capitals, so
  // upper-case bank descriptions ran into the neighbouring column.
  const wrapText = (value, maxWidth, maxLines = MAX_LINES) => {
    const text = String(value ?? '-').replace(/\s+/g, ' ').trim();
    if (!text) return [''];

    const lines = [];
    let current = '';

    for (const word of text.split(' ')) {
      const candidate = current ? `${current} ${word}` : word;
      if (doc.getTextWidth(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      // A single token wider than the column - bank references have no spaces - is hard-broken
      let rest = word;
      while (doc.getTextWidth(rest) > maxWidth) {
        let cut = rest.length;
        while (cut > 1 && doc.getTextWidth(rest.substring(0, cut)) > maxWidth) cut--;
        lines.push(rest.substring(0, cut));
        rest = rest.substring(cut);
      }
      current = rest;
    }
    if (current) lines.push(current);

    if (lines.length <= maxLines) return lines;

    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && doc.getTextWidth(`${last}...`) > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}...`;
    return kept;
  };

  // Lay out one row: wrap every cell, then size the row to its tallest cell
  const layoutRow = (cells) => {
    const wrapped = cells.map((cell, i) => {
      const indent = cell.indent || 0;
      return wrapText(cell.text, columns[i].width - CELL_PAD * 2 - indent, cell.maxLines || MAX_LINES);
    });
    const lineCount = Math.max(...wrapped.map(w => w.length));
    return { wrapped, height: lineCount * LINE_HEIGHT + ROW_PAD * 2 };
  };

  const drawCells = (cells, wrapped, rowY) => {
    cells.forEach((cell, i) => {
      const col = columns[i];
      const indent = cell.indent || 0;
      const alignRight = col.align === 'right';
      const x = alignRight ? colX[i] + col.width - CELL_PAD : colX[i] + CELL_PAD + indent;
      const colour = cell.colour || [0, 0, 0];
      doc.setTextColor(colour[0], colour[1], colour[2]);
      wrapped[i].forEach((line, li) => {
        doc.text(line, x, rowY + ROW_PAD + 2.4 + li * LINE_HEIGHT, alignRight ? { align: 'right' } : undefined);
      });
    });
    doc.setTextColor(0, 0, 0);
  };

  // Header is redrawn at the top of every page so a multi-page report stays readable
  const drawTableHeader = () => {
    doc.setFontSize(BODY_FONT);
    doc.setFont(undefined, 'bold');
    const cells = columns.map(col => ({ text: col.header, maxLines: 2 }));
    const { wrapped, height } = layoutRow(cells);
    doc.setFillColor(240, 240, 240);
    doc.rect(MARGIN, y, tableWidth, height, 'F');
    drawCells(cells, wrapped, y);
    y += height;
    doc.setDrawColor(180, 180, 180);
    doc.line(MARGIN, y, MARGIN + tableWidth, y);
    doc.setFont(undefined, 'normal');
  };

  drawTableHeader();

  // Table Rows
  doc.setFont(undefined, 'normal');
  doc.setFontSize(BODY_FONT);

  data.forEach((row, index) => {
    const reconTo = row.isReconciled ? (row.reconciledTo || 'Yes') : 'Not reconciled';

    const cells = [
      // Date - stated once per bank entry
      { text: row.isContinuation ? '' : (row.date ? format(new Date(row.date), 'dd/MM/yyyy') : '-'), maxLines: 1 },
      // Bank Reference - repeated on every line so a split block stays traceable
      { text: row.bankReference || '-' },
      // Description - allocations after the first are indented under their bank entry
      {
        text: row.isContinuation ? `> ${row.description || ''}` : (row.description || '-'),
        indent: row.isContinuation ? 3 : 0,
        colour: row.isContinuation ? [90, 90, 90] : [0, 0, 0]
      },
      // Amount - the bank movement, on the entry's first line only
      row.amount === null || row.amount === undefined
        ? { text: '-', colour: [150, 150, 150], maxLines: 1 }
        : { text: formatCurrency(Math.abs(row.amount)), colour: row.amount >= 0 ? [0, 128, 0] : [180, 0, 0], maxLines: 1 },
      // Allocated - what this line was assigned to
      {
        text: row.allocatedAmount === null || row.allocatedAmount === undefined
          ? '-'
          : formatCurrency(Math.abs(row.allocatedAmount)),
        maxLines: 1
      },
      { text: row.type || '', maxLines: 1 },
      { text: reconTo, colour: row.isReconciled ? [0, 0, 0] : [200, 100, 100] },
      { text: row.entityDetails || '-' },
      { text: row.borrowerId || '-' },
      { text: row.principalAmount !== null ? formatCurrency(row.principalAmount) : '-', maxLines: 1 },
      { text: row.interestAmount !== null ? formatCurrency(row.interestAmount) : '-', maxLines: 1 },
      { text: row.feesAmount !== null && row.feesAmount > 0 ? formatCurrency(row.feesAmount) : '-', maxLines: 1 },
      { text: row.notes || '-' }
    ];

    const { wrapped, height } = layoutRow(cells);

    if (y + height > bottomLimit) {
      doc.addPage();
      y = 15;
      drawTableHeader();
      doc.setFont(undefined, 'normal');
      doc.setFontSize(BODY_FONT);
    }

    // Alternate row background
    if (index % 2 === 0) {
      doc.setFillColor(248, 248, 248);
      doc.rect(MARGIN, y, tableWidth, height, 'F');
    }

    drawCells(cells, wrapped, y);
    y += height;
  });

  doc.setDrawColor(180, 180, 180);
  doc.line(MARGIN, y, MARGIN + tableWidth, y);

  // Summary Section
  y += 10;
  checkPageBreak(62);
  doc.setDrawColor(180, 180, 180);
  doc.line(MARGIN, y, MARGIN + tableWidth, y);
  y += 8;

  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Summary', MARGIN, y);
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

  const summaryLines = [
    `Total Transactions: ${bankEntryCount}`,
    `Total Credits: ${formatCurrency(totalCredits)}`,
    `Total Debits: ${formatCurrency(totalDebits)}`,
    `Net Movement: ${formatCurrency(netMovement)}`,
    `Total Allocated: ${formatCurrency(totalAllocated)}`,
    `Unallocated: ${formatCurrency(netMovement - totalAllocated)}`,
    `Reconciled: ${reconciledCount} of ${bankEntryCount} (${reconciledPercent}%)`
  ];

  summaryLines.forEach(line => {
    doc.text(line, MARGIN, y);
    y += 6;
  });

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
