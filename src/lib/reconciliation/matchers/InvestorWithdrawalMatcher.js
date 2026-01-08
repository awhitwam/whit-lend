/**
 * InvestorWithdrawalMatcher
 *
 * Matches bank debits (outgoing payments) to:
 * - Single investor capital_out transactions
 * - Single investor interest withdrawals (from investor_interest table)
 * - Grouped capital_out transactions from same investor
 * - Grouped interest withdrawals from same investor
 * - Cross-table combined matches (capital_out + interest for same investor)
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

export class InvestorWithdrawalMatcher extends BaseMatcher {
  constructor(config = {}) {
    super(config);
    this.name = 'investor_withdrawal';
    this.priority = config.priority ?? 75;
  }

  /**
   * Only match debits (outgoing payments)
   */
  canMatch(entry, context) {
    return entry.amount < 0;
  }

  /**
   * Generate matches for investor withdrawals
   */
  generateMatches(entry, context) {
    const {
      investorTransactions,
      investorInterestEntries,
      investors,
      reconciledTxIds,
      claimedTxIds,
      claimedInterestIds
    } = context;

    const matches = [];
    const entryAmount = Math.abs(entry.amount);

    // 1. Single capital_out matches
    for (const tx of investorTransactions || []) {
      if (tx.type !== 'capital_out') continue;
      if (reconciledTxIds?.has(tx.id)) continue;
      if (claimedTxIds?.has(tx.id)) continue;

      if (!datesWithinDays(entry.statement_date, tx.date, 30)) continue;

      const investor = investors.find(i => i.id === tx.investor_id);

      matches.push({
        type: 'investor_withdrawal',
        matchMode: 'match',
        existingTransaction: tx,
        investor,
        investor_id: tx.investor_id,
        reason: `Investor withdrawal: ${investor?.business_name || investor?.name || 'Unknown'} - ${formatCurrency(tx.amount)}`
      });
    }

    // 2. Single interest withdrawal matches
    for (const interest of investorInterestEntries || []) {
      if (interest.type !== 'debit') continue; // Only match interest withdrawals
      if (reconciledTxIds?.has(interest.id)) continue;
      if (claimedInterestIds?.has(interest.id)) continue;

      if (!datesWithinDays(entry.statement_date, interest.date, 30)) continue;

      const investor = investors.find(i => i.id === interest.investor_id);

      matches.push({
        type: 'interest_withdrawal',
        matchMode: 'match',
        existingInterest: interest,
        investor,
        investor_id: interest.investor_id,
        reason: `Interest withdrawal: ${investor?.business_name || investor?.name || 'Unknown'} - ${formatCurrency(interest.amount)}`
      });
    }

    // 3. Grouped capital_out transactions from same investor
    const groupedCapitalMatches = this.findGroupedCapitalMatches(entry, context);
    matches.push(...groupedCapitalMatches);

    // 4. Grouped interest withdrawals from same investor
    const groupedInterestMatches = this.findGroupedInterestMatches(entry, context);
    matches.push(...groupedInterestMatches);

    // 5. Cross-table combined matches (capital_out + interest)
    const crossTableMatches = this.findCrossTableMatches(entry, context);
    matches.push(...crossTableMatches);

    // 6. Multiple bank entries → single investor transaction
    const multiEntryMatches = this.findMultiEntryMatches(entry, context);
    matches.push(...multiEntryMatches);

    return matches;
  }

  /**
   * Find grouped capital_out transactions from the same investor
   */
  findGroupedCapitalMatches(entry, context) {
    const {
      investorTransactions,
      investors,
      reconciledTxIds,
      claimedTxIds
    } = context;

    const matches = [];
    const entryAmount = Math.abs(entry.amount);

    const txByInvestor = new Map();

    for (const tx of investorTransactions || []) {
      if (tx.type !== 'capital_out') continue;
      if (reconciledTxIds?.has(tx.id)) continue;
      if (claimedTxIds?.has(tx.id)) continue;

      const dateScore = dateProximityScore(entry.statement_date, tx.date);
      if (dateScore < 0.85) continue;

      const investorId = tx.investor_id;
      if (!txByInvestor.has(investorId)) {
        txByInvestor.set(investorId, []);
      }
      txByInvestor.get(investorId).push(tx);
    }

    for (const [investorId, txGroup] of txByInvestor) {
      if (txGroup.length < 2) continue;

      const groupTotal = txGroup.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

      if (amountsMatch(entryAmount, groupTotal, 1)) {
        const investor = investors.find(i => i.id === investorId);
        const allSameDay = txGroup.every(tx =>
          datesWithinDays(tx.date, entry.statement_date, 1)
        );

        matches.push({
          type: 'investor_withdrawal',
          matchMode: 'match_group',
          existingTransactions: txGroup,
          investor,
          investor_id: investorId,
          allSameDay,
          reason: `Grouped capital: ${investor?.business_name || investor?.name || 'Unknown'} - ${txGroup.length} transactions = ${formatCurrency(groupTotal)}`
        });
      }
    }

    return matches;
  }

  /**
   * Find grouped interest withdrawals from the same investor
   */
  findGroupedInterestMatches(entry, context) {
    const {
      investorInterestEntries,
      investors,
      reconciledTxIds,
      claimedInterestIds
    } = context;

    const matches = [];
    const entryAmount = Math.abs(entry.amount);

    const interestByInvestor = new Map();

    for (const interest of investorInterestEntries || []) {
      if (interest.type !== 'debit') continue;
      if (reconciledTxIds?.has(interest.id)) continue;
      if (claimedInterestIds?.has(interest.id)) continue;

      const dateScore = dateProximityScore(entry.statement_date, interest.date);
      if (dateScore < 0.85) continue;

      const investorId = interest.investor_id;
      if (!interestByInvestor.has(investorId)) {
        interestByInvestor.set(investorId, []);
      }
      interestByInvestor.get(investorId).push(interest);
    }

    for (const [investorId, interestGroup] of interestByInvestor) {
      if (interestGroup.length < 2) continue;

      const groupTotal = interestGroup.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);

      if (amountsMatch(entryAmount, groupTotal, 1)) {
        const investor = investors.find(i => i.id === investorId);
        const allSameDay = interestGroup.every(i =>
          datesWithinDays(i.date, entry.statement_date, 1)
        );

        matches.push({
          type: 'interest_withdrawal',
          matchMode: 'match_group',
          existingInterestEntries: interestGroup,
          investor,
          investor_id: investorId,
          allSameDay,
          reason: `Grouped interest: ${investor?.business_name || investor?.name || 'Unknown'} - ${interestGroup.length} entries = ${formatCurrency(groupTotal)}`
        });
      }
    }

    return matches;
  }

  /**
   * Find cross-table matches combining capital_out AND interest withdrawals for same investor
   */
  findCrossTableMatches(entry, context) {
    const {
      investorTransactions,
      investorInterestEntries,
      investors,
      reconciledTxIds,
      claimedTxIds,
      claimedInterestIds
    } = context;

    const matches = [];
    const entryAmount = Math.abs(entry.amount);

    const combinedByInvestor = new Map();

    // Add capital_out transactions
    for (const tx of investorTransactions || []) {
      if (tx.type !== 'capital_out') continue;
      if (reconciledTxIds?.has(tx.id)) continue;
      if (claimedTxIds?.has(tx.id)) continue;

      const dateScore = dateProximityScore(entry.statement_date, tx.date);
      if (dateScore < 0.85) continue;

      const investorId = tx.investor_id;
      if (!combinedByInvestor.has(investorId)) {
        combinedByInvestor.set(investorId, { capitalTxs: [], interestEntries: [] });
      }
      combinedByInvestor.get(investorId).capitalTxs.push(tx);
    }

    // Add interest entries
    for (const interest of investorInterestEntries || []) {
      if (interest.type !== 'debit') continue;
      if (reconciledTxIds?.has(interest.id)) continue;
      if (claimedInterestIds?.has(interest.id)) continue;

      const dateScore = dateProximityScore(entry.statement_date, interest.date);
      if (dateScore < 0.85) continue;

      const investorId = interest.investor_id;
      if (!combinedByInvestor.has(investorId)) {
        combinedByInvestor.set(investorId, { capitalTxs: [], interestEntries: [] });
      }
      combinedByInvestor.get(investorId).interestEntries.push(interest);
    }

    // Check combined totals
    for (const [investorId, { capitalTxs, interestEntries }] of combinedByInvestor) {
      // Must have at least one from EACH table
      if (capitalTxs.length === 0 || interestEntries.length === 0) continue;

      const capitalTotal = capitalTxs.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
      const interestTotal = interestEntries.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
      const combinedTotal = capitalTotal + interestTotal;

      if (amountsMatch(entryAmount, combinedTotal, 1)) {
        const investor = investors.find(i => i.id === investorId);

        matches.push({
          type: 'investor_withdrawal',
          matchMode: 'match_group',
          existingTransactions: capitalTxs,
          existingInterestEntries: interestEntries,
          investor,
          investor_id: investorId,
          isCrossTable: true,
          reason: `Combined: ${investor?.business_name || investor?.name || 'Unknown'} - ${capitalTxs.length} capital + ${interestEntries.length} interest = ${formatCurrency(combinedTotal)}`
        });
      }
    }

    return matches;
  }

  /**
   * Find matches where multiple bank debits sum to a single investor capital_out
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

    // Find all unreconciled debit entries within 3 days
    const nearbyDebits = (bankEntries || []).filter(other => {
      if (other.amount >= 0) return false; // Must be debit
      if (other.is_reconciled) return false;
      if (other.id !== entry.id && claimedTxIds?.has(other.id)) return false;
      return datesWithinDays(entry.statement_date, other.statement_date, 3);
    });

    // For each unreconciled investor capital_out, check if subset of bank entries sums to it
    for (const tx of investorTransactions || []) {
      if (tx.type !== 'capital_out') continue;
      if (reconciledTxIds?.has(tx.id)) continue;
      if (claimedTxIds?.has(tx.id)) continue;

      const txAmount = Math.abs(tx.amount);

      // Skip if single entry already matches
      if (amountsMatch(entryAmount, txAmount, 1)) continue;

      // Skip if this entry is larger than the transaction
      if (entryAmount > txAmount * 1.01) continue;

      // Find subset of bank entries that sum to transaction
      const matchingSubset = findSubsetSum(nearbyDebits, txAmount, entry.id);

      if (matchingSubset && matchingSubset.length >= 2) {
        const investor = investors.find(i => i.id === tx.investor_id);

        // Validate proximity to transaction
        const maxDaysFromTransaction = 14;
        const allEntriesNearTransaction = matchingSubset.every(e =>
          datesWithinDays(e.statement_date, tx.date, maxDaysFromTransaction)
        );
        if (!allEntriesNearTransaction) continue;

        // Validate entries are related
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
          type: 'investor_withdrawal',
          matchMode: 'grouped_investor',
          existingTransaction: tx,
          groupedEntries: matchingSubset,
          investor,
          investor_id: tx.investor_id,
          allSameDay,
          allNearTransaction,
          reason: `Split withdrawal: ${matchingSubset.length} payments → ${investor?.business_name || investor?.name || 'Unknown'} (${formatCurrency(txAmount)})`
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

    // For match_group (multiple txs → single bank)
    if (match.matchMode === 'match_group') {
      let score = match.isCrossTable ? 0.92 : (match.allSameDay ? 0.92 : 0.90);

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

    // For single transaction/interest matches
    const tx = match.existingTransaction || match.existingInterest;
    if (!tx) return 0;

    let score = calculateMatchScore(entry, tx, 'date');

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

export default InvestorWithdrawalMatcher;
