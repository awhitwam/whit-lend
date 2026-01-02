-- =====================================================
-- Add interest calculation options to investor_products
-- =====================================================

-- Add interest_calculation_type column
-- 'automatic' = system calculates based on rate
-- 'manual' = user manually enters accrued interest amounts
ALTER TABLE public.investor_products
  ADD COLUMN IF NOT EXISTS interest_calculation_type text DEFAULT 'automatic';

-- Add interest_posting_day column
-- Day of month (1-28) when interest should be posted for automatic calculation
ALTER TABLE public.investor_products
  ADD COLUMN IF NOT EXISTS interest_posting_day integer DEFAULT 1;

-- Add constraint to ensure valid day of month (1-28 to handle all months)
-- Use DO block to handle case where constraint already exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'investor_products_posting_day_check'
  ) THEN
    ALTER TABLE public.investor_products
      ADD CONSTRAINT investor_products_posting_day_check
      CHECK (interest_posting_day >= 1 AND interest_posting_day <= 28);
  END IF;
END $$;

-- Add comment
COMMENT ON COLUMN public.investor_products.interest_calculation_type IS 'automatic = system calculates interest, manual = user enters amounts';
COMMENT ON COLUMN public.investor_products.interest_posting_day IS 'Day of month (1-28) when interest is posted for automatic calculation';
