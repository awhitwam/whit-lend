-- =====================================================
-- Other Income Table
-- =====================================================
-- Tracks miscellaneous income like bank interest that doesn't
-- belong to loan repayments or investor credits.

-- Other Income table
CREATE TABLE IF NOT EXISTS public.other_income (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  date date NOT NULL,
  amount numeric NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  CONSTRAINT other_income_pkey PRIMARY KEY (id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_other_income_org ON public.other_income(organization_id);
CREATE INDEX IF NOT EXISTS idx_other_income_date ON public.other_income(date DESC);

-- Enable RLS
ALTER TABLE public.other_income ENABLE ROW LEVEL SECURITY;

-- RLS Policies for other_income
DROP POLICY IF EXISTS "other_income_select" ON other_income;
CREATE POLICY "other_income_select" ON other_income
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "other_income_insert" ON other_income;
CREATE POLICY "other_income_insert" ON other_income
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "other_income_update" ON other_income;
CREATE POLICY "other_income_update" ON other_income
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "other_income_delete" ON other_income;
CREATE POLICY "other_income_delete" ON other_income
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- Add other_income_id column to reconciliation_entries
ALTER TABLE public.reconciliation_entries
  ADD COLUMN IF NOT EXISTS other_income_id uuid REFERENCES public.other_income(id) ON DELETE SET NULL;

-- Update comment for reconciliation_type to include other_income
COMMENT ON COLUMN public.reconciliation_entries.reconciliation_type IS 'Type: loan_repayment, loan_disbursement, investor_credit, investor_withdrawal, investor_interest, expense, other_income, offset';

-- Comments
COMMENT ON TABLE public.other_income IS 'Miscellaneous income like bank interest';
COMMENT ON COLUMN public.other_income.amount IS 'Income amount (positive value)';
COMMENT ON COLUMN public.other_income.description IS 'Description of the income source';
