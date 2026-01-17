-- ============================================
-- Rename Default Organization
-- ============================================
-- Update the name and slug of the first/default organization

-- IMPORTANT: Replace these values with your desired organization name
DO $$
DECLARE
  v_org_id UUID;
  v_new_name TEXT := 'My Lending Company';  -- CHANGE THIS to your desired name
  v_new_slug TEXT := 'my-lending-company';   -- CHANGE THIS to match (lowercase, hyphens only)
  v_new_description TEXT := 'Main lending organization';  -- OPTIONAL: Add a description
BEGIN
  -- Get the first organization (the default one)
  SELECT id INTO v_org_id
  FROM organizations
  ORDER BY created_at
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found to rename';
  END IF;

  -- Update the organization
  UPDATE organizations
  SET
    name = v_new_name,
    slug = v_new_slug,
    description = v_new_description
  WHERE id = v_org_id;

  RAISE NOTICE 'Organization renamed to: %', v_new_name;
END $$;

-- Verify the change
SELECT
  id,
  name,
  slug,
  description,
  created_at
FROM organizations
ORDER BY created_at
LIMIT 1;
