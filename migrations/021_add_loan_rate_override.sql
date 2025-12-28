-- ============================================
-- Add Interest Rate Override and Penalty Rate Fields to Loans
-- ============================================
-- Allows overriding the product's default interest rate for individual loans
-- and applying a penalty rate from a specific date onwards.

-- Add interest rate override fields
ALTER TABLE loans ADD COLUMN IF NOT EXISTS override_interest_rate BOOLEAN DEFAULT FALSE;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS overridden_rate DECIMAL(10,4);

-- Add penalty rate fields
ALTER TABLE loans ADD COLUMN IF NOT EXISTS has_penalty_rate BOOLEAN DEFAULT FALSE;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS penalty_rate DECIMAL(10,4);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS penalty_rate_from DATE;

-- Add comments for documentation
COMMENT ON COLUMN loans.override_interest_rate IS 'When true, use overridden_rate instead of product default rate';
COMMENT ON COLUMN loans.overridden_rate IS 'Custom interest rate (%) to use instead of product rate';
COMMENT ON COLUMN loans.has_penalty_rate IS 'When true, apply penalty_rate from penalty_rate_from date onwards';
COMMENT ON COLUMN loans.penalty_rate IS 'Penalty interest rate (%) applied after penalty_rate_from date';
COMMENT ON COLUMN loans.penalty_rate_from IS 'Date from which penalty_rate applies to interest calculations';
