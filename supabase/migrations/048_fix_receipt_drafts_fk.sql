-- =====================================================
-- Fix receipt_drafts foreign key to cascade on borrower delete
-- =====================================================

-- Drop the existing constraint and recreate with ON DELETE CASCADE
ALTER TABLE public.receipt_drafts
  DROP CONSTRAINT IF EXISTS receipt_drafts_borrower_id_fkey;

ALTER TABLE public.receipt_drafts
  ADD CONSTRAINT receipt_drafts_borrower_id_fkey
  FOREIGN KEY (borrower_id) REFERENCES public.borrowers(id) ON DELETE CASCADE;
