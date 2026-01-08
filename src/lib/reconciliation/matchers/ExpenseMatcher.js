/**
 * ExpenseMatcher
 *
 * Matches bank debits (outgoing payments) to existing expense records.
 * This is a simple 1:1 matcher - one bank entry to one expense.
 */

import { BaseMatcher } from './BaseMatcher';
import {
  calculateMatchScore,
  datesWithinDays
} from '../scoring';
import { formatCurrency } from '@/components/loan/LoanCalculator';

export class ExpenseMatcher extends BaseMatcher {
  constructor(config = {}) {
    super(config);
    this.name = 'expense';
    this.priority = config.priority ?? 50;
  }

  /**
   * Only match debits (outgoing payments)
   */
  canMatch(entry, context) {
    return entry.amount < 0;
  }

  /**
   * Generate matches for expenses
   */
  generateMatches(entry, context) {
    const {
      expenses,
      reconciledTxIds,
      claimedExpenseIds
    } = context;

    const matches = [];

    for (const exp of expenses || []) {
      if (reconciledTxIds?.has(exp.id)) continue;
      if (claimedExpenseIds?.has(exp.id)) continue;

      // Check date proximity (within 30 days)
      if (!datesWithinDays(entry.statement_date, exp.date, 30)) continue;

      matches.push({
        type: 'expense',
        matchMode: 'match',
        existingExpense: exp,
        expense_type_id: exp.type_id,
        reason: `Expense: ${exp.type_name || 'Expense'} - ${formatCurrency(exp.amount)}`
      });
    }

    return matches;
  }

  /**
   * Calculate confidence score for an expense match
   */
  calculateConfidence(match, entry) {
    const exp = match.existingExpense;
    if (!exp) return 0;

    return calculateMatchScore(entry, exp, 'date');
  }
}

export default ExpenseMatcher;
