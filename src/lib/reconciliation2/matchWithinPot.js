/**
 * Matching Logic - Finds specific entity matches within each pot
 *
 * This is Phase 2 of the two-phase approach:
 * 1. Classification: Determine pot (handled by classifyToPot.js)
 * 2. Matching: Find specific entity within the pot
 *
 * Matching strategies per pot:
 * - Loans: Match to loan + existing transaction OR create new
 * - Investors: Match to investor + transaction type
 * - Expenses: Match to expense type + optionally a loan
 */

import { parseISO, isValid, differenceInDays } from 'date-fns';

/**
 * Check if amounts match within tolerance
 */
function amountsMatch(amount1, amount2, tolerancePercent = 1) {
  const a1 = Math.abs(parseFloat(amount1) || 0);
  const a2 = Math.abs(parseFloat(amount2) || 0);
  if (a1 === 0 && a2 === 0) return true;
  if (a1 === 0 || a2 === 0) return false;
  const diff = Math.abs(a1 - a2);
  const tolerance = Math.max(a1, a2) * (tolerancePercent / 100);
  return diff <= tolerance;
}

/**
 * Calculate date proximity score (0-1)
 */
function dateProximityScore(date1, date2) {
  if (!date1 || !date2) return 0;
  try {
    const d1 = typeof date1 === 'string' ? parseISO(date1) : date1;
    const d2 = typeof date2 === 'string' ? parseISO(date2) : date2;
    if (!isValid(d1) || !isValid(d2)) return 0;

    const daysDiff = Math.abs(differenceInDays(d1, d2));
    if (daysDiff === 0) return 1;
    if (daysDiff <= 1) return 0.95;
    if (daysDiff <= 3) return 0.85;
    if (daysDiff <= 7) return 0.70;
    if (daysDiff <= 14) return 0.50;
    if (daysDiff <= 30) return 0.30;
    return 0.1;
  } catch {
    return 0;
  }
}

/**
 * Calculate match score for a transaction
 */
function calculateMatchScore(bankEntry, transaction, dateField = 'date') {
  const entryAmount = Math.abs(parseFloat(bankEntry.amount) || 0);
  const txAmount = Math.abs(parseFloat(transaction.amount) || 0);

  const exactAmount = amountsMatch(entryAmount, txAmount, 0.5);
  const closeAmount = amountsMatch(entryAmount, txAmount, 5);

  const dateScore = dateProximityScore(bankEntry.statement_date, transaction[dateField]);

  // Scoring matrix
  if (exactAmount && dateScore >= 0.95) return 0.98; // Same day, exact amount
  if (exactAmount && dateScore >= 0.85) return 0.92; // Within 3 days, exact
  if (exactAmount && dateScore >= 0.70) return 0.85; // Within 7 days, exact
  if (closeAmount && dateScore >= 0.95) return 0.75; // Same day, close amount
  if (exactAmount && dateScore >= 0.50) return 0.65; // Within 14 days, exact
  if (closeAmount && dateScore >= 0.70) return 0.55; // Within 7 days, close
  if (exactAmount) return 0.40; // Exact amount, far date
  if (closeAmount) return 0.25; // Close amount

  return 0;
}

/**
 * Match entries in the Loans pot
 */
