-- ============================================
-- Add Loan Restructure Link
-- ============================================
-- This adds support for tracking restructured loans
-- When a loan is restructured, the old loan is settled and a new loan is created
-- This field links the new loan to the previous one(s) in the restructure chain

-- Add restructured_from_loan_id column to loans table
-- This points to the previous loan in a restructure chain
ALTER TABLE loans ADD COLUMN IF NOT EXISTS restructured_from_loan_id UUID REFERENCES loans(id);

-- Add an index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_loans_restructured_from ON loans(restructured_from_loan_id);

-- Add a field to mark loans as "Restructured" status (settled due to restructure)
-- The status field already exists, we'll use status = 'Restructured' for loans that were restructured

-- Add a comment explaining the field
COMMENT ON COLUMN loans.restructured_from_loan_id IS 'References the previous loan in a restructure chain. When a loan is restructured, balance/interest/fees roll to a new loan. The original loan is marked as Restructured status.';

-- Optional: Create a function to get the full restructure chain for a loan
CREATE OR REPLACE FUNCTION get_loan_restructure_chain(loan_id UUID)
RETURNS TABLE(
  chain_loan_id UUID,
  chain_position INT,
  loan_number TEXT,
  status TEXT,
  principal_amount NUMERIC
) AS $$
WITH RECURSIVE chain AS (
  -- Start with the given loan
  SELECT id, 1 as position, loan_number, status, principal_amount, restructured_from_loan_id
  FROM loans
  WHERE id = loan_id

  UNION ALL

  -- Walk back through the chain
  SELECT l.id, c.position + 1, l.loan_number, l.status, l.principal_amount, l.restructured_from_loan_id
  FROM loans l
  INNER JOIN chain c ON l.id = c.restructured_from_loan_id
)
SELECT id, position, loan_number, status, principal_amount
FROM chain
ORDER BY position DESC;  -- Oldest first
$$ LANGUAGE SQL;
