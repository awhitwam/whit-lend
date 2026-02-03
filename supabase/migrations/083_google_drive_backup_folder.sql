-- Add backup folder settings to organizations table
-- This allows organizations to configure a Google Drive folder for backup uploads

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS google_drive_backup_folder_id TEXT,
ADD COLUMN IF NOT EXISTS google_drive_backup_folder_path TEXT;

-- Add comments
COMMENT ON COLUMN organizations.google_drive_backup_folder_id IS 'Google Drive folder ID for backup uploads';
COMMENT ON COLUMN organizations.google_drive_backup_folder_path IS 'Display path of the Google Drive backup folder';
