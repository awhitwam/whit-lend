/**
 * Bank statement import de-duplication.
 *
 * Shared by the import paths in src/pages/BankReconciliation.jsx and
 * src/hooks/useReconciliation.js, which previously carried byte-identical copies of this logic.
 *
 * The checks run in order of how much they can be trusted:
 *   1. external_reference match - definitive when the reference is a real unique identifier.
 *   2. Reference short-circuit - see below.
 *   3. date + amount + similar description - a fallback for rows stored under an older
 *      reference format, where the reference cannot be relied on to distinguish anything.
 */

const normaliseAmount = (value) => Math.round((parseFloat(value) || 0) * 100);
const normaliseDescription = (value) => (value || '').toLowerCase().trim();

/**
 * Does this reference carry the running account balance?
 *
 * The Allica parser appends the post-transaction balance to the reference precisely so that two
 * genuine transactions sharing a date, amount and description are still distinguishable - the
 * balance necessarily moves between them. Where a reference has one, it is a true unique key.
 *
 * Barclays statements carry no balance, so their references cannot make this guarantee and the
 * description fallback still applies to them.
 */
export function hasBalanceSuffix(reference) {
  return /-bal-?\d+$/.test(reference || '');
}

/**
 * Filter parsed CSV entries down to those not already stored.
 *
 * @param {Array} entries - parsed rows from the statement file
 * @param {Array} existingStatements - bank_statements already in the database
 * @returns {Array} the subset of `entries` that should be inserted
 */
export function findNewEntries(entries = [], existingStatements = []) {
  const existingRefs = new Set(
    existingStatements.map((s) => s.external_reference).filter(Boolean)
  );

  // date+amount -> the stored rows sharing it, with both description and reference
  const existingByDateAmount = new Map();
  for (const s of existingStatements) {
    const key = `${s.statement_date || ''}|${normaliseAmount(s.amount)}`;
    if (!existingByDateAmount.has(key)) existingByDateAmount.set(key, []);
    existingByDateAmount.get(key).push({
      description: normaliseDescription(s.description),
      reference: s.external_reference || ''
    });
  }

  return entries.filter((entry) => {
    // 1. Exact reference match - the primary check.
    if (entry.external_reference && existingRefs.has(entry.external_reference)) {
      return false;
    }

    const key = `${entry.statement_date}|${normaliseAmount(entry.amount)}`;
    const candidates = existingByDateAmount.get(key);
    if (!candidates || candidates.length === 0) {
      return true;
    }

    // 2. If this entry and every stored row for the same date and amount carry a
    //    balance-suffixed reference, the references settle it. Step 1 already proved this
    //    reference matches none of them, so it is a distinct transaction, and an identical
    //    description is exactly what you would expect - same payer, same day, same amount.
    //
    //    Without this short-circuit a genuine third GBP 250,000 payment to the same payee on
    //    one day can never be imported: its reference is unique, but step 3 rejects it on the
    //    description every time, so retrying the import can never recover it.
    const referencesAreDefinitive =
      hasBalanceSuffix(entry.external_reference) &&
      candidates.every((candidate) => hasBalanceSuffix(candidate.reference));
    if (referencesAreDefinitive) {
      return true;
    }

    // 3. Fallback: the references are not trustworthy here, so fall back to treating a similar
    //    description on the same date and amount as a duplicate. Deliberately unchanged.
    const newDescription = normaliseDescription(entry.description);
    const descriptionMatches = candidates.some(({ description }) => {
      if (description === newDescription) return true;
      if (description.includes(newDescription) || newDescription.includes(description)) return true;
      if (description.slice(0, 20) === newDescription.slice(0, 20) && description.length > 10) return true;
      return false;
    });

    return !descriptionMatches;
  });
}
