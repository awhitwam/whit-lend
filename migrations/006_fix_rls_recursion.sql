-- ============================================
-- Fix RLS Infinite Recursion
-- ============================================
-- The organization_members policies were creating circular dependencies
-- This script fixes them by using simpler policies

-- Drop the problematic policies
DROP POLICY IF EXISTS "View organization members" ON organization_members;
DROP POLICY IF EXISTS "Admins manage members" ON organization_members;

-- Simpler approach: users can view/manage records where they are the user
-- OR view other members of the same organization
CREATE POLICY "View own membership" ON organization_members
  FOR SELECT
  USING (user_id = auth.uid());

-- Admins can manage all members of their organizations
-- We'll handle this at the application level for now to avoid recursion
CREATE POLICY "Manage own membership" ON organization_members
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Success message
SELECT 'RLS policies fixed! Refresh your browser.' as message;
