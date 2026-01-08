/**
 * LoanDisbursementMatcher
 *
 * Matches bank debits (outgoing payments) to:
 * - Single loan disbursement transactions
 * - Grouped disbursements (multiple bank debits → single disbursement)
 */

import { BaseMatcher } from './BaseMatcher';
import {
  calculateMatchScore,
  descriptionContainsName,
  datesWithinDays,
  amountsMatch,
  findSubsetSum,
  groupHasRelatedDescriptions
} from '../scoring';
import { formatCurrency } from '@/components/loan/LoanCalculator';

export class LoanDisbursementMatcher extends BaseMatcher {
  constructor(config = {}) {
    super(config);
    this.name = 'loan_disbursement';
    this.priority = config.priority ?? 85;
  }

  /**
   * Only match debits (outgoing payments)
   */
  canMatch(entry, context) {
    return entry.amount < 0;
  }

  /**
   * Generate matches for loan disbursements
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

    // 1. Single disbursement matches
    for (const tx of loanTransactions) {
      if (tx.type !== 'Disbursement') continue;
      if (tx.is_deleted) continue;
      if (reconciledTxIds?.has(tx.id)) continue;
      if (claimedTxIds?.has(tx.id)) continue;

      // Check date proximity (within 30 days)
      if (!datesWithinDays(entry.statement_date, tx.date, 30)) continue;

      const loan = loans.find(l => l.id === tx.loan_id);
      const borrower = borrowers.find(b => b.id === (loan?.borrower_id || tx.borrower_id));

      matches.push({
        type: 'loan_disbursement',
        matchMode: 'match',
        existingTransaction: tx,
        loan,
        borrower,
        loan_id: tx.loan_id,
        reason: `Disbursement: ${borrower?.business_name || borrower?.name || loan?.borrower_name || 'Unknown'} - ${formatCurrency(tx.amount)}`
      });
    }

    // 2. Grouped disbursement matches (multiple bank debits → single disbursement)
    const groupedMatches = this.findGroupedMatches(entry, context);
    matches.push(...groupedMatches);

    return matches;
  }

  /**
   * Find grouped disbursement matches where multiple bank debits sum to a single disbursement
   */
  findGroupedMatches(entry, context) {
    const {
      loanTransactions,
      loans,
      borrowers,
      reconciledTxIds,
      claimedTxIds,
      bankEntries
    } = context;

    const matches = [];
    const entryAmount = Math.abs(entry.amount);

    // Find all unreconciled debits within 3 days of this entry
    const nearbyDebits = (bankEntries || []).filter(other => {
      if (other.amount >= 0) return false; // Must be debit
      if (other.is_reconciled) return false;
      if (other.id !== entry.id && claimedTxIds?.has(other.id)) return false;
      return datesWithinDays(entry.statement_date, other.statement_date, 3);
    });

    // For each Disbursement transaction, check if any subset of debits sums to it
    for (const tx of loanTransactions) {
      if (tx.type !== 'Disbursement') continue;
      if (tx.is_deleted) continue;
      if (reconciledTxIds?.has(tx.id)) continue;
      if (claimedTxIds?.has(tx.id)) continue;

      const disbursementAmount = Math.abs(tx.amount);

      // Skip if this single entry already matches (handled above)
      if (amountsMatch(entryAmount, disbursementAmount, 1)) continue;

      // Skip if this entry is larger than the disbursement
      if (entryAmount > disbursementAmount * 1.01) continue;

      // Find subset of debits that sum to disbursement (must include current entry)
      const matchingSubset = findSubsetSum(
        nearbyDebits,
        disbursementAmount,
        entry.id
      );

      if (matchingSubset && matchingSubset.length >= 2) {
        const loan = loans.find(l => l.id === tx.loan_id);
        const borrower = borrowers.find(b => b.id === loan?.borrower_id);

        // Check that bank entries are within reasonable date range of the disbursement
        const txDate = tx.date;
        const maxDaysFromTransaction = 14;
        const allEntriesNearTransaction = matchingSubset.every(e =>
          datesWithinDays(e.statement_date, txDate, maxDaysFromTransaction)
        );

        // Skip if bank entries are too far from the transaction date
        if (!allEntriesNearTransaction) continue;

        // Validate that grouped entries are actually related
        const entriesAreRelated = groupHasRelatedDescriptions(matchingSubset);
        const borrowerName = loan?.borrower_name || borrower?.name || '';
        const hasBorrowerName = borrowerName && matchingSubset.some(e =>
          descriptionContainsName(e.description, borrowerName, null) > 0.5
        );

        // Skip if entries don't appear to be related
        if (!entriesAreRelated && !hasBorrowerName) continue;

        const allSameDay = matchingSubset.every(e =>
          datesWithinDays(e.statement_date, entry.statement_date, 0)
        );

        const allNearTransaction = matchingSubset.every(e =>
          datesWithinDays(e.statement_date, txDate, 3)
        );

        matches.push({
          type: 'loan_disbursement',
          matchMode: 'grouped_disbursement',
          existingTransaction: tx,
          groupedEntries: matchingSubset,
          loan,
          borrower,
          loan_id: tx.loan_id,
          allSameDay,
          allNearTransaction,
          reason: `Split disbursement: ${matchingSubset.length} payments → ${loan?.loan_number || 'Unknown'} (${borrower?.business_name || borrower?.name || loan?.borrower_name || 'Unknown'})`
        });
      }
    }

    return matches;
  }

  /**
   * Calculate confidence score for a match
   */
  calculateConfidence(match, entry) {
    // For grouped disbursement matches
    if (match.matchMode === 'grouped_disbursement' && match.groupedEntries) {
      let score;

      if (match.allSameDay && match.allNearTransaction) {
        score = 0.92; // Same day entries, within 3 days of transaction
      } else if (match.allSameDay) {
        score = 0.75; // Same day entries, but further from transaction
      } else if (match.allNearTransaction) {
        score = 0.80; // Different day entries, but close to transaction
      } else {
        score = 0.60; // Different days, further from transaction
      }

      // Name matching bonus
      if (match.borrower) {
        const nameScore = descriptionContainsName(
          entry.description,
          match.borrower.name,
          match.borrower.business_name
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
        match.borrower.name,
        match.borrower.business_name
      );
      if (nameScore > 0) {
        score = Math.min(score + (nameScore * 0.15), 0.99);
      }
    }

    return score;
  }
}

export default LoanDisbursementMatcher;
