/**
 * Reconciliation Handler
 *
 * Executes reconciliation operations based on match type and relationship.
 * Handles creating transactions, linking bank entries, and managing state.
 *
 * CRITICAL: All reconciliation operations MUST validate that amounts balance.
 * Bank entries must exactly match system transactions (within tolerance).
 */

import { api } from '@/api/dataClient';
import { AuditAction, logReconciliationEvent } from '@/lib/auditLog';
import { maybeRegenerateScheduleAfterCapitalChange } from '@/components/loan/LoanScheduleManager';
import { queueBalanceCacheUpdate } from '@/components/loan/LoanCalculator';

// Tolerance for floating point comparison (1 cent)
const BALANCE_TOLERANCE = 0.01;

/**
 * Validate that bank amount matches transaction amount
 * @throws {Error} if amounts don't balance
 */
function validateAmountsBalance(bankTotal, transactionTotal, context = '') {
  const difference = Math.abs(bankTotal - transactionTotal);
  if (difference > BALANCE_TOLERANCE) {
    throw new Error(
      `Amounts do not balance${context ? ` (${context})` : ''}: ` +
      `Bank total £${bankTotal.toFixed(2)} vs Transaction total £${transactionTotal.toFixed(2)} ` +
      `(difference: £${difference.toFixed(2)})`
    );
  }
}

/**
 * Mark a bank entry as reconciled
 */
async function markBankEntryReconciled(entryId) {
  await api.entities.BankStatement.update(entryId, {
    is_reconciled: true,
    reconciled_at: new Date().toISOString()
  });
}

/**
 * Create a reconciliation entry linking bank statement to transaction
 */
async function createReconciliationEntry({
  bankStatementId,
  loanTransactionId = null,
  investorTransactionId = null,
  expenseId = null,
  otherIncomeId = null,
  interestId = null,
  amount,
  reconciliationType,
  notes = null,
  wasCreated = false
}) {
  return api.entities.ReconciliationEntry.create({
    bank_statement_id: bankStatementId,
    loan_transaction_id: loanTransactionId,
    investor_transaction_id: investorTransactionId,
    expense_id: expenseId,
    other_income_id: otherIncomeId,
    interest_id: interestId,
    amount,
    reconciliation_type: reconciliationType,
    notes,
    was_created: wasCreated
  });
}

/**
 * Execute reconciliation for a match_group (one bank → many transactions)
 *
 * @param {Object} params
 * @param {Object} params.bankEntry - The bank entry being reconciled
 * @param {Object} params.suggestion - The match suggestion containing existingTransactions
 * @returns {Promise<void>}
 */
export async function reconcileMatchGroup({ bankEntry, suggestion }) {
  const bankAmount = Math.abs(bankEntry.amount);

  // Calculate total of all transactions
  let transactionTotal = 0;
  if (suggestion.existingTransactions) {
    transactionTotal += suggestion.existingTransactions
      .filter(tx => !tx.is_deleted)
      .reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount) || 0), 0);
  }
  if (suggestion.existingInterestEntries) {
    transactionTotal += suggestion.existingInterestEntries
      .reduce((sum, i) => sum + Math.abs(parseFloat(i.amount) || 0), 0);
  }

  // CRITICAL: Validate amounts balance before proceeding
  validateAmountsBalance(bankAmount, transactionTotal, 'match_group');

  const isInvestorType = suggestion.type === 'investor_withdrawal' ||
                        suggestion.type === 'investor_credit' ||
                        suggestion.type === 'interest_withdrawal';
  const isLoanType = suggestion.type === 'loan_repayment' || suggestion.type === 'loan_disbursement';

  // Handle capital/investor transactions if present
  if (suggestion.existingTransactions) {
    const txGroup = suggestion.existingTransactions.filter(tx => !tx.is_deleted);

    for (const tx of txGroup) {
      await createReconciliationEntry({
        bankStatementId: bankEntry.id,
        loanTransactionId: isLoanType ? tx.id : null,
        investorTransactionId: isInvestorType ? tx.id : null,
        amount: parseFloat(tx.amount) || 0,
        reconciliationType: suggestion.type,
        notes: `Grouped match: ${txGroup.length} transactions`,
        wasCreated: false
      });
    }
  }

  // Handle interest ledger entries if present
  if (suggestion.existingInterestEntries) {
    for (const interest of suggestion.existingInterestEntries) {
      await createReconciliationEntry({
        bankStatementId: bankEntry.id,
        interestId: interest.id,
        amount: parseFloat(interest.amount) || 0,
        reconciliationType: 'interest_withdrawal',
        notes: `Grouped interest match`,
        wasCreated: false
      });
    }
  }

  // Mark bank statement as reconciled
  await markBankEntryReconciled(bankEntry.id);

  // Log the reconciliation
  const txCount = (suggestion.existingTransactions?.length || 0) +
                  (suggestion.existingInterestEntries?.length || 0);
  logReconciliationEvent(AuditAction.RECONCILIATION_MATCH, {
    bank_statement_id: bankEntry.id,
    description: bankEntry.description,
    amount: Math.abs(bankEntry.amount),
    transaction_count: txCount,
    match_type: isInvestorType ? 'grouped_investor' : 'grouped_repayments'
  });
}

