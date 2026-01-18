/**
 * Letter Generation System
 *
 * Provides utilities for:
 * - Template placeholder substitution
 * - Letter PDF generation with letterhead
 * - PDF merging with attached reports
 * - Continuous page numbering across merged documents
 */

import jsPDF from 'jspdf';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { format, addMonths } from 'date-fns';

/**
 * Render a template by substituting placeholders with values
 * Supports {{placeholder}} syntax
 *
 * Special handling for signature placeholder:
 * - If signature_image_url is provided, renders as <img> tag
 *
 * @param {string} template - Template string with {{placeholders}}
 * @param {Object} data - Key-value pairs for substitution
 * @returns {string} - Rendered template
 */
export function renderTemplate(template, data) {
  if (!template) return '';

  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    // Special handling for signature - render as image if URL is provided
    if (key === 'signature') {
      const signatureUrl = data.signature_image_url || data.signature;
      if (signatureUrl && signatureUrl.startsWith('http')) {
        // Render as image tag for HTML/PDF rendering
        return `<img src="${signatureUrl}" alt="Signature" style="max-height: 60px; max-width: 200px;" class="signature-image" />`;
      }
      return ''; // No signature available
    }

    const value = data[key];
    if (value !== undefined && value !== null) {
      return String(value);
    }
    return match; // Keep placeholder if no value provided
  });
}

/**
 * Extract all placeholder keys from a template
 *
 * @param {string} template - Template string
 * @returns {string[]} - Array of placeholder keys
 */
export function extractPlaceholders(template) {
  if (!template) return [];

  const matches = template.match(/\{\{(\w+)\}\}/g) || [];
  return [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))];
}

/**
 * Build placeholder data object from loan context
 *
 * @param {Object} params - Parameters object
 * @param {Object} params.loan - Loan object
 * @param {Object} params.borrower - Primary borrower
 * @param {Object} params.organization - Organization
 * @param {Object} params.property - Primary security property
 * @param {Object} params.product - Loan product
 * @param {Object} params.settlementData - Optional settlement data (for future date)
 * @param {Object} params.liveSettlement - Live settlement figures (as of today)
 * @param {Object} params.userProfile - Current user profile with signature_image_url
 * @returns {Object} - Placeholder key-value pairs
 */
export function buildPlaceholderData({
  loan,
  borrower,
  organization,
  property,
  product,
  settlementData,
  interestBalance,
  liveSettlement,
  userProfile
}) {
  // Build borrower display name
  const borrowerName = borrower?.business
    || borrower?.full_name
    || (borrower?.first_name || borrower?.last_name
        ? `${borrower?.first_name || ''} ${borrower?.last_name || ''}`.trim()
        : '')
    || borrower?.name
    || '';

  const data = {
    // Borrower fields
    borrower_name: borrowerName,
    borrower_last_name: borrower?.last_name || '',
    borrower_first_name: borrower?.first_name || '',
    borrower_address: formatBorrowerAddress(borrower),

    // Loan fields
    loan_reference: loan?.loan_number || loan?.reference || '',
    loan_description: loan?.description || '',
    loan_start_date: loan?.start_date ? format(new Date(loan.start_date), 'dd MMMM yyyy') : '',
    principal_amount: formatCurrency(loan?.principal_amount),
    current_balance: formatCurrency(loan?.principal_amount), // Will be updated with actual balance
    interest_rate: loan?.interest_rate ? `${loan.interest_rate}` : '',
    maturity_date: loan?.maturity_date ? format(new Date(loan.maturity_date), 'dd MMMM yyyy') : '',
    // Original term end date (start date + original term months)
    original_term: loan?.original_term && loan?.start_date
      ? format(addMonths(new Date(loan.start_date), loan.original_term), 'dd MMMM yyyy')
      : '',
    // Current end date (start date + current duration months)
    loan_end_date: loan?.duration && loan?.start_date
      ? format(addMonths(new Date(loan.start_date), loan.duration), 'dd MMMM yyyy')
      : (loan?.end_date ? format(new Date(loan.end_date), 'dd MMMM yyyy') : ''),
    // Loan term date (original if set, else current end date)
    loan_term: loan?.original_term && loan?.start_date
      ? format(addMonths(new Date(loan.start_date), loan.original_term), 'dd MMMM yyyy')
      : (loan?.duration && loan?.start_date
          ? format(addMonths(new Date(loan.start_date), loan.duration), 'dd MMMM yyyy')
          : ''),

    // Property fields
    property_address: property?.address || '',

    // Organization fields
    company_name: organization?.name || '',
    company_address: formatOrganizationAddress(organization),

    // Date fields
    today_date: format(new Date(), 'dd MMMM yyyy'),

    // Signature - stored as image URL, rendered as image in PDF
    // The placeholder will be replaced with an <img> tag for HTML preview
    // and handled specially during PDF generation
    signature: userProfile?.signature_image_url || '',
    signature_image_url: userProfile?.signature_image_url || '',
  };

  // Add interest balance if provided
  if (interestBalance !== undefined) {
    data.current_interest = formatCurrency(interestBalance);
    data.total_outstanding = formatCurrency((loan?.principal_amount || 0) + interestBalance);
  }

  // Add settlement data if provided (for future dated settlement)
  if (settlementData) {
    data.settlement_date = settlementData.settlementDate
      ? format(new Date(settlementData.settlementDate), 'dd MMMM yyyy')
      : '';
    data.settlement_principal = formatCurrency(settlementData.principalBalance || 0);
    data.settlement_interest = formatCurrency(settlementData.interestBalance || 0);
    data.settlement_fees = formatCurrency(settlementData.feesBalance || 0);
    data.settlement_total = formatCurrency(settlementData.totalBalance || 0);
  }

  // Add live settlement figures (as of today)
  if (liveSettlement) {
    data.live_principal_balance = formatCurrency(liveSettlement.principalRemaining || 0);
    data.live_interest_balance = formatCurrency(liveSettlement.interestRemaining || 0);
    data.live_fees_balance = formatCurrency(liveSettlement.feesRemaining || 0);
    data.live_settlement_total = formatCurrency(liveSettlement.settlementTotal || 0);
  }

  // Add free text placeholders (to be filled in at merge time)
  data.free_text_1 = '[Enter at merge]';
  data.free_text_2 = '[Enter at merge]';
  data.free_text_3 = '[Enter at merge]';

  return data;
}

