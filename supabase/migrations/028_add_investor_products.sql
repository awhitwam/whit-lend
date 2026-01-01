-- =====================================================
-- Add Investor Products table
-- Similar to loan_products, allows defining different
-- investor account types with varying interest rates
-- =====================================================

CREATE TABLE IF NOT EXISTS public.investor_products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  interest_rate_per_annum numeric NOT NULL DEFAULT 0,
  interest_posting_frequency text DEFAULT 'monthly',
  min_balance_for_interest numeric DEFAULT 0,
  min_balance_for_withdrawals numeric DEFAULT 0,
  status text DEFAULT 'Active',
  description text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT investor_products_pkey PRIMARY KEY (id),
  CONSTRAINT investor_products_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_investor_products_org ON public.investor_products(organization_id);
CREATE INDEX IF NOT EXISTS idx_investor_products_status ON public.investor_products(status);

-- Enable RLS
ALTER TABLE public.investor_products ENABLE ROW LEVEL SECURITY;

-- RLS Policies using the existing user_org_ids() function
DROP POLICY IF EXISTS "investor_products_select" ON investor_products;
DROP POLICY IF EXISTS "investor_products_insert" ON investor_products;
DROP POLICY IF EXISTS "investor_products_update" ON investor_products;
DROP POLICY IF EXISTS "investor_products_delete" ON investor_products;

CREATE POLICY "investor_products_select" ON investor_products
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "investor_products_insert" ON investor_products
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "investor_products_update" ON investor_products
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "investor_products_delete" ON investor_products
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- Add comment
COMMENT ON TABLE public.investor_products IS 'Investor product types with interest rates and terms';
