-- =====================================================
-- Update Investor table with additional fields
-- Adds product reference, account identifiers, and
-- interest tracking columns
-- =====================================================

-- Add new columns to Investor table
ALTER TABLE public."Investor"
  ADD COLUMN IF NOT EXISTS investor_product_id uuid REFERENCES public.investor_products(id),
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS investor_number text,
  ADD COLUMN IF NOT EXISTS business_name text,
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS accrued_interest numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_accrual_date date,
  ADD COLUMN IF NOT EXISTS total_interest_paid numeric DEFAULT 0;

-- Create indexes for lookups
CREATE INDEX IF NOT EXISTS idx_investor_product_id ON public."Investor"(investor_product_id);
CREATE INDEX IF NOT EXISTS idx_investor_account_number ON public."Investor"(account_number);
CREATE INDEX IF NOT EXISTS idx_investor_investor_number ON public."Investor"(investor_number);

-- Add comments
COMMENT ON COLUMN public."Investor".investor_product_id IS 'Reference to investor product type';
COMMENT ON COLUMN public."Investor".account_number IS 'External account number for matching';
COMMENT ON COLUMN public."Investor".investor_number IS 'External investor number from Loandisc';
COMMENT ON COLUMN public."Investor".accrued_interest IS 'Interest accrued but not yet posted';
COMMENT ON COLUMN public."Investor".last_accrual_date IS 'Date of last interest accrual calculation';
COMMENT ON COLUMN public."Investor".total_interest_paid IS 'Total interest paid to this investor over time';
