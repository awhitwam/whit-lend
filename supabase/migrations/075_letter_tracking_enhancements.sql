-- Migration: Add delivery tracking fields to generated_letters
-- Enables tracking of letters sent via email, download, or Google Drive

-- Add delivery tracking fields to generated_letters
ALTER TABLE generated_letters
ADD COLUMN IF NOT EXISTS delivery_method TEXT, -- 'email', 'download', 'drive'
ADD COLUMN IF NOT EXISTS recipient_email TEXT,
ADD COLUMN IF NOT EXISTS google_drive_file_id TEXT,
ADD COLUMN IF NOT EXISTS google_drive_file_url TEXT,
ADD COLUMN IF NOT EXISTS template_name TEXT; -- Denormalized for display

-- Add comment for documentation
COMMENT ON COLUMN generated_letters.delivery_method IS 'How the letter was delivered: email, download, or drive';
COMMENT ON COLUMN generated_letters.recipient_email IS 'Email address the letter was sent to';
COMMENT ON COLUMN generated_letters.google_drive_file_id IS 'Google Drive file ID if sent from Drive';
COMMENT ON COLUMN generated_letters.google_drive_file_url IS 'Google Drive file URL if sent from Drive';
COMMENT ON COLUMN generated_letters.template_name IS 'Denormalized template name for display';

-- Add index for loan filtering with creation date ordering
CREATE INDEX IF NOT EXISTS idx_generated_letters_created ON generated_letters(loan_id, created_at DESC);
