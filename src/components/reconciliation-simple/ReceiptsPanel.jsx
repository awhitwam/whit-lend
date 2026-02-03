/**
 * Receipts Panel - Handles credit bank entries
 *
 * Shows matching suggestions for:
 * - Loan repayments
 * - Investor deposits
 * - Other income
 *
 * Allows creating new transactions inline.
 */

import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowUp, ArrowDown } from 'lucide-react';
import BankEntryRow from './BankEntryRow';

export default function ReceiptsPanel({
  entries,
  loans,
  borrowers,
  investors,
  transactions,
  investorTransactions,
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

  // Generate suggestions for each entry and sort
  const entriesWithSuggestions = useMemo(() => {
    const withSuggestions = entries.map(entry => {
      const suggestions = generateReceiptSuggestions(
        entry,
        loans,
        borrowers,
        investors,
        transactions,
        investorTransactions,
        reconciledTxIds
      );
      return { entry, suggestions };
    });

    // Sort by date
    withSuggestions.sort((a, b) => {
      const dateA = new Date(a.entry.statement_date);
      const dateB = new Date(b.entry.statement_date);
      return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });

    return withSuggestions;
  }, [entries, loans, borrowers, investors, transactions, investorTransactions, reconciledTxIds, sortOrder]);

  const toggleSort = () => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-8 text-slate-500">
          No credit entries to reconcile
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
        {entriesWithSuggestions.map(({ entry, suggestions }) => (
          <BankEntryRow
            key={entry.id}
            entry={entry}
            suggestions={suggestions}
            type="receipt"
            loans={loans}
            borrowers={borrowers}
            investors={investors}
            onReconciled={onReconciled}
          />
        ))}
      </Card>
    </div>
  );
}

/**
 * Generate matching suggestions for a credit bank entry
 */
