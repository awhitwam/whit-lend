-- Add signature image to user profiles for letter signing
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS signature_image_url TEXT;

-- Add comment for documentation
COMMENT ON COLUMN user_profiles.signature_image_url IS 'URL to uploaded signature image for letters';
