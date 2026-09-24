/**
 * Bank statement import de-duplication.
 *
 * Shared by the import paths in src/pages/BankReconciliation.jsx and
 * src/hooks/useReconciliation.js, which previously carried byte-identical copies of this logic.
 *
 * The checks run in order of how much they can be trusted:
 *   1. external_reference match - definitive when the reference is a real unique identifier.
 *   2. Same transaction re-dated by the bank - see BALANCE_WINDOW_DAYS below.
 *   3. Reference short-circuit - see below.
 *   4. date + amount + similar description - a fallback for rows stored under an older
 *      reference format, where the reference cannot be relied on to distinguish anything.
 */

const normaliseAmount = (value) => Math.round((parseFloat(value) || 0) * 100);
const normaliseDescription = (value) => (value || '').toLowerCase().trim();

/**
 * How far a bank may move a transaction's date between exports and still be talking about the
 * same transaction. Observed in practice: Allica moved a payment from the 22nd to the 21st.
 *
 * Bounded rather than unlimited so that a genuine repeat payment - same payee, same amount,
 * with the balance happening to return to the same figure - is not silently swallowed months
 * later. Skipping a real transaction loses money; a duplicate is merely visible and fixable.
 */
const BALANCE_WINDOW_DAYS = 7;

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

/** The balance portion of a reference, or null when it carries none. */
export function balanceSuffix(reference) {
  const match = /-bal(-?\d+)$/.exec(reference || '');
  return match ? match[1] : null;
}

/** Identifies a transaction independently of the date the bank has put on it. */
const fingerprint = (row) =>
  `${normaliseAmount(row.amount)}|${balanceSuffix(row.external_reference)}|${normaliseDescription(row.description)}`;

const daysApart = (a, b) => {
  const left = new Date(a);
  const right = new Date(b);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return Infinity;
  return Math.abs(left.getTime() - right.getTime()) / 86400000;
};

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
  // amount+balance+description -> the dates it is stored under, for re-dating detection
  const existingByFingerprint = new Map();

  for (const s of existingStatements) {
    const key = `${s.statement_date || ''}|${normaliseAmount(s.amount)}`;
    if (!existingByDateAmount.has(key)) existingByDateAmount.set(key, []);
    existingByDateAmount.get(key).push({
      description: normaliseDescription(s.description),
      reference: s.external_reference || ''
    });

    if (balanceSuffix(s.external_reference) !== null) {
      const fp = fingerprint(s);
      if (!existingByFingerprint.has(fp)) existingByFingerprint.set(fp, []);
      existingByFingerprint.get(fp).push(s.statement_date || '');
    }
  }

  return entries.filter((entry) => {
    // 1. Exact reference match - the primary check.
    if (entry.external_reference && existingRefs.has(entry.external_reference)) {
      return false;
    }

    // 2. The same transaction, re-dated by the bank between exports.
    //
    //    The balance after a transaction pins it to one moment in the account's history, so a
    //    stored row with the same amount, description and resulting balance is the same payment
    //    however the bank has since dated it. Without this, a re-dated transaction defeats every
    //    other check - the date is part of the reference and part of the composite key - and
    //    imports as a second copy of money that only left the account once.
    //
    //    This must run before step 3, which would otherwise trust the differing references.
    if (balanceSuffix(entry.external_reference) !== null) {
      const storedDates = existingByFingerprint.get(fingerprint(entry));
      if (storedDates?.some((date) => daysApart(date, entry.statement_date) <= BALANCE_WINDOW_DAYS)) {
        return false;
      }
    }

    const key = `${entry.statement_date}|${normaliseAmount(entry.amount)}`;
    const candidates = existingByDateAmount.get(key);
    if (!candidates || candidates.length === 0) {
      return true;
    }

    // 3. If this entry and every stored row for the same date and amount carry a
    //    balance-suffixed reference, the references settle it. Steps 1 and 2 already proved
    //    this is not a stored transaction, so it is distinct, and an identical
    //    description is exactly what you would expect - same payer, same day, same amount.
    //
    //    Without this short-circuit a genuine third GBP 250,000 payment to the same payee on
    //    one day can never be imported: its reference is unique, but step 4 rejects it on the
    //    description every time, so retrying the import can never recover it.
    const referencesAreDefinitive =
      hasBalanceSuffix(entry.external_reference) &&
      candidates.every((candidate) => hasBalanceSuffix(candidate.reference));
    if (referencesAreDefinitive) {
      return true;
    }

    // 4. Fallback: the references are not trustworthy here, so fall back to treating a similar
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
