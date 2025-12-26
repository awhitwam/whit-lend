-- ============================================
-- Verification and Access Fix Script
-- ============================================
--
-- Run this in Supabase SQL Editor to:
-- 1. Check if you have organization membership
-- 2. Temporarily disable RLS to regain access if needed
-- 3. Verify your setup
--

-- STEP 1: Check your current user and organization membership
-- ============================================

-- Who am I?
SELECT
  auth.uid() as my_user_id,
  auth.email() as my_email;

-- Do I have any organizations?
SELECT
  om.*,
  o.name as org_name,
  o.slug as org_slug
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id
WHERE om.user_id = auth.uid();

-- STEP 2: If you see NO RESULTS above, you need to manually add yourself
-- ============================================
-- Uncomment and run this block if you have no membership:

/*
DO $$
DECLARE
  current_user_id UUID;
  default_org_id UUID;
BEGIN
  -- Get current user
  SELECT auth.uid() INTO current_user_id;

  -- Get the default organization (or create one if none exists)
  SELECT id INTO default_org_id FROM organizations ORDER BY created_at LIMIT 1;

  IF default_org_id IS NULL THEN
    -- Create an organization if none exists
    INSERT INTO organizations (name, slug, created_by)
    VALUES ('My Organization', 'my-organization', current_user_id)
    RETURNING id INTO default_org_id;

    RAISE NOTICE 'Created new organization with ID: %', default_org_id;
  END IF;

  -- Add current user as admin (or update if exists)
  INSERT INTO organization_members (organization_id, user_id, role, joined_at, is_active)
  VALUES (default_org_id, current_user_id, 'Admin', NOW(), true)
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET role = 'Admin', is_active = true;

  RAISE NOTICE 'Added user % as Admin to organization %', current_user_id, default_org_id;

  -- Also set default organization in user profile
  INSERT INTO user_profiles (id, default_organization_id)
  VALUES (current_user_id, default_org_id)
  ON CONFLICT (id) DO UPDATE SET default_organization_id = default_org_id;

  RAISE NOTICE 'Access fixed! Refresh your app.';
END $$;
*/


-- STEP 3: If RLS is blocking you, temporarily disable it
-- ============================================
-- ONLY use this if you absolutely cannot access the app
-- Remember to re-enable RLS after fixing your membership!

/*
-- Disable RLS on organization tables (TEMPORARY FIX ONLY)
ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE invitations DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles DISABLE ROW LEVEL SECURITY;

-- Disable RLS on data tables (TEMPORARY FIX ONLY)
ALTER TABLE borrowers DISABLE ROW LEVEL SECURITY;
ALTER TABLE loans DISABLE ROW LEVEL SECURITY;
ALTER TABLE loan_products DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE repayment_schedules DISABLE ROW LEVEL SECURITY;
ALTER TABLE expenses DISABLE ROW LEVEL SECURITY;
ALTER TABLE expense_types DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Investor" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "InvestorTransaction" DISABLE ROW LEVEL SECURITY;

-- After disabling RLS, run the DO $$ block above to add yourself as admin
-- Then re-enable RLS using the script below
*/


-- STEP 4: Re-enable RLS after fixing membership
-- ============================================
-- Run this after you've fixed your membership

/*
-- Re-enable RLS on organization tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Re-enable RLS on data tables
ALTER TABLE borrowers ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE repayment_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Investor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvestorTransaction" ENABLE ROW LEVEL SECURITY;
*/


-- STEP 5: Verify everything is working
-- ============================================

-- Check organization membership again
SELECT
  om.role,
  om.is_active,
  o.name as org_name,
  o.id as org_id
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id
WHERE om.user_id = auth.uid() AND om.is_active = true;

-- Check if you can see data (should return your org's data)
SELECT COUNT(*) as loan_count FROM loans;
SELECT COUNT(*) as borrower_count FROM borrowers;

-- Done! If you see data above, RLS is working correctly.