/**
 * Format a currency value
 */
function formatCurrency(value) {
  if (value === undefined || value === null) return '£0.00';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP'
  }).format(value);
}

/**
 * Format borrower address with each component on a separate line:
 * Address (street)
 * City
 * Postcode
 * Uses <br> tags for HTML display
 */
function formatBorrowerAddress(borrower) {
  if (!borrower) return '';

  // Borrowers use 'address' field for street address
  // and 'city', 'zipcode'/'postcode' for separate fields
  if (borrower.address) {
    // Put address, city, and postcode each on their own line
    const parts = [
      borrower.address?.trim(),
      borrower.city?.trim(),
      (borrower.zipcode || borrower.postcode)?.trim()
    ].filter(Boolean);
    return parts.join('<br>');
  }

  // Fallback to address_line1/2 format
  const parts = [
    borrower.address_line1?.trim(),
    borrower.address_line2?.trim(),
    borrower.city?.trim(),
    (borrower.zipcode || borrower.postcode)?.trim()
  ].filter(Boolean);
  return parts.join('<br>');
}

/**
 * Format organization address with each component on a separate line
 * Returns an array of address lines for PDF rendering
 */
function getOrganizationAddressLines(org) {
  if (!org) return [];
  return [
    org.address_line1,
    org.address_line2,
    org.city,
    org.postcode
  ].filter(Boolean);
}

/**
 * Format organization address as a single string (for placeholders)
 */
function formatOrganizationAddress(org) {
  return getOrganizationAddressLines(org).join(', ');
}

/**
 * Load an image from URL and convert to base64 for PDF embedding
 * @param {string} url - Image URL
 * @returns {Promise<{data: string, format: string} | null>}
 */
