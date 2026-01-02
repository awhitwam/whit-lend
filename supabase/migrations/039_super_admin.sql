-- Migration: Add super admin capability
-- This adds a is_super_admin flag to user_profiles for cross-organization management

-- Add is_super_admin column to user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE;

-- Create index for quick super admin lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_super_admin ON user_profiles(is_super_admin) WHERE is_super_admin = true;

-- Comment for documentation
COMMENT ON COLUMN user_profiles.is_super_admin IS 'When true, user has access to cross-organization management features';
