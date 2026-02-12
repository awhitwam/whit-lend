-- Add flag to identify the initial disbursement regardless of its date
-- This allows the initial disbursement date to differ from loan.start_date
-- (e.g. funds sent before the loan officially starts)
ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS is_initial_disbursement boolean DEFAULT false;

-- Backfill: for each loan, mark one disbursement as the initial one
-- Prefer the disbursement on the start_date; fall back to earliest by date then created_at
WITH ranked AS (
  SELECT t.id,
    ROW_NUMBER() OVER (
      PARTITION BY t.loan_id
      ORDER BY
        CASE WHEN DATE(t.date) = DATE(l.start_date) THEN 0 ELSE 1 END,
        t.date ASC, t.created_at ASC
    ) AS rn
  FROM public.transactions t
  JOIN public.loans l ON l.id = t.loan_id
  WHERE t.type = 'Disbursement' AND t.is_deleted = false
)
UPDATE public.transactions SET is_initial_disbursement = true
WHERE id IN (SELECT id FROM ranked WHERE rn = 1);