async function loadImageAsBase64(url) {
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const blob = await response.blob();
    const reader = new FileReader();

    return new Promise((resolve) => {
      reader.onloadend = () => {
        const base64 = reader.result;
        // Detect format from data URL
        let format = 'PNG';
        if (base64.includes('image/jpeg') || base64.includes('image/jpg')) {
          format = 'JPEG';
        }
        resolve({ data: base64, format });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error('Failed to load logo:', err);
    return null;
  }
}

/**
 * Generate a letter PDF with letterhead
 *
 * @param {Object} params - Parameters
 * @param {string} params.subject - Letter subject line
 * @param {string} params.body - Letter body content (already rendered)
 * @param {Object} params.organization - Organization for letterhead (includes logo_url)
 * @param {string} params.recipientName - Recipient name
 * @param {string} params.recipientAddress - Recipient address
 * @returns {Promise<Uint8Array>} - PDF bytes
 */
export async function generateLetterPDF({
  subject,
  body,
  organization,
  recipientName,
  recipientAddress
}) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - (margin * 2);

  let y = margin;

  // Try to load and add logo if available (positioned above company name)
  const logoImage = await loadImageAsBase64(organization?.logo_url);
  let logoHeight = 0;

  if (logoImage) {
    try {
      // Add logo on the right side, max 40mm wide x 20mm tall
      const maxLogoWidth = 40;
      const maxLogoHeight = 20;

      // Calculate actual dimensions maintaining aspect ratio
      const img = new Image();
      img.src = logoImage.data;

      doc.addImage(
        logoImage.data,
        logoImage.format,
        pageWidth - margin - maxLogoWidth, // X position (right-aligned)
        y,
        maxLogoWidth,
        maxLogoHeight, // Use fixed height for consistent positioning
        undefined,
        'FAST'
      );
      logoHeight = maxLogoHeight;
      y += logoHeight + 3; // Space between logo and company name
    } catch (err) {
      console.error('Failed to add logo to PDF:', err);
      // Continue without logo
    }
  }

  // Letterhead - Company name (right aligned, below logo)
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(organization?.name || 'Company Name', pageWidth - margin, y, { align: 'right' });
  y += 5;

  // Company address (right aligned, each part on its own line)
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const orgAddressLines = getOrganizationAddressLines(organization);
  orgAddressLines.forEach(line => {
    doc.text(line, pageWidth - margin, y, { align: 'right' });
    y += 4;
  });

  // Company contact details
  if (organization?.phone) {
    doc.text(`Tel: ${organization.phone}`, pageWidth - margin, y, { align: 'right' });
    y += 4;
  }
  if (organization?.email) {
    doc.text(`Email: ${organization.email}`, pageWidth - margin, y, { align: 'right' });
    y += 4;
  }

  y += 10;

  // Note: Date, recipient name/address, and subject line are NOT auto-generated here
  // They should be included in the template body using placeholders like:
  // {{today_date}}, {{borrower_name}}, {{borrower_address}}, etc.
  // This gives full control over formatting in the template.

  // Pre-load any images in the body (e.g., signature images)
  const imageCache = {};
  const imgMatches = body.match(/<img[^>]+src="([^"]+)"[^>]*>/g) || [];
  for (const imgTag of imgMatches) {
    const srcMatch = imgTag.match(/src="([^"]+)"/);
    if (srcMatch && srcMatch[1]) {
      const imgUrl = srcMatch[1];
      if (!imageCache[imgUrl]) {
        const imgData = await loadImageAsBase64(imgUrl);
        if (imgData) {
          imageCache[imgUrl] = imgData;
        }
      }
    }
  }

  // Body text - parse HTML content (includes all letter content from template)
  doc.setFontSize(11);
  y = renderHtmlToPdf(doc, body, margin, y, contentWidth, pageHeight, imageCache);

  // Return as ArrayBuffer
  return doc.output('arraybuffer');
}

/**
 * Render HTML content to PDF with basic formatting support
 * Supports: bold, italic, underline, headers, lists, paragraphs, images
 *
 * Paragraph spacing logic:
 * - Consecutive lines of text (each in their own <p>) render as single-spaced lines
 * - Empty paragraphs (<p><br></p>) or double-newlines create paragraph breaks
 * - Headers get extra spacing before/after
 *
 * @param {jsPDF} doc - jsPDF document
 * @param {string} html - HTML content
 * @param {number} margin - Page margin
 * @param {number} startY - Starting Y position
 * @param {number} contentWidth - Available content width
 * @param {number} pageHeight - Page height
 * @param {Object} imageCache - Pre-loaded images keyed by URL
 * @returns {number} - Final Y position
 */
