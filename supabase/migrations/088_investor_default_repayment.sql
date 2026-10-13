-- =====================================================
-- Per-investor default capital repayment amount
-- Pre-fills the capital portion of an investor
-- withdrawal during bank reconciliation; the remainder
-- of the bank amount is allocated to interest.
-- =====================================================

ALTER TABLE public."Investor"
  ADD COLUMN IF NOT EXISTS default_capital_repayment numeric;

COMMENT ON COLUMN public."Investor".default_capital_repayment IS
  'Default capital portion of a regular repayment to this investor. Pre-fills the capital box during bank reconciliation; the remainder of the bank amount goes to interest. NULL = no default, fall back to evidence-based suggestion.';