/**
 * Execute reconciliation for grouped_disbursement (many bank → one loan tx)
 *
 * @param {Object} params
 * @param {Object} params.suggestion - The match suggestion
 * @returns {Promise<void>}
 */
export async function reconcileGroupedDisbursement({ suggestion }) {
  const tx = suggestion.existingTransaction;
  const groupedEntries = suggestion.groupedEntries;

  // Calculate totals
  const bankTotal = groupedEntries.reduce((sum, e) => sum + Math.abs(e.amount), 0);
  const transactionAmount = Math.abs(tx.amount);

  // CRITICAL: Validate amounts balance before proceeding
  validateAmountsBalance(bankTotal, transactionAmount, 'grouped_disbursement');

  // Create reconciliation entry for each bank debit
  for (const bankEntry of groupedEntries) {
    await createReconciliationEntry({
      bankStatementId: bankEntry.id,
      loanTransactionId: tx.id,
      amount: Math.abs(bankEntry.amount),
      reconciliationType: 'loan_disbursement',
      notes: `Grouped disbursement: ${groupedEntries.length} payments`,
      wasCreated: false
    });

    await markBankEntryReconciled(bankEntry.id);
  }

  logReconciliationEvent(AuditAction.RECONCILIATION_MATCH, {
    bank_statement_id: groupedEntries[0]?.id,
    description: groupedEntries[0]?.description,
    amount: Math.abs(tx.amount),
    bank_entry_count: groupedEntries.length,
    match_type: 'grouped_disbursement'
  });
}

/**
 * Execute reconciliation for grouped_repayment (many bank credits → one loan repayment)
 *
 * @param {Object} params
 * @param {Object} params.suggestion - The match suggestion
 * @returns {Promise<void>}
 */
export async function reconcileGroupedRepayment({ suggestion }) {
  const tx = suggestion.existingTransaction;
  const groupedEntries = suggestion.groupedEntries;

  // Calculate totals
  const bankTotal = groupedEntries.reduce((sum, e) => sum + Math.abs(e.amount), 0);
  const transactionAmount = Math.abs(tx.amount);

  // CRITICAL: Validate amounts balance before proceeding
  validateAmountsBalance(bankTotal, transactionAmount, 'grouped_repayment');

  // Create reconciliation entry for each bank credit
  for (const bankEntry of groupedEntries) {
    await createReconciliationEntry({
      bankStatementId: bankEntry.id,
      loanTransactionId: tx.id,
      amount: Math.abs(bankEntry.amount),
      reconciliationType: 'loan_repayment',
      notes: `Grouped repayment: ${groupedEntries.length} bank entries`,
      wasCreated: false
    });

    await markBankEntryReconciled(bankEntry.id);
  }

  logReconciliationEvent(AuditAction.RECONCILIATION_MATCH, {
    bank_statement_id: groupedEntries[0]?.id,
    description: groupedEntries[0]?.description,
    amount: Math.abs(tx.amount),
    bank_entry_count: groupedEntries.length,
    match_type: 'grouped_repayment'
  });
}

