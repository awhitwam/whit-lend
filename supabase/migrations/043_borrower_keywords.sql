-- Add keywords column to borrowers table
-- Keywords are stored as a text array for searchable references

ALTER TABLE public.borrowers
ADD COLUMN IF NOT EXISTS keywords text[] DEFAULT '{}';

-- Create GIN index for efficient array searches
CREATE INDEX IF NOT EXISTS idx_borrowers_keywords ON public.borrowers USING GIN (keywords);

-- Add comment for documentation
COMMENT ON COLUMN public.borrowers.keywords IS 'Array of searchable keywords/aliases for this borrower';
