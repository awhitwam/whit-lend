/**
 * LoanRepaymentMatcher
 *
 * Matches bank credits (incoming payments) to:
 * - Single loan repayment transactions
 * - Grouped repayments from same borrower
 * - Grouped repayments from borrowers sharing the same email
 */

import { BaseMatcher } from './BaseMatcher';
import {
  calculateMatchScore,
  descriptionContainsName,
  datesWithinDays,
  amountsMatch
} from '../scoring';
import { formatCurrency } from '@/components/loan/LoanCalculator';

export class LoanRepaymentMatcher extends BaseMatcher {
  constructor(config = {}) {
    super(config);
    this.name = 'loan_repayment';
    this.priority = config.priority ?? 90;
  }

  /**
   * Only match credits (incoming payments)
   */
  canMatch(entry, context) {
    return entry.amount > 0;
  }

  /**
   * Generate matches for loan repayments
   */
  generateMatches(entry, context) {
    const {
      loanTransactions,
      loans,
      borrowers,
      reconciledTxIds,
      claimedTxIds
    } = context;

    const matches = [];
    const entryAmount = Math.abs(entry.amount);

    // 1. Single repayment matches
    for (const tx of loanTransactions) {
      if (tx.type !== 'Repayment') continue;
      if (tx.is_deleted) continue;
      if (reconciledTxIds?.has(tx.id)) continue;
      if (claimedTxIds?.has(tx.id)) continue;

      // Check if date is reasonable (within 30 days)
      if (!datesWithinDays(entry.statement_date, tx.date, 30)) continue;

      const loan = loans.find(l => l.id === tx.loan_id);
      const borrower = borrowers.find(b => b.id === (loan?.borrower_id || tx.borrower_id));

      matches.push({
        type: 'loan_repayment',
        matchMode: 'match',
        existingTransaction: tx,
        loan,
        borrower,
        reason: `Repayment: ${borrower?.business || borrower?.full_name || loan?.borrower_name || 'Unknown'} - ${formatCurrency(tx.amount)}`
      });
    }

    // 2. Grouped repayments from same borrower
    const groupedMatches = this.findGroupedMatches(entry, context);
    matches.push(...groupedMatches);

    // 3. Grouped repayments from borrowers sharing email
    const emailGroupedMatches = this.findEmailGroupedMatches(entry, context);
    matches.push(...emailGroupedMatches);

    // 4. Date-based grouped repayments (any borrowers, same date, amounts sum to bank entry)
    const dateGroupedMatches = this.findDateGroupedMatches(entry, context);
    matches.push(...dateGroupedMatches);

    return matches;
  }

  /**
   * Find grouped repayments from the same borrower
   */
  findGroupedMatches(entry, context) {
    const {
      loanTransactions,
      loans,
      borrowers,
      reconciledTxIds,
      claimedTxIds
    } = context;

    const matches = [];
    const entryAmount = Math.abs(entry.amount);

    // Group unreconciled repayments by borrower_id within 3 days
    const repaymentsByBorrower = new Map();

    for (const tx of loanTransactions) {
      if (tx.is_deleted) continue;
      if (reconciledTxIds?.has(tx.id)) continue;
      if (claimedTxIds?.has(tx.id)) continue;
      if (tx.type !== 'Repayment') continue;

      // Check date proximity
      if (!datesWithinDays(entry.statement_date, tx.date, 3)) continue;

      const loan = loans.find(l => l.id === tx.loan_id);
      const borrowerId = loan?.borrower_id || tx.borrower_id;
      if (!borrowerId) continue;

      if (!repaymentsByBorrower.has(borrowerId)) {
        repaymentsByBorrower.set(borrowerId, []);
      }
      repaymentsByBorrower.get(borrowerId).push(tx);
    }

    // Check if any borrower's grouped transactions sum to the entry amount
    for (const [borrowerId, txGroup] of repaymentsByBorrower) {
      if (txGroup.length < 2) continue; // Only interested in groups of 2+

      const groupTotal = txGroup.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

      if (amountsMatch(entryAmount, groupTotal, 1)) {
        const borrower = borrowers.find(b => b.id === borrowerId);
        const allSameDay = txGroup.every(tx =>
          datesWithinDays(tx.date, entry.statement_date, 1)
        );

        const loanNumbers = [...new Set(txGroup.map(tx => {
          const l = loans.find(loan => loan.id === tx.loan_id);
          return l?.loan_number || '?';
        }))].join(', ');

        matches.push({
          type: 'loan_repayment',
          matchMode: 'match_group',
          existingTransactions: txGroup,
          borrower_id: borrowerId,
          borrower,
          allSameDay,
          reason: `Grouped repayments: ${borrower?.business || borrower?.full_name || 'Unknown'} - ${txGroup.length} payments (${loanNumbers}) = ${formatCurrency(groupTotal)}`
        });
      }
    }

    return matches;
  }

