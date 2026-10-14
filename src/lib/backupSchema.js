// Schema definitions for backup/restore compatibility.
//
// The column lists below are the REAL columns of each table, verified against the live
// database rather than hand-maintained. They matter because processRecordsForRestore()
// uses them as a whitelist: a column missing from this file is silently thrown away on
// restore, and a column listed here that does not exist in the database makes the whole
// insert fail with "column ... does not exist".
//
// Three fields per table:
//   columns  - every real column, in alphabetical order
//   required - NOT NULL with no database default. If one of these is absent from a backup
//              and has no entry in `defaults`, that backup cannot be restored.
//   defaults - fallback values for restoring OLDER backups taken before a column existed.
//              Every value here matches the column's own database DEFAULT, so supplying it
//              is equivalent to omitting the column.
//
// When a migration changes a table, update the entry here in the same commit and bump
// CURRENT_SCHEMA_VERSION to the migration number.

export const CURRENT_SCHEMA_VERSION = 88;

/**
 * Tables exported by a per-organization backup, in FK-safe order (parents first).
 * Both the export and the restore walk this list, so adding a table here is all that is
 * needed to get it into every backup path.
 *
 * Deliberately excluded:
 *   app_settings        - global, not org-scoped; restoring it would clobber other orgs
 *   google_drive_tokens - OAuth refresh tokens
 *   organizations       - the org's own row is stored as `organizationRecord` instead
 *   organization_members / trusted_devices - auth-linked, rebuilt by invitation flow
 */
export const BACKUP_TABLES = [
  // Reference data (no dependencies beyond the organization)
  'loan_products', 'investor_products', 'expense_types', 'first_charge_holders',
  'borrowers', 'properties', 'Investor',
  // Loans and the ledgers hanging off them
  'loans', 'loan_comments', 'InvestorTransaction', 'investor_interest',
  'transactions', 'repayment_schedules', 'loan_properties', 'expenses',
  'value_history', 'bank_statements', 'other_income', 'property_documents',
  'borrower_loan_preferences', 'receipt_drafts',
  'internal_accounts', 'internal_transfers',
  'reconciliation_patterns', 'reconciliation_entries',
  'accepted_orphans',
  // History and cached aggregates
  'audit_logs',
  'invitations',
  'nightly_job_runs',
  'organization_summary',
  'letter_templates',
  'generated_letters',
  'user_profiles',
];

/**
 * Tables written back by a restore, in the same FK-safe order.
 *
 * audit_logs is skipped because the rows would describe the restore itself, and
 * user_profiles because it is keyed to auth.users and carries no organization_id -
 * membership is re-established through the invitation flow instead.
 */
export const RESTORE_TABLES = BACKUP_TABLES.filter(
  (t) => t !== 'audit_logs' && t !== 'user_profiles'
);

/** Table name -> the api.entities key that reads it. */
export const ENTITY_NAMES = {
  loan_products: 'LoanProduct',
  investor_products: 'InvestorProduct',
  expense_types: 'ExpenseType',
  first_charge_holders: 'FirstChargeHolder',
  borrowers: 'Borrower',
  properties: 'Property',
  Investor: 'Investor',
  loans: 'Loan',
  loan_comments: 'LoanComment',
  InvestorTransaction: 'InvestorTransaction',
  investor_interest: 'InvestorInterest',
  transactions: 'Transaction',
  repayment_schedules: 'RepaymentSchedule',
  loan_properties: 'LoanProperty',
  expenses: 'Expense',
  value_history: 'ValueHistory',
  bank_statements: 'BankStatement',
  other_income: 'OtherIncome',
  property_documents: 'PropertyDocument',
  borrower_loan_preferences: 'BorrowerLoanPreference',
  receipt_drafts: 'ReceiptDraft',
  internal_accounts: 'InternalAccount',
  internal_transfers: 'InternalTransfer',
  reconciliation_patterns: 'ReconciliationPattern',
  reconciliation_entries: 'ReconciliationEntry',
  accepted_orphans: 'AcceptedOrphan',
  audit_logs: 'AuditLog',
  invitations: 'Invitation',
  nightly_job_runs: 'NightlyJobRun',
  organization_summary: 'OrganizationSummary',
  letter_templates: 'LetterTemplate',
  generated_letters: 'GeneratedLetter',
  user_profiles: 'UserProfile',
};