/**
 * Execute reconciliation for grouped_investor (many bank → one investor tx)
 *
 * @param {Object} params
 * @param {Object} params.suggestion - The match suggestion
 * @returns {Promise<void>}
 */
export async function reconcileGroupedInvestor({ suggestion }) {
  const invTx = suggestion.existingTransaction;
  const groupedEntries = suggestion.groupedEntries;
  const recType = suggestion.type;

  // Calculate totals
  const bankTotal = groupedEntries.reduce((sum, e) => sum + Math.abs(e.amount), 0);
  const transactionAmount = Math.abs(invTx.amount);

  // CRITICAL: Validate amounts balance before proceeding
  validateAmountsBalance(bankTotal, transactionAmount, 'grouped_investor');

  // Create reconciliation entry for each bank entry
  for (const bankEntry of groupedEntries) {
    await createReconciliationEntry({
      bankStatementId: bankEntry.id,
      investorTransactionId: invTx.id,
      amount: Math.abs(bankEntry.amount),
      reconciliationType: recType,
      notes: `Grouped investor: ${groupedEntries.length} payments`,
      wasCreated: false
    });

    await markBankEntryReconciled(bankEntry.id);
  }

  logReconciliationEvent(AuditAction.RECONCILIATION_MATCH, {
    bank_statement_id: groupedEntries[0]?.id,
    description: groupedEntries[0]?.description,
    amount: Math.abs(invTx.amount),
    bank_entry_count: groupedEntries.length,
    match_type: 'grouped_investor'
  });
}

/**
 * Execute reconciliation for single match (one bank → one existing tx)
 *
 * @param {Object} params
 * @param {Object} params.bankEntry - The bank entry being reconciled
 * @param {Object} params.suggestion - The match suggestion
 * @returns {Promise<void>}
 */
export async function reconcileSingleMatch({ bankEntry, suggestion }) {
  const bankAmount = Math.abs(bankEntry.amount);

  // Determine transaction amount based on what we're matching to
  let transactionAmount = 0;
  if (suggestion.existingTransaction) {
    transactionAmount = Math.abs(parseFloat(suggestion.existingTransaction.amount) || 0);
  } else if (suggestion.existingExpense) {
    transactionAmount = Math.abs(parseFloat(suggestion.existingExpense.amount) || 0);
  } else if (suggestion.existingInterest) {
    transactionAmount = Math.abs(parseFloat(suggestion.existingInterest.amount) || 0);
  }

  // CRITICAL: Validate amounts balance before proceeding
  validateAmountsBalance(bankAmount, transactionAmount, 'single_match');

  let loanTransactionId = null;
  let investorTransactionId = null;
  let expenseId = null;
  let interestId = null;

  if (suggestion.existingTransaction) {
    if (suggestion.type === 'loan_repayment' || suggestion.type === 'loan_disbursement') {
      loanTransactionId = suggestion.existingTransaction.id;
    } else if (suggestion.type.startsWith('investor_')) {
      investorTransactionId = suggestion.existingTransaction.id;
    }
  }

  if (suggestion.existingExpense) {
    expenseId = suggestion.existingExpense.id;
  }

  if (suggestion.existingInterest) {
    interestId = suggestion.existingInterest.id;
  }

  await createReconciliationEntry({
    bankStatementId: bankEntry.id,
    loanTransactionId,
    investorTransactionId,
    expenseId,
    interestId,
    amount,
    reconciliationType: suggestion.type,
    notes: 'Matched to existing transaction',
    wasCreated: false
  });

  await markBankEntryReconciled(bankEntry.id);

  logReconciliationEvent(AuditAction.RECONCILIATION_MATCH, {
    bank_statement_id: bankEntry.id,
    description: bankEntry.description,
    amount,
    match_type: suggestion.type
  });
}

/**
 * Create a new loan repayment transaction and reconcile
 *
 * @param {Object} params
 * @param {Object} params.bankEntry - The bank entry
 * @param {Object} params.loan - The loan to apply repayment to
 * @param {Object} params.split - { principal, interest, fees }
 * @returns {Promise<Object>} Created transaction
 */