  /**
   * Find grouped repayments from borrowers sharing the same email
   */
  findEmailGroupedMatches(entry, context) {
    const {
      loanTransactions,
      loans,
      borrowers,
      reconciledTxIds,
      claimedTxIds
    } = context;

    const matches = [];
    const entryAmount = Math.abs(entry.amount);

    // Build a map of borrower email -> borrower IDs
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

    // For each email with multiple borrowers, check if combined repayments match
    for (const [email, borrowerIds] of emailToBorrowerIds) {
      if (borrowerIds.size < 2) continue; // Only if multiple borrowers share this email

      // Collect all repayments from these borrowers within date range
      const combinedRepayments = [];
      for (const tx of loanTransactions) {
        if (tx.is_deleted) continue;
        if (reconciledTxIds?.has(tx.id)) continue;
        if (claimedTxIds?.has(tx.id)) continue;
        if (tx.type !== 'Repayment') continue;

        const loan = loans.find(l => l.id === tx.loan_id);
        const borrowerId = loan?.borrower_id || tx.borrower_id;

        if (!borrowerIds.has(borrowerId)) continue;
        if (!datesWithinDays(entry.statement_date, tx.date, 3)) continue;

        combinedRepayments.push(tx);
      }

      if (combinedRepayments.length < 2) continue;

      const groupTotal = combinedRepayments.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

      if (amountsMatch(entryAmount, groupTotal, 1)) {
        const allSameDay = combinedRepayments.every(tx =>
          datesWithinDays(tx.date, entry.statement_date, 1)
        );

        matches.push({
          type: 'loan_repayment',
          matchMode: 'match_group',
          existingTransactions: combinedRepayments,
          email,
          allSameDay,
          reason: `Email-grouped repayments: ${email} - ${combinedRepayments.length} payments = ${formatCurrency(groupTotal)}`
        });
      }
    }

    return matches;
  }

