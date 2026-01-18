-- Google Drive Integration
-- Allows users to save generated letters directly to Google Drive

-- Add Google Drive settings to user_profiles
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS google_drive_connected BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS google_drive_email TEXT,
ADD COLUMN IF NOT EXISTS google_drive_base_folder_id TEXT,
ADD COLUMN IF NOT EXISTS google_drive_base_folder_path TEXT;

-- Comments for documentation
COMMENT ON COLUMN user_profiles.google_drive_connected IS 'Whether user has connected their Google Drive account';
COMMENT ON COLUMN user_profiles.google_drive_email IS 'Email of connected Google account';
COMMENT ON COLUMN user_profiles.google_drive_base_folder_id IS 'Google Drive folder ID for base correspondence folder';
COMMENT ON COLUMN user_profiles.google_drive_base_folder_path IS 'Display path of base folder (for UI)';

-- Encrypted token storage (separate table for security isolation)
CREATE TABLE IF NOT EXISTS google_drive_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expiry TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_google_drive_tokens_user ON google_drive_tokens(user_id);

-- Enable RLS
ALTER TABLE google_drive_tokens ENABLE ROW LEVEL SECURITY;

-- RLS policies - users can only access their own tokens
CREATE POLICY "Users can view own Google Drive tokens"
  ON google_drive_tokens FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own Google Drive tokens"
  ON google_drive_tokens FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own Google Drive tokens"
  ON google_drive_tokens FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own Google Drive tokens"
  ON google_drive_tokens FOR DELETE
  USING (user_id = auth.uid());

-- Service role can manage all tokens (for Edge Functions)
CREATE POLICY "Service role can manage all Google Drive tokens"
  ON google_drive_tokens FOR ALL
  USING (auth.role() = 'service_role');
