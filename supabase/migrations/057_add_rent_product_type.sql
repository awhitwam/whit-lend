-- Migration: Add 'Rent' to product_type allowed values
-- The loan_products table has a CHECK constraint limiting product_type values.
-- This migration updates it to include the new 'Rent' product type.

-- Drop the existing constraint
ALTER TABLE public.loan_products
DROP CONSTRAINT IF EXISTS loan_products_product_type_check;

-- Re-create with 'Rent' included
ALTER TABLE public.loan_products
ADD CONSTRAINT loan_products_product_type_check
CHECK (product_type IN ('Standard', 'Fixed Charge', 'Irregular Income', 'Rent'));
