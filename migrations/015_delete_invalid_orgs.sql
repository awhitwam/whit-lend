-- ============================================
-- Delete Invalid/Duplicate Organizations
-- ============================================
-- Delete the ADW Enterprises organizations created during testing

-- Delete organization with slug 'adw-enterprises-limited'
DELETE FROM organizations
WHERE slug = 'adw-enterprises-limited';

-- Delete organization with slug 'adw'
DELETE FROM organizations
WHERE slug = 'adw';

-- Verify remaining organizations
SELECT
  id,
  name,
  slug,
  description,
  created_at
FROM organizations
ORDER BY created_at;