export async function createLoanRepayment({ bankEntry, loan, split }) {
  const amount = Math.abs(bankEntry.amount);
  const txData = {
    loan_id: loan.id,
    borrower_id: loan.borrower_id,
    amount,
    date: bankEntry.statement_date,
    type: 'Repayment',
    principal_applied: split.principal || 0,
    interest_applied: split.interest || 0,
    fees_applied: split.fees || 0,
    reference: bankEntry.external_reference,
    notes: `Bank reconciliation: ${bankEntry.description}`
  };

  const created = await api.entities.Transaction.create(txData);

  await createReconciliationEntry({
    bankStatementId: bankEntry.id,
    loanTransactionId: created.id,
    amount,
    reconciliationType: 'loan_repayment',
    notes: 'Created new transaction',
    wasCreated: true
  });

  await markBankEntryReconciled(bankEntry.id);

  logReconciliationEvent(AuditAction.RECONCILIATION_CREATE, {
    bank_statement_id: bankEntry.id,
    description: bankEntry.description,
    amount,
    type: 'loan_repayment',
    loan_id: loan.id,
    loan_number: loan.loan_number
  });

  // Regenerate schedule if principal was applied (affects capital)
  if (split.principal && split.principal > 0) {
    await maybeRegenerateScheduleAfterCapitalChange(loan.id, {
      type: 'Repayment',
      principal_applied: split.principal,
      date: bankEntry.statement_date
    }, 'create');
  }

  // Update balance cache so loans list shows correct balances
  queueBalanceCacheUpdate(loan.id);

  return created;
}

/**
 * Create a new loan disbursement transaction and reconcile
 *
 * @param {Object} params
 * @param {Object} params.bankEntry - The bank entry
 * @param {Object} params.loan - The loan to apply disbursement to
 * @returns {Promise<Object>} Created transaction
 */
export async function createLoanDisbursement({ bankEntry, loan }) {
  const amount = Math.abs(bankEntry.amount);
  const txData = {
    loan_id: loan.id,
    borrower_id: loan.borrower_id,
    amount,
    date: bankEntry.statement_date,
    type: 'Disbursement',
    principal_applied: amount,
    reference: bankEntry.external_reference,
    notes: `Bank reconciliation: ${bankEntry.description}`
  };

  const created = await api.entities.Transaction.create(txData);

  await createReconciliationEntry({
    bankStatementId: bankEntry.id,
    loanTransactionId: created.id,
    amount,
    reconciliationType: 'loan_disbursement',
    notes: 'Created new transaction',
    wasCreated: true
  });

  await markBankEntryReconciled(bankEntry.id);

  logReconciliationEvent(AuditAction.RECONCILIATION_CREATE, {
    bank_statement_id: bankEntry.id,
    description: bankEntry.description,
    amount,
    type: 'loan_disbursement',
    loan_id: loan.id,
    loan_number: loan.loan_number
  });

  // Regenerate schedule for disbursement (affects capital)
  await maybeRegenerateScheduleAfterCapitalChange(loan.id, {
    type: 'Disbursement',
    amount,
    date: bankEntry.statement_date
  }, 'create');

  // Update balance cache so loans list shows correct principal
  queueBalanceCacheUpdate(loan.id);

  return created;
}

/**
 * Create a new investor credit transaction and reconcile
 *
 * @param {Object} params
 * @param {Object} params.bankEntry - The bank entry
 * @param {Object} params.investor - The investor
 * @returns {Promise<Object>} Created transaction
 */
