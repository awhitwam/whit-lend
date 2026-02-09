/**
 * Reconciliation Utility Functions
 *
 * Pure utility/helper functions extracted from BankReconciliation.jsx.
 * These handle fuzzy matching, scoring, date proximity, amount parsing,
 * subset-sum grouping, and description analysis for bank reconciliation.
 */

import { parseISO, isValid, differenceInDays } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';

// ============================================================================
// KEYWORD & TEXT UTILITIES
// ============================================================================

// Fuzzy matching utilities
export function extractKeywords(text) {
  if (!text) return [];
  // Remove common words and extract meaningful keywords
  const stopWords = ['from', 'to', 'the', 'and', 'for', 'with', 'payment', 'transfer', 'in', 'out', 'ltd', 'limited'];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word));
}

export function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;

  const words1 = extractKeywords(s1);
  const words2 = extractKeywords(s2);
  if (words1.length === 0 || words2.length === 0) return 0;

  const matches = words1.filter(w1 =>
    words2.some(w2 => w1.includes(w2) || w2.includes(w1))
  );
  return matches.length / Math.max(words1.length, words2.length);
}

// Enhanced keyword extraction for vendor names - cleans messy bank descriptions
export function extractVendorKeywords(text) {
  if (!text) return [];

  let cleaned = text.toLowerCase();

  // Remove URLs and domains (www., .com, .co.uk, etc.)
  cleaned = cleaned.replace(/www\./gi, ' ');
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/gi, ' ');
  cleaned = cleaned.replace(/\.(com|co\.uk|org|net|io|app|co|uk|au|de|fr|es|it|nl|ie|ca|nz)/gi, ' ');

  // Remove phone numbers (various formats)
  cleaned = cleaned.replace(/\+?\d{1,4}[\s\-]?\d{6,14}/g, ' '); // +61280056782 format
  cleaned = cleaned.replace(/\d{3}[\s\-]?\d{3}[\s\-]?\d{4}/g, ' '); // 123-456-7890 format

  // Remove 2-letter country codes at word boundaries
  const countryCodes = ['gb', 'uk', 'au', 'us', 'de', 'fr', 'es', 'it', 'nl', 'ie', 'ca', 'nz'];
  cleaned = cleaned.replace(/\b([a-z]{2})\b/g, (match) =>
    countryCodes.includes(match) ? ' ' : match
  );

  // Remove common reference patterns
  cleaned = cleaned.replace(/\b\d{5,}\b/g, ' '); // Reference numbers (5+ digits)
  cleaned = cleaned.replace(/\b[a-z]{1,2}\d{5,}\b/gi, ' '); // Codes like AB12345

  // Remove non-alphanumeric (keep spaces)
  cleaned = cleaned.replace(/[^a-z0-9\s]/g, ' ');

  // Stop words including payment-related terms
  const stopWords = [
    'from', 'to', 'the', 'and', 'for', 'with', 'payment', 'transfer',
    'in', 'out', 'ltd', 'limited', 'plc', 'inc', 'corp', 'llc',
    'card', 'visa', 'mastercard', 'debit', 'credit', 'pos', 'atm',
    'ref', 'reference', 'direct', 'faster', 'bacs', 'chaps', 'fps',
    'gbp', 'usd', 'eur', 'aud', 'purchase', 'sale', 'fee', 'charge'
  ];

  return cleaned
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word))
    .slice(0, 5); // Keep only top 5 keywords for matching
}

// Levenshtein distance-based similarity (0-1 scale)
export function levenshteinSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const len1 = s1.length;
  const len2 = s2.length;
  const maxLen = Math.max(len1, len2);

  // Quick reject for very different lengths
  if (Math.abs(len1 - len2) / maxLen > 0.5) return 0;

  // Create distance matrix
  const matrix = [];
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return 1 - matrix[len1][len2] / maxLen;
}

// ============================================================================
// AMOUNT UTILITIES
// ============================================================================

export function normalizeAmount(amount) {
  return Math.abs(parseFloat(amount) || 0);
}

// Check if amounts match within a tolerance (default 1%)
export function amountsMatch(amount1, amount2, tolerancePercent = 1) {
  const a1 = Math.abs(parseFloat(amount1) || 0);
  const a2 = Math.abs(parseFloat(amount2) || 0);
  if (a1 === 0 && a2 === 0) return true;
  if (a1 === 0 || a2 === 0) return false;
  const diff = Math.abs(a1 - a2);
  const tolerance = Math.max(a1, a2) * (tolerancePercent / 100);
  return diff <= tolerance;
}

// ============================================================================
// DATE UTILITIES
// ============================================================================

// Check if two dates are within a certain number of days
export function datesWithinDays(date1, date2, days) {
  if (!date1 || !date2) return false;
  try {
    const d1 = typeof date1 === 'string' ? parseISO(date1) : date1;
    const d2 = typeof date2 === 'string' ? parseISO(date2) : date2;
    if (!isValid(d1) || !isValid(d2)) return false;
    const diffMs = Math.abs(d1.getTime() - d2.getTime());
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= days;
  } catch {
    return false;
  }
}

