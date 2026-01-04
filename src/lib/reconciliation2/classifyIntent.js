/**
 * Intent Classification for Bank Reconciliation v2
 *
 * Uses the proven matching approach from v1:
 * 1. Match against existing unreconciled transactions (date/amount)
 * 2. Check learned patterns
 * 3. Fall back to name matching
 * 4. Use expense keywords for debits
 */

import { parseISO, isValid, differenceInDays } from 'date-fns';

/**
 * Extract keywords from text, filtering out common stop words
 */
function extractKeywords(text) {
  if (!text) return [];
  const stopWords = ['from', 'to', 'the', 'and', 'for', 'with', 'payment', 'transfer', 'in', 'out', 'ltd', 'limited'];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word));
}

/**
 * Enhanced keyword extraction for vendor names - cleans messy bank descriptions
 */
function extractVendorKeywords(text) {
  if (!text) return [];

  let cleaned = text.toLowerCase();

  // Remove URLs and domains
  cleaned = cleaned.replace(/www\./gi, ' ');
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/gi, ' ');
  cleaned = cleaned.replace(/\.(com|co\.uk|org|net|io|app|co|uk|au|de|fr|es|it|nl|ie|ca|nz)/gi, ' ');

  // Remove phone numbers
  cleaned = cleaned.replace(/\+?\d{1,4}[\s-]?\d{6,14}/g, ' ');
  cleaned = cleaned.replace(/\d{3}[\s-]?\d{3}[\s-]?\d{4}/g, ' ');

  // Remove 2-letter country codes
  const countryCodes = ['gb', 'uk', 'au', 'us', 'de', 'fr', 'es', 'it', 'nl', 'ie', 'ca', 'nz'];
  cleaned = cleaned.replace(/\b([a-z]{2})\b/g, (match) =>
    countryCodes.includes(match) ? ' ' : match
  );

  // Remove reference numbers
  cleaned = cleaned.replace(/\b\d{5,}\b/g, ' ');
  cleaned = cleaned.replace(/\b[a-z]{1,2}\d{5,}\b/gi, ' ');

  // Remove non-alphanumeric
  cleaned = cleaned.replace(/[^a-z0-9\s]/g, ' ');

  // Stop words
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
    .slice(0, 5);
}

/**
 * Levenshtein distance-based similarity (0-1 scale)
 */
function levenshteinSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const len1 = s1.length;
  const len2 = s2.length;
  const maxLen = Math.max(len1, len2);

  if (Math.abs(len1 - len2) / maxLen > 0.5) return 0;

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
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return 1 - matrix[len1][len2] / maxLen;
}

/**
 * Calculate string similarity
 */
