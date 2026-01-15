-- Migration: Add loan_comments table for storing notes/comments on loans
-- This allows users to record free-text comments with timestamps against loans

-- Create the loan_comments table
CREATE TABLE IF NOT EXISTS public.loan_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  loan_id UUID NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name TEXT,  -- Stored denormalized for display (especially for imported historical comments)
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_loan_comments_loan_id ON public.loan_comments(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_comments_org ON public.loan_comments(organization_id);
CREATE INDEX IF NOT EXISTS idx_loan_comments_created_at ON public.loan_comments(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.loan_comments ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can access comments in their organization
CREATE POLICY "Users can view loan comments in their organization"
ON public.loan_comments
FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM public.organization_members
    WHERE user_id = auth.uid() AND is_active = true
  )
);

CREATE POLICY "Users can insert loan comments in their organization"
ON public.loan_comments
FOR INSERT
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM public.organization_members
    WHERE user_id = auth.uid() AND is_active = true
  )
);

CREATE POLICY "Users can update loan comments in their organization"
ON public.loan_comments
FOR UPDATE
USING (
  organization_id IN (
    SELECT organization_id FROM public.organization_members
    WHERE user_id = auth.uid() AND is_active = true
  )
);

CREATE POLICY "Users can delete loan comments in their organization"
ON public.loan_comments
FOR DELETE
USING (
  organization_id IN (
    SELECT organization_id FROM public.organization_members
    WHERE user_id = auth.uid() AND is_active = true
  )
);

-- Grant permissions
GRANT ALL ON public.loan_comments TO authenticated;
GRANT ALL ON public.loan_comments TO service_role;
