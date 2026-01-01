-- =====================================================
-- Add was_created column to reconciliation_entries
-- =====================================================
-- Tracks whether the linked record was created during reconciliation
-- (and should be deleted on unlink) vs matched to existing record
-- (which should be preserved on unlink).

-- Add was_created column
ALTER TABLE public.reconciliation_entries
  ADD COLUMN IF NOT EXISTS was_created boolean DEFAULT false;

-- Comment
COMMENT ON COLUMN public.reconciliation_entries.was_created IS 'True if the linked transaction/expense was created during reconciliation (should be deleted on unlink)';
