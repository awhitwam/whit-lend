-- Add restructured_from_loan_number field to loans table
-- This stores the original loan number that this loan was restructured from
-- (from Loandisc format "1000121, R:1000120" the value would be "1000120")

ALTER TABLE loans ADD COLUMN IF NOT EXISTS restructured_from_loan_number text;

-- Add index for lookups
CREATE INDEX IF NOT EXISTS idx_loans_restructured_from_loan_number ON loans(restructured_from_loan_number);

-- Update database structure documentation
COMMENT ON COLUMN loans.restructured_from_loan_number IS 'The loan number of the original loan this was restructured from (e.g., from Loandisc import)';
