/**
 * BaseMatcher - Abstract base class for reconciliation matchers
 *
 * Each matcher is responsible for:
 * 1. Determining if it can handle a bank entry (canMatch)
 * 2. Generating potential matches for an entry (generateMatches)
 * 3. Calculating confidence scores for matches (calculateConfidence)
 *
 * Extend this class to create new matchers for different transaction types.
 */

export class BaseMatcher {
  /**
   * @param {Object} config - Configuration options
   * @param {number} config.priority - Priority 0-100, higher runs first (default 50)
   * @param {boolean} config.enabled - Whether matcher is active (default true)
   */
  constructor(config = {}) {
    this.name = 'base';
    this.priority = config.priority ?? 50;
    this.enabled = config.enabled ?? true;
  }

  /**
   * Check if this matcher can handle the bank entry
   *
   * Override in subclasses to filter by entry type (credit/debit), amount range, etc.
   *
   * @param {Object} entry - Bank statement entry
   * @param {number} entry.amount - Entry amount (positive = credit, negative = debit)
   * @param {string} entry.statement_date - Entry date (ISO string)
   * @param {string} entry.description - Entry description
   * @param {Object} context - Matching context with transactions, loans, etc.
   * @returns {boolean}
   */
  canMatch(entry, context) {
    return false;
  }

  /**
   * Generate potential matches for a bank entry
   *
   * Override in subclasses to implement matching logic.
   * Return all potential matches - scoring will determine the best one.
   *
   * @param {Object} entry - Bank statement entry
   * @param {Object} context - Matching context
   * @param {Array} context.loanTransactions - All loan transactions
   * @param {Array} context.investorTransactions - All investor transactions
   * @param {Array} context.expenses - All expenses
   * @param {Array} context.loans - All loans
   * @param {Array} context.borrowers - All borrowers
   * @param {Array} context.investors - All investors
   * @param {Set} context.reconciledTxIds - IDs of already reconciled transactions
   * @param {Set} context.claimedTxIds - IDs claimed by earlier entries (prevents duplicates)
   * @returns {Array<Match>} Array of potential matches
   */
  generateMatches(entry, context) {
    return [];
  }

  /**
   * Calculate confidence score for a specific match
   *
   * Override in subclasses to implement scoring logic.
   *
   * @param {Object} match - A match object from generateMatches
   * @param {Object} entry - The bank entry being matched
   * @returns {number} Confidence score from 0.0 to 1.0
   */
  calculateConfidence(match, entry) {
    return 0;
  }

  /**
   * Get human-readable description of this matcher
   * @returns {string}
   */
  getDescription() {
    return `${this.name} (priority: ${this.priority})`;
  }
}

/**
 * @typedef {Object} Match
 * @property {string} type - Reconciliation type (e.g., 'loan_repayment', 'investor_credit')
 * @property {string} matchMode - How to reconcile ('match', 'create', 'match_group', 'grouped_disbursement', 'grouped_investor')
 * @property {Object} [existingTransaction] - Single existing transaction to match
 * @property {Array} [existingTransactions] - Multiple existing transactions (for grouped matches)
 * @property {Array} [groupedEntries] - Multiple bank entries (for grouped disbursement/investor)
 * @property {Object} [loan] - Associated loan (for loan transactions)
 * @property {Object} [borrower] - Associated borrower
 * @property {Object} [investor] - Associated investor
 * @property {string} reason - Human-readable explanation of the match
 * @property {number} [confidence] - Score 0-1 (set by matcher runner)
 * @property {string} [matcher] - Name of matcher that generated this (set by runner)
 */

/**
 * @typedef {Object} MatchContext
 * @property {Array} bankEntries - All bank entries (for grouped matching)
 * @property {Array} loanTransactions - Loan transactions
 * @property {Array} investorTransactions - Investor transactions
 * @property {Array} investorInterestEntries - Investor interest entries
 * @property {Array} expenses - Expense records
 * @property {Array} loans - Loan records
 * @property {Array} borrowers - Borrower records
 * @property {Array} investors - Investor records
 * @property {Array} patterns - Learned reconciliation patterns
 * @property {Set} reconciledTxIds - Already reconciled transaction IDs
 * @property {Set} claimedTxIds - Transaction IDs claimed by earlier entries
 * @property {Set} claimedExpenseIds - Expense IDs claimed by earlier entries
 * @property {Set} claimedInterestIds - Interest IDs claimed by earlier entries
 */

export default BaseMatcher;
