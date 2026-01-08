/**
 * PatternMatcher
 *
 * Matches bank entries to learned patterns for creating new transactions.
 * This matcher has the lowest priority and suggests creating new transactions
 * based on:
 * - Previously learned patterns (from user reconciliations)
 * - Expense-related keywords in descriptions
 * - Borrower name matching in descriptions
 * - Investor name matching in descriptions
 */

import { BaseMatcher } from './BaseMatcher';
import {
  extractVendorKeywords,
  levenshteinSimilarity,
  calculateSimilarity,
  descriptionContainsName
} from '../scoring';

export class PatternMatcher extends BaseMatcher {
  constructor(config = {}) {
    super(config);
    this.name = 'pattern';
    this.priority = config.priority ?? 30;
  }

  /**
   * Can match any entry
   */
  canMatch(entry, context) {
    return true;
  }

  /**
   * Generate pattern-based suggestions for creating new transactions
   */
  generateMatches(entry, context) {
    const {
      patterns,
      loans,
      borrowers,
      investors
    } = context;

    const matches = [];
    const entryAmount = Math.abs(entry.amount);
    const isCredit = entry.amount > 0;

    // 1. Match against learned patterns
    const patternMatches = this.findPatternMatches(entry, patterns || [], isCredit, entryAmount);
    matches.push(...patternMatches);

    // 2. Check for expense-related keywords (debits only)
    if (!isCredit) {
      const expenseMatch = this.findExpenseKeywordMatch(entry);
      if (expenseMatch) {
        matches.push(expenseMatch);
      }
    }

    // 3. Match by borrower name
    const borrowerMatch = this.findBorrowerNameMatch(entry, loans || [], borrowers || [], isCredit);
    if (borrowerMatch) {
      matches.push(borrowerMatch);
    }

    // 4. Match by investor name
    const investorMatch = this.findInvestorNameMatch(entry, investors || [], isCredit);
    if (investorMatch) {
      matches.push(investorMatch);
    }

    return matches;
  }

  /**
   * Match against learned patterns
   */
  findPatternMatches(entry, patterns, isCredit, entryAmount) {
    const matches = [];
    const entryVendorKeywords = extractVendorKeywords(entry.description);

    for (const pattern of patterns) {
      const patternKeywords = extractVendorKeywords(pattern.description_pattern);
      if (patternKeywords.length === 0) continue;

      // Calculate fuzzy keyword match score
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
        matches.push({
          type: pattern.match_type,
          matchMode: 'create',
          loan_id: pattern.loan_id,
          investor_id: pattern.investor_id,
          expense_type_id: pattern.expense_type_id,
          pattern_id: pattern.id,
          keywordScore,
          usageCount: pattern.match_count || 1,
          patternConfidence: pattern.confidence_score || 0.5,
          reason: `Pattern: "${pattern.description_pattern}" (used ${pattern.match_count || 1}x)`,
          defaultSplit: {
            capital: pattern.default_capital_ratio,
            interest: pattern.default_interest_ratio,
            fees: pattern.default_fees_ratio
          }
        });
      }
    }

