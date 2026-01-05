import { supabase } from '@/lib/supabaseClient';

// Audit log action types
export const AuditAction = {
  // Authentication
  LOGIN: 'login',
  LOGOUT: 'logout',
  LOGIN_FAILED: 'login_failed',

  // Loans
  LOAN_CREATE: 'loan_create',
  LOAN_UPDATE: 'loan_update',
  LOAN_DELETE: 'loan_delete',
  LOAN_IMPORT: 'loan_import',
  LOAN_SETTLE: 'loan_settle',

  // Transactions
  TRANSACTION_CREATE: 'transaction_create',
  TRANSACTION_UPDATE: 'transaction_update',
  TRANSACTION_DELETE: 'transaction_delete',

  // Borrowers
  BORROWER_CREATE: 'borrower_create',
  BORROWER_UPDATE: 'borrower_update',
  BORROWER_DELETE: 'borrower_delete',

  // Loan Products
  PRODUCT_CREATE: 'product_create',
  PRODUCT_UPDATE: 'product_update',
  PRODUCT_DELETE: 'product_delete',
  PRODUCT_DUPLICATE: 'product_duplicate',

  // Investors
  INVESTOR_CREATE: 'investor_create',
  INVESTOR_UPDATE: 'investor_update',
  INVESTOR_DELETE: 'investor_delete',
  INVESTOR_TRANSACTION_CREATE: 'investor_transaction_create',
  INVESTOR_TRANSACTION_UPDATE: 'investor_transaction_update',
  INVESTOR_TRANSACTION_DELETE: 'investor_transaction_delete',
  INVESTOR_INTEREST_POST: 'investor_interest_post',

  // Expenses
  EXPENSE_CREATE: 'expense_create',
  EXPENSE_UPDATE: 'expense_update',
  EXPENSE_DELETE: 'expense_delete',

  // Organization
  ORG_MEMBER_INVITE: 'org_member_invite',
  ORG_MEMBER_REMOVE: 'org_member_remove',
  ORG_SETTINGS_UPDATE: 'org_settings_update',

  // Bulk Imports
  BULK_IMPORT: 'bulk_import',
  BULK_IMPORT_TRANSACTIONS: 'bulk_import_transactions',
  BULK_IMPORT_DISBURSEMENTS: 'bulk_import_disbursements',
  BULK_IMPORT_LOANS: 'bulk_import_loans',
  BULK_IMPORT_INVESTORS: 'bulk_import_investors',
  BULK_IMPORT_INVESTOR_TRANSACTIONS: 'bulk_import_investor_transactions',

  // Bank Reconciliation
  RECONCILIATION_MATCH: 'reconciliation_match',
  RECONCILIATION_CREATE: 'reconciliation_create',
  RECONCILIATION_UNMATCH: 'reconciliation_unmatch',

  // Security/Properties
  PROPERTY_CREATE: 'property_create',
  PROPERTY_UPDATE: 'property_update',
  LOAN_PROPERTY_LINK: 'loan_property_link',
  LOAN_PROPERTY_REMOVE: 'loan_property_remove',
  VALUATION_CREATE: 'valuation_create',
  FIRST_CHARGE_HOLDER_CREATE: 'first_charge_holder_create',
  FIRST_CHARGE_HOLDER_UPDATE: 'first_charge_holder_update',

  // Backup/Restore
  ORG_BACKUP_EXPORT: 'org_backup_export',
  ORG_BACKUP_RESTORE: 'org_backup_restore'
};

// Entity types for categorization
export const EntityType = {
  USER: 'user',
  LOAN: 'loan',
  TRANSACTION: 'transaction',
  BORROWER: 'borrower',
  PRODUCT: 'loan_product',
  INVESTOR: 'investor',
  INVESTOR_TRANSACTION: 'investor_transaction',
  EXPENSE: 'expense',
  ORGANIZATION: 'organization',
  PAGE: 'page',
  PROPERTY: 'property',
  LOAN_PROPERTY: 'loan_property',
  VALUATION: 'valuation',
  FIRST_CHARGE_HOLDER: 'first_charge_holder',
  BULK_IMPORT: 'bulk_import',
  RECONCILIATION: 'reconciliation'
};

/**
 * Log an audit event
 * @param {Object} params - Audit log parameters
 * @param {string} params.action - The action type (use AuditAction constants)
 * @param {string} params.entityType - The type of entity (use EntityType constants)
 * @param {string} [params.entityId] - The ID of the affected entity
 * @param {string} [params.entityName] - Human-readable name/identifier of the entity
 * @param {Object} [params.details] - Additional details about the action
 * @param {Object} [params.previousValues] - Previous values before update (for amendments)
 * @param {Object} [params.newValues] - New values after update (for amendments)
 * @param {string} [params.userId] - User ID (auto-detected if not provided)
 * @param {string} [params.organizationId] - Organization ID (auto-detected if not provided)
 */
