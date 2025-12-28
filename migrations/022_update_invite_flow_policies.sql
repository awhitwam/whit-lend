-- Migration: Update policies for Supabase Auth invite flow
-- This updates the organization_members policies to allow users to activate their own pending membership

-- Drop the old update policy if it exists
DROP POLICY IF EXISTS "Users can update their own membership" ON organization_members;
DROP POLICY IF EXISTS "Admins can update memberships" ON organization_members;

-- Allow users to activate their own pending membership (set is_active = true and joined_at)
CREATE POLICY "Users can activate their own membership" ON organization_members
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Allow admins to update any membership in their organization (for role changes, etc.)
CREATE POLICY "Admins can update memberships" ON organization_members
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND role = 'Admin' AND is_active = true
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND role = 'Admin' AND is_active = true
    )
  );

-- Ensure users can view pending invitations (their own inactive membership)
DROP POLICY IF EXISTS "Users can view their memberships" ON organization_members;

CREATE POLICY "Users can view their memberships" ON organization_members
  FOR SELECT
  USING (user_id = auth.uid());

-- The invitations table is now optional - keeping for backwards compatibility
-- but new invites go through Supabase Auth

-- Add index for faster lookups on pending/inactive members
CREATE INDEX IF NOT EXISTS idx_org_members_pending
  ON organization_members(user_id, is_active)
  WHERE is_active = false;

-- Comment explaining the new invite flow
COMMENT ON TABLE organization_members IS
  'Organization membership. New members are created with is_active=false by the invite Edge Function,
   then activated when the user accepts the email invitation.';
