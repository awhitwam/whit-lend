/**
 * InvestorCreditMatcher
 *
 * Matches bank credits (incoming payments) to:
 * - Single investor capital_in transactions
 * - Grouped capital_in transactions from same investor
 * - Multiple bank entries → single investor transaction (grouped_investor)
 */

import { BaseMatcher } from './BaseMatcher';
import {
  calculateMatchScore,
  descriptionContainsName,
  datesWithinDays,
  dateProximityScore,
  amountsMatch,
  findSubsetSum,
  groupHasRelatedDescriptions
} from '../scoring';
import { formatCurrency } from '@/components/loan/LoanCalculator';

export class InvestorCreditMatcher extends BaseMatcher {
  constructor(config = {}) {
    super(config);
    this.name = 'investor_credit';
    this.priority = config.priority ?? 80;
  }

  /**
   * Only match credits (incoming payments)
   */
  canMatch(entry, context) {
    return entry.amount > 0;
  }

  /**
   * Generate matches for investor credits
   */
  generateMatches(entry, context) {
    const {
      investorTransactions,
      investors,
      reconciledTxIds,
      claimedTxIds
    } = context;

    const matches = [];
    const entryAmount = Math.abs(entry.amount);

    // 1. Single capital_in matches
    for (const tx of investorTransactions) {
      if (tx.type !== 'capital_in') continue;
      if (reconciledTxIds?.has(tx.id)) continue;
      if (claimedTxIds?.has(tx.id)) continue;

      // Check date proximity (within 30 days)
      if (!datesWithinDays(entry.statement_date, tx.date, 30)) continue;

      const investor = investors.find(i => i.id === tx.investor_id);

      matches.push({
        type: 'investor_credit',
        matchMode: 'match',
        existingTransaction: tx,
        investor,
        investor_id: tx.investor_id,
        reason: `Investor credit: ${investor?.business_name || investor?.name || 'Unknown'} - ${formatCurrency(tx.amount)}`
      });
    }

    // 2. Grouped capital_in transactions from same investor
    const groupedMatches = this.findGroupedMatches(entry, context);
    matches.push(...groupedMatches);

    // 3. Multiple bank entries → single investor transaction
    const multiEntryMatches = this.findMultiEntryMatches(entry, context);
    matches.push(...multiEntryMatches);

    return matches;
  }

  /**
   * Find grouped capital_in transactions from the same investor that sum to entry amount
   */
  findGroupedMatches(entry, context) {
    const {
      investorTransactions,
      investors,
      reconciledTxIds,
      claimedTxIds
    } = context;

    const matches = [];
    const entryAmount = Math.abs(entry.amount);

    // Group investor capital_in transactions by investor_id within 3 days
    const txByInvestor = new Map();

    for (const tx of investorTransactions) {
      if (tx.type !== 'capital_in') continue;
      if (reconciledTxIds?.has(tx.id)) continue;
      if (claimedTxIds?.has(tx.id)) continue;

      // Check date proximity (within 3 days)
      const dateScore = dateProximityScore(entry.statement_date, tx.date);
      if (dateScore < 0.85) continue;

      const investorId = tx.investor_id;
      if (!txByInvestor.has(investorId)) {
        txByInvestor.set(investorId, []);
      }
      txByInvestor.get(investorId).push(tx);
    }

    // Check if any investor's grouped transactions sum to the entry amount
    for (const [investorId, txGroup] of txByInvestor) {
      if (txGroup.length < 2) continue;

      const groupTotal = txGroup.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

      if (amountsMatch(entryAmount, groupTotal, 1)) {
        const investor = investors.find(i => i.id === investorId);
        const allSameDay = txGroup.every(tx =>
          datesWithinDays(tx.date, entry.statement_date, 1)
        );

        matches.push({
          type: 'investor_credit',
          matchMode: 'match_group',
          existingTransactions: txGroup,
          investor,
          investor_id: investorId,
          allSameDay,
          reason: `Grouped investor: ${investor?.business_name || investor?.name || 'Unknown'} - ${txGroup.length} transactions = ${formatCurrency(groupTotal)}`
        });
      }
    }

    return matches;
  }

