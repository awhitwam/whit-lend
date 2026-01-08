-- Migration: Add scheduler_type to loan_products
-- This enables the new scheduler-first architecture where products explicitly
-- declare which scheduler to use for schedule generation.

-- Add scheduler_type column with default for backward compatibility
ALTER TABLE public.loan_products
ADD COLUMN IF NOT EXISTS scheduler_type text DEFAULT 'reducing_balance';

-- Add scheduler_config for scheduler-specific settings (JSONB for flexibility)
ALTER TABLE public.loan_products
ADD COLUMN IF NOT EXISTS scheduler_config jsonb DEFAULT '{}';

-- Migrate existing products based on their current settings
-- This maps the old interest_type/product_type to the new scheduler_type
UPDATE public.loan_products SET scheduler_type =
  CASE
    -- Special product types first (most specific)
    WHEN product_type = 'Fixed Charge' THEN 'fixed_charge'
    WHEN product_type = 'Irregular Income' THEN 'irregular_income'
    -- Interest type mappings
    WHEN interest_type = 'Rolled-Up' THEN 'rolled_up'
    WHEN interest_type = 'Interest-Only' THEN 'interest_only'
    WHEN interest_type = 'Flat' THEN 'flat_rate'
    WHEN interest_type = 'Reducing' THEN 'reducing_balance'
    -- Default fallback
    ELSE 'reducing_balance'
  END
WHERE scheduler_type IS NULL OR scheduler_type = 'reducing_balance';

-- Migrate existing configuration fields to scheduler_config
-- This preserves all the settings that influence schedule generation
UPDATE public.loan_products SET scheduler_config = jsonb_build_object(
  'period', COALESCE(period, 'Monthly'),
  'interest_calculation_method', COALESCE(interest_calculation_method, 'daily'),
  'interest_alignment', COALESCE(interest_alignment, 'period_based'),
  'interest_paid_in_advance', COALESCE(interest_paid_in_advance, false),
  'extend_for_full_period', COALESCE(extend_for_full_period, false),
  'interest_only_period', interest_only_period
)
WHERE scheduler_config = '{}' OR scheduler_config IS NULL;

-- Create index for efficient scheduler type lookups
CREATE INDEX IF NOT EXISTS idx_loan_products_scheduler_type
ON public.loan_products(scheduler_type);

-- Add comment explaining the column
COMMENT ON COLUMN public.loan_products.scheduler_type IS
  'Scheduler type for schedule generation. Values: reducing_balance, flat_rate, interest_only, rolled_up, fixed_charge, irregular_income';

COMMENT ON COLUMN public.loan_products.scheduler_config IS
  'JSON configuration passed to the scheduler. Contains period, calculation method, alignment, etc.';