export function matchLoansEntries(entries, context) {
  const {
    loans = [],
    loanTransactions = [],
    reconciledTxIds = new Set()
  } = context;

  return entries.map(entry => {
    const isCredit = entry.amount > 0;
    const entryAmount = Math.abs(entry.amount);

    let bestMatch = null;
    let bestScore = 0;

    // 1. Match against existing unreconciled transactions
    for (const tx of loanTransactions) {
      if (tx.is_deleted || reconciledTxIds.has(tx.id)) continue;

      // Credits = Repayments, Debits = Disbursements
      const expectedType = isCredit ? 'Repayment' : 'Disbursement';
      if (tx.type !== expectedType) continue;

      const score = calculateMatchScore(entry, tx, 'date');
      if (score > bestScore) {
        bestScore = score;
        const loan = loans.find(l => l.id === tx.loan_id);
        bestMatch = {
          matchType: 'existing_transaction',
          transaction: tx,
          loan,
          transactionType: tx.type,
          confidence: Math.round(score * 100),
          reason: `Matches ${tx.type.toLowerCase()} for ${loan?.borrower_name || 'Unknown'}`
        };
      }
    }

    // 2. If no transaction match, suggest creating new based on classification signals
    if (bestScore < 0.5 && entry.classification?.suggestedLoan) {
      const loan = entry.classification.suggestedLoan;
      bestMatch = {
        matchType: 'create_new',
        loan,
        transactionType: isCredit ? 'Repayment' : 'Disbursement',
        confidence: entry.classification.confidence || 50,
        reason: `Create ${isCredit ? 'repayment' : 'disbursement'} for ${loan.borrower_name}`
      };
      bestScore = (entry.classification.confidence || 50) / 100;
    }

    // 3. Check for grouped payments (multiple loans from same borrower)
    if (isCredit && bestScore < 0.9) {
      const groupedMatch = findGroupedPaymentMatch(entry, loanTransactions, loans, reconciledTxIds);
      if (groupedMatch && groupedMatch.confidence / 100 > bestScore) {
        bestMatch = groupedMatch;
        bestScore = groupedMatch.confidence / 100;
      }
    }

    return {
      ...entry,
      match: bestMatch
    };
  });
}

/**
 * Find grouped payment match (multiple loans paid together)
 */
function findGroupedPaymentMatch(entry, loanTransactions, loans, reconciledTxIds) {
  const entryAmount = Math.abs(entry.amount);

  // Group repayments by borrower that are within 3 days
  const repaymentsByBorrower = new Map();

  for (const tx of loanTransactions) {
    if (tx.is_deleted || reconciledTxIds.has(tx.id)) continue;
    if (tx.type !== 'Repayment') continue;

    const dateScore = dateProximityScore(entry.statement_date, tx.date);
    if (dateScore < 0.85) continue; // Within 3 days

    const borrowerId = tx.borrower_id;
    if (!repaymentsByBorrower.has(borrowerId)) {
      repaymentsByBorrower.set(borrowerId, []);
    }
    repaymentsByBorrower.get(borrowerId).push(tx);
  }

  // Check if any group sums to the entry amount
  for (const [borrowerId, txGroup] of repaymentsByBorrower) {
    if (txGroup.length < 2) continue;

    const groupTotal = txGroup.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

    if (amountsMatch(entryAmount, groupTotal, 1)) {
      const loanNumbers = [...new Set(txGroup.map(tx => {
        const l = loans.find(loan => loan.id === tx.loan_id);
        return l?.loan_number || '?';
      }))].join(', ');

      const borrowerName = txGroup[0]?.borrower_name || 'Multiple loans';

      return {
        matchType: 'grouped_payment',
        transactions: txGroup,
        borrowerId,
        confidence: 90,
        reason: `Grouped payment: ${borrowerName} - ${txGroup.length} loans (${loanNumbers})`
      };
    }
  }

  return null;
}

/**
 * Match entries in the Investors pot
 */
export function matchInvestorEntries(entries, context) {
  const {
    investors = [],
    investorTransactions = [],
    reconciledTxIds = new Set()
  } = context;

  return entries.map(entry => {
    const isCredit = entry.amount > 0;

    let bestMatch = null;
    let bestScore = 0;

    // 1. Match against existing unreconciled investor transactions
    for (const tx of investorTransactions) {
      if (reconciledTxIds.has(tx.id)) continue;

      // Credits = capital_in, Debits = capital_out
      const expectedType = isCredit ? 'capital_in' : 'capital_out';
      if (tx.type !== expectedType) continue;

      const score = calculateMatchScore(entry, tx, 'date');
      if (score > bestScore) {
        bestScore = score;
        const investor = investors.find(i => i.id === tx.investor_id);
        bestMatch = {
          matchType: 'existing_transaction',
          transaction: tx,
          investor,
          transactionType: tx.type,
          confidence: Math.round(score * 100),
          reason: `Matches ${tx.type.replace('_', ' ')} for ${investor?.name || 'Unknown'}`
        };
      }
    }

    // 2. If no transaction match, suggest based on classification
    if (bestScore < 0.5 && entry.classification?.suggestedInvestor) {
      const investor = entry.classification.suggestedInvestor;
      bestMatch = {
        matchType: 'create_new',
        investor,
        transactionType: isCredit ? 'capital_in' : 'capital_out',
        confidence: entry.classification.confidence || 50,
        reason: `Create ${isCredit ? 'capital in' : 'capital out'} for ${investor.name}`
      };
      bestScore = (entry.classification.confidence || 50) / 100;
    }

    return {
      ...entry,
      match: bestMatch
    };
  });
}

