-- Migration: Add Roll-Up & Serviced product type
-- This adds support for loans where interest rolls up during an initial period,
-- then serviced monthly payments begin

-- Add compound_after_rollup to loan_products
ALTER TABLE public.loan_products
ADD COLUMN IF NOT EXISTS compound_after_rollup boolean DEFAULT false;

-- Add roll-up fields to loans
ALTER TABLE public.loans
ADD COLUMN IF NOT EXISTS roll_up_length integer,
ADD COLUMN IF NOT EXISTS roll_up_amount numeric,
ADD COLUMN IF NOT EXISTS roll_up_amount_override boolean DEFAULT false;

-- Add additional deducted fees (applies to ALL product types)
ALTER TABLE public.loans
ADD COLUMN IF NOT EXISTS additional_deducted_fees numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS additional_deducted_fees_note text;

-- Also add to loan_products for default configuration
ALTER TABLE public.loan_products
ADD COLUMN IF NOT EXISTS default_additional_fees numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS default_additional_fees_note text;

-- Update product_type constraints to include Roll-Up & Serviced
ALTER TABLE public.loan_products DROP CONSTRAINT IF EXISTS loan_products_product_type_check;
ALTER TABLE public.loan_products ADD CONSTRAINT loan_products_product_type_check
CHECK (product_type IN ('Standard', 'Fixed Charge', 'Irregular Income', 'Rent', 'Roll-Up & Serviced'));

ALTER TABLE public.loans DROP CONSTRAINT IF EXISTS loans_product_type_check;
ALTER TABLE public.loans ADD CONSTRAINT loans_product_type_check
CHECK (product_type IN ('Standard', 'Fixed Charge', 'Irregular Income', 'Rent', 'Roll-Up & Serviced'));