// Calculate date proximity score (0-1)
export function dateProximityScore(date1, date2) {
  if (!date1 || !date2) return 0;
  try {
    const d1 = typeof date1 === 'string' ? parseISO(date1) : date1;
    const d2 = typeof date2 === 'string' ? parseISO(date2) : date2;
    if (!isValid(d1) || !isValid(d2)) return 0;

    const daysDiff = Math.abs(differenceInDays(d1, d2));
    if (daysDiff === 0) return 1;
    if (daysDiff <= 1) return 0.95;
    if (daysDiff <= 3) return 0.85;
    if (daysDiff <= 7) return 0.70;
    if (daysDiff <= 14) return 0.50;
    if (daysDiff <= 30) return 0.30;
    return 0.1;
  } catch {
    return 0;
  }
}

// ============================================================================
// MATCH SCORING
// ============================================================================

// Calculate match score based on date and amount proximity
export function calculateMatchScore(bankEntry, transaction, dateField = 'date') {
  const entryAmount = Math.abs(parseFloat(bankEntry.amount) || 0);
  const txAmount = Math.abs(parseFloat(transaction.amount) || 0);

  // Exact amount match is very strong
  const exactAmount = amountsMatch(entryAmount, txAmount, 0.1);
  const closeAmount = amountsMatch(entryAmount, txAmount, 5);

  // Calculate actual day difference
  const bankDate = bankEntry.statement_date ? parseISO(bankEntry.statement_date) : null;
  const txDate = transaction[dateField] ? parseISO(transaction[dateField]) : null;
  let daysDiff = Infinity;

  if (bankDate && txDate && isValid(bankDate) && isValid(txDate)) {
    daysDiff = Math.abs(differenceInDays(bankDate, txDate));
  }

  // Date proximity flags
  const sameDay = daysDiff === 0;
  const within3Days = daysDiff <= 3;
  const within7Days = daysDiff <= 7;
  const within14Days = daysDiff <= 14;
  const within30Days = daysDiff <= 30;

  // Calculate base score
  let score = 0;

  if (exactAmount && sameDay) {
    score = 0.95; // Near perfect match
  } else if (exactAmount && within3Days) {
    score = 0.85;
  } else if (exactAmount && within7Days) {
    score = 0.75;
  } else if (closeAmount && sameDay) {
    score = 0.70;
  } else if (closeAmount && within3Days) {
    score = 0.60;
  } else if (exactAmount && within14Days) {
    score = 0.50; // Amount matches but date is 8-14 days off
  } else if (closeAmount && within7Days) {
    score = 0.45;
  } else if (exactAmount && within30Days) {
    score = 0.40; // Amount matches but date is 15-30 days off - still show as suggestion since exact amount is strong signal
  } else if (closeAmount && within14Days) {
    score = 0.25;
  } else if (exactAmount || closeAmount) {
    // Dates are over 30 days apart - cap at 10%
    score = 0.10;
  }

  return score;
}

// Generate human-readable explanation of match confidence
export function getMatchExplanation(bankEntry, transaction, dateField = 'date') {
  const entryAmount = Math.abs(parseFloat(bankEntry.amount) || 0);
  const txAmount = Math.abs(parseFloat(transaction.amount) || 0);

  const exactAmount = amountsMatch(entryAmount, txAmount, 0.1);
  const closeAmount = amountsMatch(entryAmount, txAmount, 5);

  const bankDate = bankEntry.statement_date ? parseISO(bankEntry.statement_date) : null;
  const txDate = transaction[dateField] ? parseISO(transaction[dateField]) : null;
  let daysDiff = null;

  if (bankDate && txDate && isValid(bankDate) && isValid(txDate)) {
    daysDiff = Math.abs(differenceInDays(bankDate, txDate));
  }

  const amountExplanation = exactAmount
    ? { text: 'Exact match', icon: 'check', color: 'emerald' }
    : closeAmount
    ? { text: `Within 5% (${formatCurrency(Math.abs(entryAmount - txAmount))} difference)`, icon: 'approx', color: 'amber' }
    : { text: `${formatCurrency(Math.abs(entryAmount - txAmount))} difference`, icon: 'x', color: 'red' };

  let dateExplanation;
  if (daysDiff === null) {
    dateExplanation = { text: 'Date unknown', icon: 'x', color: 'slate' };
  } else if (daysDiff === 0) {
    dateExplanation = { text: 'Same day', icon: 'check', color: 'emerald' };
  } else if (daysDiff <= 3) {
    dateExplanation = { text: `${daysDiff} day${daysDiff > 1 ? 's' : ''} apart`, icon: 'check', color: 'emerald' };
  } else if (daysDiff <= 7) {
    dateExplanation = { text: `${daysDiff} days apart`, icon: 'approx', color: 'amber' };
  } else if (daysDiff <= 14) {
    dateExplanation = { text: `${daysDiff} days apart (moderate gap)`, icon: 'warning', color: 'amber' };
  } else {
    dateExplanation = { text: `${daysDiff} days apart (large gap)`, icon: 'x', color: 'red' };
  }

  return { amount: amountExplanation, date: dateExplanation, daysDiff };
}

