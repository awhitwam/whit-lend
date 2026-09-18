import { config } from './config.js';

/**
 * Table and column allowlist.
 *
 * This is the layer that actually protects PII: select() is never a wildcard, it is
 * always assembled from these lists. A sensitive column added to a table later is
 * therefore not silently exposed.
 *
 * Deliberate omissions:
 *   borrowers.id_number, borrowers.gender - national ID and gender, never returned.
 *   loans.principal_paid / interest_paid / charges_paid - stale; nothing maintains them
 *     (migration 054's trigger only maintains principal_remaining). Loan 1000036 shows
 *     principal_paid = 0 while principal_remaining says GBP 1.28m has been repaid.
 *   audit_logs, bank_statements, reconciliation_*, google_drive_tokens, trusted_devices,
 *     invitations, receipt_drafts, letter_templates, generated_letters, loan_comments -
 *     not present at all: credentials, raw CSV rows, or free text with a high leak
 *     surface and low analytical value.
 */
export const TABLES = {
  loans: [
    'id', 'loan_number', 'borrower_id', 'borrower_name', 'product_id', 'product_name',
    'principal_amount', 'arrangement_fee', 'exit_fee', 'net_disbursed', 'overpayment_credit',
    'interest_rate', 'interest_type', 'interest_only_period', 'duration', 'period',
    'start_date', 'status', 'total_interest', 'total_repayable', 'is_deleted', 'auto_extend',
    'created_at', 'organization_id', 'description', 'product_type', 'monthly_charge',
    'total_charges', 'restructured_from_loan_id', 'restructured_from_loan_number',
    'override_interest_rate', 'overridden_rate', 'has_penalty_rate', 'penalty_rate',
    'penalty_rate_from', 'principal_remaining', 'interest_remaining', 'balance_updated_at',
    'roll_up_length', 'roll_up_amount', 'additional_deducted_fees'
  ],
  borrowers: [
    'id', 'unique_number', 'first_name', 'last_name', 'full_name', 'business', 'status',
    'is_archived', 'created_at', 'organization_id',
    // Contact details - only selected when a tool call opts in. See CONTACT_COLUMNS.
    'phone', 'mobile', 'landline', 'email', 'address', 'city', 'zipcode', 'country',
    // Free text - only selected when a tool call opts in. See NOTES_COLUMNS.
    'notes', 'keywords'
  ],
  transactions: [
    'id', 'loan_id', 'borrower_id', 'amount', 'date', 'type', 'principal_applied',
    'interest_applied', 'fees_applied', 'reference', 'notes', 'is_deleted',
    'organization_id', 'gross_amount', 'deducted_fee', 'deducted_interest',
    'linked_disbursement_id', 'created_at', 'is_initial_disbursement'
  ],
  repayment_schedules: [
    'id', 'loan_id', 'installment_number', 'due_date', 'principal_amount', 'interest_amount',
    'total_due', 'principal_paid', 'interest_paid', 'balance', 'status', 'charge_amount',
    'is_extension_period', 'organization_id'
  ],
  loan_products: [
    'id', 'name', 'interest_rate', 'interest_type', 'period', 'interest_calculation_method',
    'interest_alignment', 'interest_only_period', 'extend_for_full_period',
    'interest_paid_in_advance', 'min_amount', 'max_amount', 'max_duration', 'product_type',
    'organization_id'
  ],
  properties: [
    'id', 'address', 'city', 'postcode', 'country', 'property_type', 'current_value',
    'organization_id'
  ],
  loan_properties: [
    'id', 'loan_id', 'property_id', 'charge_type', 'first_charge_holder_id',
    'first_charge_balance', 'status', 'organization_id'
  ],
  first_charge_holders: ['id', 'name', 'organization_id'],
  expenses: ['id', 'date', 'type_id', 'type_name', 'amount', 'description', 'loan_id', 'organization_id'],
  expense_types: ['id', 'name', 'description', 'organization_id'],
  organizations: ['id', 'name'],
  // Startup checks only, always constrained to the server's own user id.
  organization_members: ['organization_id', 'user_id', 'role', 'is_active'],
  user_profiles: ['id', 'is_super_admin']
};

/** Borrower contact details - withheld unless a tool call asks for them. */
export const CONTACT_COLUMNS = ['phone', 'mobile', 'landline', 'email', 'address', 'city', 'zipcode', 'country'];
/** Borrower free text - withheld unless a tool call asks for it. */
export const NOTES_COLUMNS = ['notes', 'keywords'];