/**
 * Foreign-key columns the restore rewrites from old ids to newly inserted ones.
 *
 * Only columns that actually exist are listed - a mapping for a column that
 * processRecordsForRestore() has already stripped is dead code, and that kind of drift
 * is what made the old per-page copies of this map diverge.
 *
 * Known limits, all of them ordering problems rather than missing entries:
 *   transactions.linked_disbursement_id    self-referential; may point at a row not yet inserted
 *   bank_statements.pattern_id             patterns are restored after statements
 *   accepted_orphans.entity_id             polymorphic, handled separately
 *   receipt_drafts.allocations / selected_loan_ids, borrower_loan_preferences.default_loan_ids
 *                                          loan ids embedded in JSONB / arrays
 */
export const RESTORE_FK_FIELDS = {
  // restructured_from_loan_id is self-referential and handled in a second pass
  loans: ['borrower_id', 'product_id'],
  loan_comments: ['loan_id', 'user_id'],  // user_id may be null for imported comments
  Investor: ['investor_product_id'],
  InvestorTransaction: ['investor_id'],
  investor_interest: ['investor_id'],
  transactions: ['loan_id', 'borrower_id'],
  repayment_schedules: ['loan_id'],
  loan_properties: ['loan_id', 'property_id', 'first_charge_holder_id'],
  expenses: ['type_id', 'loan_id'],  // type_id for expense type, loan_id for loan reference
  value_history: ['property_id', 'loan_property_id'],
  bank_statements: ['suggested_loan_id', 'suggested_investor_id', 'suggested_expense_type_id'],
  property_documents: ['property_id'],
  borrower_loan_preferences: ['borrower_id'],
  receipt_drafts: ['borrower_id', 'bank_statement_id'],
  reconciliation_patterns: ['loan_id', 'investor_id', 'expense_type_id'],
  reconciliation_entries: ['bank_statement_id', 'loan_transaction_id', 'investor_transaction_id',
                           'expense_id', 'other_income_id', 'interest_id', 'internal_transfer_id'],
  internal_transfers: ['internal_account_id'],
  accepted_orphans: ['entity_id'],  // polymorphic, handled specially
  organization_summary: [],  // keyed by organization_id, handled specially
  letter_templates: ['created_by'],  // auth user id, may be null
  generated_letters: ['template_id', 'loan_id', 'borrower_id', 'created_by'],
};

/**
 * Resolve a table name to its api.entities key.
 * Throws rather than returning the raw table name: a missing mapping used to surface as
 * `api.entities[undefined].listAll()` throwing inside the per-table try/catch, which
 * recorded the table as zero rows and produced a backup that looked complete.
 */
export function getEntityName(tableName) {
  const entityName = ENTITY_NAMES[tableName];
  if (!entityName) {
    throw new Error(`No api.entities mapping for table "${tableName}" - add it to ENTITY_NAMES`);
  }
  return entityName;
}

// Columns present on every table that the restore always strips and lets the database
// re-create, so their absence from a backup is never an incompatibility.
const AUTO_COLUMNS = ['id', 'organization_id', 'created_at', 'updated_at'];

