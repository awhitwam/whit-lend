-- ============================================
-- Add Email and Name to User Profiles
-- ============================================
-- Store email/name in user_profiles for easy access

-- Add email column to user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill emails from auth.users
UPDATE user_profiles up
SET email = au.email
FROM auth.users au
WHERE up.id = au.id AND up.email IS NULL;

-- Create an index
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);

-- Success
SELECT 'User profiles updated! Refresh your browser.' as message;
