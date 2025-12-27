-- ============================================
-- Add description column to loans table
-- ============================================

ALTER TABLE loans ADD COLUMN IF NOT EXISTS description TEXT;

-- Optional: Add an index if you want to search by description
-- CREATE INDEX IF NOT EXISTS idx_loans_description ON loans USING gin(to_tsvector('english', description));
