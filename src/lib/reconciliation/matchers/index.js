/**
 * Matcher Registry & Runner
 *
 * Manages the collection of matchers and runs them against bank entries
 * to find the best match suggestions.
 */

import { LoanRepaymentMatcher } from './LoanRepaymentMatcher';
import { LoanDisbursementMatcher } from './LoanDisbursementMatcher';
import { InvestorCreditMatcher } from './InvestorCreditMatcher';
import { InvestorWithdrawalMatcher } from './InvestorWithdrawalMatcher';
import { ExpenseMatcher } from './ExpenseMatcher';
import { PatternMatcher } from './PatternMatcher';

/**
 * Default matchers with their priorities
 * Higher priority matchers run first and produce more "important" matches
 */
export const defaultMatchers = [
  new LoanRepaymentMatcher({ priority: 90 }),      // Credits - loan repayments
  new LoanDisbursementMatcher({ priority: 85 }),   // Debits - loan disbursements
  new InvestorCreditMatcher({ priority: 80 }),     // Credits - investor deposits
  new InvestorWithdrawalMatcher({ priority: 75 }), // Debits - investor withdrawals
  new ExpenseMatcher({ priority: 50 }),            // Debits - business expenses
  new PatternMatcher({ priority: 30 }),            // Pattern-based suggestions (lowest)
];

/**
 * Run all enabled matchers against a bank entry and return the best match
 *
 * @param {Object} entry - Bank statement entry to match
 * @param {Object} context - Matching context with all transaction data
 * @param {Array} matchers - Array of matcher instances (default: defaultMatchers)
 * @returns {Object|null} Best match with confidence score, or null if no match
 */
export function runMatchers(entry, context, matchers = defaultMatchers) {
  const sortedMatchers = [...matchers]
    .filter(m => m.enabled)
    .sort((a, b) => b.priority - a.priority);

  let bestMatch = null;
  let bestScore = 0;

  for (const matcher of sortedMatchers) {
    if (!matcher.canMatch(entry, context)) continue;

    const matches = matcher.generateMatches(entry, context);

    for (const match of matches) {
      const score = matcher.calculateConfidence(match, entry);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          ...match,
          confidence: score,
          matcher: matcher.name
        };
      }
    }
  }

  // Only return matches above minimum threshold
  if (bestMatch && bestScore >= 0.35) {
    return bestMatch;
  }

  return null;
}

/**
 * Run matchers for all unreconciled bank entries
 * Returns a Map of entryId -> suggestion
 *
 * @param {Array} entries - Bank entries (will filter to unreconciled)
 * @param {Object} baseContext - Base context (transactions, loans, etc.)
 * @param {Array} matchers - Matcher instances to use
 * @returns {Map<string, Object>} Map of entry ID to best suggestion
 */
export function generateAllSuggestions(entries, baseContext, matchers = defaultMatchers) {
  const suggestions = new Map();

  // Filter to unreconciled entries and sort by date (oldest first)
  const unreconciled = entries
    .filter(e => !e.is_reconciled)
    .sort((a, b) => new Date(a.statement_date) - new Date(b.statement_date));

  // Build context with claiming sets
  const context = {
    ...baseContext,
    bankEntries: unreconciled,
    claimedTxIds: new Set(),
    claimedExpenseIds: new Set(),
    claimedInterestIds: new Set(),
  };

  // Process each entry in date order
  for (const entry of unreconciled) {
    const suggestion = runMatchers(entry, context, matchers);

    if (suggestion) {
      suggestions.set(entry.id, suggestion);

      // Claim matched transactions to prevent duplicate matches
      if (suggestion.existingTransaction) {
        context.claimedTxIds.add(suggestion.existingTransaction.id);
      }
      if (suggestion.existingTransactions) {
        suggestion.existingTransactions.forEach(tx => context.claimedTxIds.add(tx.id));
      }
      if (suggestion.existingExpense) {
        context.claimedExpenseIds.add(suggestion.existingExpense.id);
      }
      if (suggestion.existingInterest) {
        context.claimedInterestIds.add(suggestion.existingInterest.id);
      }
      if (suggestion.existingInterestEntries) {
        suggestion.existingInterestEntries.forEach(i => context.claimedInterestIds.add(i.id));
      }
    }
  }

  return suggestions;
}

/**
 * Create a custom matcher set with specific matchers enabled/disabled
 *
 * @param {Object} config - Configuration object
 * @param {boolean} config.loanRepayments - Enable loan repayment matching
 * @param {boolean} config.loanDisbursements - Enable loan disbursement matching
 * @param {boolean} config.investorCredits - Enable investor credit matching
 * @param {boolean} config.investorWithdrawals - Enable investor withdrawal matching
 * @param {boolean} config.expenses - Enable expense matching
 * @param {boolean} config.patterns - Enable pattern-based matching
 * @returns {Array} Array of matcher instances
 */
export function createMatcherSet(config = {}) {
  const matchers = [];

  if (config.loanRepayments !== false) {
    matchers.push(new LoanRepaymentMatcher({ priority: 90 }));
  }
  if (config.loanDisbursements !== false) {
    matchers.push(new LoanDisbursementMatcher({ priority: 85 }));
  }
  if (config.investorCredits !== false) {
    matchers.push(new InvestorCreditMatcher({ priority: 80 }));
  }
  if (config.investorWithdrawals !== false) {
    matchers.push(new InvestorWithdrawalMatcher({ priority: 75 }));
  }
  if (config.expenses !== false) {
    matchers.push(new ExpenseMatcher({ priority: 50 }));
  }
  if (config.patterns !== false) {
    matchers.push(new PatternMatcher({ priority: 30 }));
  }

  return matchers;
}

// Re-export matcher classes for custom instantiation
export { BaseMatcher } from './BaseMatcher';
export { LoanRepaymentMatcher } from './LoanRepaymentMatcher';
export { LoanDisbursementMatcher } from './LoanDisbursementMatcher';
export { InvestorCreditMatcher } from './InvestorCreditMatcher';
export { InvestorWithdrawalMatcher } from './InvestorWithdrawalMatcher';
export { ExpenseMatcher } from './ExpenseMatcher';
export { PatternMatcher } from './PatternMatcher';