export async function logAudit({
  action,
  entityType,
  entityId = null,
  entityName = null,
  details = null,
  previousValues = null,
  newValues = null,
  userId = null,
  organizationId = null
}) {
  try {
    // Get current user if not provided
    if (!userId) {
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id || null;
    }

    // Get organization ID from sessionStorage if not provided (per-tab isolation)
    if (!organizationId) {
      organizationId = sessionStorage.getItem('currentOrganizationId');
    }

    const auditEntry = {
      action,
      entity_type: entityType,
      entity_id: entityId,
      entity_name: entityName,
      details: details ? JSON.stringify(details) : null,
      previous_values: previousValues ? JSON.stringify(previousValues) : null,
      new_values: newValues ? JSON.stringify(newValues) : null,
      user_id: userId,
      organization_id: organizationId,
      ip_address: null, // Can't reliably get client IP from browser
      user_agent: navigator.userAgent,
      created_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('audit_logs')
      .insert(auditEntry);

    if (error) {
      console.error('Failed to log audit event:', error);
    }
  } catch (err) {
    // Don't throw - audit logging should not break the app
    console.error('Audit logging error:', err);
  }
}

/**
 * Helper to log authentication events
 */
export async function logAuthEvent(action, userEmail, success = true, details = null) {
  await logAudit({
    action,
    entityType: EntityType.USER,
    entityName: userEmail,
    details: {
      success,
      ...details
    }
  });
}

/**
 * Helper to log loan events
 */
export async function logLoanEvent(action, loan, details = null, previousValues = null) {
  await logAudit({
    action,
    entityType: EntityType.LOAN,
    entityId: loan.id,
    entityName: loan.loan_number || `Loan ${loan.id?.slice(0, 8)}`,
    details,
    previousValues,
    newValues: action.includes('update') ? details : null
  });
}

/**
 * Helper to log transaction events
 */
export async function logTransactionEvent(action, transaction, loanInfo = null, details = null) {
  await logAudit({
    action,
    entityType: EntityType.TRANSACTION,
    entityId: transaction.id,
    entityName: `${transaction.type} - ${transaction.amount}`,
    details: {
      loan_id: transaction.loan_id,
      loan_number: loanInfo?.loan_number,
      ...details
    }
  });
}

/**
 * Helper to log borrower events
 */
export async function logBorrowerEvent(action, borrower, details = null, previousValues = null) {
  await logAudit({
    action,
    entityType: EntityType.BORROWER,
    entityId: borrower.id,
    entityName: borrower.name,
    details,
    previousValues,
    newValues: action.includes('update') ? details : null
  });
}

/**
 * Helper to log product events
 */
export async function logProductEvent(action, product, details = null, previousValues = null) {
  await logAudit({
    action,
    entityType: EntityType.PRODUCT,
    entityId: product.id,
    entityName: product.name,
    details,
    previousValues,
    newValues: action.includes('update') ? details : null
  });
}

/**
 * Helper to log page access
 */
export async function logPageAccess(pageName, path) {
  await logAudit({
    action: AuditAction.PAGE_ACCESS,
    entityType: EntityType.PAGE,
    entityName: pageName,
    details: { path }
  });
}

/**
 * Helper to log property events
 */
export async function logPropertyEvent(action, property, details = null, previousValues = null) {
  await logAudit({
    action,
    entityType: EntityType.PROPERTY,
    entityId: property.id,
    entityName: property.address,
    details,
    previousValues,
    newValues: action.includes('update') ? details : null
  });
}

/**
 * Helper to log loan-property link events
 */
export async function logLoanPropertyEvent(action, loanProperty, loan = null, property = null, details = null) {
  await logAudit({
    action,
    entityType: EntityType.LOAN_PROPERTY,
    entityId: loanProperty.id,
    entityName: `${loan?.loan_number || 'Loan'} - ${property?.address || 'Property'}`,
    details: {
      loan_id: loanProperty.loan_id,
      property_id: loanProperty.property_id,
      charge_type: loanProperty.charge_type,
      ...details
    }
  });
}

/**
 * Helper to log investor events
 */
export async function logInvestorEvent(action, investor, details = null, previousValues = null) {
  await logAudit({
    action,
    entityType: EntityType.INVESTOR,
    entityId: investor.id,
    entityName: investor.name,
    details,
    previousValues,
    newValues: action.includes('update') ? details : null
  });
}

/**
 * Helper to log investor transaction events (capital deposits/withdrawals, interest ledger)
 */
export async function logInvestorTransactionEvent(action, transaction, investorInfo = null, details = null, previousValues = null) {
  await logAudit({
    action,
    entityType: EntityType.INVESTOR_TRANSACTION,
    entityId: transaction.id,
    entityName: `${transaction.type || transaction.transaction_type} - £${Number(transaction.amount || 0).toLocaleString()}`,
    details: {
      investor_id: transaction.investor_id,
      investor_name: investorInfo?.name,
      amount: transaction.amount,
      type: transaction.type || transaction.transaction_type,
      date: transaction.date || transaction.transaction_date,
      ...details
    },
    previousValues,
    newValues: action.includes('update') ? details : null
  });
}

/**
 * Helper to log expense events
 */
export async function logExpenseEvent(action, expense, details = null, previousValues = null) {
  await logAudit({
    action,
    entityType: EntityType.EXPENSE,
    entityId: expense.id,
    entityName: expense.description || expense.category || `Expense £${Number(expense.amount || 0).toLocaleString()}`,
    details: {
      amount: expense.amount,
      category: expense.category,
      date: expense.date,
      ...details
    },
    previousValues,
    newValues: action.includes('update') ? details : null
  });
}

/**
 * Helper to log bulk import events
 */
export async function logBulkImportEvent(action, entityType, summary, details = null) {
  await logAudit({
    action,
    entityType: EntityType.BULK_IMPORT,
    entityId: null,
    entityName: `${entityType} Import`,
    details: {
      entityType,
      ...summary,
      ...details
    }
  });
}

/**
 * Helper to log bank reconciliation events
 */
export async function logReconciliationEvent(action, details = null) {
  await logAudit({
    action,
    entityType: EntityType.RECONCILIATION,
    entityId: details?.transaction_id || details?.bank_transaction_id || null,
    entityName: details?.description || 'Bank Reconciliation',
    details
  });
}