function generateReceiptSuggestions(entry, loans, borrowers, investors, transactions, investorTransactions, reconciledTxIds = new Set()) {
  const suggestions = [];
  const entryAmount = Math.abs(entry.amount);
  const entryDate = new Date(entry.statement_date);
  const entryDesc = (entry.description || '').toLowerCase();

  // Helper function to check if amounts match within tolerance
  const amountsMatch = (a1, a2, tolerancePercent = 1) => {
    const val1 = Math.abs(a1);
    const val2 = Math.abs(a2);
    if (val1 === 0 && val2 === 0) return true;
    if (val1 === 0 || val2 === 0) return false;
    const diff = Math.abs(val1 - val2);
    const tolerance = Math.max(val1, val2) * (tolerancePercent / 100);
    return diff <= tolerance;
  };

  // Helper function to check if dates are within days
  const datesWithinDays = (date1, date2, days) => {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffMs = Math.abs(d1.getTime() - d2.getTime());
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= days;
  };

  // 1. Match against unreconciled loan repayments
  // Filter out deleted transactions and those already reconciled (via ReconciliationEntry)
  const unrecRepayments = transactions.filter(tx =>
    tx.type === 'Repayment' &&
    !tx.is_deleted &&
    !reconciledTxIds.has(tx.id)
  );

  for (const tx of unrecRepayments) {
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
    const borrowerName = borrower?.name || borrower?.business_name || loan?.borrower_name || 'Unknown';

    suggestions.push({
      type: 'loan_repayment',
      matchMode: 'match',
      confidence: Math.min(confidence, 0.99),
      matchReasons,
      existingTransaction: tx,
      loan,
      borrower,
      label: `Loan Repayment: ${loanNumber} (${borrowerName})`
    });
  }

  // 1b. GROUPED REPAYMENT MATCH: One bank entry → multiple loan repayment transactions
  // This handles cases where a single bank payment covers multiple loan repayments
  // Group unreconciled repayments by borrower_id (filtering by 3-day date proximity)
  const repaymentsByBorrower = new Map();

  for (const tx of unrecRepayments) {
    // Check if date is within 3 days of bank entry
    if (!datesWithinDays(entry.statement_date, tx.date, 3)) continue;

    const key = tx.borrower_id || 'unknown';
    if (!repaymentsByBorrower.has(key)) {
      repaymentsByBorrower.set(key, []);
    }
    repaymentsByBorrower.get(key).push(tx);
  }

  // Check each borrower group for sum matches
  for (const [borrowerId, txGroup] of repaymentsByBorrower) {
    if (txGroup.length < 2) continue; // Only interested in groups of 2+

    const groupTotal = txGroup.reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount) || 0), 0);

    if (amountsMatch(entryAmount, groupTotal, 1)) {
      const allSameDay = txGroup.every(tx =>
        datesWithinDays(tx.date, entry.statement_date, 1)
      );

      let confidence = allSameDay ? 0.92 : 0.85;
      const matchReasons = ['Sum matches', `${txGroup.length} transactions`];
      if (allSameDay) matchReasons.push('Same day');

      // Get borrower and loan info for label
      const firstLoan = loans.find(l => l.id === txGroup[0].loan_id);
      const borrower = borrowers.find(b => b.id === borrowerId) ||
                       borrowers.find(b => b.id === firstLoan?.borrower_id);
      const borrowerName = borrower?.name || borrower?.business_name || firstLoan?.borrower_name || 'Unknown';

      // Check for borrower name match in bank description
      // Use borrowerName which already resolved from borrower entity or loan.borrower_name
      const nameToCheck = borrowerName.toLowerCase();
      const firstWord = nameToCheck.split(' ')[0];
      if (firstWord && firstWord !== 'unknown' && entryDesc.includes(firstWord)) {
        confidence += 0.1;
        matchReasons.push('Name in description');
      }

      // Get unique loan numbers
      const loanNumbers = [...new Set(txGroup.map(tx => {
        const loan = loans.find(l => l.id === tx.loan_id);
        return loan?.loan_number || '?';
      }))].join(', ');

      suggestions.push({
        type: 'loan_repayment',
        matchMode: 'match_group',
        confidence: Math.min(confidence, 0.99),
        matchReasons,
        existingTransactions: txGroup,
        borrower_id: borrowerId,
        borrower,
        label: `Grouped Repayments: ${borrowerName} (${loanNumbers})`
      });
    }
  }

  // 2. Match against unreconciled investor deposits
  // Filter out deleted transactions and those already reconciled (via ReconciliationEntry)
  const unrecDeposits = investorTransactions.filter(tx =>
    tx.type === 'capital_in' &&
    !tx.is_deleted &&
    !reconciledTxIds.has(tx.id)
  );

  for (const tx of unrecDeposits) {
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
      type: 'investor_credit',
      matchMode: 'match',
      confidence: Math.min(confidence, 0.99),
      matchReasons,
      existingTransaction: tx,
      investor,
      label: `Investor Deposit: ${investor?.business_name || investor?.name || 'Unknown'}`
    });
  }

  // 3. Suggest matching to active loans by borrower name
  const activeLoans = loans.filter(l =>
    l.status === 'Live' || l.status === 'Active' || l.status === 'Defaulted'
  );

  for (const loan of activeLoans) {
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
      // Only suggest if not already suggested via transaction match
      const alreadySuggested = suggestions.some(s =>
        s.type === 'loan_repayment' && s.loan?.id === loan.id
      );
      if (!alreadySuggested) {
        suggestions.push({
          type: 'loan_repayment_new',
          matchMode: 'create',
          confidence: 0.6,
          matchReasons: ['Name in description', 'Active loan'],
          loan,
          borrower,
          label: `New Repayment: ${loan.loan_number} (${borrower.name})`
        });
      }
    }
  }

  // 4. Suggest matching to investors by name
  for (const investor of investors) {
    const investorName = (investor.business_name || investor.name || '').toLowerCase();
    if (!investorName) continue;

    // Check if investor name appears in description
    if (entryDesc.includes(investorName.split(' ')[0])) {
      // Only suggest if not already suggested via transaction match
      const alreadySuggested = suggestions.some(s =>
        s.type === 'investor_credit' && s.investor?.id === investor.id
      );
      if (!alreadySuggested) {
        suggestions.push({
          type: 'investor_credit_new',
          matchMode: 'create',
          confidence: 0.55,
          matchReasons: ['Name in description'],
          investor,
          label: `New Investor Deposit: ${investor.business_name || investor.name}`
        });
      }
    }
  }

  // Sort by confidence
  suggestions.sort((a, b) => b.confidence - a.confidence);

  return suggestions;
}
