-- Fix legacy disbursement data for accurate Gross/Net tracking
-- This ensures the Dashboard shows correct portfolio metrics

-- Step 1: Update loans.net_disbursed where it wasn't properly set
-- (Only for loans where arrangement_fee exists but net_disbursed wasn't calculated)
UPDATE loans
SET net_disbursed = principal_amount - COALESCE(arrangement_fee, 0)
WHERE arrangement_fee > 0
  AND (net_disbursed IS NULL OR net_disbursed >= principal_amount);

-- Step 2: Fix initial disbursement transactions
-- Set gross_amount = loan.principal_amount for the first disbursement of each loan
WITH first_disbursements AS (
  SELECT DISTINCT ON (loan_id)
    t.id as transaction_id,
    t.loan_id,
    t.amount as current_amount,
    l.principal_amount,
    l.arrangement_fee,
    l.net_disbursed as loan_net_disbursed
  FROM transactions t
  JOIN loans l ON t.loan_id = l.id
  WHERE t.type = 'Disbursement'
    AND NOT t.is_deleted
    AND t.gross_amount IS NULL  -- Only update if not already set
  ORDER BY t.loan_id, t.date ASC, t.id ASC
)
UPDATE transactions t
SET
  gross_amount = fd.principal_amount,
  deducted_fee = CASE
    -- If the disbursement amount is less than principal, the fee was deducted
    WHEN fd.current_amount < fd.principal_amount
    THEN COALESCE(fd.arrangement_fee, fd.principal_amount - fd.current_amount)
    ELSE 0
  END
FROM first_disbursements fd
WHERE t.id = fd.transaction_id;

-- Step 3: For any remaining disbursements (further advances), set gross_amount = amount
-- (These weren't deducting fees at source)
UPDATE transactions
SET gross_amount = amount
WHERE type = 'Disbursement'
  AND NOT is_deleted
  AND gross_amount IS NULL;
