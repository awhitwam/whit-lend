/**
 * Classification Logic - Assigns bank entries to pots
 *
 * This is Phase 1 of the two-phase approach:
 * 1. Classification: Determine pot (loans, investors, expenses, unclassified)
 * 2. Matching: Find specific entity within the pot (handled separately)
 *
 * Pots:
 * - loans: Repayments (credits) and Disbursements (debits)
 * - investors: Capital in/out, Interest payments
 * - expenses: Operating expenses (debits only)
 * - unclassified: Items that couldn't be classified
 *
 * Default heuristics (when no specific match found):
 * - Credits: Default to investors (most credits are investor capital in)
 * - Debits < £1000: Default to expenses (small outgoings are usually operational)
 * - Debits >= £1000: Unclassified (could be loan disbursement or large expense)
 */

// Expense keywords for classification
const EXPENSE_KEYWORDS = [
  'expense', 'expenses', 'bill', 'bills', 'fee', 'fees', 'charge', 'charges',
  'utilities', 'rent', 'insurance', 'subscription', 'office', 'supplies', 'maintenance',
  'professional', 'legal', 'accounting', 'tax', 'vat', 'hmrc', 'council', 'electric',
  'gas', 'water', 'phone', 'internet', 'broadband', 'software', 'license', 'licence',
  'stripe', 'paypal', 'worldpay', 'barclays', 'lloyds', 'bank charge', 'direct debit',
  'standing order', 'service', 'admin', 'postage', 'printing', 'stationery', 'travel',
  'parking', 'fuel', 'cleaning', 'security', 'hosting', 'domain', 'cloud', 'aws', 'azure'
];

// Keywords that strongly suggest investor transactions
const INVESTOR_KEYWORDS = [
  'capital', 'investment', 'investor', 'dividend', 'interest payment', 'return',
  'withdrawal', 'funding', 'contribution'
];

// Keywords that suggest loan transactions
const LOAN_KEYWORDS = [
  'repayment', 'loan', 'disbursement', 'drawdown', 'principal', 'borrower'
];

// Threshold for "small" expenses (debits below this are likely expenses)
const SMALL_EXPENSE_THRESHOLD = 1000;

/**
 * Extract keywords from text, filtering out common stop words
 */
function extractKeywords(text) {
  if (!text) return [];
  const stopWords = ['from', 'to', 'the', 'and', 'for', 'with', 'payment', 'transfer', 'in', 'out', 'ltd', 'limited', 'plc', 'inc', 'llc', 'mr', 'mrs', 'ms'];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word));
}

/**
 * Normalize a name for comparison (remove common suffixes, lowercase, etc)
 */
function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\b(ltd|limited|plc|inc|llc|llp|co|company|holdings|group|enterprises?|properties|investments?)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if a name appears in description text
 * Returns confidence score 0-1
 */
function findNameInText(description, name) {
  if (!description || !name) return 0;

  const descNorm = normalizeName(description);
  const nameNorm = normalizeName(name);

  if (!nameNorm || nameNorm.length < 3) return 0;

  // Exact match of normalized name
  if (descNorm.includes(nameNorm)) return 0.95;

  // Check each significant word from the name
  const nameWords = nameNorm.split(' ').filter(w => w.length >= 3);
  if (nameWords.length === 0) return 0;

  // Count how many name words appear in description
  const matchedWords = nameWords.filter(word => descNorm.includes(word));

  if (matchedWords.length === 0) return 0;

  // If primary word (first significant word) matches, that's strong
  if (matchedWords.includes(nameWords[0])) {
    return 0.7 + (0.2 * matchedWords.length / nameWords.length);
  }

  // Partial match
  return 0.5 * (matchedWords.length / nameWords.length);
}

/**
 * Calculate string similarity (0-1) - legacy function for backward compat
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
 * Classify a single bank entry to a pot
 *
 * Priority order:
 * 1. Learned patterns (user's previous selections)
 * 2. Name matching (investor/borrower names in description) - THIS IS KEY
 * 3. Keywords (loan, investor, expense keywords)
 * 4. Default heuristics based on direction and amount
 */
