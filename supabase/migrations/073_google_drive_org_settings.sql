-- Migration: Move Google Drive base folder from user-level to organization-level
-- This allows a single base folder to be shared across the organization
-- Only super admins can modify the base folder

-- Add Google Drive base folder columns to organizations table
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS google_drive_base_folder_id TEXT,
ADD COLUMN IF NOT EXISTS google_drive_base_folder_path TEXT;

-- Add comment for documentation
COMMENT ON COLUMN organizations.google_drive_base_folder_id IS 'Google Drive folder ID used as base for all loan folders in this organization';
COMMENT ON COLUMN organizations.google_drive_base_folder_path IS 'Display path of the Google Drive base folder';
