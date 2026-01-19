-- Migration: Remove contact_email column from borrowers table
-- This field was intended for grouping borrowers but was never used
-- Grouping is done by first_name + last_name instead

-- Drop the contact_email column
ALTER TABLE borrowers DROP COLUMN IF EXISTS contact_email;
