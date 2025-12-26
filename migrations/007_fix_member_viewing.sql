-- ============================================
-- Fix Member Viewing with Security Definer Function
-- ============================================
-- Allow viewing all members of organizations you belong to
-- without causing infinite recursion

-- Drop existing policies
DROP POLICY IF EXISTS "View own membership" ON organization_members;
DROP POLICY IF EXISTS "Manage own membership" ON organization_members;

-- Create a security definer function to check if user is org member
-- This bypasses RLS for the check, preventing recursion
CREATE OR REPLACE FUNCTION is_organization_member(org_id UUID, user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
      AND organization_members.user_id = user_id
      AND is_active = true
  );
$$;

-- Create a security definer function to check if user is org admin
CREATE OR REPLACE FUNCTION is_organization_admin(org_id UUID, user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
      AND organization_members.user_id = user_id
      AND role = 'Admin'
      AND is_active = true
  );
$$;

-- Now create policies using these functions
CREATE POLICY "View organization members" ON organization_members
  FOR SELECT
  USING (is_organization_member(organization_id, auth.uid()));

-- Admins can manage members
CREATE POLICY "Admins manage members INSERT" ON organization_members
  FOR INSERT
  WITH CHECK (is_organization_admin(organization_id, auth.uid()));

CREATE POLICY "Admins manage members UPDATE" ON organization_members
  FOR UPDATE
  USING (is_organization_admin(organization_id, auth.uid()))
  WITH CHECK (is_organization_admin(organization_id, auth.uid()));

CREATE POLICY "Admins manage members DELETE" ON organization_members
  FOR DELETE
  USING (is_organization_admin(organization_id, auth.uid()));

-- Success
SELECT 'Member viewing fixed! Refresh your browser.' as message;
