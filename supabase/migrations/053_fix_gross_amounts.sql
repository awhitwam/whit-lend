-- Fix gross_amount values that were incorrectly set to NET amounts
-- Migration 051 set gross_amount = amount for backward compatibility,
-- but for loans with arrangement fees, the amount was already NET (principal - fee)
-- This migration corrects those to show the true GROSS (principal_amount)

-- Step 1: Fix first disbursement for each loan where fee was deducted
-- Identify loans where arrangement_fee > 0 and the disbursement amount < principal
WITH first_disbursements AS (
  SELECT DISTINCT ON (t.loan_id)
    t.id as transaction_id,
    t.loan_id,
    t.amount as current_amount,
    t.gross_amount as current_gross,
    l.principal_amount,
    l.arrangement_fee,
    l.net_disbursed
  FROM transactions t
  JOIN loans l ON t.loan_id = l.id
  WHERE t.type = 'Disbursement'
    AND NOT t.is_deleted
    AND l.arrangement_fee > 0
    -- Only fix if gross_amount appears to be NET (roughly equals amount or net_disbursed)
    AND (
      t.gross_amount IS NULL
      OR t.gross_amount = t.amount
      OR ABS(t.gross_amount - l.net_disbursed) < 1
      OR t.gross_amount < l.principal_amount
    )
  ORDER BY t.loan_id, t.date ASC, t.id ASC
)
UPDATE transactions t
SET
  gross_amount = fd.principal_amount,
  deducted_fee = COALESCE(fd.arrangement_fee, fd.principal_amount - fd.current_amount)
FROM first_disbursements fd
WHERE t.id = fd.transaction_id
  AND fd.principal_amount > fd.current_amount;  -- Confirm fee was actually deducted

-- Step 2: Update loans.net_disbursed where it equals principal but fee exists
UPDATE loans
SET net_disbursed = principal_amount - COALESCE(arrangement_fee, 0)
WHERE arrangement_fee > 0
  AND (net_disbursed IS NULL OR net_disbursed >= principal_amount);

-- Report what was updated (for verification)
-- SELECT count(*) as fixed_disbursements FROM transactions WHERE deducted_fee > 0;