const BASE_BORROWER_COLUMNS = TABLES.borrowers.filter(
  (c) => !CONTACT_COLUMNS.includes(c) && !NOTES_COLUMNS.includes(c)
);

/** Column list for a borrower select, honouring the PII posture and per-call opt-ins. */
export function borrowerColumns({ includeContact = false, includeNotes = false } = {}) {
  const cols = [...BASE_BORROWER_COLUMNS];
  if (includeContact || config.pii === 'full') cols.push(...CONTACT_COLUMNS);
  if (includeNotes) cols.push(...NOTES_COLUMNS);
  return cols;
}

/** Comma-joined column list for a table, excluding the PII-gated borrower columns. */
export function columnsOf(table) {
  if (table === 'borrowers') return BASE_BORROWER_COLUMNS.join(',');
  const cols = TABLES[table];
  if (!cols) throw new Error(`Table "${table}" is not in the allowlist`);
  return cols.join(',');
}

// Query-builder methods a tool is permitted to call. Anything absent throws.
// then/catch/finally must pass through: PostgREST builders are thenable.
const ALLOWED_BUILDER_METHODS = new Set([
  'select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'ilike', 'like', 'or', 'not',
  'filter', 'match', 'order', 'limit', 'range', 'single', 'maybeSingle', 'abortSignal',
  'throwOnError', 'then', 'catch', 'finally'
]);

/**
 * Wraps a PostgREST builder so only read operations are reachable. Even if a future
 * code path reaches for insert or delete, it throws here rather than at the network.
 */
function readOnlyBuilder(builder, table) {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
      if (!ALLOWED_BUILDER_METHODS.has(prop)) {
        throw new Error(
          `Blocked: "${String(prop)}" is not a permitted read operation on "${table}". ` +
          'This MCP server is read-only.'
        );
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = value.apply(target, args);
        // Builder methods chain; re-wrap so the guard survives the whole chain.
        return result && typeof result === 'object' && typeof result.then === 'function'
          ? readOnlyBuilder(result, table)
          : result;
      };
    }
  });
}

/**
 * The HTTP method fence - the structural guarantee. Anything that is not a read, and
 * is not the auth token/logout endpoint, never leaves the process.
 */
export function createGuardedFetch(baseFetch = globalThis.fetch) {
  return async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const method = String(
      init.method || (typeof input === 'object' && input && input.method) || 'GET'
    ).toUpperCase();
    const isAuthCall = url.includes('/auth/v1/token') || url.includes('/auth/v1/logout');
    if (!isAuthCall && method !== 'GET' && method !== 'HEAD') {
      throw new Error(
        `Blocked: attempted ${method} to ${url}. This MCP server is read-only and only ` +
        'issues GET/HEAD requests.'
      );
    }
    return baseFetch(input, init);
  };
}

/** The only handle tools get on the database. */
export function createReadOnlyDb(supabase, orgId) {
  return {
    orgId,

    from(table) {
      if (!Object.hasOwn(TABLES, table)) {
        throw new Error(
          `Blocked: table "${table}" is not in the allowlist. Readable tables: ` +
          `${Object.keys(TABLES).join(', ')}.`
        );
      }
      return readOnlyBuilder(supabase.from(table), table);
    },

    /**
     * A builder already scoped to the resolved organization. RLS scopes this too, but
     * the explicit filter is defence in depth against the account gaining a second
     * membership, and it makes the intent testable.
     */
    scoped(table) {
      return this.from(table).eq('organization_id', orgId);
    },

    /** Loans and transactions are soft-deleted; tolerate NULL as migration 054 does. */
    notDeleted(builder) {
      return builder.or('is_deleted.is.null,is_deleted.eq.false');
    },

    clampLimit(requested, fallback) {
      const n = Number.isFinite(Number(requested)) ? Number(requested) : fallback;
      return Math.max(1, Math.min(n, config.maxRows));
    },

    signal() {
      return AbortSignal.timeout(config.queryTimeoutMs);
    }
  };
}

/**
 * PostgREST splits an or() filter on top-level commas, so a value containing a comma
 * silently truncates the filter. Quote the value and escape the quotes.
 */
export function orIlike(columns, term) {
  const safe = String(term).replace(/["\\]/g, '\\$&').replace(/[%_]/g, '\\$&');
  return columns.map((c) => `${c}.ilike."%${safe}%"`).join(',');
}