export const tableSchemas = {

  loan_products: {
    // max_duration (not max_term) is the real column.
    columns: ['abbreviation', 'compound_after_rollup', 'created_at', 'default_additional_fees',
              'default_additional_fees_note', 'extend_for_full_period', 'id', 'interest_alignment',
              'interest_calculation_method', 'interest_only_period', 'interest_paid_in_advance',
              'interest_rate', 'interest_type', 'max_amount', 'max_duration', 'min_amount', 'name',
              'organization_id', 'period', 'product_type', 'scheduler_config', 'scheduler_type'],
    required: ['interest_rate', 'interest_type', 'name', 'period'],
    defaults: {
      product_type: 'Standard',
      scheduler_type: 'reducing_balance',
      scheduler_config: {},
      compound_after_rollup: false,
      default_additional_fees: 0,
    }
  },

  investor_products: {
    columns: ['created_at', 'description', 'id', 'interest_calculation_type',
              'interest_posting_day', 'interest_posting_frequency', 'interest_rate_per_annum',
              'min_balance_for_interest', 'min_balance_for_withdrawals', 'name', 'organization_id',
              'status'],
    required: ['name'],
    defaults: {
      status: 'Active',
      interest_posting_frequency: 'monthly',
      interest_calculation_type: 'automatic',
      interest_posting_day: 1,
      interest_rate_per_annum: 0,
      min_balance_for_interest: 0,
      min_balance_for_withdrawals: 0,
    }
  },

  expense_types: {
    columns: ['description', 'id', 'name', 'organization_id'],
    required: ['name'],
    defaults: {}
  },

  first_charge_holders: {
    columns: ['contact_email', 'contact_phone', 'created_at', 'id', 'name', 'organization_id'],
    required: ['name'],
    defaults: {}
  },

  borrowers: {
    columns: ['address', 'archived_by', 'archived_date', 'business', 'city', 'country',
              'created_at', 'email', 'first_name', 'full_name', 'gender', 'id', 'id_number',
              'import_created_date', 'is_archived', 'keywords', 'landline', 'last_name', 'mobile',
              'notes', 'organization_id', 'phone', 'status', 'unique_number', 'zipcode'],
    required: ['first_name', 'last_name'],
    defaults: {
      status: 'Active',
      keywords: [],
      is_archived: false,
    }
  },

  properties: {
    columns: ['address', 'city', 'country', 'created_at', 'created_by', 'current_value', 'id',
              'notes', 'organization_id', 'postcode', 'property_type'],
    required: ['address'],
    defaults: {}
  },

  'Investor': {
    // PascalCase table name in the database.
    columns: ['account_number', 'accrued_interest', 'annual_interest_rate', 'business_name',
              'current_capital_balance', 'default_capital_repayment', 'email', 'first_name', 'id',
              'interest_calculation_type', 'investor_number', 'investor_product_id',
              'last_accrual_date', 'last_name', 'manual_interest_amount', 'name',
              'organization_id', 'phone', 'status', 'total_capital_contributed',
              'total_interest_paid'],
    required: ['name'],
    defaults: {
      status: 'Active',
      accrued_interest: 0,
      total_interest_paid: 0,
      interest_calculation_type: 'annual_rate',
      total_capital_contributed: 0,
      current_capital_balance: 0,
    }
  },

  loans: {
    // No end_date / scheduler_type / notes column - term comes from duration, scheduler from the product.
    columns: ['additional_deducted_fees', 'additional_deducted_fees_note', 'arrangement_fee',
              'auto_extend', 'balance_updated_at', 'borrower_id', 'borrower_name', 'charges_paid',
              'created_at', 'deleted_by', 'deleted_date', 'deleted_reason', 'description',
              'duration', 'exit_fee', 'has_penalty_rate', 'id', 'interest_only_period',
              'interest_paid', 'interest_rate', 'interest_remaining', 'interest_type',
              'is_deleted', 'loan_number', 'monthly_charge', 'net_disbursed', 'organization_id',
              'original_term', 'overpayment_credit', 'overridden_rate', 'override_interest_rate',
              'penalty_rate', 'penalty_rate_from', 'period', 'principal_amount', 'principal_paid',
              'principal_remaining', 'product_id', 'product_name', 'product_type',
              'restructured_from_loan_id', 'restructured_from_loan_number', 'roll_up_amount',
              'roll_up_amount_override', 'roll_up_length', 'start_date', 'status', 'total_charges',
              'total_interest', 'total_repayable'],
    required: ['borrower_id', 'duration', 'principal_amount', 'product_id', 'start_date'],
    defaults: {
      status: 'Live',
      is_deleted: false,
      auto_extend: false,
      has_penalty_rate: false,
      override_interest_rate: false,
      roll_up_amount_override: false,
      additional_deducted_fees: 0,
    }
  },

  'InvestorTransaction': {
    // PascalCase table name in the database.
    columns: ['accrual_period_end', 'accrual_period_start', 'amount', 'bank_account', 'date',
              'description', 'id', 'investor_id', 'investor_name', 'is_auto_generated', 'notes',
              'organization_id', 'reference', 'transaction_id', 'type'],
    required: ['amount', 'date', 'investor_id', 'type'],
    defaults: {
      is_auto_generated: false,
    }
  },

  investor_interest: {
    columns: ['amount', 'created_at', 'created_by', 'date', 'description', 'id', 'investor_id',
              'organization_id', 'reference', 'type'],
    required: ['amount', 'date', 'investor_id', 'type'],
    defaults: {}
  },

  transactions: {
    columns: ['amount', 'borrower_id', 'created_at', 'date', 'deducted_fee', 'deducted_interest',
              'deleted_by', 'deleted_date', 'deleted_reason', 'fees_applied', 'gross_amount', 'id',
              'interest_applied', 'is_deleted', 'is_initial_disbursement',
              'linked_disbursement_id', 'loan_id', 'notes', 'organization_id', 'principal_applied',
              'reference', 'type'],
    required: ['amount', 'date', 'loan_id', 'type'],
    defaults: {
      is_deleted: false,
      deducted_fee: 0,
      deducted_interest: 0,
      is_initial_disbursement: false,
    }
  },

  repayment_schedules: {
    // Payment progress lives in principal_paid / interest_paid / status, not an is_paid flag.
    columns: ['balance', 'calculation_days', 'calculation_method', 'calculation_principal_start',
              'charge_amount', 'due_date', 'id', 'installment_number', 'interest_amount',
              'interest_paid', 'is_extension_period', 'is_roll_up_period', 'is_serviced_period',
              'loan_id', 'organization_id', 'principal_amount', 'principal_paid',
              'rolled_up_interest', 'status', 'total_due'],
    required: ['due_date', 'installment_number', 'interest_amount', 'loan_id', 'principal_amount',
               'total_due'],
    defaults: {
      is_extension_period: false,
      is_roll_up_period: false,
      is_serviced_period: false,
    }
  },

  loan_properties: {
    columns: ['charge_type', 'created_at', 'first_charge_balance', 'first_charge_holder_id', 'id',
              'loan_id', 'notes', 'organization_id', 'property_id', 'removed_date',
              'removed_reason', 'status'],
    required: ['loan_id', 'property_id'],
    defaults: {
      status: 'Active',
    }
  },

  expenses: {
    columns: ['amount', 'borrower_name', 'date', 'description', 'id', 'loan_id', 'organization_id',
              'type_id', 'type_name'],
    required: ['amount', 'date', 'type_id'],
    defaults: {}
  },

  value_history: {
    // value_type + effective_date are NOT NULL; there is no valuation_date or source column.
    columns: ['created_at', 'created_by', 'effective_date', 'id', 'loan_property_id', 'notes',
              'organization_id', 'property_id', 'value', 'value_type'],
    required: ['effective_date', 'property_id', 'value', 'value_type'],
    defaults: {
      value_type: 'Property Valuation',
    }
  },

  bank_statements: {
    // Unreconcilable entries are flagged in place via is_unreconcilable + unreconcilable_*.
    columns: ['amount', 'balance', 'bank_source', 'created_at', 'description',
              'external_reference', 'id', 'is_reconciled', 'is_unreconcilable', 'organization_id',
              'pattern_id', 'raw_data', 'reconciled_at', 'reconciled_by', 'statement_date',
              'suggested_expense_type_id', 'suggested_investor_id', 'suggested_loan_id',
              'suggested_match_type', 'suggestion_confidence', 'suggestion_reason',
              'transaction_type', 'unreconcilable_at', 'unreconcilable_by',
              'unreconcilable_group_id', 'unreconcilable_reason'],
    required: ['amount', 'bank_source', 'statement_date'],
    defaults: {
      is_reconciled: false,
      is_unreconcilable: false,
    }
  },

  other_income: {
    columns: ['amount', 'created_at', 'created_by', 'date', 'description', 'id', 'organization_id'],
    required: ['amount', 'date'],
    defaults: {}
  },

  borrower_loan_preferences: {
    columns: ['borrower_id', 'created_at', 'default_loan_ids', 'id', 'last_allocation_pattern',
              'organization_id', 'updated_at'],
    required: ['borrower_id'],
    defaults: {
      default_loan_ids: [],
    }
  },

  receipt_drafts: {
    // entry_mode / receipt_date / receipt_amount are NOT NULL; allocations is a JSONB map of loan_id -> {principal, interest, fees}.
    columns: ['allocations', 'bank_statement_id', 'borrower_id', 'created_at', 'created_by',
              'entry_mode', 'filed_at', 'filed_by', 'id', 'organization_id', 'receipt_amount',
              'receipt_date', 'reference', 'row_order', 'selected_loan_ids', 'status',
              'updated_at'],
    required: ['entry_mode', 'receipt_amount', 'receipt_date'],
    defaults: {
      entry_mode: 'manual',
      status: 'draft',
      allocations: {},
      selected_loan_ids: [],
    }
  },

  reconciliation_patterns: {
    columns: ['amount_max', 'amount_min', 'bank_source', 'confidence_score', 'created_at',
              'created_by', 'default_capital_ratio', 'default_fees_ratio',
              'default_interest_ratio', 'description_pattern', 'expense_type_id', 'id',
              'investor_id', 'last_used_at', 'loan_id', 'match_count', 'match_type',
              'organization_id', 'transaction_type'],
    required: ['description_pattern', 'match_type'],
    defaults: {}
  },

  reconciliation_entries: {
    columns: ['amount', 'bank_statement_id', 'created_at', 'created_by', 'expense_id', 'id',
              'interest_id', 'internal_transfer_id', 'investor_transaction_id',
              'loan_transaction_id', 'notes', 'organization_id', 'other_income_id',
              'reconciliation_type', 'was_created'],
    required: ['amount', 'bank_statement_id', 'reconciliation_type'],
    defaults: {
      was_created: false,
    }
  },

  internal_accounts: {
    columns: ['created_at', 'created_by', 'description', 'id', 'is_active', 'match_keyword',
              'name', 'organization_id', 'updated_at'],
    required: ['name'],
    defaults: {
      is_active: true,
    }
  },

  internal_transfers: {
    columns: ['amount', 'created_at', 'created_by', 'date', 'description', 'direction', 'id',
              'internal_account_id', 'organization_id', 'reference'],
    required: ['amount', 'date', 'direction', 'internal_account_id'],
    defaults: {}
  },

  accepted_orphans: {
    columns: ['accepted_at', 'accepted_by', 'created_at', 'entity_id', 'entity_type', 'id',
              'organization_id', 'reason', 'updated_at'],
    required: ['entity_id', 'entity_type', 'reason'],
    defaults: {}
  },

  audit_logs: {
    columns: ['action', 'created_at', 'details', 'entity_id', 'entity_name', 'entity_type', 'id',
              'ip_address', 'new_values', 'organization_id', 'previous_values', 'user_agent',
              'user_id'],
    required: ['action'],
    defaults: {}
  },

  invitations: {
    columns: ['accepted_at', 'created_at', 'email', 'expires_at', 'id', 'invited_by',
              'organization_id', 'role', 'status', 'token'],
    required: ['email', 'expires_at', 'invited_by', 'role', 'token'],
    defaults: {
      status: 'pending',
    }
  },

  nightly_job_runs: {
    columns: ['created_at', 'details', 'failed', 'id', 'organization_id', 'processed', 'run_date',
              'skipped', 'status', 'succeeded', 'task_name'],
    required: ['status', 'task_name'],
    defaults: {}
  },

  organization_summary: {
    // Keyed by organization_id, not id - one cached row per org.
    columns: ['arrears_amount', 'live_loan_count', 'organization_id', 'settled_loan_count',
              'total_disbursed', 'total_interest_outstanding', 'total_principal_outstanding',
              'total_repaid', 'updated_at'],
    required: [],
    defaults: {}
  },

  app_settings: {
    // Keyed by `key`. Global (not org-scoped), so it is not part of a per-organization backup.
    columns: ['description', 'key', 'updated_at', 'updated_by', 'value'],
    required: ['value'],
    defaults: {}
  },

  organizations: {
    // The org row itself is captured as `organizationRecord` in the backup, not as a table.
    columns: ['address_line1', 'address_line2', 'city', 'country', 'created_at', 'created_by',
              'description', 'email', 'google_drive_backup_folder_id',
              'google_drive_backup_folder_path', 'google_drive_base_folder_id',
              'google_drive_base_folder_path', 'google_drive_connected', 'google_drive_email',
              'id', 'is_active', 'logo_url', 'name', 'phone', 'postcode', 'settings', 'slug',
              'updated_at', 'website'],
    required: ['name', 'slug'],
    defaults: {
      settings: {},
      google_drive_connected: false,
      is_active: true,
    }
  },

  user_profiles: {
    // No organization_id / role column - membership and role live in organization_members.
    columns: ['avatar_url', 'created_at', 'default_organization_id', 'email', 'full_name',
              'google_drive_base_folder_id', 'google_drive_base_folder_path',
              'google_drive_connected', 'google_drive_email', 'id', 'is_super_admin',
              'preferences', 'signature_image_url', 'updated_at'],
    required: [],
    defaults: {
      is_super_admin: false,
      google_drive_connected: false,
    }
  },

  loan_comments: {
    columns: ['comment', 'created_at', 'id', 'loan_id', 'organization_id', 'user_id', 'user_name'],
    required: ['comment', 'loan_id'],
    defaults: {}
  },

  letter_templates: {
    columns: ['available_placeholders', 'body_template', 'category', 'created_at', 'created_by',
              'default_attachments', 'description', 'email_body_template', 'id', 'is_active',
              'name', 'organization_id', 'subject_template', 'updated_at'],
    required: ['body_template', 'name'],
    defaults: {
      category: 'General',
      available_placeholders: [],
      default_attachments: [],
      is_active: true,
    }
  },

  generated_letters: {
    columns: ['attached_reports', 'body_rendered', 'borrower_id', 'created_at', 'created_by',
              'delivery_method', 'google_drive_file_id', 'google_drive_file_url', 'id', 'loan_id',
              'organization_id', 'pdf_storage_path', 'placeholder_values', 'recipient_email',
              'settlement_date', 'subject', 'template_id', 'template_name'],
    required: [],
    defaults: {
      placeholder_values: {},
      attached_reports: [],
    }
  },

  property_documents: {
    columns: ['created_at', 'created_by', 'document_type', 'external_url', 'file_size', 'id',
              'mime_type', 'notes', 'organization_id', 'property_id', 'storage_path', 'title',
              'updated_at'],
    required: ['document_type', 'property_id', 'title'],
    defaults: {}
  },

  google_drive_tokens: {
    // Never exported: contains OAuth refresh tokens.
    columns: ['access_token_encrypted', 'created_at', 'id', 'organization_id',
              'refresh_token_encrypted', 'token_expiry', 'updated_at', 'user_id'],
    required: ['access_token_encrypted', 'refresh_token_encrypted', 'token_expiry', 'user_id'],
    defaults: {}
  },};