export async function createInvestorCredit({ bankEntry, investor }) {
  const amount = Math.abs(bankEntry.amount);
  const txData = {
    investor_id: investor.id,
    type: 'capital_in',
    amount,
    date: bankEntry.statement_date,
    description: bankEntry.description,
    reference: bankEntry.external_reference
  };

  const created = await api.entities.InvestorTransaction.create(txData);

  // Update investor balance
  await api.entities.Investor.update(investor.id, {
    current_capital_balance: (investor.current_capital_balance || 0) + amount,
    total_capital_contributed: (investor.total_capital_contributed || 0) + amount
  });

  await createReconciliationEntry({
    bankStatementId: bankEntry.id,
    investorTransactionId: created.id,
    amount,
    reconciliationType: 'investor_credit',
    notes: 'Created new transaction',
    wasCreated: true
  });

  await markBankEntryReconciled(bankEntry.id);

  logReconciliationEvent(AuditAction.RECONCILIATION_CREATE, {
    bank_statement_id: bankEntry.id,
    description: bankEntry.description,
    amount,
    type: 'investor_credit',
    investor_id: investor.id,
    investor_name: investor.business_name || investor.name
  });

  return created;
}

/**
 * Create a new investor withdrawal transaction and reconcile
 *
 * @param {Object} params
 * @param {Object} params.bankEntry - The bank entry
 * @param {Object} params.investor - The investor
 * @param {Object} params.split - { capital, interest }
 * @param {Object} params.investorProduct - The investor's product (for manual interest handling)
 * @returns {Promise<Object>} Created transaction(s)
 */
export async function createInvestorWithdrawal({ bankEntry, investor, split, investorProduct }) {
  const capitalAmount = split.capital || 0;
  const interestAmount = split.interest || 0;
  let investorTransactionId = null;
  let interestId = null;

  // Create capital withdrawal if there's capital amount
  if (capitalAmount > 0) {
    const txData = {
      investor_id: investor.id,
      type: 'capital_out',
      amount: capitalAmount,
      date: bankEntry.statement_date,
      description: bankEntry.description,
      reference: bankEntry.external_reference
    };
    const created = await api.entities.InvestorTransaction.create(txData);
    investorTransactionId = created.id;

    await api.entities.Investor.update(investor.id, {
      current_capital_balance: (investor.current_capital_balance || 0) - capitalAmount
    });
  }

  // Create interest withdrawal if there's interest amount
  if (interestAmount > 0) {
    const isManualInterest = investorProduct?.interest_calculation_type === 'manual';

    // For manual interest investors, create a credit entry first (accrual)
    if (isManualInterest) {
      await api.entities.InvestorInterest.create({
        investor_id: investor.id,
        type: 'credit',
        amount: interestAmount,
        date: bankEntry.statement_date,
        description: `Interest accrued (auto-created): ${bankEntry.description}`,
        reference: bankEntry.external_reference
      });
    }

    // Create the debit (withdrawal/payment) entry
    const interestEntry = await api.entities.InvestorInterest.create({
      investor_id: investor.id,
      type: 'debit',
      amount: interestAmount,
      date: bankEntry.statement_date,
      description: bankEntry.description,
      reference: bankEntry.external_reference
    });
    interestId = interestEntry.id;
  }

  await createReconciliationEntry({
    bankStatementId: bankEntry.id,
    investorTransactionId,
    interestId,
    amount: Math.abs(bankEntry.amount),
    reconciliationType: 'investor_withdrawal',
    notes: 'Created new transaction',
    wasCreated: true
  });

  await markBankEntryReconciled(bankEntry.id);

  logReconciliationEvent(AuditAction.RECONCILIATION_CREATE, {
    bank_statement_id: bankEntry.id,
    description: bankEntry.description,
    amount: Math.abs(bankEntry.amount),
    type: 'investor_withdrawal',
    investor_id: investor.id,
    investor_name: investor.business_name || investor.name,
    capital: capitalAmount,
    interest: interestAmount
  });

  return { investorTransactionId, interestId };
}

/**
 * Create a new expense and reconcile
 *
 * @param {Object} params
 * @param {Object} params.bankEntry - The bank entry
 * @param {Object} params.expenseType - The expense type
 * @param {string} params.description - Optional description override
 * @returns {Promise<Object>} Created expense
 */
