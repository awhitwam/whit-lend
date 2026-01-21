-- Re-enable RLS on organizations table and restrict creation to super admins
-- RLS was disabled in migration 011 as a temporary fix but never re-enabled
-- Organization creation was too permissive (any authenticated user)

-- 1. Enable RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- 2. Drop the overly permissive creation policy
DROP POLICY IF EXISTS "Users can create organizations" ON organizations;
DROP POLICY IF EXISTS "Admins can create organizations" ON organizations;

-- 3. Create new policy: only super admins can create organizations
CREATE POLICY "Super admins can create organizations" ON organizations
  FOR INSERT
  WITH CHECK (is_super_admin());

SELECT 'RLS enabled and organization creation restricted to super admins' as message;
