-- =====================================================
-- Investor Interest Ledger Table
-- =====================================================
-- Replaces the complex double-entry interest_accrual/interest_payment
-- approach with a simple ledger that tracks credits and debits.

-- Create investor_interest table
CREATE TABLE IF NOT EXISTS public.investor_interest (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  investor_id uuid NOT NULL REFERENCES public."Investor"(id) ON DELETE CASCADE,
  date date NOT NULL,
  type text NOT NULL CHECK (type IN ('credit', 'debit')),
  amount numeric NOT NULL,
  description text,
  reference text,  -- for bank reconciliation linking
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  CONSTRAINT investor_interest_pkey PRIMARY KEY (id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_investor_interest_org ON public.investor_interest(organization_id);
CREATE INDEX IF NOT EXISTS idx_investor_interest_investor ON public.investor_interest(investor_id);
CREATE INDEX IF NOT EXISTS idx_investor_interest_date ON public.investor_interest(date DESC);

-- Enable RLS
ALTER TABLE public.investor_interest ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "investor_interest_select" ON investor_interest;
CREATE POLICY "investor_interest_select" ON investor_interest
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "investor_interest_insert" ON investor_interest;
CREATE POLICY "investor_interest_insert" ON investor_interest
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "investor_interest_update" ON investor_interest;
CREATE POLICY "investor_interest_update" ON investor_interest
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "investor_interest_delete" ON investor_interest;
CREATE POLICY "investor_interest_delete" ON investor_interest
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- Migrate existing interest_accrual transactions to credits
INSERT INTO public.investor_interest (organization_id, investor_id, date, type, amount, description, reference)
SELECT
  organization_id,
  investor_id,
  date,
  'credit',
  amount,
  COALESCE(description, 'Migrated from interest_accrual'),
  reference
FROM public."InvestorTransaction"
WHERE type = 'interest_accrual'
ON CONFLICT DO NOTHING;

-- Migrate existing interest_payment transactions to debits
INSERT INTO public.investor_interest (organization_id, investor_id, date, type, amount, description, reference)
SELECT
  organization_id,
  investor_id,
  date,
  'debit',
  amount,
  COALESCE(description, 'Migrated from interest_payment'),
  reference
FROM public."InvestorTransaction"
WHERE type = 'interest_payment'
ON CONFLICT DO NOTHING;

-- Add interest_id column to reconciliation_entries for linking
ALTER TABLE public.reconciliation_entries
  ADD COLUMN IF NOT EXISTS interest_id uuid REFERENCES public.investor_interest(id) ON DELETE SET NULL;

-- Comments
COMMENT ON TABLE public.investor_interest IS 'Simple ledger for investor interest credits and debits';
COMMENT ON COLUMN public.investor_interest.type IS 'credit = interest added/accrued, debit = interest withdrawn';
COMMENT ON COLUMN public.investor_interest.reference IS 'External reference for bank reconciliation linking';
