-- Organization Summary Cache Table
-- Stores cached aggregate values for dashboard display
-- Updated asynchronously after loan balance updates

CREATE TABLE IF NOT EXISTS organization_summary (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  total_principal_outstanding numeric DEFAULT 0,
  total_interest_outstanding numeric DEFAULT 0,
  total_disbursed numeric DEFAULT 0,
  total_repaid numeric DEFAULT 0,
  live_loan_count integer DEFAULT 0,
  settled_loan_count integer DEFAULT 0,
  arrears_amount numeric DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE organization_summary ENABLE ROW LEVEL SECURITY;

-- Policy: users can only see their own org summary
CREATE POLICY "Users can view own org summary"
  ON organization_summary FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

-- Policy: users can insert/update their own org summary
CREATE POLICY "Users can upsert own org summary"
  ON organization_summary FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can update own org summary"
  ON organization_summary FOR UPDATE
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_organization_summary_updated_at
  ON organization_summary(updated_at);

-- Grant permissions (adjust based on your role setup)
GRANT SELECT, INSERT, UPDATE ON organization_summary TO authenticated;