function calculateSimilarity(str1, str2) {
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

/**
 * Check if amounts match within tolerance
 */
function amountsMatch(amount1, amount2, tolerancePercent = 1) {
  const a1 = Math.abs(parseFloat(amount1) || 0);
  const a2 = Math.abs(parseFloat(amount2) || 0);
  if (a1 === 0 && a2 === 0) return true;
  if (a1 === 0 || a2 === 0) return false;
  const diff = Math.abs(a1 - a2);
  const tolerance = Math.max(a1, a2) * (tolerancePercent / 100);
  return diff <= tolerance;
}

/**
 * Check if two dates are within a certain number of days
 */
function datesWithinDays(date1, date2, days) {
  if (!date1 || !date2) return false;
  try {
    const d1 = typeof date1 === 'string' ? parseISO(date1) : date1;
    const d2 = typeof date2 === 'string' ? parseISO(date2) : date2;
    if (!isValid(d1) || !isValid(d2)) return false;
    return Math.abs(differenceInDays(d1, d2)) <= days;
  } catch {
    return false;
  }
}

/**
 * Calculate match score based on date and amount
 */
function calculateMatchScore(bankEntry, transaction, dateField = 'date') {
  const entryAmount = Math.abs(parseFloat(bankEntry.amount) || 0);
  const txAmount = Math.abs(parseFloat(transaction.amount) || 0);

  const exactAmount = amountsMatch(entryAmount, txAmount, 0.1);
  const closeAmount = amountsMatch(entryAmount, txAmount, 5);

  const bankDate = bankEntry.statement_date ? parseISO(bankEntry.statement_date) : null;
  const txDate = transaction[dateField] ? parseISO(transaction[dateField]) : null;
  let daysDiff = Infinity;

  if (bankDate && txDate && isValid(bankDate) && isValid(txDate)) {
    daysDiff = Math.abs(differenceInDays(bankDate, txDate));
  }

  const sameDay = daysDiff === 0;
  const within3Days = daysDiff <= 3;
  const within7Days = daysDiff <= 7;
  const within14Days = daysDiff <= 14;
  const within30Days = daysDiff <= 30;

  let score = 0;

  if (exactAmount && sameDay) {
    score = 0.95;
  } else if (exactAmount && within3Days) {
    score = 0.85;
  } else if (exactAmount && within7Days) {
    score = 0.75;
  } else if (closeAmount && sameDay) {
    score = 0.70;
  } else if (closeAmount && within3Days) {
    score = 0.60;
  } else if (exactAmount && within14Days) {
    score = 0.50;
  } else if (closeAmount && within7Days) {
    score = 0.45;
  } else if (exactAmount && within30Days) {
    score = 0.30;
  } else if (closeAmount && within14Days) {
    score = 0.25;
  } else if (exactAmount || closeAmount) {
    score = 0.10;
  }

  return score;
}

// Expense keywords for classification
const EXPENSE_KEYWORDS = [
  'expense', 'expenses', 'bill', 'bills', 'fee', 'fees', 'charge', 'charges',
  'utilities', 'rent', 'insurance', 'subscription', 'office', 'supplies', 'maintenance',
  'professional', 'legal', 'accounting', 'tax', 'vat', 'hmrc', 'council', 'electric',
  'gas', 'water', 'phone', 'internet', 'broadband', 'software', 'license', 'licence'
];

/**
 * Classify a single bank entry using v1-style matching
 */
export function classifyBankEntry(entry, context) {
  const {
    loans = [],
    investors = [],
    borrowers = [],
    patterns = [],
    loanTransactions = [],
    investorTransactions = [],
    expenses = [],
    expenseTypes = [],
    reconciledTxIds = new Set()
  } = context;

  const entryAmount = Math.abs(entry.amount);
  const isCredit = entry.amount > 0;
  const description = entry.description || '';

  let bestMatch = null;
  let bestScore = 0;

  // Helper to get borrower name
  const getBorrowerName = (borrowerId) => {
    const borrower = borrowers.find(b => b.id === borrowerId);
    return borrower?.name || borrower?.business_name || 'Unknown';
  };

  // 1. Match against existing loan transactions
  if (isCredit) {
    // Credits could be repayments
    for (const tx of loanTransactions) {
      if (tx.is_deleted || reconciledTxIds.has(tx.id)) continue;
      if (tx.type !== 'Repayment') continue;

      const score = calculateMatchScore(entry, tx, 'date');
      if (score > bestScore) {
        bestScore = score;
        const loan = loans.find(l => l.id === tx.loan_id);
        bestMatch = {
          intent: 'loan_repayment',
          matchMode: 'match',
          existingTransaction: tx,
          loan,
          confidence: Math.round(score * 100),
          reason: `Repayment match: ${loan?.borrower_name || 'Unknown'}`
        };
      }
    }

    // 1b. GROUPED MATCH: Check if multiple repayments from same borrower sum to this amount
    // This handles cases where a borrower pays once for multiple loans
    if (bestScore < 0.9) {
      // Build email -> borrower IDs map for grouping by shared email
      const emailToBorrowerIds = new Map();
      for (const borrower of borrowers) {
        const email = borrower.email?.toLowerCase()?.trim();
        if (email) {
          if (!emailToBorrowerIds.has(email)) {
            emailToBorrowerIds.set(email, new Set());
          }
          emailToBorrowerIds.get(email).add(borrower.id);
        }
      }

      // Group unreconciled repayments by borrower_id
      const repaymentsByBorrower = new Map();
      for (const tx of loanTransactions) {
        if (tx.is_deleted || reconciledTxIds.has(tx.id)) continue;
        if (tx.type !== 'Repayment') continue;
        // Check if date is within 3 days of bank entry
        if (!datesWithinDays(entry.statement_date, tx.date, 3)) continue;

        const key = tx.borrower_id;
        if (!repaymentsByBorrower.has(key)) {
          repaymentsByBorrower.set(key, []);
        }
        repaymentsByBorrower.get(key).push(tx);
      }

      // Check individual borrower groups
      for (const [borrowerId, txGroup] of repaymentsByBorrower) {
        if (txGroup.length < 2) continue; // Only interested in groups of 2+

        const groupTotal = txGroup.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

        if (amountsMatch(entryAmount, groupTotal, 1)) {
          const allSameDay = txGroup.every(tx =>
            datesWithinDays(tx.date, entry.statement_date, 1)
          );

          const score = allSameDay ? 0.92 : 0.85;

          if (score > bestScore) {
            bestScore = score;
            const borrowerName = getBorrowerName(borrowerId);
            const loanNumbers = [...new Set(txGroup.map(tx => {
              const l = loans.find(loan => loan.id === tx.loan_id);
              return l?.loan_number || '?';
            }))].join(', ');

            bestMatch = {
              intent: 'loan_repayment',
              matchMode: 'match_group',
              existingTransactions: txGroup,
              borrowerId,
              confidence: Math.round(score * 100),
              reason: `Grouped: ${borrowerName} - ${txGroup.length} loans (${loanNumbers})`
            };
          }
        }
      }

      // Check groups by shared email (combines multiple borrowers with same email)
      if (bestScore < 0.9) {
        for (const [email, borrowerIds] of emailToBorrowerIds) {
          if (borrowerIds.size < 2) continue;

          // Combine transactions from all borrowers with this email
          const combinedTxGroup = [];
          for (const borrowerId of borrowerIds) {
            const txs = repaymentsByBorrower.get(borrowerId) || [];
            combinedTxGroup.push(...txs);
          }

          if (combinedTxGroup.length < 2) continue;

          const groupTotal = combinedTxGroup.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

          if (amountsMatch(entryAmount, groupTotal, 1)) {
            const allSameDay = combinedTxGroup.every(tx =>
              datesWithinDays(tx.date, entry.statement_date, 1)
            );

            const score = allSameDay ? 0.90 : 0.82;

            if (score > bestScore) {
              bestScore = score;
              const borrowerNames = [...borrowerIds].map(id => getBorrowerName(id)).join(' / ');
              const loanNumbers = [...new Set(combinedTxGroup.map(tx => {
                const l = loans.find(loan => loan.id === tx.loan_id);
                return l?.loan_number || '?';
              }))].join(', ');

              bestMatch = {
                intent: 'loan_repayment',
                matchMode: 'match_group',
                existingTransactions: combinedTxGroup,
                borrowerId: [...borrowerIds][0],
                confidence: Math.round(score * 100),
                reason: `Email group (${email}): ${borrowerNames} - ${combinedTxGroup.length} loans (${loanNumbers})`
              };
            }
          }
        }
      }
    }
  } else {
    // Debits could be disbursements
    for (const tx of loanTransactions) {
      if (tx.is_deleted || reconciledTxIds.has(tx.id)) continue;
      if (tx.type !== 'Disbursement') continue;

      const score = calculateMatchScore(entry, tx, 'date');
      if (score > bestScore) {
        bestScore = score;
        const loan = loans.find(l => l.id === tx.loan_id);
        bestMatch = {
          intent: 'loan_disbursement',
          matchMode: 'match',
          existingTransaction: tx,
          loan,
          confidence: Math.round(score * 100),
          reason: `Disbursement match: ${loan?.borrower_name || 'Unknown'}`
        };
      }
    }
  }

  // 2. Match against existing investor transactions
  for (const tx of investorTransactions) {
    if (reconciledTxIds.has(tx.id)) continue;
    const txIsCredit = tx.type === 'capital_in';
    const txIsDebit = tx.type === 'capital_out';

    if ((isCredit && txIsCredit) || (!isCredit && txIsDebit)) {
      const score = calculateMatchScore(entry, tx, 'date');
      if (score > bestScore) {
        bestScore = score;
        const investor = investors.find(i => i.id === tx.investor_id);
        const matchIntent = tx.type === 'capital_in' ? 'investor_funding' : 'investor_withdrawal';

        bestMatch = {
          intent: matchIntent,
          matchMode: 'match',
          existingTransaction: tx,
          investor,
          confidence: Math.round(score * 100),
          reason: `Investor match: ${investor?.name || 'Unknown'}`
        };
      }
    }
  }

  // 3. Match against existing expenses (debits only)
  if (!isCredit) {
    for (const exp of expenses) {
      if (reconciledTxIds.has(exp.id)) continue;
      const score = calculateMatchScore(entry, exp, 'date');
      if (score > bestScore) {
        bestScore = score;
        const expenseType = expenseTypes.find(t => t.id === exp.type_id);
        bestMatch = {
          intent: 'operating_expense',
          matchMode: 'match',
          existingExpense: exp,
          expenseType,
          confidence: Math.round(score * 100),
          reason: `Expense match: ${exp.type_name || expenseType?.name || 'Expense'}`
        };
      }
    }
  }

  // 4. Check learned patterns (for creating new)
  if (bestScore < 0.7) {
    const entryVendorKeywords = extractVendorKeywords(description);

    for (const pattern of patterns) {
      const patternKeywords = extractVendorKeywords(pattern.description_pattern);
      if (patternKeywords.length === 0) continue;

      let matchCount = 0;
      for (const entryKw of entryVendorKeywords) {
        for (const patternKw of patternKeywords) {
          if (entryKw === patternKw) {
            matchCount += 1;
          } else if (entryKw.includes(patternKw) || patternKw.includes(entryKw)) {
            matchCount += 0.7;
          } else if (levenshteinSimilarity(entryKw, patternKw) >= 0.75) {
            matchCount += 0.5;
          }
        }
      }

      const keywordScore = matchCount / Math.max(patternKeywords.length, 1);
      const amountInRange = (!pattern.amount_min || entryAmount >= pattern.amount_min) &&
                           (!pattern.amount_max || entryAmount <= pattern.amount_max);
      const typeMatch = !pattern.transaction_type ||
                       (isCredit ? pattern.transaction_type === 'CRDT' : pattern.transaction_type === 'DBIT');

      if (keywordScore >= 0.5 && amountInRange && typeMatch) {
        const usageBoost = Math.min((pattern.match_count || 1) / 20, 0.15);
        const score = (pattern.confidence_score || 0.5) * 0.6 + keywordScore * 0.25 + usageBoost;

        if (score > bestScore) {
          bestScore = score;

          // Map pattern match_type to intent
          let intent = pattern.match_type;
          if (intent === 'investor_credit') intent = 'investor_funding';

          const loan = pattern.loan_id ? loans.find(l => l.id === pattern.loan_id) : null;
          const investor = pattern.investor_id ? investors.find(i => i.id === pattern.investor_id) : null;
          const expenseType = pattern.expense_type_id ? expenseTypes.find(t => t.id === pattern.expense_type_id) : null;

          bestMatch = {
            intent,
            matchMode: 'create',
            loan,
            investor,
            expenseType,
            patternId: pattern.id,
            confidence: Math.round(score * 100),
            reason: `Pattern: "${pattern.description_pattern}"`
          };
        }
      }
    }
  }

  // 5. Check expense keywords (debits only)
  if (!isCredit && bestScore < 0.6) {
    const descLower = description.toLowerCase();
    const hasExpenseKeyword = EXPENSE_KEYWORDS.some(kw => descLower.includes(kw));

    if (hasExpenseKeyword) {
      bestScore = 0.65;
      bestMatch = {
        intent: 'operating_expense',
        matchMode: 'create',
        confidence: 65,
        reason: 'Description contains expense keyword'
      };
    }
  }

  // 6. Try matching to loans by borrower name
  if (bestScore < 0.5) {
    const descLower = description.toLowerCase();
    const hasExpenseKeyword = EXPENSE_KEYWORDS.slice(0, 6).some(kw => descLower.includes(kw));

    if (!hasExpenseKeyword) {
      for (const loan of loans.filter(l => l.status === 'Live' || l.status === 'Active')) {
        const similarity = calculateSimilarity(description, loan.borrower_name);

        if (similarity > 0.5 && similarity > bestScore) {
          bestScore = similarity;
          bestMatch = {
            intent: isCredit ? 'loan_repayment' : 'loan_disbursement',
            matchMode: 'create',
            loan,
            confidence: Math.round(similarity * 100),
            reason: `Borrower name: ${loan.borrower_name}`
          };
        }
      }
    }
  }

  // 7. Try matching to investors by name
  if (bestScore < 0.45) {
    const descLower = description.toLowerCase();
    const hasExpenseKeyword = EXPENSE_KEYWORDS.slice(0, 6).some(kw => descLower.includes(kw));

    if (!hasExpenseKeyword) {
      for (const investor of investors.filter(i => i.status === 'Active')) {
        const nameSimilarity = Math.max(
          calculateSimilarity(description, investor.name || ''),
          calculateSimilarity(description, investor.business_name || '')
        );

        if (nameSimilarity > 0.4 && nameSimilarity > bestScore) {
          bestScore = nameSimilarity;
          const matchIntent = isCredit ? 'investor_funding' : 'investor_withdrawal';

          bestMatch = {
            intent: matchIntent,
            matchMode: 'create',
            investor,
            confidence: Math.round(nameSimilarity * 100),
            reason: `Investor name: ${investor.business_name || investor.name}`
          };
        }
      }
    }
  }

  // Return result if confidence is above threshold
  if (bestMatch && bestScore >= 0.35) {
    return {
      intent: bestMatch.intent,
      confidence: bestMatch.confidence,
      matchMode: bestMatch.matchMode,
      suggestedMatch: bestMatch,
      reason: bestMatch.reason
    };
  }

  // No match - return unknown
  return {
    intent: 'unknown',
    confidence: 0,
    matchMode: null,
    suggestedMatch: null,
    reason: null
  };
}

/**
 * Classify multiple bank entries
 */
export function classifyBankEntries(entries, context) {
  return entries.map(entry => ({
    ...entry,
    classification: classifyBankEntry(entry, context)
  }));
}

/**
 * Get confidence level category
 */
export function getConfidenceLevel(confidence) {
  if (confidence >= 90) return 'high';
  if (confidence >= 70) return 'medium';
  return 'low';
}