  /**
   * Find grouped repayments by date (any borrowers, as long as amounts sum correctly)
   * This handles the case where a single bank transfer contains payments from multiple borrowers
   * Tries different date windows: same day first, then 3 days, then 7 days (with lower confidence)
   */
  findDateGroupedMatches(entry, context) {
    const {
      loanTransactions,
      loans,
      borrowers,
      reconciledTxIds,
      claimedTxIds
    } = context;

    const matches = [];
    const entryAmount = Math.abs(entry.amount);

    // Helper to get borrower name
    const getBorrowerName = (tx) => {
      const loan = loans.find(l => l.id === tx.loan_id);
      const borrower = borrowers.find(b => b.id === (loan?.borrower_id || tx.borrower_id));
      return borrower?.business || borrower?.full_name || 'Unknown';
    };

    // Helper to calculate max date difference from bank entry
    const getMaxDateDiff = (txs) => {
      if (!entry.statement_date) return 0;
      const bankDate = new Date(entry.statement_date);
      let maxDiff = 0;
      for (const tx of txs) {
        if (tx.date) {
          const txDate = new Date(tx.date);
          const diff = Math.abs(Math.round((bankDate - txDate) / (1000 * 60 * 60 * 24)));
          if (diff > maxDiff) maxDiff = diff;
        }
      }
      return maxDiff;
    };

    // Try different date windows - start with tightest match first
    const dateWindows = [1, 3, 7];

    for (const dayWindow of dateWindows) {
      // Collect all unreconciled repayments within this date window
      const repaymentsInWindow = [];
      for (const tx of loanTransactions) {
        if (tx.is_deleted) continue;
        if (reconciledTxIds?.has(tx.id)) continue;
        if (claimedTxIds?.has(tx.id)) continue;
        if (tx.type !== 'Repayment') continue;

        if (!datesWithinDays(entry.statement_date, tx.date, dayWindow)) continue;

        repaymentsInWindow.push(tx);
      }

      // Need at least 2 repayments to form a group
      if (repaymentsInWindow.length < 2) continue;

      // Case 1: All repayments in window sum to entry
      const totalAll = repaymentsInWindow.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
      if (amountsMatch(entryAmount, totalAll, 1)) {
        const borrowerNames = [...new Set(repaymentsInWindow.map(getBorrowerName))];
        const maxDateDiff = getMaxDateDiff(repaymentsInWindow);

        matches.push({
          type: 'loan_repayment',
          matchMode: 'match_group',
          existingTransactions: repaymentsInWindow,
          allSameDay: maxDateDiff <= 1,
          maxDateDiff,
          isDateGrouped: true,
          reason: `Date-grouped repayments: ${repaymentsInWindow.length} payments from ${borrowerNames.join(', ')} = ${formatCurrency(totalAll)}`
        });
        return matches; // Found best match, return it
      }

      // Case 2: Try pairs (most common scenario - 2 payments)
      for (let i = 0; i < repaymentsInWindow.length; i++) {
        for (let j = i + 1; j < repaymentsInWindow.length; j++) {
          const tx1 = repaymentsInWindow[i];
          const tx2 = repaymentsInWindow[j];
          const pairTotal = (parseFloat(tx1.amount) || 0) + (parseFloat(tx2.amount) || 0);

          if (amountsMatch(entryAmount, pairTotal, 1)) {
            const maxDateDiff = getMaxDateDiff([tx1, tx2]);

            matches.push({
              type: 'loan_repayment',
              matchMode: 'match_group',
              existingTransactions: [tx1, tx2],
              allSameDay: maxDateDiff <= 1,
              maxDateDiff,
              isDateGrouped: true,
              reason: `Date-grouped repayments: ${getBorrowerName(tx1)} (${formatCurrency(tx1.amount)}) + ${getBorrowerName(tx2)} (${formatCurrency(tx2.amount)}) = ${formatCurrency(pairTotal)}`
            });
          }
        }
      }

      // If we found matches in this window, return them (tightest date window wins)
      if (matches.length > 0) {
        return matches;
      }

      // Case 3: Try triplets if no pair found and we have 3+ repayments
      if (repaymentsInWindow.length >= 3) {
        for (let i = 0; i < repaymentsInWindow.length; i++) {
          for (let j = i + 1; j < repaymentsInWindow.length; j++) {
            for (let k = j + 1; k < repaymentsInWindow.length; k++) {
              const txs = [repaymentsInWindow[i], repaymentsInWindow[j], repaymentsInWindow[k]];
              const tripletTotal = txs.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

              if (amountsMatch(entryAmount, tripletTotal, 1)) {
                const maxDateDiff = getMaxDateDiff(txs);

                matches.push({
                  type: 'loan_repayment',
                  matchMode: 'match_group',
                  existingTransactions: txs,
                  allSameDay: maxDateDiff <= 1,
                  maxDateDiff,
                  isDateGrouped: true,
                  reason: `Date-grouped repayments: 3 payments = ${formatCurrency(tripletTotal)}`
                });
              }
            }
          }
        }

        if (matches.length > 0) {
          return matches;
        }
      }
    }

    return matches;
  }

  /**
   * Calculate confidence score for a match
   */
  calculateConfidence(match, entry) {
    // For grouped matches, use group-specific scoring
    if (match.matchMode === 'match_group' && match.existingTransactions) {
      const groupTotal = match.existingTransactions.reduce(
        (sum, tx) => sum + (parseFloat(tx.amount) || 0), 0
      );

      // Base score depends on date proximity
      let score;
      const maxDateDiff = match.maxDateDiff || 0;

      if (maxDateDiff <= 1) {
        score = 0.92; // Same day or 1 day apart
      } else if (maxDateDiff <= 3) {
        score = 0.85; // 2-3 days apart
      } else if (maxDateDiff <= 7) {
        score = 0.75; // 4-7 days apart
      } else {
        score = 0.65; // More than a week
      }

      // Email-grouped is slightly less confident than borrower-grouped
      if (match.email) {
        score -= 0.03;
      }

      // Date-grouped (different borrowers) is slightly less confident
      // but still a strong match since date + amount sum is exact
      if (match.isDateGrouped) {
        score -= 0.05;
      }

      // Check for name match bonus
      if (match.borrower) {
        const nameScore = descriptionContainsName(
          entry.description,
          match.borrower.full_name,
          match.borrower.business
        );
        if (nameScore > 0) {
          score = Math.min(score + (nameScore * 0.05), 0.95);
        }
      }

      return score;
    }

    // For single transaction matches
    const tx = match.existingTransaction;
    if (!tx) return 0;

    let score = calculateMatchScore(entry, tx, 'date');

    // Name matching bonus
    if (match.borrower) {
      const nameScore = descriptionContainsName(
        entry.description,
        match.borrower.full_name,
        match.borrower.business
      );
      if (nameScore > 0) {
        score = Math.min(score + (nameScore * 0.15), 0.99);
      }
    }

    return score;
  }
}

export default LoanRepaymentMatcher;
