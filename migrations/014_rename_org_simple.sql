-- ============================================
-- Rename Default Organization (Simple Version)
-- ============================================
-- IMPORTANT: Replace with your desired name below

-- Update the first/oldest organization
UPDATE organizations
SET
  name = '360 Funding Limited',  -- CHANGE THIS to your desired name
  slug = '360-funding-limited',  -- CHANGE THIS to match (lowercase, hyphens only)
  description = '360 Funding'  -- OPTIONAL: Change this description
WHERE id = (
  SELECT id
  FROM organizations
  ORDER BY created_at
  LIMIT 1
);

-- Verify the change
SELECT
  id,
  name,
  slug,
  description,
  created_at
FROM organizations
ORDER BY created_at;
