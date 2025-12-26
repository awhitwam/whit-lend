-- ============================================
-- Quick Fix: Add User as Admin by Email
-- ============================================
-- IMPORTANT: Replace 'YOUR_EMAIL_HERE' with your actual email address
-- Then run this in Supabase SQL Editor

DO $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_email TEXT := 'whitwam@gmail.com';
BEGIN
  -- Get user by email
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found. Check your email address.', v_email;
  END IF;

  RAISE NOTICE 'Found user ID: % with email: %', v_user_id, v_email;

  -- Get the default organization (should exist from migration)
  SELECT id INTO v_org_id FROM organizations ORDER BY created_at LIMIT 1;

  IF v_org_id IS NULL THEN
    -- Create an organization if none exists
    INSERT INTO organizations (name, slug, created_by)
    VALUES ('Default Organization', 'default-organization', v_user_id)
    RETURNING id INTO v_org_id;

    RAISE NOTICE 'Created new organization with ID: %', v_org_id;
  ELSE
    RAISE NOTICE 'Using existing organization ID: %', v_org_id;
  END IF;

  -- Add user as admin (or update if exists)
  INSERT INTO organization_members (organization_id, user_id, role, joined_at, is_active)
  VALUES (v_org_id, v_user_id, 'Admin', NOW(), true)
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET role = 'Admin', is_active = true;

  RAISE NOTICE 'Added/updated user % as Admin to organization %', v_user_id, v_org_id;

  -- Also set default organization in user profile
  INSERT INTO user_profiles (id, default_organization_id)
  VALUES (v_user_id, v_org_id)
  ON CONFLICT (id) DO UPDATE SET default_organization_id = v_org_id;

  RAISE NOTICE 'SUCCESS! User % is now Admin. Refresh your browser.', v_email;
END $$;

-- Verify it worked
SELECT
  'User Email: ' || u.email as info,
  'Organization: ' || o.name as organization,
  'Role: ' || om.role as role
FROM auth.users u
JOIN organization_members om ON om.user_id = u.id
JOIN organizations o ON o.id = om.organization_id
WHERE u.email = 'whitwam@gmail.com' AND om.is_active = true;
