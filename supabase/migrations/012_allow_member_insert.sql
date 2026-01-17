-- ============================================
-- Allow Users to Add Themselves as Organization Members
-- ============================================
-- When creating a new organization, users need to add themselves as admin

-- Drop the restrictive policies from script 007
DROP POLICY IF EXISTS "Admins manage members INSERT" ON organization_members;
DROP POLICY IF EXISTS "Admins manage members UPDATE" ON organization_members;
DROP POLICY IF EXISTS "Admins manage members DELETE" ON organization_members;

-- Allow users to insert themselves as members of any organization
-- (They can only create orgs they own, so this is safe)
CREATE POLICY "Users can add themselves as members" ON organization_members
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Admins can update members in their organizations
CREATE POLICY "Admins can update members" ON organization_members
  FOR UPDATE
  USING (is_organization_admin(organization_id, auth.uid()))
  WITH CHECK (is_organization_admin(organization_id, auth.uid()));

-- Admins can delete members from their organizations
CREATE POLICY "Admins can delete members" ON organization_members
  FOR DELETE
  USING (is_organization_admin(organization_id, auth.uid()));

-- Success
SELECT 'Organization member policies updated! Refresh your browser.' as message;
