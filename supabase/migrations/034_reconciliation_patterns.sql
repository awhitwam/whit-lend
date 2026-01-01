-- =====================================================
-- Reconciliation Patterns Table
-- =====================================================
-- Stores learned patterns from manual reconciliations to
-- enable auto-matching of similar future bank entries.

-- Reconciliation patterns (learned from manual matches)
CREATE TABLE IF NOT EXISTS public.reconciliation_patterns (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),

  -- Pattern matching criteria (extracted from bank description)
  description_pattern text NOT NULL,      -- Key words/phrases to match
  amount_min numeric,                     -- Optional amount range
  amount_max numeric,
  transaction_type text,                  -- CRDT/DBIT
  bank_source text,                       -- Which bank this pattern applies to

  -- What to match to
  match_type text NOT NULL,               -- loan_repayment, loan_disbursement, investor_credit, investor_withdrawal, investor_interest, expense
  loan_id uuid REFERENCES public.loans(id) ON DELETE SET NULL,
  investor_id uuid REFERENCES public."Investor"(id) ON DELETE SET NULL,
  expense_type_id uuid REFERENCES public.expense_types(id) ON DELETE SET NULL,

  -- For loan repayments - default split ratios
  default_capital_ratio numeric DEFAULT 1,  -- e.g., 0.6 = 60% to capital
  default_interest_ratio numeric DEFAULT 0, -- e.g., 0.4 = 40% to interest
  default_fees_ratio numeric DEFAULT 0,

  -- Pattern metadata
  match_count integer DEFAULT 1,          -- How many times this pattern has matched
  confidence_score numeric DEFAULT 1.0,   -- 0-1 score based on match history
  last_used_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,

  CONSTRAINT reconciliation_patterns_pkey PRIMARY KEY (id)
);

-- Indexes for pattern matching
CREATE INDEX IF NOT EXISTS idx_reconciliation_patterns_org ON public.reconciliation_patterns(organization_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_patterns_description ON public.reconciliation_patterns(organization_id, description_pattern);
CREATE INDEX IF NOT EXISTS idx_reconciliation_patterns_loan ON public.reconciliation_patterns(loan_id) WHERE loan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reconciliation_patterns_investor ON public.reconciliation_patterns(investor_id) WHERE investor_id IS NOT NULL;

-- Enable RLS
ALTER TABLE public.reconciliation_patterns ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "reconciliation_patterns_select" ON reconciliation_patterns;
CREATE POLICY "reconciliation_patterns_select" ON reconciliation_patterns
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "reconciliation_patterns_insert" ON reconciliation_patterns;
CREATE POLICY "reconciliation_patterns_insert" ON reconciliation_patterns
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "reconciliation_patterns_update" ON reconciliation_patterns;
CREATE POLICY "reconciliation_patterns_update" ON reconciliation_patterns
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "reconciliation_patterns_delete" ON reconciliation_patterns;
CREATE POLICY "reconciliation_patterns_delete" ON reconciliation_patterns
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- Add suggested_match columns to bank_statements for caching auto-match suggestions
ALTER TABLE public.bank_statements
  ADD COLUMN IF NOT EXISTS suggested_match_type text,
  ADD COLUMN IF NOT EXISTS suggested_loan_id uuid REFERENCES public.loans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_investor_id uuid REFERENCES public."Investor"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_expense_type_id uuid REFERENCES public.expense_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggestion_confidence numeric,
  ADD COLUMN IF NOT EXISTS suggestion_reason text,
  ADD COLUMN IF NOT EXISTS pattern_id uuid REFERENCES public.reconciliation_patterns(id) ON DELETE SET NULL;

-- Index for suggested matches
CREATE INDEX IF NOT EXISTS idx_bank_statements_suggested ON public.bank_statements(organization_id, suggested_match_type) WHERE suggested_match_type IS NOT NULL;

COMMENT ON TABLE public.reconciliation_patterns IS 'Learned patterns from manual reconciliations for auto-matching';
COMMENT ON COLUMN public.reconciliation_patterns.description_pattern IS 'Key words extracted from bank description for fuzzy matching';
COMMENT ON COLUMN public.reconciliation_patterns.confidence_score IS 'Match confidence 0-1 based on pattern usage history';
COMMENT ON COLUMN public.bank_statements.suggestion_confidence IS 'Auto-match confidence score 0-1';
