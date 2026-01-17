-- ============================================
-- Quick Fix: Add Current User as Admin
-- ============================================
-- Run this in Supabase SQL Editor to grant yourself admin access

DO $$
DECLARE
  current_user_id UUID;
  default_org_id UUID;
BEGIN
  -- Get current user
  SELECT auth.uid() INTO current_user_id;

  RAISE NOTICE 'Current user ID: %', current_user_id;

  -- Get the default organization (should exist from migration)
  SELECT id INTO default_org_id FROM organizations ORDER BY created_at LIMIT 1;

  IF default_org_id IS NULL THEN
    -- Create an organization if none exists
    INSERT INTO organizations (name, slug, created_by)
    VALUES ('Default Organization', 'default-organization', current_user_id)
    RETURNING id INTO default_org_id;

    RAISE NOTICE 'Created new organization with ID: %', default_org_id;
  ELSE
    RAISE NOTICE 'Using existing organization ID: %', default_org_id;
  END IF;

  -- Add current user as admin (or update if exists)
  INSERT INTO organization_members (organization_id, user_id, role, joined_at, is_active)
  VALUES (default_org_id, current_user_id, 'Admin', NOW(), true)
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET role = 'Admin', is_active = true;

  RAISE NOTICE 'Added/updated user % as Admin to organization %', current_user_id, default_org_id;

  -- Also set default organization in user profile
  INSERT INTO user_profiles (id, default_organization_id)
  VALUES (current_user_id, default_org_id)
  ON CONFLICT (id) DO UPDATE SET default_organization_id = default_org_id;

  RAISE NOTICE 'SUCCESS! You should now have access. Refresh your browser.';
END $$;

-- Verify it worked
SELECT
  'My User ID: ' || auth.uid()::text as info
UNION ALL
SELECT
  'My Organization: ' || o.name || ' (ID: ' || o.id::text || ')'
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id
WHERE om.user_id = auth.uid() AND om.is_active = true
UNION ALL
SELECT
  'My Role: ' || om.role
FROM organization_members om
WHERE om.user_id = auth.uid() AND om.is_active = true;
