// Schema definitions for backup/restore compatibility
// Update CURRENT_SCHEMA_VERSION when adding new migrations that affect table structure

export const CURRENT_SCHEMA_VERSION = 72;

// Define columns and defaults for each table
// When adding new columns to tables, add them here with appropriate defaults
export const tableSchemas = {
  loan_products: {
    columns: ['id', 'organization_id', 'name', 'description', 'interest_rate',
              'interest_type', 'min_term', 'max_term', 'min_amount', 'max_amount',
              'arrangement_fee', 'exit_fee', 'default_rate', 'is_active',
              'created_at', 'updated_at', 'product_type', 'period', 'interest_calculation_method',
              'interest_alignment', 'interest_paid_in_advance', 'extend_for_full_period',
              'interest_only_period', 'abbreviation', 'scheduler_type', 'scheduler_config',
              'compound_after_rollup', 'default_additional_fees', 'default_additional_fees_note'],
    defaults: {
      is_active: true,
      scheduler_type: 'reducing_balance',
      scheduler_config: {},
      compound_after_rollup: false,
      default_additional_fees: 0
    }
  },

  investor_products: {
    columns: ['id', 'organization_id', 'name', 'description', 'interest_rate',
              'min_investment', 'max_investment', 'is_active', 'created_at',
              'interest_calculation_type', 'interest_posting_day'],
    defaults: {
      is_active: true,
      interest_calculation_type: 'automatic',
      interest_posting_day: 1
    }
  },

  expense_types: {
    columns: ['id', 'organization_id', 'name', 'description', 'is_active', 'created_at'],
    defaults: { is_active: true }
  },

  first_charge_holders: {
    columns: ['id', 'organization_id', 'name', 'contact_name', 'contact_email',
              'contact_phone', 'address', 'notes', 'created_at'],
    defaults: {}
  },

  borrowers: {
    columns: ['id', 'organization_id', 'unique_number', 'full_name', 'first_name',
              'last_name', 'email', 'phone', 'mobile', 'landline', 'address',
              'city', 'zipcode', 'country', 'status', 'notes', 'created_at', 'updated_at',
              'keywords'],
    defaults: { status: 'Active', keywords: [] }
  },

  properties: {
    columns: ['id', 'organization_id', 'address', 'city', 'postcode', 'property_type',
              'tenure', 'purchase_price', 'current_value', 'valuation_date',
              'gdv', 'notes', 'created_at'],
    defaults: {}
  },

  Investor: {
    columns: ['id', 'organization_id', 'name', 'business_name', 'email', 'phone',
              'address', 'account_number', 'sort_code', 'bank_name', 'notes',
              'status', 'product_id', 'created_at', 'updated_at',
              'investor_product_id', 'investor_number', 'first_name', 'last_name',
              'accrued_interest', 'last_accrual_date', 'total_interest_paid'],
    defaults: {
      status: 'Active',
      accrued_interest: 0,
      total_interest_paid: 0
    }
  },

  loans: {
    columns: ['id', 'organization_id', 'borrower_id', 'product_id', 'loan_number',
              'borrower_name', 'principal_amount', 'interest_rate', 'start_date',
              'end_date', 'duration', 'duration_unit', 'status', 'notes',
              'arrangement_fee', 'exit_fee', 'net_disbursed', 'default_rate',
              'interest_type', 'compounding_frequency', 'first_charge_holder_id',
              'redemption_date', 'restructured', 'restructured_from_loan_id',
              'auto_extend', 'rolled_interest', 'scheduler_type',
              'principal_outstanding', 'interest_outstanding', 'fees_outstanding',
              'balance_updated_at', 'created_at', 'updated_at',
              'product_type', 'period', 'product_name', 'description',
              'principal_remaining', 'interest_remaining', 'has_penalty_rate',
              'penalty_rate', 'penalty_rate_from', 'total_interest', 'total_repayable',
              'roll_up_length', 'roll_up_amount', 'roll_up_amount_override',
              'additional_deducted_fees', 'additional_deducted_fees_note', 'original_term'],
    defaults: {
      status: 'Live',
      restructured: false,
      auto_extend: false,
      scheduler_type: 'standard',
      rolled_interest: 0,
      principal_outstanding: null,
      interest_outstanding: null,
      fees_outstanding: null,
      roll_up_amount_override: false,
      additional_deducted_fees: 0
    }
  },

  InvestorTransaction: {
    columns: ['id', 'organization_id', 'investor_id', 'type', 'amount', 'date',
              'reference', 'notes', 'created_at', 'transaction_id', 'description',
              'bank_account', 'is_auto_generated', 'accrual_period_start', 'accrual_period_end'],
    defaults: { is_auto_generated: false }
  },

  investor_interest: {
    columns: ['id', 'organization_id', 'investor_id', 'type', 'amount', 'date',
              'description', 'created_at'],
    defaults: {}
  },

  transactions: {
    columns: ['id', 'organization_id', 'loan_id', 'borrower_id', 'borrower_name',
              'type', 'date', 'amount', 'principal_applied', 'interest_applied',
              'fees_applied', 'reference', 'notes', 'is_deleted', 'created_at',
              'gross_amount', 'deducted_fee', 'deducted_interest', 'linked_disbursement_id'],
    defaults: { is_deleted: false, deducted_fee: 0, deducted_interest: 0 }
  },

  repayment_schedules: {
    columns: ['id', 'organization_id', 'loan_id', 'due_date', 'principal_due',
              'interest_due', 'fees_due', 'is_paid', 'paid_date', 'created_at',
              'installment_number', 'principal_amount', 'interest_amount', 'total_due',
              'balance', 'calculation_days', 'calculation_principal_start',
              'is_extension_period', 'is_roll_up_period', 'is_serviced_period',
              'rolled_up_interest'],
    defaults: {
      is_paid: false,
      is_extension_period: false,
      is_roll_up_period: false,
      is_serviced_period: false
    }
  },

  loan_properties: {
    columns: ['id', 'organization_id', 'loan_id', 'property_id', 'charge_type',
              'charge_position', 'notes', 'created_at',
              'first_charge_holder_id', 'first_charge_balance', 'status'],
    defaults: { status: 'Active' }
  },

  expenses: {
    columns: ['id', 'organization_id', 'type_id', 'type_name', 'loan_id',
              'borrower_name', 'amount', 'date', 'description', 'notes', 'created_at'],
    defaults: {}
  },

  value_history: {
    columns: ['id', 'organization_id', 'property_id', 'valuation_date', 'value',
              'source', 'notes', 'created_at'],
    defaults: {}
  },

  bank_statements: {
    columns: ['id', 'organization_id', 'statement_date', 'description', 'amount',
              'balance', 'bank_source', 'transaction_type', 'is_reconciled',
              'created_at', 'suggested_match_type', 'suggested_loan_id',
              'suggested_investor_id', 'suggested_expense_type_id',
              'suggestion_confidence', 'suggestion_reason', 'pattern_id', 'was_created'],
    defaults: { is_reconciled: false, was_created: false }
  },

  other_income: {
    columns: ['id', 'organization_id', 'date', 'amount', 'description', 'source',
              'notes', 'created_at'],
    defaults: {}
  },

  borrower_loan_preferences: {
    columns: ['id', 'organization_id', 'borrower_id', 'loan_id', 'created_at'],
    defaults: {}
  },

  receipt_drafts: {
    columns: ['id', 'organization_id', 'date', 'amount', 'description', 'borrower_id',
              'loan_id', 'status', 'notes', 'created_at'],
    defaults: { status: 'draft' }
  },

  reconciliation_patterns: {
    columns: ['id', 'organization_id', 'description_pattern', 'match_type',
              'loan_id', 'investor_id', 'expense_type_id', 'confidence_score',
              'match_count', 'transaction_type', 'amount_min', 'amount_max',
              'default_capital_ratio', 'default_interest_ratio', 'default_fees_ratio',
              'created_at', 'updated_at'],
    defaults: { match_count: 1, confidence_score: 0.8 }
  },

  reconciliation_entries: {
    columns: ['id', 'organization_id', 'bank_statement_id', 'loan_transaction_id',
              'investor_transaction_id', 'interest_id', 'expense_id', 'other_income_id',
              'reconciliation_type', 'notes', 'created_at', 'was_created'],
    defaults: { was_created: false }
  },

  accepted_orphans: {
    columns: ['id', 'organization_id', 'entity_type', 'entity_id', 'reason',
              'accepted_by', 'created_at'],
    defaults: {}
  },

  audit_logs: {
    columns: ['id', 'organization_id', 'user_id', 'user_email', 'action',
              'entity_type', 'entity_id', 'details', 'created_at'],
    defaults: {}
  },

  invitations: {
    columns: ['id', 'organization_id', 'email', 'role', 'invited_by', 'status',
              'expires_at', 'created_at'],
    defaults: { status: 'pending' }
  },

  nightly_job_runs: {
    columns: ['id', 'organization_id', 'job_type', 'status', 'started_at',
              'completed_at', 'records_processed', 'error_message'],
    defaults: {}
  },

  organization_summary: {
    columns: ['organization_id', 'total_principal_outstanding', 'total_interest_outstanding',
              'total_fees_outstanding', 'total_disbursed', 'total_repaid',
              'live_loan_count', 'settled_loan_count', 'arrears_amount',
              'investor_capital_balance', 'investor_interest_owed', 'updated_at'],
    defaults: {}
  },

  app_settings: {
    columns: ['key', 'value', 'description', 'updated_at', 'updated_by'],
    defaults: {}
  },

  organizations: {
    columns: ['id', 'name', 'created_at', 'updated_at', 'address_line1', 'address_line2',
              'city', 'postcode', 'country', 'phone', 'email', 'website', 'settings'],
    defaults: { settings: {} }
  },

  user_profiles: {
    columns: ['id', 'email', 'full_name', 'role', 'organization_id', 'created_at',
              'updated_at', 'is_super_admin', 'default_organization_id',
              'google_drive_connected', 'google_drive_email',
              'google_drive_base_folder_id', 'google_drive_base_folder_path'],
    defaults: {
      is_super_admin: false,
      google_drive_connected: false
    }
  },

  loan_comments: {
    columns: ['id', 'organization_id', 'loan_id', 'user_id', 'user_name',
              'comment', 'created_at'],
    defaults: {}
  },

  letter_templates: {
    columns: ['id', 'organization_id', 'name', 'description', 'category',
              'subject_template', 'body_template', 'email_body_template', 'available_placeholders',
              'default_attachments', 'is_active', 'created_at', 'updated_at', 'created_by'],
    defaults: {
      category: 'General',
      available_placeholders: [],
      default_attachments: [],
      is_active: true
    }
  },

  generated_letters: {
    columns: ['id', 'organization_id', 'template_id', 'loan_id', 'borrower_id',
              'subject', 'body_rendered', 'placeholder_values', 'attached_reports',
              'settlement_date', 'pdf_storage_path', 'created_by', 'created_at',
              'delivery_method', 'recipient_email', 'google_drive_file_id',
              'google_drive_file_url', 'template_name'],
    defaults: {
      placeholder_values: {},
      attached_reports: []
    }
  },

  google_drive_tokens: {
    columns: ['id', 'user_id', 'access_token_encrypted', 'refresh_token_encrypted',
              'token_expiry', 'created_at', 'updated_at'],
    defaults: {}
  }
};

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
    missingRequired: {}, // table -> [columns] without defaults that are missing
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

    // Check first record for column differences
    const sampleRecord = records[0];
    const backupColumns = Object.keys(sampleRecord);
    const schemaColumns = new Set(schema.columns);

    // Find columns in backup but not in schema (will be dropped)
    const dropped = backupColumns.filter(c => !schemaColumns.has(c) && c !== 'id');
    if (dropped.length > 0) {
      issues.droppedColumns[tableName] = dropped;
      issues.hasIssues = true;
    }

    // Find columns in schema but not in backup
    const backupColSet = new Set(backupColumns);
    const missing = schema.columns.filter(c => !backupColSet.has(c) && c !== 'id');

    for (const col of missing) {
      if (col in (schema.defaults || {})) {
        issues.addedColumns[tableName] = issues.addedColumns[tableName] || [];
        issues.addedColumns[tableName].push({ column: col, default: schema.defaults[col] });
      } else if (!['created_at', 'updated_at', 'organization_id'].includes(col)) {
        // Columns without defaults that aren't auto-generated
        issues.missingRequired[tableName] = issues.missingRequired[tableName] || [];
        issues.missingRequired[tableName].push(col);
        issues.hasIssues = true;
      }
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

  const schemaColumns = new Set(tableSchema.columns);
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
