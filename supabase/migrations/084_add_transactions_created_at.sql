-- Add created_at timestamp to transactions table
-- This enables sorting same-day transactions by entry order

-- Add the column with default NOW() for new records
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();

-- For existing records without created_at, we can't know when they were created
-- So we'll leave them NULL or set to the transaction date as a reasonable default
-- Setting to date at midnight to preserve date ordering within the same day
UPDATE transactions
SET created_at = (date::timestamp AT TIME ZONE 'UTC')
WHERE created_at IS NULL;

-- Add index for efficient sorting by date + created_at
CREATE INDEX IF NOT EXISTS idx_transactions_date_created
ON transactions (date DESC, created_at DESC);

COMMENT ON COLUMN transactions.created_at IS 'Timestamp when the transaction record was created (for ordering same-day entries)';