function renderHtmlToPdf(doc, html, margin, startY, contentWidth, pageHeight, imageCache = {}) {
  let y = startY;
  let pendingParagraphBreak = false; // Track if we need a paragraph break before next content

  // Create a temporary DOM element to parse HTML
  const parser = new DOMParser();
  const htmlDoc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const container = htmlDoc.body.firstChild;

  // Check if a node is an empty paragraph (used for spacing)
  const isEmptyParagraph = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = node.tagName.toLowerCase();
    if (tag !== 'p' && tag !== 'div') return false;
    // Empty if no text content, or only contains <br>
    const text = node.textContent?.trim();
    if (!text) return true;
    // Check if it only contains whitespace
    return text.length === 0;
  };

  const processNode = (node, styles = { bold: false, italic: false, underline: false }) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (!text.trim()) return;

      // If there's a pending paragraph break, add it now before content
      if (pendingParagraphBreak) {
        y += 5; // Paragraph break spacing
        pendingParagraphBreak = false;
      }

      // Apply font styles
      let fontStyle = 'normal';
      if (styles.bold && styles.italic) {
        fontStyle = 'bolditalic';
      } else if (styles.bold) {
        fontStyle = 'bold';
      } else if (styles.italic) {
        fontStyle = 'italic';
      }
      doc.setFont('helvetica', fontStyle);

      const lines = doc.splitTextToSize(text, contentWidth);
      for (const line of lines) {
        if (y > pageHeight - 30) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        if (styles.underline) {
          const textWidth = doc.getTextWidth(line);
          doc.line(margin, y + 1, margin + textWidth, y + 1);
        }
        y += 5;
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tagName = node.tagName.toLowerCase();
    const newStyles = { ...styles };

    // Check if this is an empty paragraph (creates paragraph break)
    if (isEmptyParagraph(node)) {
      pendingParagraphBreak = true;
      return;
    }

    const hasContent = node.textContent?.trim().length > 0;

    // Handle different HTML elements
    switch (tagName) {
      case 'strong':
      case 'b':
        newStyles.bold = true;
        break;
      case 'em':
      case 'i':
        newStyles.italic = true;
        break;
      case 'u':
        newStyles.underline = true;
        break;
      case 'h1':
        if (y > startY) y += 6; // Extra space before header
        if (pendingParagraphBreak) pendingParagraphBreak = false;
        doc.setFontSize(18);
        newStyles.bold = true;
        break;
      case 'h2':
        if (y > startY) y += 5;
        if (pendingParagraphBreak) pendingParagraphBreak = false;
        doc.setFontSize(16);
        newStyles.bold = true;
        break;
      case 'h3':
        if (y > startY) y += 4;
        if (pendingParagraphBreak) pendingParagraphBreak = false;
        doc.setFontSize(14);
        newStyles.bold = true;
        break;
      case 'p':
      case 'div':
        // Paragraphs with content just flow as lines - no extra spacing
        // Spacing only comes from empty paragraphs (handled above)
        break;
      case 'br':
        // <br> tags don't need to advance y since each text segment already advances y after rendering
        // The <br> just acts as a separator between text nodes, but the line spacing is handled by text output
        // We only ignore trailing <br> tags (added by ReactQuill) to prevent extra spacing
        // For non-trailing <br>, we still don't advance y - the text after it will render on the current y
        return;
      case 'img':
        // Handle image elements (e.g., signature images)
        const imgSrc = node.getAttribute('src');
        if (imgSrc && imageCache[imgSrc]) {
          if (pendingParagraphBreak) {
            y += 5;
            pendingParagraphBreak = false;
          }
          // Check for page break
          const imgHeight = 15; // Default image height in mm (about 60px)
          if (y + imgHeight > pageHeight - 30) {
            doc.addPage();
            y = margin;
          }
          try {
            const imgData = imageCache[imgSrc];
            // Signature images: max 50mm wide, 15mm tall
            doc.addImage(
              imgData.data,
              imgData.format,
              margin,
              y,
              50, // max width
              imgHeight,
              undefined,
              'FAST'
            );
            y += imgHeight + 3; // Space after image
          } catch (err) {
            console.error('Failed to add image to PDF:', err);
          }
        }
        return;
      case 'ul':
      case 'ol':
        if (pendingParagraphBreak) {
          y += 5;
          pendingParagraphBreak = false;
        }
        break;
      case 'li':
        // Add bullet point or number
        if (pendingParagraphBreak) {
          y += 5;
          pendingParagraphBreak = false;
        }
        if (y > pageHeight - 30) {
          doc.addPage();
          y = margin;
        }
        const listParent = node.parentElement?.tagName.toLowerCase();
        const bullet = listParent === 'ol'
          ? `${Array.from(node.parentElement.children).indexOf(node) + 1}. `
          : '• ';
        doc.setFont('helvetica', 'normal');
        doc.text(bullet, margin, y);
        // Process children with indent
        const indent = 8;
        for (const child of node.childNodes) {
          const childText = child.textContent?.trim();
          if (childText) {
            const lines = doc.splitTextToSize(childText, contentWidth - indent);
            for (let i = 0; i < lines.length; i++) {
              if (y > pageHeight - 30) {
                doc.addPage();
                y = margin;
              }
              doc.text(lines[i], margin + indent, y);
              y += 5;
            }
          }
        }
        return; // Already processed children
    }

    // Process child nodes
    for (const child of node.childNodes) {
      processNode(child, newStyles);
    }

    // Reset font size after headers and add spacing after
    if (['h1', 'h2', 'h3'].includes(tagName)) {
      doc.setFontSize(11);
      y += 2; // Small spacing after header
    }
  };

  // Process all child nodes
  for (const child of container.childNodes) {
    processNode(child, { bold: false, italic: false, underline: false });
  }

  // Reset font
  doc.setFont('helvetica', 'normal');

  return y;
}