export async function createExpense({ bankEntry, expenseType, description }) {
  const amount = Math.abs(bankEntry.amount);
  const expenseData = {
    type_id: expenseType?.id || null,
    type_name: expenseType?.name || null,
    amount,
    date: bankEntry.statement_date,
    description: description || bankEntry.description
  };

  const created = await api.entities.Expense.create(expenseData);

  await createReconciliationEntry({
    bankStatementId: bankEntry.id,
    expenseId: created.id,
    amount,
    reconciliationType: 'expense',
    notes: 'Created new expense',
    wasCreated: true
  });

  await markBankEntryReconciled(bankEntry.id);

  logReconciliationEvent(AuditAction.RECONCILIATION_CREATE, {
    bank_statement_id: bankEntry.id,
    description: bankEntry.description,
    amount,
    type: 'expense',
    expense_type: expenseType?.name
  });

  return created;
}

/**
 * Un-reconcile a bank entry
 *
 * @param {Object} params
 * @param {string} params.bankEntryId - The bank entry ID
 * @param {Array} params.reconciliationEntries - The reconciliation entries to remove
 * @param {boolean} params.deleteCreatedTransactions - Whether to delete transactions that were created
 * @returns {Promise<void>}
 */
export async function unreconcile({ bankEntryId, reconciliationEntries, deleteCreatedTransactions = true }) {
  for (const entry of reconciliationEntries) {
    // If we created the transaction, optionally delete it
    if (deleteCreatedTransactions && entry.was_created) {
      if (entry.loan_transaction_id) {
        await api.entities.Transaction.delete(entry.loan_transaction_id);
      }
      if (entry.investor_transaction_id) {
        await api.entities.InvestorTransaction.delete(entry.investor_transaction_id);
      }
      if (entry.expense_id) {
        await api.entities.Expense.delete(entry.expense_id);
      }
      if (entry.interest_id) {
        await api.entities.InvestorInterest.delete(entry.interest_id);
      }
      if (entry.other_income_id) {
        await api.entities.OtherIncome.delete(entry.other_income_id);
      }
    }

    // Delete the reconciliation entry
    await api.entities.ReconciliationEntry.delete(entry.id);
  }

  // Mark bank statement as not reconciled
  await api.entities.BankStatement.update(bankEntryId, {
    is_reconciled: false,
    reconciled_at: null
  });

  logReconciliationEvent(AuditAction.RECONCILIATION_UNDO, {
    bank_statement_id: bankEntryId,
    entry_count: reconciliationEntries.length
  });
}

/**
 * Execute a manual match with multiple selections
 *
 * @param {Object} params
 * @param {Array} params.bankEntryIds - Bank entry IDs being matched
 * @param {Array} params.bankEntries - Bank entries being matched (with amounts)
 * @param {Array} params.targetTransactions - Target transactions to match to
 * @param {string} params.matchType - Type of match
 * @param {string} params.relationshipType - 'many-to-one' | 'one-to-many' | 'one-to-one' | 'net-receipt'
 * @returns {Promise<void>}
 */