// ============================================================================
// NAME MATCHING
// ============================================================================

/**
 * Check if bank description contains a name (borrower/investor)
 * Returns a score 0-1 indicating match strength
 */
export function descriptionContainsName(description, name, businessName) {
  if (!description) return 0;

  // Normalize name for comparison (remove Ltd, Limited, etc)
  const normalizeName = (n) => {
    if (!n) return '';
    return n.toLowerCase()
      .replace(/\b(ltd|limited|plc|inc|llc|llp|co|company)\b/gi, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const nameNorm = normalizeName(name);
  const bizNorm = normalizeName(businessName);
  const descNorm = normalizeName(description);

  // Check business name first (more specific)
  if (bizNorm && bizNorm.length >= 3 && descNorm.includes(bizNorm)) {
    return 1.0; // Strong match
  }

  // Check individual name
  if (nameNorm && nameNorm.length >= 3 && descNorm.includes(nameNorm)) {
    return 0.9;
  }

  // Check significant words from business name
  if (bizNorm) {
    const words = bizNorm.split(' ').filter(w => w.length >= 4);
    for (const word of words) {
      if (descNorm.includes(word)) {
        return 0.7; // Partial match
      }
    }
  }

  return 0;
}

// ============================================================================
// DESCRIPTION RELATEDNESS
// ============================================================================

/**
 * Check if two bank descriptions appear to be parts of the same transaction
 * (e.g., "TOBIE HOLBROOK LOAN PART1" and "TOBIE HOLBROOK LOAN PART2")
 */
export function descriptionsAreRelated(desc1, desc2) {
  if (!desc1 || !desc2) return false;

  const norm1 = desc1.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  const norm2 = desc2.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();

  // Extract words (3+ chars)
  const words1 = norm1.split(/\s+/).filter(w => w.length >= 3);
  const words2 = norm2.split(/\s+/).filter(w => w.length >= 3);

  if (words1.length === 0 || words2.length === 0) return false;

  // Count matching words
  const matches = words1.filter(w => words2.includes(w));

  // Require at least 50% word overlap
  const overlapRatio = matches.length / Math.min(words1.length, words2.length);
  return overlapRatio >= 0.5;
}

/**
 * Check if ALL entries in a group have related descriptions
 */
export function groupHasRelatedDescriptions(entries) {
  if (entries.length < 2) return true;

  const firstDesc = entries[0].description;
  return entries.slice(1).every(e => descriptionsAreRelated(firstDesc, e.description));
}

// ============================================================================
// SUBSET SUM ALGORITHM
// ============================================================================

/**
 * Find combination of exactly `size` entries that sum to target
 */
function findComboOfSize(entries, size, target) {
  if (size === 1) {
    const match = entries.find(e => amountsMatch(Math.abs(e.amount), target, 1));
    return match ? [match] : null;
  }

  // Recursive: try each entry as first element
  for (let i = 0; i < entries.length - size + 1; i++) {
    const first = entries[i];
    const remaining = entries.slice(i + 1);
    const subCombo = findComboOfSize(remaining, size - 1, target - Math.abs(first.amount));
    if (subCombo) {
      return [first, ...subCombo];
    }
  }

  return null;
}

/**
 * Find subset of entries that sum to target amount (within 1% tolerance)
 * mustIncludeId: the entry that must be in the subset
 */
export function findSubsetSum(entries, targetAmount, mustIncludeId) {
  const mustInclude = entries.find(e => e.id === mustIncludeId);
  if (!mustInclude) return null;

  const others = entries.filter(e => e.id !== mustIncludeId);
  const mustIncludeAmount = Math.abs(mustInclude.amount);

  // If just the must-include entry matches, not a grouped match
  if (amountsMatch(mustIncludeAmount, targetAmount, 1)) return null;

  // Try combinations of increasing size (prefer smaller groups)
  for (let size = 1; size <= Math.min(others.length, 5); size++) {
    const combo = findComboOfSize(others, size, targetAmount - mustIncludeAmount);
    if (combo) {
      return [mustInclude, ...combo];
    }
  }

  return null;
}

// ============================================================================
// MATCH MODE HELPERS
// ============================================================================

/**
 * Check if a matchMode indicates matching to an existing transaction (vs creating new)
 */
export function isMatchType(matchMode) {
  return matchMode === 'match' || matchMode === 'match_group' || matchMode === 'grouped_disbursement' || matchMode === 'grouped_investor' || matchMode === 'grouped_repayment';
}
