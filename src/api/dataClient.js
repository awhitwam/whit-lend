import { supabase } from '@/lib/supabaseClient';

// Get current organization ID - MUST be set by OrganizationContext
// SECURITY: Never fallback to localStorage to prevent org ID manipulation
let getCurrentOrganizationId = () => null;

export const setOrganizationIdGetter = (getter) => {
  getCurrentOrganizationId = getter;
};

// Map entity names to Supabase table names (matching actual database schema)
const tableMap = {
  Borrower: 'borrowers',
  Loan: 'loans',
  LoanProduct: 'loan_products',
  Transaction: 'transactions',
  RepaymentSchedule: 'repayment_schedules',
  Expense: 'expenses',
  ExpenseType: 'expense_types',
  Investor: 'Investor',  // PascalCase in database
  InvestorTransaction: 'InvestorTransaction',  // PascalCase in database
  InvestorProduct: 'investor_products',
  Organization: 'organizations',
  OrganizationMember: 'organization_members',
  Invitation: 'invitations',
  UserProfile: 'user_profiles',
  AuditLog: 'audit_logs',
  // Security/Property entities
  Property: 'properties',
  LoanProperty: 'loan_properties',
  ValueHistory: 'value_history',
  FirstChargeHolder: 'first_charge_holders',
  // Scheduled job tracking
  NightlyJobRun: 'nightly_job_runs',
  // Bank reconciliation
  BankStatement: 'bank_statements',
  ReconciliationEntry: 'reconciliation_entries',
  ReconciliationPattern: 'reconciliation_patterns',
  // Other income
  OtherIncome: 'other_income',
  // Investor interest ledger
  InvestorInterest: 'investor_interest',
  // Receipts module
  ReceiptDraft: 'receipt_drafts',
  BorrowerLoanPreference: 'borrower_loan_preferences',
  // Accepted orphans (unreconciled entries marked as intentional)
  AcceptedOrphan: 'accepted_orphans',
  // Organization summary (cached aggregates)
  OrganizationSummary: 'organization_summary',
  // Loan comments
  LoanComment: 'loan_comments',
  // Letter templates
  LetterTemplate: 'letter_templates',
  GeneratedLetter: 'generated_letters'
};

// Tables that should have organization_id filter applied
// SECURITY: All tables with organization_id column must be listed here
const orgScopedTables = [
  'borrowers',
  'loans',
  'loan_products',
  'transactions',
  'repayment_schedules',
  'expenses',
  'expense_types',
  'Investor',
  'InvestorTransaction',
  'investor_products',
  'audit_logs',
  'invitations',  // SECURITY: Invitations are org-scoped
  // Security/Property tables
  'properties',
  'loan_properties',
  'value_history',
  'first_charge_holders',
  // Bank reconciliation
  'bank_statements',
  'reconciliation_entries',
  'reconciliation_patterns',
  // Other income
  'other_income',
  // Investor interest ledger
  'investor_interest',
  // Receipts module
  'receipt_drafts',
  'borrower_loan_preferences',
  // Accepted orphans
  'accepted_orphans',
  // Nightly job runs (nullable org_id, but should be filtered when present)
  'nightly_job_runs',
  // Loan comments
  'loan_comments',
  // Letter templates
  'letter_templates',
  'generated_letters'
];

// Map column names that differ between code and database
// Format: { tableName: { codeColumnName: dbColumnName } }
const columnMap = {
  borrowers: {
    created_date: 'created_at'
  },
  loans: {
    created_date: 'created_at'
  },
  loan_products: {
    created_date: 'created_at'
  },
  investor_products: {
    created_date: 'created_at'
  }
};

// Parse order string like '-created_date' into { column: 'created_date', ascending: false }
function parseOrder(orderStr, tableName) {
  if (!orderStr) return null;
  const ascending = !orderStr.startsWith('-');
  let column = orderStr.replace(/^-/, '');

  // Map column name if needed
  if (columnMap[tableName] && columnMap[tableName][column]) {
    column = columnMap[tableName][column];
  }

  return { column, ascending };
}

// Helper to apply organization filter to queries
// SECURITY: Throws error if org ID not available for scoped tables
function applyOrgFilter(query, tableName) {
  if (orgScopedTables.includes(tableName)) {
    const orgId = getCurrentOrganizationId();
    if (!orgId) {
      // CRITICAL: Fail safely - never return unfiltered query for org-scoped tables
      throw new Error(`Organization context not available. Cannot query ${tableName} without organization scope.`);
    }
    return query.eq('organization_id', orgId);
  }
  return query;
}

