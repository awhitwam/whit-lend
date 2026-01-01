-- =====================================================
-- Update InvestorTransaction table with additional fields
-- Adds external reference, description, and interest
-- posting tracking columns
-- =====================================================

-- Add new columns to InvestorTransaction table
ALTER TABLE public."InvestorTransaction"
  ADD COLUMN IF NOT EXISTS transaction_id text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS bank_account text,
  ADD COLUMN IF NOT EXISTS is_auto_generated boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS accrual_period_start date,
  ADD COLUMN IF NOT EXISTS accrual_period_end date;

-- Create index for external reference lookup
CREATE INDEX IF NOT EXISTS idx_investor_transaction_external_id ON public."InvestorTransaction"(transaction_id);

-- Add comments
COMMENT ON COLUMN public."InvestorTransaction".transaction_id IS 'External transaction ID for matching during import';
COMMENT ON COLUMN public."InvestorTransaction".description IS 'Transaction description';
COMMENT ON COLUMN public."InvestorTransaction".bank_account IS 'Bank account used for the transaction';
COMMENT ON COLUMN public."InvestorTransaction".is_auto_generated IS 'True if this was auto-generated (e.g., interest posting)';
COMMENT ON COLUMN public."InvestorTransaction".accrual_period_start IS 'Start of interest accrual period (for interest payments)';
COMMENT ON COLUMN public."InvestorTransaction".accrual_period_end IS 'End of interest accrual period (for interest payments)';