/**
 * Analyze a backup file for compatibility issues with current schema
 * @param {Object} backupData - The parsed backup JSON
 * @param {Object} currentSchema - The tableSchemas object (defaults to exported tableSchemas)
 * @returns {Object} Analysis results with unknownTables, droppedColumns, addedColumns, missingRequired
 */
export function analyzeBackup(backupData, currentSchema = tableSchemas) {
  const issues = {
    unknownTables: [],
    droppedColumns: {},  // table -> [columns that will be dropped]
    addedColumns: {},    // table -> [{column, default}] columns that will use defaults
    missingRequired: {}, // table -> [columns] NOT NULL with no default and no value in the backup
    backupVersion: backupData.schemaVersion || backupData.version || 'unknown',
    currentVersion: CURRENT_SCHEMA_VERSION,
    hasIssues: false
  };

  for (const [tableName, records] of Object.entries(backupData.tables || {})) {
    const schema = currentSchema[tableName];

    if (!schema) {
      issues.unknownTables.push(tableName);
      issues.hasIssues = true;
      continue;
    }

    if (!records || records.length === 0) continue;

    // Union the keys across records rather than trusting the first one: a nullable column
    // can be absent from an individual row in some exports.
    const backupColSet = new Set();
    for (const record of records) {
      for (const key of Object.keys(record)) backupColSet.add(key);
    }

    const schemaColumns = new Set(schema.columns);
    const defaults = schema.defaults || {};

    // Columns in the backup that no longer exist - processRecordsForRestore drops these
    const dropped = [...backupColSet].filter(c => !schemaColumns.has(c) && c !== 'id');
    if (dropped.length > 0) {
      issues.droppedColumns[tableName] = dropped;
      issues.hasIssues = true;
    }

    for (const col of schema.columns) {
      if (backupColSet.has(col) || AUTO_COLUMNS.includes(col)) continue;

      if (col in defaults) {
        issues.addedColumns[tableName] = issues.addedColumns[tableName] || [];
        issues.addedColumns[tableName].push({ column: col, default: defaults[col] });
      } else if ((schema.required || []).includes(col)) {
        // NOT NULL, no database default, nothing to fall back on - the insert will fail
        issues.missingRequired[tableName] = issues.missingRequired[tableName] || [];
        issues.missingRequired[tableName].push(col);
        issues.hasIssues = true;
      }
      // Anything else is nullable or database-defaulted: safe to leave out entirely
    }
  }

  return issues;
}