// Create an entity handler for a specific table
function createEntityHandler(tableName) {
  return {
    // List all records with optional ordering and limit
    // NOTE: Supabase has a default 1000 row limit. Use listAll() for large datasets.
    async list(orderBy, limit) {
      let query = supabase.from(tableName).select('*');

      // Apply organization filter
      query = applyOrgFilter(query, tableName);

      const order = parseOrder(orderBy, tableName);
      if (order) {
        query = query.order(order.column, { ascending: order.ascending });
      }

      if (limit) {
        query = query.limit(limit);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },

    // List ALL records by paginating through Supabase's 1000 row limit
    // Use this when you need more than 1000 records
    async listAll(orderBy) {
      const PAGE_SIZE = 1000;
      let allData = [];
      let offset = 0;
      let hasMore = true;

      const order = parseOrder(orderBy, tableName);

      while (hasMore) {
        let query = supabase.from(tableName).select('*');
        query = applyOrgFilter(query, tableName);

        if (order) {
          query = query.order(order.column, { ascending: order.ascending });
        }

        query = query.range(offset, offset + PAGE_SIZE - 1);

        const { data, error } = await query;
        if (error) throw error;

        if (data && data.length > 0) {
          allData = allData.concat(data);
          offset += data.length;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }

      return allData;
    },

    // Filter records by conditions with optional ordering
    // NOTE: Supabase has a default 1000 row limit. Use filterAll() for large filtered datasets.
    async filter(conditions, orderBy) {
      let query = supabase.from(tableName).select('*');

      // Apply organization filter
      query = applyOrgFilter(query, tableName);

      // Apply filter conditions
      for (const [key, value] of Object.entries(conditions)) {
        query = query.eq(key, value);
      }

      const order = parseOrder(orderBy, tableName);
      if (order) {
        query = query.order(order.column, { ascending: order.ascending });
      }

      const { data, error} = await query;
      if (error) throw error;
      return data || [];
    },

    // Filter ALL records by paginating through Supabase's 1000 row limit
    async filterAll(conditions, orderBy) {
      const PAGE_SIZE = 1000;
      let allData = [];
      let offset = 0;
      let hasMore = true;

      const order = parseOrder(orderBy, tableName);

      while (hasMore) {
        let query = supabase.from(tableName).select('*');
        query = applyOrgFilter(query, tableName);

        // Apply filter conditions
        for (const [key, value] of Object.entries(conditions)) {
          query = query.eq(key, value);
        }

        if (order) {
          query = query.order(order.column, { ascending: order.ascending });
        }

        query = query.range(offset, offset + PAGE_SIZE - 1);

        const { data, error } = await query;
        if (error) throw error;

        if (data && data.length > 0) {
          allData = allData.concat(data);
          offset += data.length;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }

      return allData;
    },

    // Create a new record
    async create(data) {
      // Auto-inject organization_id for scoped tables
      if (orgScopedTables.includes(tableName)) {
        const orgId = getCurrentOrganizationId();
        if (!orgId) {
          throw new Error(`Organization context not available. Cannot create ${tableName} record without organization scope.`);
        }
        data = { ...data, organization_id: orgId };
      }

      const { data: created, error } = await supabase
        .from(tableName)
        .insert(data)
        .select()
        .single();

      if (error) throw error;
      return created;
    },

    // Update a record by ID
    async update(id, data) {
      let query = supabase
        .from(tableName)
        .update(data)
        .eq('id', id);

      // Apply organization filter for security
      query = applyOrgFilter(query, tableName);

      const { data: updated, error } = await query.select().single();

      if (error) throw error;
      return updated;
    },

    // Delete a record by ID
    async delete(id) {
      let query = supabase
        .from(tableName)
        .delete()
        .eq('id', id);

      // Apply organization filter for security
      query = applyOrgFilter(query, tableName);

      const { error } = await query;

      if (error) throw error;
      return true;
    },

    // Batch create multiple records at once (much faster than individual creates)
    // Batches in chunks of 500 to avoid Supabase row limits
    async createMany(records) {
      if (!records || records.length === 0) return [];

      // Auto-inject organization_id for scoped tables
      if (orgScopedTables.includes(tableName)) {
        const orgId = getCurrentOrganizationId();
        if (!orgId) {
          throw new Error(`Organization context not available. Cannot create ${tableName} records without organization scope.`);
        }
        records = records.map(r => ({ ...r, organization_id: orgId }));
      }

      // Batch inserts to avoid Supabase row limits (max ~1000 per request)
      const BATCH_SIZE = 500;
      let allCreated = [];

      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const { data: created, error } = await supabase
          .from(tableName)
          .insert(batch)
          .select();

        if (error) throw error;
        if (created) allCreated = allCreated.concat(created);
      }

      return allCreated;
    },

    // Batch delete by condition (much faster than individual deletes)
    async deleteWhere(conditions) {
      let query = supabase.from(tableName).delete();

      // Apply organization filter
      query = applyOrgFilter(query, tableName);

      for (const [key, value] of Object.entries(conditions)) {
        query = query.eq(key, value);
      }

      const { error } = await query;
      if (error) throw error;
      return true;
    }
  };
}

// Special handler for OrganizationSummary (uses organization_id as primary key)
function createOrganizationSummaryHandler() {
  const tableName = 'organization_summary';

  return {
    // Get summary for the current organization
    async get() {
      const orgId = getCurrentOrganizationId();
      if (!orgId) {
        throw new Error('Organization context not available.');
      }

      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .eq('organization_id', orgId)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
      return data || null;
    },

    // List returns array for backup compatibility (single org summary)
    async list() {
      const orgId = getCurrentOrganizationId();
      if (!orgId) {
        throw new Error('Organization context not available.');
      }

      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .eq('organization_id', orgId);

      if (error) throw error;
      return data || [];
    },

    // listAll for backup compatibility (same as list since there's only one row per org)
    async listAll() {
      return this.list();
    },

    // Upsert (insert or update) summary for the current organization
    async upsert(summaryData) {
      const orgId = getCurrentOrganizationId();
      if (!orgId) {
        throw new Error('Organization context not available.');
      }

      const { data, error } = await supabase
        .from(tableName)
        .upsert({
          organization_id: orgId,
          ...summaryData,
          updated_at: new Date().toISOString()
        }, { onConflict: 'organization_id' })
        .select()
        .single();

      if (error) throw error;
      return data;
    },

    // Create for restore compatibility (uses upsert internally)
    async create(summaryData) {
      return this.upsert(summaryData);
    },

    // CreateMany for restore compatibility
    async createMany(records) {
      const results = [];
      for (const record of records) {
        const result = await this.upsert(record);
        results.push(result);
      }
      return results;
    }
  };
}

// Create the data client
const entities = {};
for (const [entityName, tableName] of Object.entries(tableMap)) {
  // Skip OrganizationSummary as it has a special handler
  if (entityName === 'OrganizationSummary') continue;
  entities[entityName] = createEntityHandler(tableName);
}

// Add special handlers
entities.OrganizationSummary = createOrganizationSummaryHandler();

/**
 * Change the borrower of a loan - used for data correction
 * Updates the loan record and related transactions/letters
 * @param {string} loanId - ID of the loan to update
 * @param {string} newBorrowerId - ID of the new borrower
 * @param {Object} options - Additional options
 * @param {string} options.reason - Reason for the change (for audit)
 * @returns {Promise<Object>} Result with old and new borrower info
 */
async function changeLoanBorrower(loanId, newBorrowerId, { reason }) {
  const orgId = getCurrentOrganizationId();
  if (!orgId) {
    throw new Error('Organization context not available.');
  }

  // Fetch the loan
  const { data: loan, error: loanError } = await supabase
    .from('loans')
    .select('*')
    .eq('id', loanId)
    .eq('organization_id', orgId)
    .single();

  if (loanError || !loan) {
    throw new Error('Loan not found or access denied');
  }

  const oldBorrowerId = loan.borrower_id;
  const oldBorrowerName = loan.borrower_name;

  // Fetch the new borrower
  const { data: newBorrower, error: borrowerError } = await supabase
    .from('borrowers')
    .select('*')
    .eq('id', newBorrowerId)
    .eq('organization_id', orgId)
    .single();

  if (borrowerError || !newBorrower) {
    throw new Error('New borrower not found or access denied');
  }

  // Update the loan record
  const newBorrowerName = newBorrower.full_name || `${newBorrower.first_name} ${newBorrower.last_name}`;
  const { error: updateLoanError } = await supabase
    .from('loans')
    .update({
      borrower_id: newBorrowerId,
      borrower_name: newBorrowerName
    })
    .eq('id', loanId)
    .eq('organization_id', orgId);

  if (updateLoanError) {
    throw new Error(`Failed to update loan: ${updateLoanError.message}`);
  }

  // Update transactions for this loan
  const { error: updateTxError } = await supabase
    .from('transactions')
    .update({ borrower_id: newBorrowerId })
    .eq('loan_id', loanId)
    .eq('organization_id', orgId);

  if (updateTxError) {
    console.error('Failed to update transactions:', updateTxError);
    // Don't throw - loan is already updated, this is supplementary
  }

  // Update generated letters for this loan
  const { error: updateLettersError } = await supabase
    .from('generated_letters')
    .update({ borrower_id: newBorrowerId })
    .eq('loan_id', loanId)
    .eq('organization_id', orgId);

  if (updateLettersError) {
    console.error('Failed to update generated letters:', updateLettersError);
    // Don't throw - loan is already updated, this is supplementary
  }

  return {
    loanId,
    oldBorrowerId,
    oldBorrowerName,
    newBorrowerId,
    newBorrowerName,
    reason
  };
}

export const api = {
  entities,
  changeLoanBorrower
};
