/**
 * Suggestion type -> inline form key.
 *
 * 'create'-mode suggestions carry a `_new` suffix (ExpenditurePanel and ReceiptsPanel
 * build them that way), but BankEntryRow's `expandedForm` keys do not, and two of the
 * four differ by more than the suffix - investor_credit_new opens the *deposit* form. So
 * a naive suffix-strip is not enough.
 *
 * Setting expandedForm to the raw suggestion type therefore matched no form at all, and
 * clicking Create on any of these four suggestions silently opened nothing. One map,
 * used by everyone, is what keeps that fixed.
 *
 * Kept out of ./utils.js deliberately: that module imports '@/components/loan/LoanCalculator',
 * a path alias that only Vite can resolve, which would make this untestable from a plain
 * node script.
 */

export const SUGGESTION_FORM_KEYS = {
  loan_repayment_new: 'loan_repayment',
  investor_credit_new: 'investor_deposit',
  loan_disbursement_new: 'loan_disbursement',
  investor_withdrawal_new: 'investor_withdrawal'
};

/**
 * The inline form a suggestion should open.
 * @param {{type?: string}|null} suggestion
 * @returns {string|null} form key, or null when there is no suggestion
 */
export function formKeyForSuggestion(suggestion) {
  if (!suggestion) return null;
  return SUGGESTION_FORM_KEYS[suggestion.type] || suggestion.type;
}
