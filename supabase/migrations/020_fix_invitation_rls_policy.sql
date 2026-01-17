-- ============================================
-- Fix Invitation RLS Policy
-- ============================================
-- The existing policy tries to access auth.users directly which causes
-- "permission denied for table users" error.
-- We need to use auth.jwt() or user_profiles instead.

-- Drop the existing problematic policies
DROP POLICY IF EXISTS "View organization invitations" ON invitations;
DROP POLICY IF EXISTS "Admins create invitations" ON invitations;
DROP POLICY IF EXISTS "Admins update invitations" ON invitations;

-- Recreate the SELECT policy without accessing auth.users directly
-- Users can view invitations for:
-- 1. Organizations they belong to
-- 2. Invitations sent to their email (using auth.jwt() to get email)
CREATE POLICY "View organization invitations" ON invitations
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    OR email = (auth.jwt() ->> 'email')
  );

-- Admins can create invitations for their organization
CREATE POLICY "Admins create invitations" ON invitations
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND role = 'Admin' AND is_active = true
    )
  );

-- Admins can update invitations for their organization
CREATE POLICY "Admins update invitations" ON invitations
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND role = 'Admin' AND is_active = true
    )
  );

-- Also allow users to update invitations sent to them (to accept them)
CREATE POLICY "Users can accept their invitations" ON invitations
  FOR UPDATE
  USING (
    email = (auth.jwt() ->> 'email')
    AND status = 'pending'
  )
  WITH CHECK (
    email = (auth.jwt() ->> 'email')
    AND status IN ('pending', 'accepted')
  );

-- Allow admins to delete/revoke invitations
CREATE POLICY "Admins delete invitations" ON invitations
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND role = 'Admin' AND is_active = true
    )
  );