export function classifyEntryToPot(entry, context) {
  const {
    loans = [],
    investors = [],
    borrowers = [],
    patterns = []
  } = context;

  const isCredit = entry.amount > 0;
  const absAmount = Math.abs(entry.amount);
  const description = entry.description || '';
  const reference = entry.reference || '';
  const counterparty = entry.counterparty || '';
  const fullText = `${description} ${reference} ${counterparty}`;

  // Initialize classification result
  let result = {
    pot: 'unclassified',
    confidence: 0,
    reason: null,
    signals: []
  };

  // Track best matches for investor and borrower
  let bestInvestorMatch = { score: 0, investor: null };
  let bestBorrowerMatch = { score: 0, loan: null, borrower: null };

  // 1. FIRST: Check name matching - this is the most reliable signal
  // Check all investor names against description
  for (const investor of investors.filter(i => i.status === 'Active')) {
    const nameScore = Math.max(
      findNameInText(fullText, investor.name),
      findNameInText(fullText, investor.business_name)
    );

    if (nameScore > bestInvestorMatch.score) {
      bestInvestorMatch = { score: nameScore, investor };
    }
  }

  // Check all borrower/loan names against description
  const activeLoanStatuses = ['Live', 'Active', 'Approved'];
  for (const loan of loans.filter(l => activeLoanStatuses.includes(l.status))) {
    const nameScore = findNameInText(fullText, loan.borrower_name);

    if (nameScore > bestBorrowerMatch.score) {
      bestBorrowerMatch = { score: nameScore, loan, borrower: null };
    }
  }

  // Also check borrower entities directly
  for (const borrower of borrowers) {
    const nameScore = Math.max(
      findNameInText(fullText, borrower.name),
      findNameInText(fullText, borrower.business_name)
    );

    if (nameScore > bestBorrowerMatch.score) {
      bestBorrowerMatch = { score: nameScore, loan: null, borrower };
    }
  }

  // 2. Apply name matches with appropriate confidence
  // Investor name match
  if (bestInvestorMatch.score >= 0.5) {
    const conf = Math.round(bestInvestorMatch.score * 95);
    if (conf > result.confidence) {
      result = {
        pot: 'investors',
        confidence: conf,
        reason: `Investor: ${bestInvestorMatch.investor.business_name || bestInvestorMatch.investor.name}`,
        signals: ['investor_name_match'],
        suggestedInvestor: bestInvestorMatch.investor
      };
    }
  }

  // Borrower name match - slightly favor this for credits (repayments)
  if (bestBorrowerMatch.score >= 0.5) {
    // For credits, borrower match is very strong (repayment)
    // For debits, it's weaker (could be disbursement but less common)
    const multiplier = isCredit ? 98 : 80;
    const conf = Math.round(bestBorrowerMatch.score * multiplier);

    if (conf > result.confidence) {
      const matchName = bestBorrowerMatch.loan?.borrower_name ||
                        bestBorrowerMatch.borrower?.business_name ||
                        bestBorrowerMatch.borrower?.name;
      result = {
        pot: 'loans',
        confidence: conf,
        reason: `Borrower: ${matchName}`,
        signals: ['borrower_name_match'],
        suggestedLoan: bestBorrowerMatch.loan,
        suggestedBorrower: bestBorrowerMatch.borrower
      };
    }
  }

  // 3. Check learned patterns (user's previous selections)
  for (const pattern of patterns) {
    const patternText = (pattern.description_pattern || '').toLowerCase();
    if (patternText && patternText.length >= 3) {
      if (fullText.toLowerCase().includes(patternText)) {
        const patternPot = mapPatternTypeToPot(pattern.match_type);
        if (patternPot) {
          const conf = Math.round(85 + (pattern.confidence_score || 0.7) * 10);
          if (conf > result.confidence) {
            result = {
              pot: patternPot,
              confidence: Math.min(conf, 95),
              reason: `Learned: "${pattern.description_pattern}"`,
              signals: ['learned_pattern'],
              patternId: pattern.id
            };
          }
        }
      }
    }
  }

  // 4. Check for keywords if no strong name match
  if (result.confidence < 70) {
    const fullTextLower = fullText.toLowerCase();

    // Loan keywords
    const hasLoanKeyword = LOAN_KEYWORDS.some(kw => fullTextLower.includes(kw));
    if (hasLoanKeyword) {
      const conf = 72;
      if (conf > result.confidence) {
        result = {
          pot: 'loans',
          confidence: conf,
          reason: 'Loan keyword detected',
          signals: ['loan_keyword']
        };
      }
    }

    // Investor keywords
    const hasInvestorKeyword = INVESTOR_KEYWORDS.some(kw => fullTextLower.includes(kw));
    if (hasInvestorKeyword) {
      const conf = isCredit ? 75 : 70;
      if (conf > result.confidence) {
        result = {
          pot: 'investors',
          confidence: conf,
          reason: 'Investor keyword detected',
          signals: ['investor_keyword']
        };
      }
    }

    // Expense keywords (debits only)
    if (!isCredit) {
      const hasExpenseKeyword = EXPENSE_KEYWORDS.some(kw => fullTextLower.includes(kw));
      if (hasExpenseKeyword) {
        const conf = 68;
        if (conf > result.confidence) {
          result = {
            pot: 'expenses',
            confidence: conf,
            reason: 'Expense keyword detected',
            signals: ['expense_keyword']
          };
        }
      }
    }
  }

  // 5. DEFAULT HEURISTICS - Apply when no specific match found
  if (result.confidence < 50) {
    if (isCredit) {
      // Credits with no name match
      // If there are investors but none matched, this is unusual - more likely a loan repayment
      if (investors.length > 0 && bestInvestorMatch.score < 0.3) {
        // No investor name found - default to LOANS (likely repayment from unknown borrower)
        result = {
          pot: 'loans',
          confidence: 40,
          reason: 'Credit with no investor match - likely loan repayment',
          signals: ['default_credit_to_loan']
        };
      } else {
        // Default to investors
        result = {
          pot: 'investors',
          confidence: 45,
          reason: 'Unidentified credit - likely investor capital',
          signals: ['default_credit_to_investor']
        };
      }
    } else {
      // Debits with no match - use amount-based heuristic
      if (absAmount < SMALL_EXPENSE_THRESHOLD) {
        result = {
          pot: 'expenses',
          confidence: 55,
          reason: `Small debit (< £${SMALL_EXPENSE_THRESHOLD}) - likely expense`,
          signals: ['default_small_debit_to_expense']
        };
      } else {
        result = {
          pot: 'unclassified',
          confidence: 0,
          reason: `Large debit (>= £${SMALL_EXPENSE_THRESHOLD}) - needs review`,
          signals: ['large_debit_needs_review']
        };
      }
    }
  }

  return result;
}

/**
 * Map pattern match_type to pot
 */
function mapPatternTypeToPot(matchType) {
  const mapping = {
    'loan_repayment': 'loans',
    'loan_disbursement': 'loans',
    'investor_credit': 'investors',
    'investor_funding': 'investors',
    'investor_withdrawal': 'investors',
    'investor_interest': 'investors',
    'operating_expense': 'expenses',
    'platform_fee': 'expenses'
  };
  return mapping[matchType] || null;
}

/**
 * Classify all bank entries to pots
 */
export function classifyEntriesToPots(entries, context) {
  const results = {
    unclassified: [],
    loans: [],
    investors: [],
    expenses: []
  };

  for (const entry of entries) {
    const classification = classifyEntryToPot(entry, context);
    const enrichedEntry = {
      ...entry,
      classification,
      pot: classification.pot
    };
    results[classification.pot].push(enrichedEntry);
  }

  return results;
}

/**
 * Reclassify a single entry to a new pot (user override)
 */
export function reclassifyEntry(entry, newPot) {
  return {
    ...entry,
    pot: newPot,
    classification: {
      ...entry.classification,
      pot: newPot,
      reason: 'Manually reclassified',
      signals: [...(entry.classification?.signals || []), 'manual_override']
    }
  };
}