/**
 * Merge multiple PDFs into one and apply continuous page numbering
 *
 * @param {Uint8Array[]} pdfBytesArray - Array of PDF byte arrays to merge
 * @param {Object} options - Options
 * @param {boolean} options.addPageNumbers - Whether to add page numbers (default: true)
 * @param {string} options.pageNumberFormat - Format: 'Page X of Y' (default)
 * @returns {Promise<Uint8Array>} - Merged PDF bytes
 */
export async function mergePDFs(pdfBytesArray, options = {}) {
  const { addPageNumbers = true } = options;

  if (!pdfBytesArray || pdfBytesArray.length === 0) {
    throw new Error('No PDFs to merge');
  }

  // If only one PDF, just add page numbers if requested
  if (pdfBytesArray.length === 1) {
    if (addPageNumbers) {
      return addPageNumbersToPDF(pdfBytesArray[0]);
    }
    return pdfBytesArray[0];
  }

  const mergedPdf = await PDFDocument.create();

  for (const pdfBytes of pdfBytesArray) {
    try {
      const pdf = await PDFDocument.load(pdfBytes);
      const pageIndices = pdf.getPageIndices();
      const copiedPages = await mergedPdf.copyPages(pdf, pageIndices);
      copiedPages.forEach(page => mergedPdf.addPage(page));
    } catch (err) {
      console.error('Error loading PDF for merge:', err);
      // Skip this PDF if it fails to load
    }
  }

  if (addPageNumbers) {
    await applyPageNumbers(mergedPdf);
  }

  return mergedPdf.save();
}

/**
 * Add page numbers to an existing PDF
 *
 * @param {Uint8Array} pdfBytes - PDF bytes
 * @returns {Promise<Uint8Array>} - PDF with page numbers
 */
async function addPageNumbersToPDF(pdfBytes) {
  const pdf = await PDFDocument.load(pdfBytes);
  await applyPageNumbers(pdf);
  return pdf.save();
}

/**
 * Apply page numbers to a PDFDocument
 *
 * @param {PDFDocument} pdf - pdf-lib PDFDocument
 */
async function applyPageNumbers(pdf) {
  const pages = pdf.getPages();
  const totalPages = pages.length;
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < totalPages; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();
    const text = `Page ${i + 1} of ${totalPages}`;
    const textWidth = font.widthOfTextAtSize(text, 10);

    page.drawText(text, {
      x: (width - textWidth) / 2,
      y: 15,
      size: 10,
      font,
      color: rgb(0.4, 0.4, 0.4)
    });
  }
}

/**
 * Available report types that can be attached to letters
 */
export const ATTACHABLE_REPORTS = [
  {
    key: 'loan_statement',
    name: 'Loan Statement',
    description: 'Full transaction history and balances',
    requiresInput: false
  },
  {
    key: 'settlement_statement',
    name: 'Settlement Statement',
    description: 'Settlement figures for a specific date',
    requiresInput: true,
    inputType: 'date',
    inputLabel: 'Settlement Date',
    inputKey: 'settlementDate'
  },
  {
    key: 'interest_schedule',
    name: 'Interest Schedule',
    description: 'Interest calculation schedule',
    requiresInput: false
  }
];

/**
 * Get report configuration by key
 */
export function getReportConfig(key) {
  return ATTACHABLE_REPORTS.find(r => r.key === key);
}

/**
 * Download a PDF file to the user's device
 *
 * @param {Uint8Array} pdfBytes - PDF bytes
 * @param {string} filename - Filename for download
 */
export function downloadPDF(pdfBytes, filename) {
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Convert PDF bytes to data URL for preview
 *
 * @param {Uint8Array} pdfBytes - PDF bytes
 * @returns {string} - Data URL
 */
export function pdfToDataUrl(pdfBytes) {
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  return URL.createObjectURL(blob);
}