/**
 * Match entries in the Expenses pot
 */
export function matchExpenseEntries(entries, context) {
  const {
    expenses = [],
    expenseTypes = [],
    loans = [],
    patterns = [],
    reconciledTxIds = new Set()
  } = context;

  return entries.map(entry => {
    let bestMatch = null;
    let bestScore = 0;
    const description = (entry.description || '').toLowerCase();

    // 1. Match against existing unreconciled expenses
    for (const exp of expenses) {
      if (reconciledTxIds.has(exp.id)) continue;

      const score = calculateMatchScore(entry, exp, 'date');
      if (score > bestScore) {
        bestScore = score;
        const expenseType = expenseTypes.find(t => t.id === exp.type_id);
        const loan = exp.loan_id ? loans.find(l => l.id === exp.loan_id) : null;
        bestMatch = {
          matchType: 'existing_expense',
          expense: exp,
          expenseType,
          loan,
          confidence: Math.round(score * 100),
          reason: `Matches existing ${expenseType?.name || 'expense'}`
        };
      }
    }

    // 2. If no expense match, suggest expense type based on patterns
    if (bestScore < 0.5) {
      // Check patterns for expense type suggestion
      for (const pattern of patterns) {
        if (pattern.match_type !== 'operating_expense') continue;
        const patternText = (pattern.description_pattern || '').toLowerCase();
        if (patternText && description.includes(patternText)) {
          const expenseType = expenseTypes.find(t => t.id === pattern.expense_type_id);
          if (expenseType) {
            const conf = Math.round((pattern.confidence_score || 0.6) * 100);
            if (conf > bestScore * 100) {
              bestMatch = {
                matchType: 'create_new',
                expenseType,
                loan: pattern.loan_id ? loans.find(l => l.id === pattern.loan_id) : null,
                confidence: conf,
                reason: `Pattern suggests: ${expenseType.name}`
              };
              bestScore = conf / 100;
            }
          }
        }
      }
    }

    // 3. Default to requiring manual expense type selection
    if (!bestMatch) {
      bestMatch = {
        matchType: 'create_new',
        expenseType: null,
        confidence: 0,
        reason: 'Select expense type manually'
      };
    }

    return {
      ...entry,
      match: bestMatch
    };
  });
}

/**
 * Sort entries: existing matches first (highest confidence), then create_new (by confidence)
 */
function sortByMatchQuality(entries) {
  return [...entries].sort((a, b) => {
    const aMatch = a.match;
    const bMatch = b.match;

    // 1. Entries with existing transaction matches come first
    const aIsExisting = aMatch?.matchType === 'existing_transaction' || aMatch?.matchType === 'existing_expense' || aMatch?.matchType === 'grouped_payment';
    const bIsExisting = bMatch?.matchType === 'existing_transaction' || bMatch?.matchType === 'existing_expense' || bMatch?.matchType === 'grouped_payment';

    if (aIsExisting && !bIsExisting) return -1;
    if (!aIsExisting && bIsExisting) return 1;

    // 2. Within same category, sort by confidence (highest first)
    const aConf = aMatch?.confidence || 0;
    const bConf = bMatch?.confidence || 0;

    return bConf - aConf;
  });
}

/**
 * Run matching for all pots
 */
export function matchAllPots(entriesByPot, context) {
  return {
    unclassified: entriesByPot.unclassified || [],
    loans: sortByMatchQuality(matchLoansEntries(entriesByPot.loans || [], context)),
    investors: sortByMatchQuality(matchInvestorEntries(entriesByPot.investors || [], context)),
    expenses: sortByMatchQuality(matchExpenseEntries(entriesByPot.expenses || [], context))
  };
}
