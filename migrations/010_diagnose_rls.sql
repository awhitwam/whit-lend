-- ============================================
-- Diagnose RLS on Organizations Table
-- ============================================

-- Check if RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'organizations';

-- List all policies on organizations table
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'organizations';

-- Check current user
SELECT auth.uid() as current_user_id, current_user;

-- Try to see what's blocking
-- This will show if the INSERT policy exists and is correct
SELECT
  polname as policy_name,
  polcmd as command,
  polpermissive as permissive,
  pg_get_expr(polqual, polrelid) as using_expression,
  pg_get_expr(polwithcheck, polrelid) as with_check_expression
FROM pg_policy
WHERE polrelid = 'organizations'::regclass;
