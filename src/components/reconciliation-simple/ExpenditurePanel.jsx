/**
 * Expenditure Panel - Handles debit bank entries
 *
 * Shows matching suggestions for:
 * - Loan disbursements
 * - Investor withdrawals
 * - Expenses
 *
 * Allows creating new transactions inline.
 */

import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import BankEntryRow from './BankEntryRow';
import { extractVendorKeywords, levenshteinSimilarity } from '@/lib/reconciliation/scoring';
import { findSubsetSum, groupHasRelatedDescriptions, descriptionContainsName, datesWithinDays, amountsMatch } from '@/lib/reconciliation/utils';

export default function ExpenditurePanel({
  entries,
  loans,
  borrowers,
  investors,
  transactions,
  investorTransactions,
  investorInterestEntries = [],
  expenses,
  expenseTypes,
  patterns = [],
  reconciliationEntries = [],
  onReconciled
}) {
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc' or 'desc'

  // Build set of already-reconciled transaction IDs for quick lookup
  const reconciledTxIds = useMemo(() => {
    const ids = new Set();
    reconciliationEntries.forEach(re => {
      if (re.loan_transaction_id) ids.add(re.loan_transaction_id);
      if (re.investor_transaction_id) ids.add(re.investor_transaction_id);
      if (re.interest_id) ids.add(re.interest_id);
      if (re.expense_id) ids.add(re.expense_id);
    });
    return ids;
  }, [reconciliationEntries]);

  // Generate expense type suggestions from learned patterns
  const expenseTypeSuggestions = useMemo(() => {
    const suggestions = new Map(); // Map<entryId, { expenseTypeId, expenseTypeName, confidence, reason }>

    entries.forEach(entry => {
      const entryKeywords = extractVendorKeywords(entry.description);
      if (entryKeywords.length === 0) return;

      let bestMatch = null;
      let bestScore = 0;

      // Check patterns that have expense_type_id set
      for (const pattern of patterns) {
        if (!pattern.expense_type_id) continue;
        if (pattern.transaction_type && pattern.transaction_type !== 'DBIT') continue;

        const patternKeywords = extractVendorKeywords(pattern.description_pattern);
        if (patternKeywords.length === 0) continue;

        // Calculate match score using fuzzy matching
        let matchCount = 0;
        for (const entryKw of entryKeywords) {
          for (const patternKw of patternKeywords) {
            // Check exact match, partial match, or fuzzy match
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

        // Check amount range if pattern has it
        const entryAmount = Math.abs(entry.amount);
        const inAmountRange = (!pattern.amount_min || entryAmount >= pattern.amount_min * 0.8) &&
                              (!pattern.amount_max || entryAmount <= pattern.amount_max * 1.2);

        // Require at least 30% keyword match and reasonable amount
        if (keywordScore >= 0.3 && inAmountRange) {
          // Boost score based on pattern usage count
          const usageBoost = Math.min((pattern.match_count || 1) / 10, 0.2);
          const totalScore = keywordScore * 0.7 + (pattern.confidence_score || 0.5) * 0.2 + usageBoost;

          if (totalScore > bestScore) {
            bestScore = totalScore;
            const expenseType = expenseTypes.find(t => t.id === pattern.expense_type_id);
            bestMatch = {
              expenseTypeId: pattern.expense_type_id,
              expenseTypeName: expenseType?.name || 'Unknown',
              confidence: Math.min(totalScore, 0.95),
              reason: `Pattern: "${pattern.description_pattern}" (used ${pattern.match_count || 1}x)`,
              patternId: pattern.id
            };
          }
        }
      }

      if (bestMatch && bestMatch.confidence >= 0.35) {
        suggestions.set(entry.id, bestMatch);
      }
    });

    return suggestions;
  }, [entries, patterns, expenseTypes]);

  // Generate suggestions for each entry and sort
  const entriesWithSuggestions = useMemo(() => {
    const withSuggestions = entries.map(entry => {
      const suggestions = generateExpenditureSuggestions(
        entry,
        entries,
        loans,
        borrowers,
        investors,
        transactions,
        investorTransactions,
        investorInterestEntries,
        expenses,
        reconciledTxIds
      );
      // Include expense type suggestion from patterns
      const expenseTypeSuggestion = expenseTypeSuggestions.get(entry.id);
      return { entry, suggestions, expenseTypeSuggestion };
    });

    // Sort by date
    withSuggestions.sort((a, b) => {
      const dateA = new Date(a.entry.statement_date);
      const dateB = new Date(b.entry.statement_date);
      return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });

    return withSuggestions;
  }, [entries, loans, borrowers, investors, transactions, investorTransactions, investorInterestEntries, expenses, reconciledTxIds, sortOrder, expenseTypeSuggestions]);

  const toggleSort = () => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-8 text-slate-500">
          No debit entries to reconcile
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {/* Table Header */}
      <div className="flex items-center gap-4 px-4 py-2 bg-slate-100 border-l-4 border-l-transparent rounded-t-lg text-sm font-medium text-slate-600">
        <Button
          variant="ghost"
          size="sm"
          className="w-24 shrink-0 h-auto py-1 px-0 justify-start hover:bg-transparent"
          onClick={toggleSort}
        >
          Date
          {sortOrder === 'asc' ? (
            <ArrowUp className="w-3 h-3 ml-1" />
          ) : (
            <ArrowDown className="w-3 h-3 ml-1" />
          )}
        </Button>
        <div className="w-28 shrink-0 text-right">Amount</div>
        <div className="flex-1 min-w-0">Description</div>
        <div className="shrink-0">Suggested Match</div>
        <div className="w-24 shrink-0 text-center">Create New</div>
      </div>

      {/* Entry List */}
      <Card className="overflow-hidden">
        {entriesWithSuggestions.map(({ entry, suggestions, expenseTypeSuggestion }) => (
          <BankEntryRow
            key={entry.id}
            entry={entry}
            suggestions={suggestions}
            expenseTypeSuggestion={expenseTypeSuggestion}
            type="expenditure"
            loans={loans}
            borrowers={borrowers}
            investors={investors}
            expenseTypes={expenseTypes}
            patterns={patterns}
            onReconciled={onReconciled}
          />
        ))}
      </Card>
    </div>
  );
}

/**
 * Generate matching suggestions for a debit bank entry
 */
function generateExpenditureSuggestions(entry, allDebitEntries, loans, borrowers, investors, transactions, investorTransactions, investorInterestEntries, expenses, reconciledTxIds = new Set()) {
  const suggestions = [];
  const entryAmount = Math.abs(entry.amount);
  const entryDate = new Date(entry.statement_date);
  const entryDesc = (entry.description || '').toLowerCase();

  // 1. Match against unreconciled loan disbursements
  // Filter out deleted transactions and those already reconciled (via ReconciliationEntry)
  const unrecDisbursements = transactions.filter(tx =>
    tx.type === 'Disbursement' &&
    !tx.is_deleted &&
    !reconciledTxIds.has(tx.id)
  );

  for (const tx of unrecDisbursements) {
    const txAmount = Math.abs(tx.amount);
    const txDate = new Date(tx.date);

    // Check amount match (within 1%)
    const amountDiff = Math.abs(entryAmount - txAmount) / txAmount;
    if (amountDiff > 0.01) continue;

    // Check date proximity (within 14 days)
    const daysDiff = Math.abs((entryDate - txDate) / (1000 * 60 * 60 * 24));
    if (daysDiff > 14) continue;

    // Track match reasons
    const matchReasons = [];

    // Calculate confidence score
    let confidence = 0.7;
    if (amountDiff < 0.001) {
      confidence += 0.15;
      matchReasons.push('Exact amount');
    } else {
      matchReasons.push('Amount ±1%');
    }

    if (daysDiff <= 1) {
      confidence += 0.1;
      matchReasons.push(daysDiff === 0 ? 'Same date' : '1 day apart');
    } else if (daysDiff <= 3) {
      confidence += 0.05;
      matchReasons.push(`${Math.round(daysDiff)} days apart`);
    } else {
      matchReasons.push(`${Math.round(daysDiff)} days apart`);
    }

    // Check for name match in description
    const loan = loans.find(l => l.id === tx.loan_id);
    // Try to find borrower from loan first, then from transaction directly
    const borrower = borrowers.find(b => b.id === loan?.borrower_id) ||
                     borrowers.find(b => b.id === tx.borrower_id);
    if (borrower) {
      const borrowerName = (borrower.name || '').toLowerCase();
      if (entryDesc.includes(borrowerName.split(' ')[0])) {
        confidence += 0.1;
        matchReasons.push('Name in description');
      }
    }

    // Build a descriptive label
    const loanNumber = loan?.loan_number || tx.loan_id?.substring?.(0, 8) || 'Unknown';
    // Try multiple sources for borrower name: borrower entity, loan's borrower_name field, or transaction reference
    const borrowerDisplayName = borrower?.name || borrower?.business_name || loan?.borrower_name || 'Unknown';

    suggestions.push({
      type: 'loan_disbursement',
      matchMode: 'match',
      confidence: Math.min(confidence, 0.99),
      matchReasons,
      existingTransaction: tx,
      loan,
      borrower,
      label: `Loan Disbursement: ${loanNumber} (${borrowerDisplayName})`
    });
  }

  // 1b. GROUPED DISBURSEMENT MATCH: Multiple bank debits → single disbursement transaction
  // Handles cases where a loan disbursement is paid out in multiple tranches
  {
    // Find all unreconciled debits within 3 days of this entry
    const nearbyDebits = allDebitEntries.filter(other => {
      if (other.amount >= 0) return false; // Must be debit
      return datesWithinDays(entry.statement_date, other.statement_date, 3);
    });

    for (const tx of unrecDisbursements) {
      const disbursementAmount = Math.abs(tx.amount);

      // Skip if this single entry already matches (handled by 1:1 above)
      if (amountsMatch(entryAmount, disbursementAmount, 1)) continue;

      // Skip if this entry is larger than the disbursement
      if (entryAmount > disbursementAmount * 1.01) continue;

      // Filter out entries disproportionately small relative to the disbursement
      // Each entry must be at least 2% of the target to be a credible part of a split payment
      const meaningfulDebits = nearbyDebits.filter(e =>
        Math.abs(e.amount) >= disbursementAmount * 0.02
      );

      // Find subset of debits that sum to disbursement (must include current entry)
      const matchingSubset = findSubsetSum(meaningfulDebits, disbursementAmount, entry.id);

      if (matchingSubset && matchingSubset.length >= 2) {
        const loan = loans.find(l => l.id === tx.loan_id);

        // Check that bank entries are within 14 days of the disbursement transaction
        const allEntriesNearTransaction = matchingSubset.every(e =>
          datesWithinDays(e.statement_date, tx.date, 14)
        );
        if (!allEntriesNearTransaction) continue;

        // Validate that grouped entries are related (similar descriptions or borrower name)
        const entriesAreRelated = groupHasRelatedDescriptions(matchingSubset);
        const borrowerName = loan?.borrower_name || '';
        const hasBorrowerName = borrowerName && matchingSubset.some(e =>
          descriptionContainsName(e.description, borrowerName, null) > 0.5
        );
        if (!entriesAreRelated && !hasBorrowerName) continue;

        const allSameDay = matchingSubset.every(e =>
          datesWithinDays(e.statement_date, entry.statement_date, 0)
        );
        const allNearTransaction = matchingSubset.every(e =>
          datesWithinDays(e.statement_date, tx.date, 3)
        );

        let confidence;
        if (allSameDay && allNearTransaction) {
          confidence = 0.92;
        } else if (allSameDay) {
          confidence = 0.75;
        } else if (allNearTransaction) {
          confidence = 0.80;
        } else {
          confidence = 0.60;
        }

        const borrower = borrowers.find(b => b.id === loan?.borrower_id);
        const borrowerDisplayName = borrower?.name || borrower?.business_name || loan?.borrower_name || 'Unknown';
        const loanNumber = loan?.loan_number || 'Unknown';

        suggestions.push({
          type: 'loan_disbursement',
          matchMode: 'grouped_disbursement',
          confidence,
          matchReasons: [
            `${matchingSubset.length} payments total ${formatCurrency(disbursementAmount)}`,
            allSameDay ? 'Same day' : 'Within 3 days',
            entriesAreRelated ? 'Related descriptions' : 'Borrower name match'
          ],
          existingTransaction: tx,
          groupedEntries: matchingSubset,
          loan,
          borrower,
          label: `Loan Disbursement: ${loanNumber} (${borrowerDisplayName}) — split payment`
        });
        break; // Stop at first grouped match
      }
    }
  }

  // 2. Match against unreconciled investor withdrawals
  // Filter out deleted transactions and those already reconciled (via ReconciliationEntry)
  const unrecWithdrawals = investorTransactions.filter(tx =>
    tx.type === 'capital_out' &&
    !tx.is_deleted &&
    !reconciledTxIds.has(tx.id)
  );

  for (const tx of unrecWithdrawals) {
    const txAmount = Math.abs(tx.amount);
    const txDate = new Date(tx.date);

    // Check amount match (within 1%)
    const amountDiff = Math.abs(entryAmount - txAmount) / txAmount;
    if (amountDiff > 0.01) continue;

    // Check date proximity (within 14 days)
    const daysDiff = Math.abs((entryDate - txDate) / (1000 * 60 * 60 * 24));
    if (daysDiff > 14) continue;

    // Track match reasons
    const matchReasons = [];

    // Calculate confidence score
    let confidence = 0.7;
    if (amountDiff < 0.001) {
      confidence += 0.15;
      matchReasons.push('Exact amount');
    } else {
      matchReasons.push('Amount ±1%');
    }

    if (daysDiff <= 1) {
      confidence += 0.1;
      matchReasons.push(daysDiff === 0 ? 'Same date' : '1 day apart');
    } else if (daysDiff <= 3) {
      confidence += 0.05;
      matchReasons.push(`${Math.round(daysDiff)} days apart`);
    } else {
      matchReasons.push(`${Math.round(daysDiff)} days apart`);
    }

    // Check for investor name match
    const investor = investors.find(i => i.id === tx.investor_id);
    if (investor) {
      const investorName = (investor.business_name || investor.name || '').toLowerCase();
      if (investorName && entryDesc.includes(investorName.split(' ')[0])) {
        confidence += 0.1;
        matchReasons.push('Name in description');
      }
    }

    suggestions.push({
      type: 'investor_withdrawal',
      matchMode: 'match',
      confidence: Math.min(confidence, 0.99),
      matchReasons,
      existingTransaction: tx,
      investor,
      label: `Investor Withdrawal: ${investor?.business_name || investor?.name || 'Unknown'}`
    });
  }

  // 2b. Match against unreconciled investor interest entries (debits = interest withdrawals)
  const unrecInterestEntries = investorInterestEntries.filter(interest =>
    interest.type === 'debit' &&
    !interest.is_deleted &&
    !reconciledTxIds.has(interest.id)
  );

  for (const interest of unrecInterestEntries) {
    const interestAmount = Math.abs(interest.amount);
    const interestDate = new Date(interest.date);

    // Check amount match (within 1%)
    const amountDiff = interestAmount > 0 ? Math.abs(entryAmount - interestAmount) / interestAmount : 1;
    if (amountDiff > 0.01) continue;

    // Check date proximity (within 14 days)
    const daysDiff = Math.abs((entryDate - interestDate) / (1000 * 60 * 60 * 24));
    if (daysDiff > 14) continue;

    // Track match reasons
    const matchReasons = [];

    // Calculate confidence score
    let confidence = 0.7;
    if (amountDiff < 0.001) {
      confidence += 0.15;
      matchReasons.push('Exact amount');
    } else {
      matchReasons.push('Amount ±1%');
    }

    if (daysDiff <= 1) {
      confidence += 0.1;
      matchReasons.push(daysDiff === 0 ? 'Same date' : '1 day apart');
    } else if (daysDiff <= 3) {
      confidence += 0.05;
      matchReasons.push(`${Math.round(daysDiff)} days apart`);
    } else {
      matchReasons.push(`${Math.round(daysDiff)} days apart`);
    }

    // Check for investor name match
    const investor = investors.find(i => i.id === interest.investor_id);
    if (investor) {
      const investorName = (investor.business_name || investor.name || '').toLowerCase();
      if (investorName && entryDesc.includes(investorName.split(' ')[0])) {
        confidence += 0.1;
        matchReasons.push('Name in description');
      }
    }

    suggestions.push({
      type: 'investor_interest',
      matchMode: 'match',
      confidence: Math.min(confidence, 0.99),
      matchReasons,
      existingInterest: interest,
      investor,
      label: `Interest Withdrawal: ${investor?.business_name || investor?.name || 'Unknown'}`
    });
  }

  // 3. Match against unreconciled expenses
  // Filter out deleted expenses and those already reconciled (via ReconciliationEntry)
  const unrecExpenses = expenses.filter(exp =>
    !exp.is_deleted &&
    !reconciledTxIds.has(exp.id)
  );

  for (const exp of unrecExpenses) {
    const expAmount = Math.abs(exp.amount);
    const expDate = new Date(exp.date);

    // Check amount match (within 1%)
    const amountDiff = Math.abs(entryAmount - expAmount) / expAmount;
    if (amountDiff > 0.01) continue;

    // Check date proximity (within 14 days)
    const daysDiff = Math.abs((entryDate - expDate) / (1000 * 60 * 60 * 24));
    if (daysDiff > 14) continue;

    // Track match reasons
    const matchReasons = [];

    // Calculate confidence score
    let confidence = 0.65;
    if (amountDiff < 0.001) {
      confidence += 0.15;
      matchReasons.push('Exact amount');
    } else {
      matchReasons.push('Amount ±1%');
    }

    if (daysDiff <= 1) {
      confidence += 0.1;
      matchReasons.push(daysDiff === 0 ? 'Same date' : '1 day apart');
    } else if (daysDiff <= 3) {
      confidence += 0.05;
      matchReasons.push(`${Math.round(daysDiff)} days apart`);
    } else {
      matchReasons.push(`${Math.round(daysDiff)} days apart`);
    }

    // Check for description match
    const expDesc = (exp.description || '').toLowerCase();
    if (expDesc && entryDesc.includes(expDesc.split(' ')[0])) {
      confidence += 0.1;
      matchReasons.push('Description match');
    }

    suggestions.push({
      type: 'expense',
      matchMode: 'match',
      confidence: Math.min(confidence, 0.99),
      matchReasons,
      existingExpense: exp,
      label: `Expense: ${exp.description || exp.type_name || 'Unknown'}`
    });
  }

  // 4. Suggest matching to loans with recent disbursements by borrower name
  const recentLoans = loans.filter(l => {
    const createdAt = new Date(l.created_at);
    const daysSinceCreation = (entryDate - createdAt) / (1000 * 60 * 60 * 24);
    return daysSinceCreation >= 0 && daysSinceCreation <= 30;
  });

  for (const loan of recentLoans) {
    const borrower = borrowers.find(b => b.id === loan.borrower_id);
    if (!borrower) continue;

    const borrowerName = (borrower.name || '').toLowerCase();
    const businessName = (borrower.business_name || '').toLowerCase();

    // Check if borrower name appears in description
    let nameMatch = false;
    if (borrowerName && entryDesc.includes(borrowerName.split(' ')[0])) {
      nameMatch = true;
    } else if (businessName && entryDesc.includes(businessName.split(' ')[0])) {
      nameMatch = true;
    }

    if (nameMatch) {
      // Check amount match to loan principal
      const principalAmount = parseFloat(loan.principal_amount) || 0;
      const amountDiff = principalAmount > 0 ? Math.abs(entryAmount - principalAmount) / principalAmount : 1;

      if (amountDiff < 0.05) { // Within 5%
        // Only suggest if not already suggested via transaction match
        const alreadySuggested = suggestions.some(s =>
          s.type === 'loan_disbursement' && s.loan?.id === loan.id
        );
        if (!alreadySuggested) {
          const matchReasons = ['Name in description', 'Recent loan'];
          if (amountDiff < 0.01) {
            matchReasons.push('Amount matches principal');
          } else {
            matchReasons.push('Amount ±5% of principal');
          }
          suggestions.push({
            type: 'loan_disbursement_new',
            matchMode: 'create',
            confidence: 0.6 + (amountDiff < 0.01 ? 0.15 : 0),
            matchReasons,
            loan,
            borrower,
            label: `New Disbursement: ${loan.loan_number} (${borrower.name})`
          });
        }
      }
    }
  }

  // 5. Suggest matching to investors by name for withdrawals
  for (const investor of investors) {
    const investorName = (investor.business_name || investor.name || '').toLowerCase();
    if (!investorName) continue;

    // Check if investor name appears in description
    if (entryDesc.includes(investorName.split(' ')[0])) {
      // Only suggest if not already suggested via transaction or interest match
      const alreadySuggested = suggestions.some(s =>
        (s.type === 'investor_withdrawal' || s.type === 'investor_interest') && s.investor?.id === investor.id
      );
      if (!alreadySuggested) {
        suggestions.push({
          type: 'investor_withdrawal_new',
          matchMode: 'create',
          confidence: 0.55,
          matchReasons: ['Name in description'],
          investor,
          label: `New Investor Withdrawal: ${investor.business_name || investor.name}`
        });
      }
    }
  }

  // Sort by confidence
  suggestions.sort((a, b) => b.confidence - a.confidence);

  return suggestions;
}
