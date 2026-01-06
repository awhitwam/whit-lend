-- Add cached balance columns to loans table for performance optimization
-- These columns are automatically updated by triggers when transactions change

-- Add new columns
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS principal_remaining numeric,
  ADD COLUMN IF NOT EXISTS interest_remaining numeric,
  ADD COLUMN IF NOT EXISTS balance_updated_at timestamp with time zone;

-- Create function to recalculate a single loan's balances
CREATE OR REPLACE FUNCTION recalculate_loan_balance(p_loan_id uuid)
RETURNS void AS $$
DECLARE
  v_principal numeric;
  v_disbursed numeric;
  v_principal_paid numeric;
BEGIN
  -- Get loan principal amount
  SELECT principal_amount INTO v_principal
  FROM loans
  WHERE id = p_loan_id;

  -- If loan not found, exit
  IF v_principal IS NULL THEN
    RETURN;
  END IF;

  -- Get further advances (disbursements after the first one)
  -- Uses gross_amount which includes the full disbursement before deductions
  SELECT COALESCE(SUM(gross_amount), 0) INTO v_disbursed
  FROM (
    SELECT gross_amount, ROW_NUMBER() OVER (ORDER BY date, id) as rn
    FROM transactions
    WHERE loan_id = p_loan_id
      AND type = 'Disbursement'
      AND (is_deleted IS NULL OR is_deleted = false)
  ) sub WHERE rn > 1;

  -- Get total principal repaid
  SELECT COALESCE(SUM(principal_applied), 0) INTO v_principal_paid
  FROM transactions
  WHERE loan_id = p_loan_id
    AND type = 'Repayment'
    AND (is_deleted IS NULL OR is_deleted = false);

  -- Update the loan with calculated balance
  -- principal_remaining = original principal + further advances - principal paid
  UPDATE loans SET
    principal_remaining = v_principal + v_disbursed - v_principal_paid,
    balance_updated_at = now()
  WHERE id = p_loan_id;
END;
$$ LANGUAGE plpgsql;

-- Create trigger function to update balance when transactions change
CREATE OR REPLACE FUNCTION update_loan_balance_on_transaction()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- On delete, recalculate for the old loan
    PERFORM recalculate_loan_balance(OLD.loan_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    -- On update, recalculate for both old and new loan (in case loan_id changed)
    PERFORM recalculate_loan_balance(OLD.loan_id);
    IF NEW.loan_id IS DISTINCT FROM OLD.loan_id THEN
      PERFORM recalculate_loan_balance(NEW.loan_id);
    END IF;
    RETURN NEW;
  ELSE
    -- On insert, recalculate for the new loan
    PERFORM recalculate_loan_balance(NEW.loan_id);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists (for idempotency)
DROP TRIGGER IF EXISTS trg_update_loan_balance ON transactions;

-- Create trigger on transactions table
CREATE TRIGGER trg_update_loan_balance
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION update_loan_balance_on_transaction();

-- Backfill existing loans
DO $$
DECLARE
  loan_rec RECORD;
  counter integer := 0;
BEGIN
  RAISE NOTICE 'Starting loan balance backfill...';

  FOR loan_rec IN SELECT id FROM loans WHERE (is_deleted IS NULL OR is_deleted = false) LOOP
    PERFORM recalculate_loan_balance(loan_rec.id);
    counter := counter + 1;

    -- Log progress every 100 loans
    IF counter % 100 = 0 THEN
      RAISE NOTICE 'Processed % loans...', counter;
    END IF;
  END LOOP;

  RAISE NOTICE 'Completed backfill for % loans', counter;
END $$;

-- Add comment explaining the columns
COMMENT ON COLUMN loans.principal_remaining IS 'Cached principal balance: principal_amount + further_advances - principal_repaid. Auto-updated by trigger on transactions table.';
COMMENT ON COLUMN loans.balance_updated_at IS 'Timestamp of last balance recalculation';
