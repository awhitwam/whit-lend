-- Migration: Add original_term field to loans
-- This field preserves the original contractual loan term, separate from duration which can be modified

-- Add the original_term column
ALTER TABLE Loan ADD COLUMN IF NOT EXISTS original_term integer;

-- Backfill existing loans with 12 (assuming 1 year original term)
UPDATE Loan SET original_term = 12 WHERE original_term IS NULL;
