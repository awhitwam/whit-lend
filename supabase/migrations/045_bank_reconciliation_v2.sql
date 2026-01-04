-- =====================================================
-- Bank Reconciliation v2 - Schema Extensions
-- =====================================================
-- Adds columns to support intent-first reconciliation workflow
-- with state progression tracking

-- Extend bank_statements table with reconciliation v2 columns
ALTER TABLE public.bank_statements
  ADD COLUMN IF NOT EXISTS reconciliation_state text DEFAULT 'unclassified',
  ADD COLUMN IF NOT EXISTS classified_intent text,
  ADD COLUMN IF NOT EXISTS classification_signals jsonb,
  ADD COLUMN IF NOT EXISTS matched_schedule_id uuid REFERENCES public.repayment_schedules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proposed_split jsonb;

-- Add constraint for valid reconciliation states
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bank_statements_reconciliation_state_check'
  ) THEN
    ALTER TABLE public.bank_statements
      ADD CONSTRAINT bank_statements_reconciliation_state_check
      CHECK (reconciliation_state IN ('unclassified', 'classified', 'matched', 'split', 'reconciled', 'exception'));
  END IF;
END $$;

-- Add constraint for valid intent types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bank_statements_classified_intent_check'
  ) THEN
    ALTER TABLE public.bank_statements
      ADD CONSTRAINT bank_statements_classified_intent_check
      CHECK (classified_intent IS NULL OR classified_intent IN (
        'loan_repayment',
        'loan_disbursement',
        'interest_only_payment',
        'investor_funding',
        'investor_withdrawal',
        'investor_interest',
        'operating_expense',
        'platform_fee',
        'transfer',
        'unknown'
      ));
  END IF;
END $$;

-- Index for filtering by reconciliation state
CREATE INDEX IF NOT EXISTS idx_bank_statements_reconciliation_state
  ON public.bank_statements(reconciliation_state);

-- Index for filtering by intent
CREATE INDEX IF NOT EXISTS idx_bank_statements_classified_intent
  ON public.bank_statements(classified_intent);

-- Comments
COMMENT ON COLUMN public.bank_statements.reconciliation_state IS 'Current state in reconciliation workflow: unclassified, classified, matched, split, reconciled, exception';
COMMENT ON COLUMN public.bank_statements.classified_intent IS 'Classified transaction intent (loan_repayment, investor_withdrawal, etc.)';
COMMENT ON COLUMN public.bank_statements.classification_signals IS 'JSON object containing signals used for classification (name_similarity, amount_match, etc.)';
COMMENT ON COLUMN public.bank_statements.matched_schedule_id IS 'Reference to matched repayment schedule entry (for loan repayments)';
COMMENT ON COLUMN public.bank_statements.proposed_split IS 'JSON object containing proposed split values {principal, interest, fees}';