  /**
   * Find matches where multiple bank entries sum to a single investor transaction
   */
  findMultiEntryMatches(entry, context) {
    const {
      investorTransactions,
      investors,
      reconciledTxIds,
      claimedTxIds,
      bankEntries
    } = context;

    const matches = [];
    const entryAmount = Math.abs(entry.amount);

    // Find all unreconciled credit entries within 3 days
    const nearbyCredits = (bankEntries || []).filter(other => {
      if (other.amount <= 0) return false; // Must be credit
      if (other.is_reconciled) return false;
      if (other.id !== entry.id && claimedTxIds?.has(other.id)) return false;
      return datesWithinDays(entry.statement_date, other.statement_date, 3);
    });

    // For each unreconciled investor capital_in, check if subset of bank entries sums to it
    for (const tx of investorTransactions) {
      if (tx.type !== 'capital_in') continue;
      if (reconciledTxIds?.has(tx.id)) continue;
      if (claimedTxIds?.has(tx.id)) continue;

      const txAmount = Math.abs(tx.amount);

      // Skip if single entry already matches
      if (amountsMatch(entryAmount, txAmount, 1)) continue;

      // Skip if this entry is larger than the transaction
      if (entryAmount > txAmount * 1.01) continue;

      // Find subset of bank entries that sum to transaction (must include current entry)
      const matchingSubset = findSubsetSum(nearbyCredits, txAmount, entry.id);

      if (matchingSubset && matchingSubset.length >= 2) {
        const investor = investors.find(i => i.id === tx.investor_id);

        // Validate: bank entries must be within 14 days of the investor transaction
        const maxDaysFromTransaction = 14;
        const allEntriesNearTransaction = matchingSubset.every(e =>
          datesWithinDays(e.statement_date, tx.date, maxDaysFromTransaction)
        );
        if (!allEntriesNearTransaction) continue;

        // Validate: entries should be related
        const entriesAreRelated = groupHasRelatedDescriptions(matchingSubset);
        const investorName = investor?.business_name || investor?.name || '';
        const hasInvestorName = investorName && matchingSubset.some(e =>
          descriptionContainsName(e.description, investorName, null) > 0.5
        );
        if (!entriesAreRelated && !hasInvestorName) continue;

        const allSameDay = matchingSubset.every(e =>
          datesWithinDays(e.statement_date, entry.statement_date, 0)
        );
        const allNearTransaction = matchingSubset.every(e =>
          datesWithinDays(e.statement_date, tx.date, 3)
        );

        matches.push({
          type: 'investor_credit',
          matchMode: 'grouped_investor',
          existingTransaction: tx,
          groupedEntries: matchingSubset,
          investor,
          investor_id: tx.investor_id,
          allSameDay,
          allNearTransaction,
          reason: `Split deposit: ${matchingSubset.length} payments → ${investor?.business_name || investor?.name || 'Unknown'} (${formatCurrency(txAmount)})`
        });
      }
    }

    return matches;
  }

  /**
   * Calculate confidence score for a match
   */
  calculateConfidence(match, entry) {
    // For grouped_investor matches (multiple bank → single tx)
    if (match.matchMode === 'grouped_investor' && match.groupedEntries) {
      let score;
      if (match.allSameDay && match.allNearTransaction) {
        score = 0.92;
      } else if (match.allSameDay) {
        score = 0.75;
      } else if (match.allNearTransaction) {
        score = 0.80;
      } else {
        score = 0.60;
      }

      // Name matching bonus
      if (match.investor) {
        const nameScore = descriptionContainsName(
          entry.description,
          match.investor.name,
          match.investor.business_name
        );
        if (nameScore > 0) {
          score = Math.min(score + (nameScore * 0.05), 0.95);
        }
      }

      return score;
    }

    // For match_group (multiple investor txs → single bank)
    if (match.matchMode === 'match_group' && match.existingTransactions) {
      let score = match.allSameDay ? 0.92 : 0.90;

      // Name matching bonus
      if (match.investor) {
        const nameScore = descriptionContainsName(
          entry.description,
          match.investor.name,
          match.investor.business_name
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
    if (match.investor) {
      const nameScore = descriptionContainsName(
        entry.description,
        match.investor.name,
        match.investor.business_name
      );
      if (nameScore > 0) {
        score = Math.min(score + (nameScore * 0.15), 0.99);
      }
    }

    return score;
  }
}

export default InvestorCreditMatcher;
