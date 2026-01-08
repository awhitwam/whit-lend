-- Migration: Sync scheduler_type with product_type for all products
-- This ensures scheduler_type is always consistent with product_type/interest_type

UPDATE public.loan_products SET scheduler_type =
  CASE
    -- Special product types first (most specific)
    WHEN product_type = 'Fixed Charge' THEN 'fixed_charge'
    WHEN product_type = 'Irregular Income' THEN 'irregular_income'
    WHEN product_type = 'Rent' THEN 'rent'
    -- Interest type mappings for Standard products
    WHEN interest_type = 'Rolled-Up' THEN 'rolled_up'
    WHEN interest_type = 'Interest-Only' THEN 'interest_only'
    WHEN interest_type = 'Flat' THEN 'flat_rate'
    WHEN interest_type = 'Reducing' THEN 'reducing_balance'
    -- Default fallback
    ELSE 'reducing_balance'
  END;