export async function executeManualMatch({
  bankEntryIds,
  bankEntries,
  targetTransactions,
  matchType,
  relationshipType
}) {
  // Calculate totals for validation
  // For net-receipt: use signed amounts (credits - debits)
  // For others: use absolute sum
  let bankTotal;
  if (relationshipType === 'net-receipt') {
    // Net amount: sum of signed values
    bankTotal = Math.abs(bankEntries.reduce((sum, e) => sum + e.amount, 0));
  } else {
    bankTotal = bankEntries.reduce((sum, e) => sum + Math.abs(e.amount), 0);
  }
  const transactionTotal = targetTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

  // CRITICAL: Validate amounts balance before proceeding
  validateAmountsBalance(bankTotal, transactionTotal, `manual_match_${relationshipType}`);

  const isLoanType = matchType === 'loan_repayment' || matchType === 'loan_disbursement';
  const isInvestorType = matchType === 'investor_credit' || matchType === 'investor_withdrawal';

  if (relationshipType === 'net-receipt') {
    // Multiple bank entries (mixed credit/debit) → single target
    // Net amount (credits - debits) = target amount
    const target = targetTransactions[0];
    const netAmount = bankEntries.reduce((sum, e) => sum + e.amount, 0);

    for (const bankEntry of bankEntries) {
      await createReconciliationEntry({
        bankStatementId: bankEntry.id,
        loanTransactionId: isLoanType ? target.id : null,
        investorTransactionId: isInvestorType ? target.id : null,
        amount: bankEntry.amount, // Keep signed amount for audit trail
        reconciliationType: matchType,
        notes: `Net receipt match: ${bankEntries.length} entries (net ${netAmount.toFixed(2)})`,
        wasCreated: false
      });

      await markBankEntryReconciled(bankEntry.id);
    }

    logReconciliationEvent(AuditAction.RECONCILIATION_MATCH, {
      bank_entry_count: bankEntries.length,
      target_count: 1,
      net_amount: netAmount,
      match_type: matchType,
      relationship: relationshipType
    });
  } else if (relationshipType === 'many-to-one') {
    // Multiple bank entries → single target
    const target = targetTransactions[0];
    for (const bankEntry of bankEntries) {
      await createReconciliationEntry({
        bankStatementId: bankEntry.id,
        loanTransactionId: isLoanType ? target.id : null,
        investorTransactionId: isInvestorType ? target.id : null,
        amount: Math.abs(bankEntry.amount), // Use actual bank entry amount
        reconciliationType: matchType,
        notes: `Manual grouped match: ${bankEntries.length} bank entries`,
        wasCreated: false
      });

      await markBankEntryReconciled(bankEntry.id);
    }

    logReconciliationEvent(AuditAction.RECONCILIATION_MATCH, {
      bank_entry_count: bankEntries.length,
      target_count: 1,
      match_type: matchType,
      relationship: relationshipType
    });
  } else if (relationshipType === 'one-to-many') {
    // Single bank entry → multiple targets
    const bankEntry = bankEntries[0];
    for (const target of targetTransactions) {
      await createReconciliationEntry({
        bankStatementId: bankEntry.id,
        loanTransactionId: isLoanType ? target.id : null,
        investorTransactionId: isInvestorType ? target.id : null,
        amount: Math.abs(target.amount),
        reconciliationType: matchType,
        notes: `Manual split match: ${targetTransactions.length} transactions`,
        wasCreated: false
      });
    }

    await markBankEntryReconciled(bankEntry.id);

    logReconciliationEvent(AuditAction.RECONCILIATION_MATCH, {
      bank_entry_count: 1,
      target_count: targetTransactions.length,
      match_type: matchType,
      relationship: relationshipType
    });
  } else {
    // one-to-one
    const bankEntry = bankEntries[0];
    const target = targetTransactions[0];

    await createReconciliationEntry({
      bankStatementId: bankEntry.id,
      loanTransactionId: isLoanType ? target.id : null,
      investorTransactionId: isInvestorType ? target.id : null,
      expenseId: matchType === 'expense' ? target.id : null,
      amount: Math.abs(target.amount),
      reconciliationType: matchType,
      notes: 'Manual match',
      wasCreated: false
    });

    await markBankEntryReconciled(bankEntry.id);

    logReconciliationEvent(AuditAction.RECONCILIATION_MATCH, {
      bank_statement_id: bankEntry.id,
      match_type: matchType,
      relationship: relationshipType
    });
  }
}

/**
 * High-level function to execute reconciliation based on suggestion
 *
 * @param {Object} params
 * @param {Object} params.bankEntry - The bank entry
 * @param {Object} params.suggestion - The match suggestion
 * @returns {Promise<void>}
 */
export async function executeReconciliation({ bankEntry, suggestion }) {
  const { matchMode } = suggestion;

  switch (matchMode) {
    case 'match_group':
      return reconcileMatchGroup({ bankEntry, suggestion });

    case 'grouped_disbursement':
      return reconcileGroupedDisbursement({ suggestion });

    case 'grouped_investor':
      return reconcileGroupedInvestor({ suggestion });

    case 'grouped_repayment':
      return reconcileGroupedRepayment({ suggestion });

    case 'match':
      return reconcileSingleMatch({ bankEntry, suggestion });

    default:
      throw new Error(`Unknown match mode: ${matchMode}`);
  }
}
