-- Migration: Add 'Development Build' to property_type allowed values
-- Drop the existing check constraint and recreate with the new value

-- First, drop the existing constraint
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_property_type_check;

-- Recreate with the new allowed values
ALTER TABLE public.properties ADD CONSTRAINT properties_property_type_check
  CHECK (property_type IN ('Residential', 'Commercial', 'Land', 'Mixed Use', 'Development Build'));
