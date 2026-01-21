-- Add unreconcilable tracking to bank_statements
-- Allows marking difficult bank entries as "unreconcilable" with a reason

ALTER TABLE bank_statements
ADD COLUMN is_unreconcilable boolean DEFAULT false,
ADD COLUMN unreconcilable_reason text,
ADD COLUMN unreconcilable_at timestamp with time zone,
ADD COLUMN unreconcilable_by uuid REFERENCES auth.users(id),
ADD COLUMN unreconcilable_group_id uuid;  -- Links grouped entries together

-- Index for filtering unreconcilable entries
CREATE INDEX idx_bank_statements_unreconcilable
ON bank_statements(organization_id, is_unreconcilable)
WHERE is_unreconcilable = true;

-- Index for group lookups (to find all entries in a group for undo)
CREATE INDEX idx_bank_statements_unreconcilable_group
ON bank_statements(unreconcilable_group_id)
WHERE unreconcilable_group_id IS NOT NULL;
