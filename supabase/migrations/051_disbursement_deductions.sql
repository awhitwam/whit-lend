-- Enhanced Disbursement Tracking: Gross/Net with Fee & Interest Deductions
-- Allows disbursements to track:
--   - gross_amount: total amount added to principal (what borrower owes)
--   - deducted_fee: arrangement/origination fee deducted before paying borrower
--   - deducted_interest: advance interest deducted at source
--   - amount: net cash paid to borrower (gross - fee - interest)

-- Add deduction tracking fields to transactions table
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS gross_amount numeric;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deducted_fee numeric DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deducted_interest numeric DEFAULT 0;

-- For existing disbursements, set gross_amount = amount (backward compatible)
-- This ensures existing data continues to work correctly
UPDATE transactions
SET gross_amount = amount
WHERE type = 'Disbursement' AND gross_amount IS NULL;

-- Add linked_disbursement_id to link auto-created repayments back to their source disbursement
-- When deducted_interest > 0, a separate Repayment transaction is created and linked here
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS linked_disbursement_id uuid REFERENCES transactions(id);

-- Add comments explaining the fields
COMMENT ON COLUMN transactions.gross_amount IS 'Gross disbursement amount (what borrower owes). Net amount = gross - deducted_fee - deducted_interest';
COMMENT ON COLUMN transactions.deducted_fee IS 'Fee deducted from disbursement before paying borrower (e.g., arrangement fee)';
COMMENT ON COLUMN transactions.deducted_interest IS 'Interest deducted from disbursement (prepaid/advance interest)';
COMMENT ON COLUMN transactions.linked_disbursement_id IS 'For auto-created repayments from deducted interest, links back to the source disbursement';
