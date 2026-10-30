/**
 * Which scheduler governs a loan - the single source of truth.
 *
 * WHY THIS MODULE EXISTS: this mapping was written out four times, in four places, and they
 * disagreed:
 *
 *   1. src/components/loan/LoanScheduleManager.jsx - product_type map only, no interest_type
 *      fallback, so an unmigrated standard product fell through to the legacy generator.
 *   2. src/lib/latePayments.js - product_type AND interest_type, defaulting to reducing_balance.
 *   3. src/components/product/ProductForm.jsx - same as (2) but as a switch, and it is what
 *      actually writes the column.
 *   4. supabase/migrations/056 and 058 - in SQL. Migration 058 had NO branch for
 *      'Roll-Up & Serviced' and no WHERE clause, so it unconditionally rewrote every product
 *      and silently demoted roll-up-serviced products to interest_only or reducing_balance.
 *      Migration 089 repairs that.
 *
 * Keep the maps here and nowhere else. If a new scheduler is registered, this is the one
 * place to add it (plus a migration, if existing products need to move).
 *
 * DEPENDENCY RULE: this module must have NO imports. src/lib/latePayments.js depends on it and
 * is itself pinned by scripts/check-late-payments.mjs, which runs under plain `node` - so a
 * path alias or a transitive dependency on the data client here would break that fixture.
 */

/**
 * product_type is the more specific signal and wins over interest_type.
 */
export const PRODUCT_TYPE_TO_SCHEDULER = {
  'Fixed Charge': 'fixed_charge',
  'Irregular Income': 'irregular_income',
  'Rent': 'rent',
  'Roll-Up & Serviced': 'roll_up_serviced'
};

/**
 * 'Roll-Up & Serviced' appears here too because LoanApplicationForm.jsx:392 writes it as a
 * literal interest_type on the loan.
 */
export const INTEREST_TYPE_TO_SCHEDULER = {
  'Rolled-Up': 'rolled_up',
  'Interest-Only': 'interest_only',
  'Flat': 'flat_rate',
  'Reducing': 'reducing_balance',
  'Roll-Up & Serviced': 'roll_up_serviced'
};

/** The scheduler used when nothing else matches. */
export const DEFAULT_SCHEDULER_TYPE = 'reducing_balance';

/**
 * Resolve a loan's scheduler id, falling back to the default when nothing matches.
 *
 * loans.scheduler_type does not exist - migration 056 adds the column to loan_products only -
 * so the product is the authority, and the loan's own product_type/interest_type are the
 * fallback for unmigrated products.
 *
 * @param {Object} loan
 * @param {Object|null} [product]
 * @returns {string} a registered scheduler id
 */
export function resolveSchedulerType(loan, product) {
  return resolveSchedulerTypeOrNull(loan, product) || DEFAULT_SCHEDULER_TYPE;
}

/**
 * As resolveSchedulerType, but returns null rather than guessing.
 *
 * Use this where falling back to reducing_balance would silently generate the wrong kind of
 * schedule, and the caller would rather handle the miss itself.
 *
 * @param {Object} loan
 * @param {Object|null} [product]
 * @returns {string|null}
 */
export function resolveSchedulerTypeOrNull(loan, product) {
  if (product?.scheduler_type) return product.scheduler_type;

  const productType = product?.product_type || loan?.product_type;
  if (productType && PRODUCT_TYPE_TO_SCHEDULER[productType]) {
    return PRODUCT_TYPE_TO_SCHEDULER[productType];
  }

  const interestType = product?.interest_type || loan?.interest_type;
  if (interestType && INTEREST_TYPE_TO_SCHEDULER[interestType]) {
    return INTEREST_TYPE_TO_SCHEDULER[interestType];
  }

  return null;
}

/**
 * Derive the scheduler id to store on a product from its form data.
 *
 * Takes a single record rather than (loan, product) because it runs against unsaved form
 * state, where there is no loan.
 *
 * @param {Object} data - Product form data (product_type, interest_type)
 * @returns {string} a registered scheduler id
 */
export function deriveSchedulerType(data) {
  return resolveSchedulerType(null, data);
}
