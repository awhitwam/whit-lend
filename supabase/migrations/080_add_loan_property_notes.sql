-- Migration: Add notes column to loan_properties
-- Allows free text comments against a property on a per-loan basis

ALTER TABLE public.loan_properties
ADD COLUMN notes TEXT;

COMMENT ON COLUMN public.loan_properties.notes IS 'Free text comment/notes specific to this property-loan relationship';