/**
 * Process records for a table, filtering out unknown columns and applying defaults
 * @param {string} tableName - Name of the table
 * @param {Array} records - Array of records from backup
 * @param {Object} schema - Schema definition for the table (optional, uses tableSchemas if not provided)
 * @returns {Array} Processed records ready for insert
 */
export function processRecordsForRestore(tableName, records, schema = null) {
  const tableSchema = schema || tableSchemas[tableName];

  if (!tableSchema) {
    console.warn(`[Backup] Unknown table "${tableName}" - skipping schema processing`);
    return records;
  }

  const defaults = tableSchema.defaults || {};

  return records.map(record => {
    const processed = {};

    // Only include known columns from the record
    for (const col of tableSchema.columns) {
      if (col in record) {
        processed[col] = record[col];
      } else if (col in defaults) {
        processed[col] = defaults[col];
      }
      // Skip columns not in record and not having defaults (DB will use its defaults)
    }

    return processed;
  });
}

/**
 * Check if a backup is compatible with current schema (no blocking issues)
 * @param {Object} analysis - Result from analyzeBackup()
 * @returns {boolean} True if backup can be restored (warnings allowed, but no missing required cols)
 */
export function isBackupCompatible(analysis) {
  // Backup is incompatible if there are missing required columns without defaults
  return Object.keys(analysis.missingRequired).length === 0;
}

/**
 * Get a human-readable summary of backup analysis
 * @param {Object} analysis - Result from analyzeBackup()
 * @returns {string} Summary text
 */
export function getAnalysisSummary(analysis) {
  const parts = [];

  if (analysis.backupVersion !== analysis.currentVersion) {
    parts.push(`Schema version: backup=${analysis.backupVersion}, current=${analysis.currentVersion}`);
  }

  const droppedCount = Object.values(analysis.droppedColumns).flat().length;
  if (droppedCount > 0) {
    parts.push(`${droppedCount} column(s) will be dropped`);
  }

  const addedCount = Object.values(analysis.addedColumns).flat().length;
  if (addedCount > 0) {
    parts.push(`${addedCount} column(s) will use defaults`);
  }

  if (analysis.unknownTables.length > 0) {
    parts.push(`${analysis.unknownTables.length} unknown table(s) will be skipped`);
  }

  const missingCount = Object.values(analysis.missingRequired).flat().length;
  if (missingCount > 0) {
    parts.push(`WARNING: ${missingCount} required column(s) missing - restore may fail`);
  }

  return parts.length > 0 ? parts.join('; ') : 'Backup is fully compatible';
}
