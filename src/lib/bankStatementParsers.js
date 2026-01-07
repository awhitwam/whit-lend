/**
 * Bank Statement Parsers
 *
 * Each parser handles a specific bank's CSV format and normalizes
 * the data for import into the bank_statements table.
 */

import { parse, format } from 'date-fns';

/**
 * Parse a date string in various formats (DD/MM/YYYY, YYYY-MM-DD)
 * Returns normalized YYYY-MM-DD format
 */
function parseUKDate(dateStr) {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();

  try {
    // Try YYYY-MM-DD format first (ISO format)
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const parsed = parse(trimmed, 'yyyy-MM-dd', new Date());
      if (!isNaN(parsed.getTime())) {
        return format(parsed, 'yyyy-MM-dd');
      }
    }

    // Try DD/MM/YYYY format (UK format)
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
      const parsed = parse(trimmed, 'dd/MM/yyyy', new Date());
      if (!isNaN(parsed.getTime())) {
        return format(parsed, 'yyyy-MM-dd');
      }
    }

    // Try DD-MM-YYYY format
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(trimmed)) {
      const parsed = parse(trimmed, 'dd-MM-yyyy', new Date());
      if (!isNaN(parsed.getTime())) {
        return format(parsed, 'yyyy-MM-dd');
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Generate a unique reference from row data
 * Used when bank doesn't provide a transaction ID
 * Normalizes inputs to ensure consistent references across imports
 *
 * IMPORTANT: Format must match historical data for duplicate detection:
 * - Date: DDMMYYYY (no separators)
 * - Amount: Integer (no decimals) for whole numbers, otherwise with decimals but no dot
 * - Description: lowercase, no spaces/special chars
 */
function generateReference(date, amount, description) {
  // Normalize date to DDMMYYYY format (backward compatible with existing data)
  let dateStr = '';
  if (date) {
    const parsed = parseUKDate(date); // Returns YYYY-MM-DD
    if (parsed) {
      // Convert YYYY-MM-DD to DDMMYYYY
      const [year, month, day] = parsed.split('-');
      dateStr = `${day}${month}${year}`;
    } else {
      // Fallback: remove all non-alphanumeric chars from raw date
      dateStr = date.replace(/[^0-9]/g, '');
    }
  }

  // Normalize amount - remove decimal point only (no zero padding)
  // e.g., 4050 -> "4050", 96.6 -> "966", 2065.65 -> "206565", -36388.9 -> "-363889"
  // This matches the historical format where the decimal was simply removed
  const numAmount = typeof amount === 'number' ? amount : parseFloat(amount || 0);
  const amountStr = String(numAmount).replace('.', '');

  // Normalize description (lowercase, remove excess whitespace)
  const descStr = (description || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);

  // Create reference - remove all non-alphanumeric except dash and minus signs
  return `${dateStr}-${amountStr}-${descStr}`.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
}

/**
 * Clean memo/description text (remove tabs, excess whitespace)
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse CSV text into array of objects
 * Handles quoted fields with commas inside
 */
export function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header.trim()] = values[index] || '';
    });

    data.push(row);
  }

  return data;
}

/**
 * Parse a single CSV line, handling quoted fields
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim().replace(/^"|"$/g, ''));
  return values;
}

/**
 * Bank-specific parsers
 */
export const bankParsers = {
  allica: {
    name: 'Allica Bank',
    description: 'CSV export from Allica Bank',
    requiredColumns: ['Date', 'TYPE', 'Amount'],

    parseRow: (row) => {
      const amount = parseFloat(row.Amount);
      if (isNaN(amount)) return null;

      const date = parseUKDate(row.Date);
      if (!date) return null;

      return {
        statement_date: date,
        transaction_type: row.TYPE || row['Transaction Type'],
        description: cleanText(row.Description),
        amount: amount,
        balance: row.Balance ? parseFloat(row.Balance) : null,
        external_reference: generateReference(row.Date, row.Amount, row.Description),
        raw_data: row
      };
    },

    validate: (headers) => {
      const required = ['Date', 'Amount'];
      return required.every(col =>
        headers.some(h => h.toLowerCase() === col.toLowerCase())
      );
    }
  },

  barclays: {
    name: 'Barclays Bank',
    description: 'CSV export from Barclays Bank',
    requiredColumns: ['Date', 'Amount', 'Memo'],

    parseRow: (row) => {
      const amount = parseFloat(row.Amount);
      if (isNaN(amount)) return null;

      const date = parseUKDate(row.Date);
      if (!date) return null;

      // Barclays Number field is often 0, use it only if meaningful
      const number = row.Number && row.Number !== '0' && !row.Number.trim().startsWith('\t')
        ? row.Number.trim()
        : null;

      return {
        statement_date: date,
        transaction_type: cleanText(row.Subcategory),
        description: cleanText(row.Memo),
        amount: amount,
        balance: null, // Barclays CSV doesn't consistently provide balance
        external_reference: number || generateReference(row.Date, row.Amount, row.Memo),
        raw_data: row
      };
    },

    validate: (headers) => {
      const required = ['Date', 'Amount'];
      return required.every(col =>
        headers.some(h => h.toLowerCase() === col.toLowerCase())
      );
    }
  },

  openbanking: {
    name: 'Open Banking API',
    description: 'Placeholder for future Open Banking integration',
    requiredColumns: [],
    parseRow: null,
    validate: () => false
  }
};

/**
 * Auto-detect bank format from CSV headers
 */
export function detectBankFormat(headers) {
  const headerLower = headers.map(h => h.toLowerCase().trim());

  // Allica has TYPE column
  if (headerLower.includes('type') && headerLower.includes('transaction type')) {
    return 'allica';
  }

  // Barclays has Subcategory and Memo
  if (headerLower.includes('subcategory') && headerLower.includes('memo')) {
    return 'barclays';
  }

  // Default to allica if has basic columns
  if (headerLower.includes('date') && headerLower.includes('amount')) {
    return 'allica';
  }

  return null;
}

/**
 * Parse bank statement CSV and return normalized entries
 */
export function parseBankStatement(csvText, bankSource) {
  const rows = parseCSV(csvText);
  if (rows.length === 0) {
    return { entries: [], errors: ['No data found in CSV'] };
  }

  const parser = bankParsers[bankSource];
  if (!parser || !parser.parseRow) {
    return { entries: [], errors: [`Unknown bank source: ${bankSource}`] };
  }

  const entries = [];
  const errors = [];

  rows.forEach((row, index) => {
    try {
      const entry = parser.parseRow(row);
      if (entry) {
        entries.push(entry);
      } else {
        errors.push(`Row ${index + 2}: Could not parse row`);
      }
    } catch (err) {
      errors.push(`Row ${index + 2}: ${err.message}`);
    }
  });

  return { entries, errors };
}

/**
 * Get list of available bank sources
 */
export function getBankSources() {
  return Object.entries(bankParsers)
    .filter(([, parser]) => parser.parseRow !== null)
    .map(([key, parser]) => ({
      value: key,
      label: parser.name,
      description: parser.description
    }));
}
