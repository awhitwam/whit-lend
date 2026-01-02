-- Migration: Add RLS bypass policies for Super Admins
-- This allows super admins to view all organizations and memberships across the system

-- Create a helper function to check if current user is a super admin
-- Uses SECURITY DEFINER to avoid RLS recursion
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND is_super_admin = true
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- =====================================================
-- ORGANIZATION_MEMBERS - Super Admin can view ALL memberships
-- =====================================================

DO $$
BEGIN
  -- Allow super admins to view all organization memberships
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Super admins can view all memberships' AND tablename = 'organization_members') THEN
    CREATE POLICY "Super admins can view all memberships" ON organization_members
      FOR SELECT
      USING (is_super_admin());
  END IF;

  -- Allow super admins to manage all organization memberships
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Super admins can manage all memberships' AND tablename = 'organization_members') THEN
    CREATE POLICY "Super admins can manage all memberships" ON organization_members
      FOR ALL
      USING (is_super_admin())
      WITH CHECK (is_super_admin());
  END IF;

  -- =====================================================
  -- ORGANIZATIONS - Super Admin can view ALL organizations
  -- =====================================================

  -- Allow super admins to view all organizations
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Super admins can view all organizations' AND tablename = 'organizations') THEN
    CREATE POLICY "Super admins can view all organizations" ON organizations
      FOR SELECT
      USING (is_super_admin());
  END IF;

  -- =====================================================
  -- USER_PROFILES - Super Admin can view ALL user profiles
  -- =====================================================

  -- Allow super admins to view all user profiles
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Super admins can view all profiles' AND tablename = 'user_profiles') THEN
    CREATE POLICY "Super admins can view all profiles" ON user_profiles
      FOR SELECT
      USING (is_super_admin());
  END IF;

  -- Allow super admins to update any user profile (e.g., to grant/revoke super admin)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Super admins can update all profiles' AND tablename = 'user_profiles') THEN
    CREATE POLICY "Super admins can update all profiles" ON user_profiles
      FOR UPDATE
      USING (is_super_admin())
      WITH CHECK (is_super_admin());
  END IF;
END $$;

-- Success message
SELECT 'Super Admin RLS policies added! Super admins can now see all organizations and memberships.' as message;