    return matches;
  }

  /**
   * Check if description contains expense-related keywords
   */
  findExpenseKeywordMatch(entry) {
    const descLower = (entry.description || '').toLowerCase();
    const expenseKeywords = [
      'expense', 'expenses', 'bill', 'bills', 'fee', 'fees', 'charge', 'charges',
      'utilities', 'rent', 'insurance', 'subscription', 'office', 'supplies', 'maintenance',
      'professional', 'legal', 'accounting', 'tax', 'vat', 'hmrc', 'council', 'electric',
      'gas', 'water', 'phone', 'internet', 'broadband', 'software', 'license', 'licence'
    ];

    const hasExpenseKeyword = expenseKeywords.some(kw => descLower.includes(kw));

    if (hasExpenseKeyword) {
      return {
        type: 'expense',
        matchMode: 'create',
        expense_type_id: null,
        isExpenseKeyword: true,
        reason: 'Description contains expense keyword'
      };
    }

    return null;
  }

  /**
   * Match by borrower name in description
   */
  findBorrowerNameMatch(entry, loans, borrowers, isCredit) {
    // Skip if description contains expense-related words
    const descLower = (entry.description || '').toLowerCase();
    const expenseKeywords = ['expense', 'expenses', 'bill', 'bills', 'fee', 'fees'];
    const hasExpenseKeyword = expenseKeywords.some(kw => descLower.includes(kw));
    if (hasExpenseKeyword) return null;

    let bestMatch = null;
    let bestScore = 0;

    // Helper to get borrower name
    const getBorrowerName = (borrowerId) => {
      const borrower = borrowers.find(b => b.id === borrowerId);
      return borrower?.business_name || borrower?.name || '';
    };

    // Check active loans
    for (const loan of loans.filter(l => l.status === 'Live' || l.status === 'Active')) {
      const borrowerName = getBorrowerName(loan.borrower_id);
      if (!borrowerName) continue;

      const similarity = calculateSimilarity(entry.description, borrowerName);

      if (similarity > 0.5 && similarity > bestScore) {
        bestScore = similarity;
        bestMatch = {
          type: isCredit ? 'loan_repayment' : 'loan_disbursement',
          matchMode: 'create',
          loan_id: loan.id,
          loan,
          borrower: borrowers.find(b => b.id === loan.borrower_id),
          nameScore: similarity,
          reason: `Name match: ${borrowerName} (${loan.loan_number || 'Unknown'})`
        };
      }
    }

    return bestMatch;
  }

  /**
   * Match by investor name in description
   *
   * NOTE: This is for "create" mode suggestions only - use strict matching
   * to avoid false positives like "LOAN" matching "Bounce Back Loan Scheme"
   */
  findInvestorNameMatch(entry, investors, isCredit) {
    // Skip if description contains expense-related words
    const descLower = (entry.description || '').toLowerCase();
    const expenseKeywords = ['expense', 'expenses', 'bill', 'bills', 'fee', 'fees'];
    const hasExpenseKeyword = expenseKeywords.some(kw => descLower.includes(kw));
    if (hasExpenseKeyword) return null;

    let bestMatch = null;
    let bestScore = 0;

    for (const investor of investors) {
      const investorName = investor.business_name || investor.name || '';
      if (!investorName) continue;

      // Skip names that are ONLY generic financial terms
      // This prevents "Loan Scheme" or "Capital Fund" from matching everything
      // But allows unique names like "ADW" or "ABC Capital Partners"
      const genericTerms = ['loan', 'fund', 'funding', 'capital', 'investment', 'finance', 'scheme', 'limited', 'ltd'];
      const nameWords = investorName.toLowerCase().split(/\s+/).filter(w => w.length > 0);

      // Check if ALL significant words are generic terms
      const significantWords = nameWords.filter(w => w.length > 2);
      const isEntirelyGeneric = significantWords.length > 0 &&
        significantWords.every(w => genericTerms.includes(w));
      if (isEntirelyGeneric) continue;

      const nameScore = descriptionContainsName(
        entry.description,
        investor.name,
        investor.business_name
      );

      // Require much higher score for "create" mode suggestions (0.75 instead of 0.5)
      // This prevents false positives like "360 FUNDING LTD" matching "Bounce Back Loan Scheme"
      if (nameScore > 0.75 && nameScore > bestScore) {
        bestScore = nameScore;
        bestMatch = {
          type: isCredit ? 'investor_credit' : 'investor_withdrawal',
          matchMode: 'create',
          investor_id: investor.id,
          investor,
          nameScore,
          reason: `Investor name match: ${investorName}`
        };
      }
    }

    return bestMatch;
  }

  /**
   * Calculate confidence score for a pattern match
   */
  calculateConfidence(match, entry) {
    // For learned pattern matches
    if (match.pattern_id) {
      const usageBoost = Math.min((match.usageCount || 1) / 20, 0.15);
      return (match.patternConfidence || 0.5) * 0.6 + (match.keywordScore || 0) * 0.25 + usageBoost;
    }

    // For expense keyword matches
    if (match.isExpenseKeyword) {
      return 0.65;
    }

    // For name-based matches (borrower or investor)
    if (match.nameScore) {
      return match.nameScore;
    }

    return 0.35;
  }
}

export default PatternMatcher;
