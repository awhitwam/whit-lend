-- =====================================================
-- DELETE EXPENSES SINCE 01/04/2025 (ALL ORGANIZATIONS)
-- =====================================================
-- WARNING: This is a DESTRUCTIVE operation!
-- Run this in the Supabase SQL Editor after reviewing.
--
-- This script will:
-- 1. First delete any ReconciliationEntries that reference these expenses
-- 2. Then delete the expenses themselves
-- =====================================================

-- Step 0: Preview what will be deleted (RUN THIS FIRST!)
-- Uncomment and run this section first to see what will be affected

/*
SELECT
  e.id,
  e.organization_id,
  e.date,
  e.amount,
  e.description,
  e.type_name,
  re.id as reconciliation_entry_id,
  re.bank_statement_id
FROM expenses e
LEFT JOIN reconciliation_entries re ON re.expense_id = e.id
WHERE e.date >= '2025-04-01'
ORDER BY e.organization_id, e.date;
*/

-- Count summary by organization
/*
SELECT
  e.organization_id,
  o.name as org_name,
  COUNT(*) as expense_count,
  SUM(e.amount) as total_amount
FROM expenses e
LEFT JOIN organizations o ON o.id = e.organization_id
WHERE e.date >= '2025-04-01'
GROUP BY e.organization_id, o.name
ORDER BY o.name;
*/

-- =====================================================
-- STEP 1: Delete ReconciliationEntries first (FK dependency)
-- =====================================================
-- This prevents FK constraint violations when deleting expenses

DELETE FROM reconciliation_entries
WHERE expense_id IN (
  SELECT id FROM expenses WHERE date >= '2025-04-01'
);

-- =====================================================
-- STEP 2: Delete AcceptedOrphans that reference these expenses
-- =====================================================

DELETE FROM accepted_orphans
WHERE entity_type = 'expense'
AND entity_id IN (
  SELECT id FROM expenses WHERE date >= '2025-04-01'
);

-- =====================================================
-- STEP 3: Delete the expenses
-- =====================================================

DELETE FROM expenses
WHERE date >= '2025-04-01';

-- =====================================================
-- STEP 4: Verify deletion
-- =====================================================

-- Should return 0 rows if successful
SELECT COUNT(*) as remaining_expenses_since_april_2025
FROM expenses
WHERE date >= '2025-04-01';

-- Optional: Un-reconcile bank statements that were linked to deleted expenses
-- This marks them as needing re-reconciliation
/*
UPDATE bank_statements bs
SET is_reconciled = false, reconciled_at = null
WHERE bs.id IN (
  SELECT DISTINCT bank_statement_id
  FROM reconciliation_entries
  WHERE expense_id IS NOT NULL
  AND bank_statement_id NOT IN (
    SELECT DISTINCT bank_statement_id FROM reconciliation_entries
  )
);
*/
