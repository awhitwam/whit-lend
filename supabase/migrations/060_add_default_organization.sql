-- Migration: Add default_organization_id to user_profiles
-- Allows super admins to set their preferred default organization

-- Add the column
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS default_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_default_org ON user_profiles(default_organization_id);

-- Add comment
COMMENT ON COLUMN user_profiles.default_organization_id IS 'The user''s preferred default organization. Used to set initial org context on login.';
