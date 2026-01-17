-- ============================================
-- Allow Organization Creation
-- ============================================
-- Allow authenticated users to create new organizations

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view their organizations" ON organizations;
DROP POLICY IF EXISTS "Users can create organizations" ON organizations;
DROP POLICY IF EXISTS "Admins can update their organizations" ON organizations;

-- Allow users to view organizations they are members of
CREATE POLICY "Users can view their organizations" ON organizations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = organizations.id
        AND organization_members.user_id = auth.uid()
        AND organization_members.is_active = true
    )
  );

-- Allow any authenticated user to create an organization
CREATE POLICY "Users can create organizations" ON organizations
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Allow admins to update their organizations
CREATE POLICY "Admins can update their organizations" ON organizations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = organizations.id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'Admin'
        AND organization_members.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = organizations.id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'Admin'
        AND organization_members.is_active = true
    )
  );

-- Success
SELECT 'Organization creation enabled! Refresh your browser.' as message;
