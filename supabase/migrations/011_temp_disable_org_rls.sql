-- ============================================
-- TEMPORARY: Disable RLS on Organizations
-- ============================================
-- This is a temporary fix to test organization creation
-- We'll add proper policies back later

-- Disable RLS on organizations table temporarily
ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;

-- Success
SELECT 'RLS disabled on organizations table. You can now create organizations.' as message;
