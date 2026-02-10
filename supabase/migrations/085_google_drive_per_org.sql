-- Per-Organization Google Drive Connections
-- Moves Google Drive connections from per-user to per-organization
-- Each org gets its own Google account connection

-- 1. Add organization_id to google_drive_tokens
ALTER TABLE google_drive_tokens
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- 2. Add google_drive_connected and google_drive_email to organizations
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS google_drive_connected BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS google_drive_email TEXT;

COMMENT ON COLUMN organizations.google_drive_connected IS 'Whether this organization has a connected Google Drive account';
COMMENT ON COLUMN organizations.google_drive_email IS 'Email of the Google account connected for this organization';
COMMENT ON COLUMN google_drive_tokens.organization_id IS 'Organization this token belongs to (per-org connection)';

-- 3. Drop old unique constraint on user_id, add unique on organization_id
ALTER TABLE google_drive_tokens DROP CONSTRAINT IF EXISTS google_drive_tokens_user_id_key;
ALTER TABLE google_drive_tokens ADD CONSTRAINT google_drive_tokens_organization_id_key UNIQUE (organization_id);

-- 4. Update index
DROP INDEX IF EXISTS idx_google_drive_tokens_user;
CREATE INDEX IF NOT EXISTS idx_google_drive_tokens_org ON google_drive_tokens(organization_id);

-- 5. Drop old RLS policies
DROP POLICY IF EXISTS "Users can view own Google Drive tokens" ON google_drive_tokens;
DROP POLICY IF EXISTS "Users can insert own Google Drive tokens" ON google_drive_tokens;
DROP POLICY IF EXISTS "Users can update own Google Drive tokens" ON google_drive_tokens;
DROP POLICY IF EXISTS "Users can delete own Google Drive tokens" ON google_drive_tokens;
DROP POLICY IF EXISTS "Service role can manage all Google Drive tokens" ON google_drive_tokens;

-- 6. New RLS policies - users can access tokens for orgs they belong to
CREATE POLICY "Users can view org Google Drive tokens"
  ON google_drive_tokens FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert org Google Drive tokens"
  ON google_drive_tokens FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update org Google Drive tokens"
  ON google_drive_tokens FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete org Google Drive tokens"
  ON google_drive_tokens FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage all Google Drive tokens"
  ON google_drive_tokens FOR ALL
  USING (auth.role() = 'service_role');
