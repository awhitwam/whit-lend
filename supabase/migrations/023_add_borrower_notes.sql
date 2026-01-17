-- ============================================
-- Add notes column to borrowers table
-- ============================================

ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS notes TEXT;
